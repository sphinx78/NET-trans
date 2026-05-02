// NET-Trans — Background Service Worker
// Handles all API calls, message routing, and storage.
// API keys stay here — never exposed to content scripts.

import {
  callTMTAPI,
  getCulturalNote,
  detectIdiom,
  getGrammarBreakdown,
  getSynonyms,
} from './lib/translator.js';

// simple in-memory cache so we don't spam the API
const bgCache = new Map();
const MAX_CACHE = 500;

function hash(text, src, tgt) {
  const str = `${src}:${tgt}:${text}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16);
}

// defaults
const DEFAULTS = {
  sourceLang: 'en',
  targetLang: 'ne',
  realtimeTranslation: false,
  aiExplanation: true,
  hoverOriginal: true,
  ttsEnabled: true,
  ttsRate: 1.0,
  apiKey: '',
};

async function getSettings() {
  const stored = await chrome.storage.local.get('linguistSettings');
  return { ...DEFAULTS, ...(stored.linguistSettings || {}) };
}

async function saveSettings(updates) {
  const current = await getSettings();
  const merged = { ...current, ...updates };
  await chrome.storage.local.set({ linguistSettings: merged });
  return merged;
}

// core translation — checks cache, calls API, enriches result
async function translate(text, sourceLang, targetLang) {
  if (!text || !text.trim()) return { translatedText: '', provider: 'empty' };

  const key = hash(text, sourceLang, targetLang);
  const cached = bgCache.get(key);
  if (cached) return { ...cached, fromCache: true };

  const settings = await getSettings();
  if (!settings.apiKey) {
    return { error: true, message: 'No API key. Add one in Settings.', translatedText: null };
  }

  let result;
  try {
    result = await callTMTAPI(text, sourceLang, targetLang, settings.apiKey);
  } catch (err) {
    console.warn('[NET-Trans]', err.message);
    return { error: true, message: err.message || 'Translation failed.', translatedText: null };
  }

  // enrich with cultural notes & idiom detection
  result.culturalNote = getCulturalNote(text.split(' ')[0], targetLang);
  result.idiom = detectIdiom(text, sourceLang);

  // cache it
  if (bgCache.size >= MAX_CACHE) bgCache.delete(bgCache.keys().next().value);
  bgCache.set(key, result);

  return result;
}

// message router — content scripts & popup talk to us here
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      const settings = await getSettings();

      switch (message.type) {
        case 'TRANSLATE': {
          const { text, sourceLang, targetLang } = message.payload;
          const result = await translate(text, sourceLang || settings.sourceLang, targetLang || settings.targetLang);
          sendResponse({ success: true, result });
          break;
        }

        case 'SMART_SELECT': {
          const { text, sourceLang, targetLang } = message.payload;
          const src = sourceLang || settings.sourceLang;
          const tgt = targetLang || settings.targetLang;
          const [translation, synonyms, grammar] = await Promise.all([
            translate(text, src, tgt),
            Promise.resolve(getSynonyms(text)),
            Promise.resolve(getGrammarBreakdown(text)),
          ]);
          sendResponse({
            success: true,
            result: {
              translation: translation.translatedText,
              culturalNote: translation.culturalNote,
              idiom: detectIdiom(text, src),
              synonyms, grammar,
              provider: translation.provider,
            },
          });
          break;
        }

        case 'BATCH_TRANSLATE': {
          const { texts, sourceLang, targetLang } = message.payload;
          const src = sourceLang || settings.sourceLang;
          const tgt = targetLang || settings.targetLang;
          const results = [];
          const CHUNK = 10;
          for (let i = 0; i < texts.length; i += CHUNK) {
            const chunk = texts.slice(i, i + CHUNK);
            const chunkResults = await Promise.all(
              chunk.map(t => translate(t, src, tgt).catch(err => ({ translatedText: t, error: true, message: err.message })))
            );
            results.push(...chunkResults);
            if (i + CHUNK < texts.length) await new Promise(r => setTimeout(r, 50));
          }
          sendResponse({ success: true, results });
          break;
        }

        case 'GET_SETTINGS':
          sendResponse({ success: true, settings });
          break;

        case 'SAVE_SETTINGS': {
          const updated = await saveSettings(message.payload);
          sendResponse({ success: true, settings: updated });
          // notify all tabs
          const tabs = await chrome.tabs.query({});
          for (const tab of tabs) {
            try { await chrome.tabs.sendMessage(tab.id, { type: 'SETTINGS_UPDATED', settings: updated }); } catch {}
          }
          break;
        }

        case 'CHECK_DOMAIN':
          sendResponse({ success: true, shouldTranslate: !!settings.realtimeTranslation });
          break;

        case 'CLEAR_CACHE':
          bgCache.clear();
          sendResponse({ success: true });
          break;

        case 'CLEAR_HISTORY':
          await chrome.storage.local.set({ linguistHistory: [] });
          sendResponse({ success: true });
          break;

        case 'ADD_WORD': {
          const word = message.payload;
          const data = await chrome.storage.local.get('linguistWords');
          const words = data.linguistWords || [];
          word.id = Date.now();
          word.addedAt = Date.now();
          words.push(word);
          await chrome.storage.local.set({ linguistWords: words });
          sendResponse({ success: true, id: word.id });
          break;
        }

        case 'GET_WORDS': {
          const data = await chrome.storage.local.get('linguistWords');
          sendResponse({ success: true, words: data.linguistWords || [] });
          break;
        }

        case 'DELETE_WORD': {
          const { id } = message.payload;
          const data = await chrome.storage.local.get('linguistWords');
          const words = (data.linguistWords || []).filter(w => w.id !== id);
          await chrome.storage.local.set({ linguistWords: words });
          sendResponse({ success: true });
          break;
        }

        case 'UPDATE_WORD': {
          const { id: wordId, updates } = message.payload;
          const data = await chrome.storage.local.get('linguistWords');
          const words = data.linguistWords || [];
          const idx = words.findIndex(w => w.id === wordId);
          if (idx >= 0) Object.assign(words[idx], updates);
          await chrome.storage.local.set({ linguistWords: words });
          sendResponse({ success: true });
          break;
        }

        case 'ADD_HISTORY': {
          const entry = message.payload;
          const hData = await chrome.storage.local.get('linguistHistory');
          const history = hData.linguistHistory || [];
          entry.id = Date.now();
          entry.timestamp = Date.now();
          history.unshift(entry);
          if (history.length > 100) history.length = 100;
          await chrome.storage.local.set({ linguistHistory: history });
          sendResponse({ success: true });
          break;
        }

        case 'GET_HISTORY': {
          const hData = await chrome.storage.local.get('linguistHistory');
          sendResponse({ success: true, history: hData.linguistHistory || [] });
          break;
        }

        case 'TOGGLE_GLOSSARY':
          sendResponse({ success: true });
          break;

        default:
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    } catch (err) {
      console.error('[NET-Trans] Message handler error:', err);
      sendResponse({ success: false, error: err.message });
    }
  })();
  return true;
});

// keyboard shortcuts
chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  if (command === 'translate-page') {
    chrome.tabs.sendMessage(tab.id, { type: 'TRANSLATE_PAGE' }).catch(() => {});
  } else if (command === 'translate-selection') {
    chrome.tabs.sendMessage(tab.id, { type: 'TRANSLATE_SELECTION' }).catch(() => {});
  }
});

// right-click context menu
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'nt-translate', title: 'Translate with NET-Trans', contexts: ['selection'] });
  chrome.contextMenus.create({ id: 'nt-save-word', title: 'Save to Dictionary', contexts: ['selection'] });
  chrome.contextMenus.create({ id: 'nt-translate-page', title: 'Translate this page', contexts: ['page'] });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === 'nt-translate' && info.selectionText) {
    chrome.tabs.sendMessage(tab.id, { type: 'CONTEXT_MENU_TRANSLATE', text: info.selectionText }).catch(() => {});
  } else if (info.menuItemId === 'nt-save-word' && info.selectionText) {
    chrome.tabs.sendMessage(tab.id, { type: 'CONTEXT_MENU_SAVE_WORD', text: info.selectionText }).catch(() => {});
  } else if (info.menuItemId === 'nt-translate-page') {
    chrome.tabs.sendMessage(tab.id, { type: 'TRANSLATE_PAGE' }).catch(() => {});
  }
});

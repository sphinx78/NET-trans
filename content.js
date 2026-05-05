// NET-Trans — Content Script
// Handles page translation, smart select popup, hover tooltips, and toasts.

(() => {
  'use strict';

  let settings = {};
  let isPageTranslated = false;
  let isTranslating = false;
  let mutationObserver = null;
  let smartSelectPopup = null;
  let pendingMutations = new Set();

  const originalText = new WeakMap();
  const translatedText = new WeakMap();

  // guard against extension context being invalidated (happens on reload)
  function isAlive() {
    try { return !!chrome.runtime?.id; } catch { return false; }
  }

  function msg(type, payload) {
    payload = payload || {};
    return new Promise(function(resolve, reject) {
      if (!isAlive()) return reject(new Error('Extension reloaded'));
      try {
        chrome.runtime.sendMessage({ type: type, payload: payload }, function(response) {
          if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
          resolve(response);
        });
      } catch (err) { reject(err); }
    });
  }

  async function msgRetry(type, payload, retries) {
    retries = retries || 2;
    for (var i = 0; i <= retries; i++) {
      try { return await msg(type, payload); }
      catch (err) { if (i === retries) throw err; await new Promise(function(r) { setTimeout(r, 300 * (i + 1)); }); }
    }
  }

  // tags we never translate
  var SKIP = new Set(['SCRIPT','STYLE','NOSCRIPT','IFRAME','OBJECT','EMBED','SVG','MATH','CODE','PRE','KBD','SAMP','VAR','TIME','INPUT','TEXTAREA','SELECT']);

  function getTextNodes(root) {
    root = root || document.body;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function(node) {
        var p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (SKIP.has(p.tagName)) return NodeFilter.FILTER_REJECT;
        if (p.closest('[data-nt-skip]')) return NodeFilter.FILTER_REJECT;
        if (p.closest('.nt-popup')) return NodeFilter.FILTER_REJECT;
        if (originalText.has(node)) return NodeFilter.FILTER_REJECT;
        var t = node.textContent.trim();
        if (t.length < 1) return NodeFilter.FILTER_REJECT;
        if (/^[\d\s\.,;:!?\-–—\/\\@#$%^&*()+=\[\]{}|<>"'`~]+$/.test(t)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var nodes = [], n;
    while ((n = walker.nextNode())) nodes.push(n);
    return nodes;
  }

  // full page translation
  async function translatePage(srcLang, tgtLang) {
    if (isTranslating) return;
    isTranslating = true;
    if (!srcLang || !tgtLang) {
      try { var resp = await msg('GET_SETTINGS'); settings = resp && resp.settings ? resp.settings : settings; } catch (e) {}
      srcLang = srcLang || settings.sourceLang || 'en';
      tgtLang = tgtLang || settings.targetLang || 'ne';
    }
    showToast('Translating page...', 'info', 0);
    try {
      var textNodes = getTextNodes();
      if (textNodes.length === 0) { showToast('No translatable text found.', 'warning'); return; }

      // group duplicate text to avoid re-translating
      var textToNodes = new Map();
      for (var i = 0; i < textNodes.length; i++) {
        var text = textNodes[i].textContent.trim();
        if (!text) continue;
        if (!textToNodes.has(text)) textToNodes.set(text, []);
        textToNodes.get(text).push(textNodes[i]);
      }
      var uniqueTexts = Array.from(textToNodes.keys());
      var done = 0;
      var BATCH = 50;

      for (var start = 0; start < uniqueTexts.length; start += BATCH) {
        var batch = uniqueTexts.slice(start, start + BATCH);
        var response = null;
        for (var attempt = 0; attempt < 3; attempt++) {
          try {
            response = await msg('BATCH_TRANSLATE', { texts: batch, sourceLang: srcLang, targetLang: tgtLang });
            if (response && response.results) break;
          } catch (err) {
            if (attempt < 2) await new Promise(function(r) { setTimeout(r, 500 * (attempt + 1)); });
          }
        }
        if (response && response.results) {
          for (var j = 0; j < batch.length; j++) {
            var translated = response.results[j] ? response.results[j].translatedText : null;
            if (translated && translated !== batch[j] && !response.results[j].error) {
              var nodes = textToNodes.get(batch[j]) || [];
              for (var k = 0; k < nodes.length; k++) {
                if (nodes[k].parentElement && !originalText.has(nodes[k])) {
                  originalText.set(nodes[k], batch[j]);
                  translatedText.set(nodes[k], translated);
                  nodes[k].textContent = translated;
                  if (nodes[k].parentElement) nodes[k].parentElement.setAttribute('data-nt-translated', '1');
                }
              }
            }
          }
        }
        done += batch.length;
        showToast('Translating... ' + Math.round((done / uniqueTexts.length) * 100) + '%', 'info', 0);
      }

      isPageTranslated = true;
      startMutationObserver();
      showToast('Page translated', 'success');
    } catch (err) {
      showToast('Translation error: ' + err.message, 'error');
    } finally {
      isTranslating = false;
    }
  }

  function restorePage() {
    document.querySelectorAll('[data-nt-translated]').forEach(function(el) {
      var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      var node;
      while ((node = walker.nextNode())) {
        var orig = originalText.get(node);
        if (orig) { node.textContent = orig; originalText.delete(node); }
      }
      el.removeAttribute('data-nt-translated');
    });
    isPageTranslated = false;
    stopMutationObserver();
    showToast('Original text restored', 'info');
  }

  // watch for new DOM content and translate it too
  function startMutationObserver() {
    if (mutationObserver) return;
    mutationObserver = new MutationObserver(async function(mutations) {
      if (!isPageTranslated || !isAlive()) return;
      var newNodes = [];
      for (var m = 0; m < mutations.length; m++) {
        if (mutations[m].type !== 'childList') continue;
        for (var a = 0; a < mutations[m].addedNodes.length; a++) {
          var added = mutations[m].addedNodes[a];
          if (added.nodeType === Node.ELEMENT_NODE) newNodes.push.apply(newNodes, getTextNodes(added));
          else if (added.nodeType === Node.TEXT_NODE && added.textContent.trim().length > 1 && !originalText.has(added)) newNodes.push(added);
        }
      }
      var toTranslate = newNodes.filter(function(n) { var t = n.textContent.trim(); return t.length > 1 && !pendingMutations.has(t); });
      if (!toTranslate.length) return;
      var texts = toTranslate.map(function(n) { return n.textContent.trim(); });
      texts.forEach(function(t) { pendingMutations.add(t); });
      try {
        var response = await msg('BATCH_TRANSLATE', { texts: texts, sourceLang: settings.sourceLang, targetLang: settings.targetLang });
        if (!response || !response.results) return;
        for (var i = 0; i < toTranslate.length; i++) {
          var translated = response.results[i] ? response.results[i].translatedText : null;
          if (translated && translated !== toTranslate[i].textContent.trim() && !response.results[i].error) {
            originalText.set(toTranslate[i], toTranslate[i].textContent.trim());
            toTranslate[i].textContent = translated;
            if (toTranslate[i].parentElement) toTranslate[i].parentElement.setAttribute('data-nt-translated', '1');
          }
          pendingMutations.delete(texts[i]);
        }
      } catch (err) { texts.forEach(function(t) { pendingMutations.delete(t); }); }
    });
    mutationObserver.observe(document.body, { childList: true, subtree: true });
  }

  function stopMutationObserver() {
    if (mutationObserver) { mutationObserver.disconnect(); mutationObserver = null; }
  }

  // hover over translated text to see original
  function bindHoverOriginal() {
    var tooltip = document.createElement('div');
    tooltip.className = 'nt-hover-tooltip';
    tooltip.setAttribute('data-nt-skip', '1');
    document.body.appendChild(tooltip);

    document.addEventListener('mouseover', function(e) {
      var el = e.target;
      if (!el || !el.hasAttribute || !el.hasAttribute('data-nt-translated')) return;
      var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      var node;
      while ((node = walker.nextNode())) {
        var orig = originalText.get(node);
        if (orig) {
          tooltip.textContent = orig;
          tooltip.style.display = 'block';
          tooltip.style.left = e.pageX + 12 + 'px';
          tooltip.style.top = e.pageY + 12 + 'px';
          break;
        }
      }
    });
    document.addEventListener('mousemove', function(e) {
      if (tooltip.style.display === 'block') {
        tooltip.style.left = e.pageX + 12 + 'px';
        tooltip.style.top = e.pageY + 12 + 'px';
      }
    });
    document.addEventListener('mouseout', function(e) {
      if (e.target && e.target.hasAttribute && e.target.hasAttribute('data-nt-translated')) {
        tooltip.style.display = 'none';
      }
    });
  }

  // the popup that shows when you select text
  function injectSmartSelectPopup() {
    var popup = document.createElement('div');
    popup.className = 'nt-popup';
    popup.setAttribute('data-nt-skip', '1');

    var logoUrl = '';
    try { logoUrl = chrome.runtime.getURL('logo.png'); } catch (e) {}

    popup.innerHTML =
      '<div class="lp-header"><span class="lp-logo">' +
      (logoUrl ? '<img src="' + logoUrl + '" class="lp-logo-img" alt="NET-Trans" />' : '') +
      'NET-Trans</span><div class="lp-actions">' +
      '<button class="lp-btn lp-tts hidden" title="Read aloud">&#128266;</button>' +
      '<button class="lp-btn lp-save" title="Save to Dictionary">&#9734;</button>' +
      '<button class="lp-btn lp-close" title="Close">&#10005;</button></div></div>' +
      '<div class="lp-source"></div><div class="lp-loading hidden"><div class="lp-spinner"></div><span>Analyzing...</span></div>' +
      '<div class="lp-body">' +
      '<div class="lp-section lp-translation-section"><div class="lp-label">Translation</div><div class="lp-translation"></div></div>' +
      '<div class="lp-section lp-idiom-section hidden"><div class="lp-label">Idiom Detected</div><div class="lp-idiom"></div></div>' +
      '<div class="lp-section lp-cultural-section hidden"><div class="lp-label">Cultural Note</div><div class="lp-cultural"></div></div>' +
      '<div class="lp-section lp-synonyms-section hidden"><div class="lp-label">Synonyms</div><div class="lp-synonyms"></div></div>' +
      '<div class="lp-section lp-grammar-section hidden"><div class="lp-label">Grammar</div><div class="lp-grammar"></div></div></div>';

    document.body.appendChild(popup);
    smartSelectPopup = popup;

    popup.querySelector('.lp-close').addEventListener('click', hidePopup);
    popup.querySelector('.lp-tts').addEventListener('click', function() {
      var text = popup.querySelector('.lp-translation').textContent;
      if (text && (settings.targetLang || 'ne') === 'en') speakText(text, 'en');
    });
    popup.querySelector('.lp-save').addEventListener('click', async function() {
      var sourceText = popup.querySelector('.lp-source').textContent;
      var translatedText = popup.querySelector('.lp-translation').textContent;
      if (!sourceText || !translatedText) return;
      var saveBtn = popup.querySelector('.lp-save');
      try {
        await msgRetry('ADD_WORD', {
          word: sourceText, translation: translatedText,
          sourceLang: settings.sourceLang || 'en', targetLang: settings.targetLang || 'ne',
          tag: 'general', important: false, url: location.href, domain: location.hostname
        });
        saveBtn.textContent = '\u2713';
        showToast('Saved to dictionary', 'success');
        setTimeout(function() { saveBtn.textContent = '\u2606'; }, 1500);
      } catch (err) { showToast('Failed to save word', 'error'); }
    });
    document.addEventListener('mousedown', function(e) { if (!popup.contains(e.target)) hidePopup(); });
  }

  async function showSmartSelect(selectedText) {
    if (!smartSelectPopup || !selectedText.trim()) return;
    var popup = smartSelectPopup;
    popup.querySelector('.lp-source').textContent = selectedText;
    popup.querySelector('.lp-body').style.opacity = '0.4';
    popup.querySelector('.lp-loading').classList.remove('hidden');
    var ttsBtn = popup.querySelector('.lp-tts');
    ttsBtn.classList.toggle('hidden', (settings.targetLang || 'ne') !== 'en');
    try {
      var response = await msg('SMART_SELECT', { text: selectedText, sourceLang: settings.sourceLang || 'en', targetLang: settings.targetLang || 'ne' });
      if (!response || !response.result) { popup.querySelector('.lp-translation').textContent = 'Translation unavailable.'; return; }
      var r = response.result;
      popup.querySelector('.lp-translation').textContent = r.translation || '—';
      toggleSection(popup, '.lp-idiom-section', '.lp-idiom', r.idiom ? '"' + r.idiom.phrase + '" — ' + r.idiom.explanation : null);
      toggleSection(popup, '.lp-cultural-section', '.lp-cultural', r.culturalNote);
      toggleSection(popup, '.lp-synonyms-section', '.lp-synonyms', r.synonyms && r.synonyms.length ? r.synonyms.join(', ') : null);
      if (r.grammar && r.grammar.length && selectedText.split(' ').length <= 10) {
        var grammarEl = popup.querySelector('.lp-grammar');
        grammarEl.innerHTML = '';
        r.grammar.forEach(function(g) {
          var span = document.createElement('span');
          span.className = 'lp-grammar-token';
          span.innerHTML = '<b>' + g.word + '</b><small>' + g.pos + '</small>';
          grammarEl.appendChild(span);
        });
        popup.querySelector('.lp-grammar-section').classList.remove('hidden');
      } else popup.querySelector('.lp-grammar-section').classList.add('hidden');
    } catch (err) {
      popup.querySelector('.lp-translation').textContent = 'Error: ' + err.message;
    } finally {
      popup.querySelector('.lp-loading').classList.add('hidden');
      popup.querySelector('.lp-body').style.opacity = '1';
    }
  }

  function toggleSection(popup, sectionSel, contentSel, value) {
    if (value) {
      popup.querySelector(contentSel).textContent = value;
      popup.querySelector(sectionSel).classList.remove('hidden');
    } else {
      popup.querySelector(sectionSel).classList.add('hidden');
    }
  }

  function positionPopup(x, y) {
    var popup = smartSelectPopup;
    popup.style.display = 'block';
    popup.style.opacity = '0';
    setTimeout(function() {
      var rect = popup.getBoundingClientRect();
      var left = x;
      var top = y + window.scrollY + 16;
      if (left + rect.width > window.innerWidth - 16) left = window.innerWidth - rect.width - 16;
      if (left < 8) left = 8;
      if (top + rect.height > window.scrollY + window.innerHeight - 16) top = y + window.scrollY - rect.height - 8;
      popup.style.left = left + 'px';
      popup.style.top = top + 'px';
      popup.style.opacity = '1';
    }, 0);
  }

  function hidePopup() {
    if (smartSelectPopup) {
      smartSelectPopup.style.opacity = '0';
      setTimeout(function() { smartSelectPopup.style.display = 'none'; }, 150);
    }
  }

  function bindTextSelection() {
    document.addEventListener('mouseup', async function(e) {
      if (smartSelectPopup && smartSelectPopup.contains(e.target)) return;
      var sel = window.getSelection();
      var text = sel ? sel.toString().trim() : '';
      if (!text || text.length < 2) { hidePopup(); return; }
      if (text.length > 1000) { showToast('Selection too long.', 'warning'); return; }
      positionPopup(e.clientX, e.clientY);
      await showSmartSelect(text);
    });
  }

  function bindHotkeys() {
    document.addEventListener('keydown', async function(e) {
      if (e.ctrlKey && e.shiftKey && e.key === 'T') { e.preventDefault(); isPageTranslated ? restorePage() : translatePage(); }
      if (e.ctrlKey && e.shiftKey && e.key === 'Y') {
        e.preventDefault();
        var text = window.getSelection() ? window.getSelection().toString().trim() : '';
        if (text) { positionPopup(window.innerWidth / 2, window.innerHeight / 3); await showSmartSelect(text); }
      }
      if (e.key === 'Escape') hidePopup();
    });
  }

  function speakText(text, lang) {
    if (!window.speechSynthesis || lang !== 'en') return;
    window.speechSynthesis.cancel();
    var utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'en-US';
    utter.rate = settings.ttsRate || 1.0;
    window.speechSynthesis.speak(utter);
  }

  // toast notifications
  var toastTimeout = null;
  function showToast(message, type, duration) {
    type = type || 'info';
    duration = duration !== undefined ? duration : 3000;
    var toast = document.getElementById('nt-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'nt-toast';
      toast.setAttribute('data-nt-skip', '1');
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = 'nt-toast nt-toast--' + type + ' show';
    if (toastTimeout) clearTimeout(toastTimeout);
    if (duration > 0) toastTimeout = setTimeout(function() { toast.classList.remove('show'); }, duration);
  }

  // listen for messages from background/popup
  chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    switch (message.type) {
      case 'TRANSLATE_PAGE':
        if (isPageTranslated) restorePage();
        else translatePage(message.sourceLang || null, message.targetLang || null);
        sendResponse({ success: true, isPageTranslated: !isPageTranslated });
        break;
      case 'TRANSLATE_SELECTION':
        var text = window.getSelection() ? window.getSelection().toString().trim() : '';
        if (text) { positionPopup(window.innerWidth / 2, 200); showSmartSelect(text); }
        break;
      case 'RESTORE_PAGE':
        restorePage();
        sendResponse({ success: true });
        break;
      case 'SETTINGS_UPDATED':
        settings = message.settings;
        break;
      case 'CONTEXT_MENU_TRANSLATE':
        positionPopup(window.innerWidth / 2, 200);
        showSmartSelect(message.text);
        break;
      case 'CONTEXT_MENU_SAVE_WORD':
        showSmartSelect(message.text);
        break;
      case 'SPEAK':
        speakText(message.text, message.lang);
        break;
      case 'REMOVE_GLOSSARY':
        if (window.__ntRemoveGlossary) window.__ntRemoveGlossary();
        break;
      case 'GET_PAGE_STATUS':
        sendResponse({ isPageTranslated: isPageTranslated, isTranslating: isTranslating });
        return true;
    }
  });

  // ═══════════════════════════════════════════════════
  // YouTube Subtitle Translation System
  // ═══════════════════════════════════════════════════

  var ytSubs = {
    active: false,
    translating: false,
    overlay: null,
    toggleBtn: null,
    captions: [],          // { start, end, text }
    groups: [],            // { start, end, original, translated }
    videoEl: null,
    syncRAF: null,
    currentIdx: -1,
    wasActive: false,      // remember state across SPA nav
    lastVideoId: null,
    fallbackObserver: null,
    fallbackQueue: [],
    fallbackTimer: null,
    fallbackCache: new Map(),

    isYouTubePage: function() {
      return (location.hostname === 'www.youtube.com' || location.hostname === 'youtube.com')
        && location.pathname === '/watch';
    },

    getVideoId: function() {
      try { return new URL(location.href).searchParams.get('v'); } catch(e) { return null; }
    },

    // wait for the <video> element to exist
    waitForVideo: function() {
      var self = this;
      return new Promise(function(resolve) {
        var tries = 0;
        var check = function() {
          self.videoEl = document.querySelector('video.html5-main-video') || document.querySelector('video');
          if (self.videoEl) return resolve(true);
          if (++tries > 40) return resolve(false);
          setTimeout(check, 400);
        };
        check();
      });
    },

    // inject the bridge script to get caption tracks from YouTube's player
    extractCaptionTracks: function() {
      return new Promise(function(resolve) {
        var resolved = false;
        var handler = function(event) {
          if (event.data && event.data.type === 'NT_YT_CAPTION_TRACKS') {
            window.removeEventListener('message', handler);
            resolved = true;
            resolve(event.data.tracks || []);
          }
        };
        window.addEventListener('message', handler);

        var script = document.createElement('script');
        try { script.src = chrome.runtime.getURL('lib/yt-caption-bridge.js'); } catch(e) { resolve([]); return; }
        script.onload = function() { script.remove(); };
        script.onerror = function() { script.remove(); if (!resolved) resolve([]); };
        (document.head || document.documentElement).appendChild(script);

        setTimeout(function() {
          window.removeEventListener('message', handler);
          if (!resolved) resolve([]);
        }, 5000);
      });
    },

    // fetch and parse timed captions from a track URL
    fetchCaptions: function(baseUrl) {
      // request JSON3 format
      var url = baseUrl + (baseUrl.indexOf('?') >= 0 ? '&' : '?') + 'fmt=json3';
      return fetch(url).then(function(resp) {
        if (!resp.ok) throw new Error('Caption fetch failed: ' + resp.status);
        return resp.json();
      }).then(function(data) {
        var captions = [];
        var events = data.events || [];
        for (var i = 0; i < events.length; i++) {
          var ev = events[i];
          if (!ev.segs || !ev.segs.length) continue;
          var text = '';
          for (var s = 0; s < ev.segs.length; s++) {
            text += (ev.segs[s].utf8 || '');
          }
          text = text.replace(/\n/g, ' ').trim();
          if (!text || text === ' ') continue;
          var startMs = ev.tStartMs || 0;
          var durMs = ev.dDurationMs || 3000;
          captions.push({
            start: startMs / 1000,
            end: (startMs + durMs) / 1000,
            text: text
          });
        }
        return captions;
      }).catch(function() { return []; });
    },

    // group sequential captions into sentences for better translation
    groupIntoSentences: function(captions) {
      if (!captions.length) return [];
      var groups = [];
      var buf = [];
      var PAUSE_THRESHOLD = 1.5; // seconds gap = sentence break

      for (var i = 0; i < captions.length; i++) {
        buf.push(captions[i]);
        var text = captions[i].text;
        var hasEnd = /[.!?।]$/.test(text.trim());
        var nextGap = (i + 1 < captions.length) ? (captions[i + 1].start - captions[i].end) : 999;
        var bufLen = buf.reduce(function(a, c) { return a + c.text.length; }, 0);

        if (hasEnd || nextGap > PAUSE_THRESHOLD || bufLen > 200 || i === captions.length - 1) {
          var combined = buf.map(function(c) { return c.text; }).join(' ').replace(/\s+/g, ' ').trim();
          groups.push({
            start: buf[0].start,
            end: buf[buf.length - 1].end,
            original: combined,
            translated: ''
          });
          buf = [];
        }
      }
      return groups;
    },

    // batch translate all sentence groups
    translateGroups: function() {
      var self = this;
      var texts = self.groups.map(function(g) { return g.original; });
      if (!texts.length) return Promise.resolve();

      var BATCH = 30;
      var done = 0;
      var total = texts.length;

      function translateBatch(startIdx) {
        var batch = texts.slice(startIdx, startIdx + BATCH);
        if (!batch.length) return Promise.resolve();

        return msg('BATCH_TRANSLATE', {
          texts: batch,
          sourceLang: settings.sourceLang || 'en',
          targetLang: settings.targetLang || 'ne'
        }).then(function(response) {
          if (response && response.results) {
            for (var j = 0; j < batch.length; j++) {
              var r = response.results[j];
              if (r && r.translatedText && !r.error) {
                self.groups[startIdx + j].translated = r.translatedText;
              } else {
                self.groups[startIdx + j].translated = self.groups[startIdx + j].original;
              }
            }
          }
          done += batch.length;
          var pct = Math.round((done / total) * 100);
          showToast('Translating subtitles... ' + pct + '%', 'info', 0);

          if (startIdx + BATCH < texts.length) {
            return new Promise(function(r) { setTimeout(r, 80); })
              .then(function() { return translateBatch(startIdx + BATCH); });
          }
        }).catch(function(err) {
          // fill failed entries with original text
          for (var j = startIdx; j < Math.min(startIdx + BATCH, self.groups.length); j++) {
            if (!self.groups[j].translated) self.groups[j].translated = self.groups[j].original;
          }
          done += batch.length;
          if (startIdx + BATCH < texts.length) {
            return new Promise(function(r) { setTimeout(r, 200); })
              .then(function() { return translateBatch(startIdx + BATCH); });
          }
        });
      }

      return translateBatch(0);
    },

    // create the subtitle overlay inside the video player
    createOverlay: function() {
      if (this.overlay) this.overlay.remove();

      var overlay = document.createElement('div');
      overlay.className = 'nt-yt-overlay';
      overlay.setAttribute('data-nt-skip', '1');
      overlay.innerHTML =
        '<div class="nt-yt-sub-original"></div>' +
        '<div class="nt-yt-sub-translated"></div>';

      // place inside the player so it stays with fullscreen
      var player = document.querySelector('#movie_player') || document.querySelector('.html5-video-player');
      if (player) {
        player.appendChild(overlay);
      } else {
        document.body.appendChild(overlay);
      }
      this.overlay = overlay;
    },

    // create the toggle button inside YouTube's control bar
    createToggleButton: function() {
      if (this.toggleBtn) this.toggleBtn.remove();

      var btn = document.createElement('button');
      btn.className = 'nt-yt-toggle ytp-button';
      btn.setAttribute('data-nt-skip', '1');
      btn.setAttribute('title', 'NET-Trans: Translate Subtitles');
      btn.innerHTML =
        '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2">' +
        '<path d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 0 1 6.412 9m6.088 9h7M13 19l3-8 3 8m-5.265-2h4.53"/>' +
        '<path d="M5 8l4 7"/>' +
        '</svg>';

      var self = this;
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        if (self.active) self.deactivate();
        else self.activate();
      });

      // insert into YouTube's right controls
      var rightControls = document.querySelector('.ytp-right-controls');
      if (rightControls) {
        rightControls.insertBefore(btn, rightControls.firstChild);
      } else {
        // fallback: float near the player
        btn.classList.add('nt-yt-toggle-float');
        var player = document.querySelector('#movie_player') || document.querySelector('.html5-video-player');
        if (player) player.appendChild(btn);
        else document.body.appendChild(btn);
      }

      this.toggleBtn = btn;
    },

    // pick the best caption track (prefer source language, then English, then first available)
    pickTrack: function(tracks) {
      var srcLang = settings.sourceLang || 'en';
      // prefer manual tracks over ASR
      var manual = tracks.filter(function(t) { return t.kind !== 'asr'; });
      var pool = manual.length ? manual : tracks;

      for (var i = 0; i < pool.length; i++) {
        if (pool[i].languageCode === srcLang) return pool[i];
      }
      for (var i = 0; i < pool.length; i++) {
        if (pool[i].languageCode === 'en') return pool[i];
      }
      return pool[0] || tracks[0];
    },

    // main activation flow
    activate: function() {
      if (this.active || this.translating) return;
      var self = this;
      self.translating = true;
      if (self.toggleBtn) self.toggleBtn.classList.add('nt-yt-active');
      showToast('Loading captions...', 'info', 0);

      // retry caption extraction a few times (player might not be ready)
      var attempt = 0;
      function tryExtract() {
        return self.extractCaptionTracks().then(function(tracks) {
          if (tracks.length) return tracks;
          if (++attempt < 3) {
            return new Promise(function(r) { setTimeout(r, 1500); }).then(tryExtract);
          }
          return [];
        });
      }

      tryExtract().then(function(tracks) {
        if (!tracks.length) {
          showToast('No captions found. Trying live fallback...', 'warning');
          self.translating = false;
          self.activateFallback();
          return;
        }

        var track = self.pickTrack(tracks);
        showToast('Fetching "' + (track.name || track.languageCode) + '" captions...', 'info', 0);

        return self.fetchCaptions(track.baseUrl).then(function(captions) {
          if (!captions.length) {
            showToast('Caption data empty. Trying live fallback...', 'warning');
            self.translating = false;
            self.activateFallback();
            return;
          }

          self.captions = captions;
          self.groups = self.groupIntoSentences(captions);
          showToast('Translating ' + self.groups.length + ' subtitle groups...', 'info', 0);

          return self.translateGroups().then(function() {
            self.createOverlay();
            self.active = true;
            self.wasActive = true;
            self.translating = false;
            self.currentIdx = -1;
            self.startSync();
            showToast('Subtitles translated! (' + self.groups.length + ' groups)', 'success');
          });
        });
      }).catch(function(err) {
        showToast('Subtitle error: ' + err.message, 'error');
        self.translating = false;
        if (self.toggleBtn) self.toggleBtn.classList.remove('nt-yt-active');
      });
    },

    deactivate: function() {
      this.active = false;
      this.wasActive = false;
      this.stopSync();
      this.stopFallback();
      if (this.overlay) { this.overlay.remove(); this.overlay = null; }
      if (this.toggleBtn) this.toggleBtn.classList.remove('nt-yt-active');
      this.captions = [];
      this.groups = [];
      this.currentIdx = -1;
      showToast('Subtitle translation off', 'info');
    },

    // sync translated subtitles with video playback using RAF
    startSync: function() {
      var self = this;
      if (self.syncRAF) cancelAnimationFrame(self.syncRAF);

      function tick() {
        if (!self.active || !self.videoEl || !self.overlay) return;
        var t = self.videoEl.currentTime;
        var found = -1;

        // binary-ish search for current group
        for (var i = 0; i < self.groups.length; i++) {
          if (t >= self.groups[i].start - 0.15 && t <= self.groups[i].end + 0.1) {
            found = i;
            break;
          }
          if (self.groups[i].start > t + 1) break;
        }

        if (found !== self.currentIdx) {
          self.currentIdx = found;
          var origEl = self.overlay.querySelector('.nt-yt-sub-original');
          var transEl = self.overlay.querySelector('.nt-yt-sub-translated');
          if (found >= 0 && self.groups[found]) {
            origEl.textContent = self.groups[found].original;
            transEl.textContent = self.groups[found].translated;
            self.overlay.classList.add('nt-yt-show');
          } else {
            self.overlay.classList.remove('nt-yt-show');
          }
        }

        self.syncRAF = requestAnimationFrame(tick);
      }

      self.syncRAF = requestAnimationFrame(tick);
    },

    stopSync: function() {
      if (this.syncRAF) { cancelAnimationFrame(this.syncRAF); this.syncRAF = null; }
    },

    // ── Fallback: MutationObserver on live captions ──
    activateFallback: function() {
      var self = this;
      self.createOverlay();
      self.active = true;
      self.wasActive = true;
      if (self.toggleBtn) self.toggleBtn.classList.add('nt-yt-active');

      // observe YouTube's caption container
      var captionContainer = document.querySelector('.ytp-caption-window-container');
      if (!captionContainer) {
        // wait for it
        var waitCount = 0;
        var waitInt = setInterval(function() {
          captionContainer = document.querySelector('.ytp-caption-window-container');
          if (captionContainer || ++waitCount > 30) {
            clearInterval(waitInt);
            if (captionContainer) self.startFallbackObserver(captionContainer);
            else showToast('No caption container found. Enable captions in the video.', 'warning');
          }
        }, 500);
        return;
      }
      self.startFallbackObserver(captionContainer);
      showToast('Live subtitle translation active', 'success');
    },

    startFallbackObserver: function(container) {
      var self = this;
      if (self.fallbackObserver) { self.fallbackObserver.disconnect(); self.fallbackObserver = null; }

      self.fallbackObserver = new MutationObserver(function() {
        if (!self.active) return;
        // read all current caption segments
        var segs = container.querySelectorAll('.ytp-caption-segment');
        var text = '';
        for (var i = 0; i < segs.length; i++) {
          text += (segs[i].textContent || '') + ' ';
        }
        text = text.trim();
        if (!text) {
          if (self.overlay) self.overlay.classList.remove('nt-yt-show');
          return;
        }

        // check cache
        if (self.fallbackCache.has(text)) {
          self.showFallbackSubtitle(text, self.fallbackCache.get(text));
          return;
        }

        // debounce translation requests
        if (self.fallbackTimer) clearTimeout(self.fallbackTimer);
        // show original immediately while translating
        self.showFallbackSubtitle(text, '...');

        self.fallbackTimer = setTimeout(function() {
          msg('BATCH_TRANSLATE', {
            texts: [text],
            sourceLang: settings.sourceLang || 'en',
            targetLang: settings.targetLang || 'ne'
          }).then(function(response) {
            if (response && response.results && response.results[0] && !response.results[0].error) {
              var translated = response.results[0].translatedText;
              self.fallbackCache.set(text, translated);
              // only show if caption text hasn't already changed
              var currentSegs = container.querySelectorAll('.ytp-caption-segment');
              var currentText = '';
              for (var i = 0; i < currentSegs.length; i++) currentText += (currentSegs[i].textContent || '') + ' ';
              if (currentText.trim() === text) {
                self.showFallbackSubtitle(text, translated);
              }
            }
          }).catch(function() {});
        }, 150);
      });

      self.fallbackObserver.observe(container, { childList: true, subtree: true, characterData: true });
    },

    showFallbackSubtitle: function(original, translated) {
      if (!this.overlay) return;
      var origEl = this.overlay.querySelector('.nt-yt-sub-original');
      var transEl = this.overlay.querySelector('.nt-yt-sub-translated');
      origEl.textContent = original;
      transEl.textContent = translated;
      this.overlay.classList.add('nt-yt-show');
    },

    stopFallback: function() {
      if (this.fallbackObserver) { this.fallbackObserver.disconnect(); this.fallbackObserver = null; }
      if (this.fallbackTimer) { clearTimeout(this.fallbackTimer); this.fallbackTimer = null; }
      this.fallbackCache.clear();
    },

    // handle YouTube SPA navigation
    handleNavigation: function() {
      var self = this;
      var newId = self.getVideoId();
      if (!self.isYouTubePage()) {
        // navigated away from a video page
        if (self.active) self.deactivate();
        if (self.toggleBtn) { self.toggleBtn.remove(); self.toggleBtn = null; }
        if (self.overlay) { self.overlay.remove(); self.overlay = null; }
        self.lastVideoId = null;
        return;
      }
      if (newId === self.lastVideoId) return; // same video, nothing to do
      self.lastVideoId = newId;

      // clean up previous
      self.stopSync();
      self.stopFallback();
      self.captions = [];
      self.groups = [];
      self.currentIdx = -1;
      if (self.overlay) { self.overlay.remove(); self.overlay = null; }
      self.active = false;
      if (self.toggleBtn) self.toggleBtn.classList.remove('nt-yt-active');

      // re-init
      self.waitForVideo().then(function(found) {
        if (!found) return;
        if (!self.toggleBtn || !self.toggleBtn.parentElement) self.createToggleButton();
        // re-activate if was previously active
        if (self.wasActive) {
          self.wasActive = false; // will be set again by activate
          setTimeout(function() { self.activate(); }, 1500);
        }
      });
    },

    // full initialization
    setup: function() {
      if (!this.isYouTubePage()) return;
      var self = this;
      self.lastVideoId = self.getVideoId();

      self.waitForVideo().then(function(found) {
        if (!found) return;
        self.createToggleButton();

        // listen for YouTube SPA navigations
        document.addEventListener('yt-navigate-finish', function() {
          setTimeout(function() { self.handleNavigation(); }, 800);
        });
        // also watch for popstate
        window.addEventListener('popstate', function() {
          setTimeout(function() { self.handleNavigation(); }, 800);
        });
      });
    }
  };

  // init
  async function init() {
    if (!isAlive()) return;
    try {
      var resp = await msg('GET_SETTINGS');
      settings = resp && resp.settings ? resp.settings : {};
    } catch (e) { settings = {}; }

    injectSmartSelectPopup();
    bindHotkeys();
    bindTextSelection();
    bindHoverOriginal();

    try {
      var domainCheck = await msg('CHECK_DOMAIN', { url: location.href });
      if (domainCheck && domainCheck.shouldTranslate) translatePage();
    } catch (e) {}

    // initialize YouTube subtitle translation if on YouTube
    ytSubs.setup();
  }

  init();
})();

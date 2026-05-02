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
  }

  init();
})();

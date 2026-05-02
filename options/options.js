(() => {
  'use strict';

  let settings = {};
  let isDirty = false;

  const $ = function(id) { return document.getElementById(id); };
  const dom = {
    apiKey: $('apiKey'),
    btnToggleKey: $('btnToggleKey'),
    sourceLang: $('sourceLang'),
    targetLang: $('targetLang'),
    realtimeTranslation: $('realtimeTranslation'),
    aiExplanation: $('aiExplanation'),
    hoverOriginal: $('hoverOriginal'),
    ttsEnabled: $('ttsEnabled'),
    ttsRate: $('ttsRate'),
    ttsRateVal: $('ttsRateVal'),
    saveBar: $('saveBar'),
    btnSave: $('btnSave'),
    btnClearCache: $('btnClearCache'),
    btnClearHistory: $('btnClearHistory'),
    btnExportDict: $('btnExportDict'),
    btnResetSettings: $('btnResetSettings'),
    sidebarStatus: $('sidebarStatus'),
    toast: $('toast'),
    btnTestKey: $('btnTestKey'),
    apiTestResult: $('apiTestResult'),
  };

  async function load() {
    var res = await sendMsg('GET_SETTINGS');
    settings = res.settings || {};
    dom.apiKey.value = settings.apiKey || '';
    dom.sourceLang.value = settings.sourceLang || 'en';
    dom.targetLang.value = settings.targetLang || 'ne';
    dom.realtimeTranslation.checked = !!settings.realtimeTranslation;
    dom.aiExplanation.checked = settings.aiExplanation !== false;
    dom.hoverOriginal.checked = settings.hoverOriginal !== false;
    dom.ttsEnabled.checked = settings.ttsEnabled !== false;
    dom.ttsRate.value = settings.ttsRate || 1.0;
    dom.ttsRateVal.textContent = settings.ttsRate || '1.0';
    updateStatus();
  }

  async function save() {
    var updated = {
      apiKey: dom.apiKey.value.trim(),
      sourceLang: dom.sourceLang.value,
      targetLang: dom.targetLang.value,
      realtimeTranslation: dom.realtimeTranslation.checked,
      aiExplanation: dom.aiExplanation.checked,
      hoverOriginal: dom.hoverOriginal.checked,
      ttsEnabled: dom.ttsEnabled.checked,
      ttsRate: parseFloat(dom.ttsRate.value),
    };
    await sendMsg('SAVE_SETTINGS', updated);
    settings = Object.assign({}, settings, updated);
    isDirty = false;
    dom.saveBar.classList.add('hidden');
    showToast('Settings saved', 'success');
    updateStatus();
  }

  function sendMsg(type, payload) {
    payload = payload || {};
    return new Promise(function(resolve) {
      chrome.runtime.sendMessage({ type: type, payload: payload }, function(r) { resolve(r || {}); });
    });
  }

  function markDirty() { isDirty = true; dom.saveBar.classList.remove('hidden'); }

  function updateStatus() {
    var lines = [];
    if (!settings.apiKey) lines.push('No API key set');
    if (settings.realtimeTranslation) lines.push('Real-time translation ON');
    dom.sidebarStatus.textContent = lines.join('\n') || 'All systems ready';
  }

  var toastTimer;
  function showToast(message, type) {
    type = type || '';
    dom.toast.textContent = message;
    dom.toast.className = 'toast show ' + type;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function() { dom.toast.classList.remove('show'); }, 3000);
  }

  function bindNavHighlight() {
    var sections = document.querySelectorAll('.section');
    var navLinks = document.querySelectorAll('.nav-link');
    var observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          navLinks.forEach(function(l) { l.classList.remove('active'); });
          var link = document.querySelector('.nav-link[href="#' + entry.target.id + '"]');
          if (link) link.classList.add('active');
        }
      });
    }, { threshold: 0.4 });
    sections.forEach(function(s) { observer.observe(s); });
  }

  function bindEvents() {
    dom.btnSave.addEventListener('click', save);

    dom.btnToggleKey.addEventListener('click', function() {
      if (dom.apiKey.type === 'password') { dom.apiKey.type = 'text'; dom.btnToggleKey.textContent = 'Hide'; }
      else { dom.apiKey.type = 'password'; dom.btnToggleKey.textContent = 'Show'; }
    });

    dom.btnTestKey.addEventListener('click', async function() {
      var key = dom.apiKey.value.trim();
      dom.apiTestResult.classList.remove('hidden');
      if (!key) { dom.apiTestResult.textContent = 'Please enter an API key first.'; dom.apiTestResult.className = 'api-test-result error'; return; }
      dom.apiTestResult.textContent = 'Testing...'; dom.apiTestResult.className = 'api-test-result testing'; dom.btnTestKey.disabled = true;
      try {
        await sendMsg('SAVE_SETTINGS', { apiKey: key });
        var response = await sendMsg('TRANSLATE', { text: 'Hello', sourceLang: 'en', targetLang: 'ne' });
        if (response && response.result && response.result.translatedText && !response.result.error) {
          dom.apiTestResult.textContent = 'API key works! "Hello" translated to "' + response.result.translatedText + '"';
          dom.apiTestResult.className = 'api-test-result success';
        } else {
          dom.apiTestResult.textContent = (response && response.result && response.result.message) || 'Translation failed. Check your API key.';
          dom.apiTestResult.className = 'api-test-result error';
        }
      } catch (err) {
        dom.apiTestResult.textContent = 'Test failed: ' + err.message;
        dom.apiTestResult.className = 'api-test-result error';
      } finally { dom.btnTestKey.disabled = false; }
    });

    dom.ttsRate.addEventListener('input', function() {
      dom.ttsRateVal.textContent = parseFloat(dom.ttsRate.value).toFixed(1);
      markDirty();
    });

    var allInputs = document.querySelectorAll('input, select, textarea');
    allInputs.forEach(function(el) {
      el.addEventListener('change', markDirty);
      if (el.type === 'text' || el.tagName === 'TEXTAREA') el.addEventListener('input', markDirty);
    });

    dom.btnClearCache.addEventListener('click', async function() {
      if (!confirm('Clear translation cache?')) return;
      try { await sendMsg('CLEAR_CACHE'); showToast('Cache cleared', 'success'); } catch (err) { showToast('Error: ' + err.message, 'error'); }
    });

    dom.btnClearHistory.addEventListener('click', async function() {
      if (!confirm('Delete all translation history? This cannot be undone.')) return;
      try { await sendMsg('CLEAR_HISTORY'); showToast('History cleared', 'success'); } catch (err) { showToast('Error: ' + err.message, 'error'); }
    });

    dom.btnExportDict.addEventListener('click', async function() {
      try {
        var response = await sendMsg('GET_WORDS');
        var words = response.words || [];
        var json = JSON.stringify(words, null, 2);
        var blob = new Blob([json], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'net-trans-dictionary-' + new Date().toISOString().slice(0, 10) + '.json';
        a.click();
        URL.revokeObjectURL(url);
        showToast('Dictionary exported!', 'success');
      } catch (err) { showToast('Export failed: ' + err.message, 'error'); }
    });

    dom.btnResetSettings.addEventListener('click', async function() {
      if (!confirm('Reset all settings to defaults?')) return;
      await chrome.storage.local.remove('linguistSettings');
      await load();
      showToast('Settings reset to defaults', 'success');
    });

    document.addEventListener('keydown', function(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); if (isDirty) save(); }
    });

    bindNavHighlight();
  }

  load().then(bindEvents);
})();

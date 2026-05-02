(() => {
  'use strict';

  let settings = {};
  let sourceLang = 'en';
  let targetLang = 'ne';
  let isPageTranslated = false;
  let currentDictTag = 'all';
  let quizWords = [];
  let quizIndex = 0;
  let quizScore = 0;
  let quizStreak = 0;
  let quizBestStreak = 0;

  const LANGUAGES = {
    en: { name: 'English', native: 'English' },
    ne: { name: 'Nepali', native: 'नेपाली' },
    tmg: { name: 'Tamang', native: 'तामाङ' },
  };

  const $ = (id) => document.getElementById(id);
  const dom = {
    langSource: $('langSource'),
    langTarget: $('langTarget'),
    btnSwap: $('btnSwap'),
    inputText: $('inputText'),
    charCount: $('charCount'),
    btnTranslate: $('btnTranslate'),
    btnClearInput: $('btnClearInput'),
    btnTTSInput: $('btnTTSInput'),
    outputWrap: $('outputWrap'),
    outputLoading: $('outputLoading'),
    outputText: $('outputText'),
    outputMeta: $('outputMeta'),
    outputActions: $('outputActions'),
    metaIdiom: $('metaIdiom'),
    metaIdiomText: $('metaIdiomText'),
    metaCultural: $('metaCultural'),
    metaCulturalText: $('metaCulturalText'),
    metaProviderText: $('metaProviderText'),
    btnTTSOutput: $('btnTTSOutput'),
    btnCopy: $('btnCopy'),
    btnSaveWord: $('btnSaveWord'),
    btnTranslatePage: $('btnTranslatePage'),
    btnTranslatePageText: $('btnTranslatePageText'),
    btnSettings: $('btnSettings'),
    btnGlossary: $('btnGlossary'),
    btnHistory: $('btnHistory'),
    btnDictionary: $('btnDictionary'),
    btnQuiz: $('btnQuiz'),
    panelDictionary: $('panelDictionary'),
    panelQuiz: $('panelQuiz'),
    panelHistory: $('panelHistory'),
    dictList: $('dictList'),
    dictSearch: $('dictSearch'),
    histList: $('histList'),
    histSearch: $('histSearch'),
    quizScoreBar: $('quizScoreBar'),
    quizScoreValue: $('quizScoreValue'),
    quizStreak: $('quizStreak'),
    quizCard: $('quizCard'),
    quizProgress: $('quizProgress'),
    quizQuestion: $('quizQuestion'),
    quizInputArea: $('quizInputArea'),
    quizInput: $('quizInput'),
    quizSubmit: $('quizSubmit'),
    quizFeedback: $('quizFeedback'),
    quizNext: $('quizNext'),
    quizSkip: $('quizSkip'),
    quizComplete: $('quizComplete'),
    quizCompleteStats: $('quizCompleteStats'),
    quizRestart: $('quizRestart'),
    quizEmpty: $('quizEmpty'),
  };

  function msg(type, payload = {}) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({ type, payload }, (r) => {
          if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
          resolve(r || {});
        });
      } catch (err) { reject(err); }
    });
  }

  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  async function init() {
    try {
      const res = await msg('GET_SETTINGS');
      settings = res.settings || {};
    } catch { settings = {}; }

    sourceLang = settings.sourceLang || 'en';
    targetLang = settings.targetLang || 'ne';
    updateLangDisplay();
    updateTTSVisibility();

    const tab = await getActiveTab();
    if (tab && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
      try {
        chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_STATUS' }, (resp) => {
          if (chrome.runtime.lastError) return;
          if (resp && resp.isPageTranslated) {
            isPageTranslated = true;
            dom.btnTranslatePageText.textContent = 'Restore Page';
            dom.btnTranslatePage.classList.add('active');
          }
        });
      } catch (e) { /* ignore */ }
    }

    bindEvents();
  }

  function updateLangDisplay() {
    dom.langSource.textContent = LANGUAGES[sourceLang] ? LANGUAGES[sourceLang].name : sourceLang;
    dom.langTarget.textContent = LANGUAGES[targetLang] ? LANGUAGES[targetLang].name : targetLang;
  }

  function updateTTSVisibility() {
    dom.btnTTSInput.classList.toggle('hidden', sourceLang !== 'en');
    dom.btnTTSOutput.classList.toggle('hidden', targetLang !== 'en');
  }

  function showOutput(text, meta) {
    meta = meta || {};
    dom.outputText.textContent = text;
    dom.outputText.classList.remove('hidden');
    dom.outputLoading.classList.add('hidden');
    dom.outputMeta.classList.remove('hidden');
    dom.outputActions.classList.remove('hidden');
    updateTTSVisibility();

    if (meta.idiom) {
      dom.metaIdiomText.textContent = '"' + meta.idiom.phrase + '" — ' + meta.idiom.explanation;
      dom.metaIdiom.classList.remove('hidden');
    } else {
      dom.metaIdiom.classList.add('hidden');
    }

    if (meta.culturalNote) {
      dom.metaCulturalText.textContent = meta.culturalNote;
      dom.metaCultural.classList.remove('hidden');
    } else {
      dom.metaCultural.classList.add('hidden');
    }

    dom.metaProviderText.textContent = meta.provider || 'TMT API';
  }

  function showLangPicker(anchor, which) {
    var existing = document.querySelector('.lang-picker');
    if (existing) existing.remove();

    var picker = document.createElement('div');
    picker.className = 'lang-picker';

    Object.keys(LANGUAGES).forEach(function(code) {
      var info = LANGUAGES[code];
      var item = document.createElement('div');
      item.className = 'lang-picker__item';
      var current = which === 'source' ? sourceLang : targetLang;
      if (current === code) item.classList.add('active');
      item.innerHTML = '<span>' + info.native + '</span><span style="color:var(--text-muted);font-size:11px;">' + info.name + '</span>';
      item.addEventListener('click', async function() {
        if (which === 'source') sourceLang = code;
        else targetLang = code;
        settings.sourceLang = sourceLang;
        settings.targetLang = targetLang;
        updateLangDisplay();
        updateTTSVisibility();
        picker.remove();
        try { await msg('SAVE_SETTINGS', { sourceLang: sourceLang, targetLang: targetLang }); } catch (e) { /* ignore */ }
      });
      picker.appendChild(item);
    });

    var rect = anchor.getBoundingClientRect();
    picker.style.position = 'fixed';
    picker.style.top = (rect.bottom + 4) + 'px';
    picker.style.left = rect.left + 'px';
    document.body.appendChild(picker);

    setTimeout(function() {
      document.addEventListener('click', function handler(e) {
        if (!picker.contains(e.target) && e.target !== anchor) {
          picker.remove();
          document.removeEventListener('click', handler);
        }
      });
    }, 50);
  }

  async function doTranslate() {
    var text = dom.inputText.value.trim();
    if (!text) return;

    dom.outputLoading.classList.remove('hidden');
    dom.outputText.classList.add('hidden');
    dom.outputMeta.classList.add('hidden');
    dom.outputActions.classList.add('hidden');

    try {
      var response = await msg('TRANSLATE', { text: text, sourceLang: sourceLang, targetLang: targetLang });
      if (!response || !response.result) {
        showOutput('Translation unavailable. Check your API key in Settings.', {});
        return;
      }
      var result = response.result;
      if (result.error) {
        showOutput('Error: ' + result.message, {});
        return;
      }
      showOutput(result.translatedText || '—', {
        provider: result.provider,
        culturalNote: result.culturalNote,
        idiom: result.idiom,
      });
      try {
        await msg('ADD_HISTORY', { sourceText: text, translatedText: result.translatedText, sourceLang: sourceLang, targetLang: targetLang });
      } catch (e) { /* ignore */ }
    } catch (err) {
      showOutput('Error: ' + err.message, {});
    }
  }

  function speakText(text, lang) {
    if (!window.speechSynthesis) return;
    if (lang !== 'en') return;
    window.speechSynthesis.cancel();
    var utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'en-US';
    utter.rate = settings.ttsRate || 1.0;
    window.speechSynthesis.speak(utter);
  }

  async function loadDictionary(tag, query) {
    tag = tag || 'all';
    query = query || '';
    try {
      var response = await msg('GET_WORDS');
      var words = response.words || [];
      if (tag !== 'all') words = words.filter(function(w) { return w.tag === tag; });
      if (query) {
        var q = query.toLowerCase();
        words = words.filter(function(w) {
          return (w.word && w.word.toLowerCase().indexOf(q) >= 0) || (w.translation && w.translation.toLowerCase().indexOf(q) >= 0);
        });
      }
      dom.dictList.innerHTML = '';
      if (words.length === 0) {
        dom.dictList.innerHTML = '<div class="empty-state">No words found. Translate text and save to build your dictionary.</div>';
        return;
      }
      words.reverse().forEach(function(word) {
        var item = document.createElement('div');
        item.className = 'dict-item';
        item.innerHTML =
          '<button class="dict-item__star ' + (word.important ? 'important' : '') + '" data-id="' + word.id + '">' + (word.important ? '\u2605' : '\u2606') + '</button>' +
          '<div class="dict-item__words"><div class="dict-item__source">' + esc(word.word || '') + '</div><div class="dict-item__translation">' + esc(word.translation || '') + '</div></div>' +
          '<span class="dict-item__tag">' + esc(word.tag || 'general') + '</span>' +
          '<button class="dict-item__del" data-id="' + word.id + '" title="Delete"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>';

        item.querySelector('.dict-item__star').addEventListener('click', async function(e) {
          var updated = !word.important;
          try {
            await msg('UPDATE_WORD', { id: word.id, updates: { important: updated } });
            word.important = updated;
            e.currentTarget.textContent = updated ? '\u2605' : '\u2606';
            e.currentTarget.classList.toggle('important', updated);
          } catch (err) { /* ignore */ }
        });
        item.querySelector('.dict-item__del').addEventListener('click', async function() {
          try { await msg('DELETE_WORD', { id: word.id }); item.remove(); } catch (err) { /* ignore */ }
        });
        dom.dictList.appendChild(item);
      });
    } catch (err) {
      dom.dictList.innerHTML = '<div class="empty-state">Error loading dictionary.</div>';
    }
  }

  async function loadHistory(query) {
    query = query || '';
    try {
      var response = await msg('GET_HISTORY');
      var items = response.history || [];
      if (query) {
        var q = query.toLowerCase();
        items = items.filter(function(h) {
          return (h.sourceText && h.sourceText.toLowerCase().indexOf(q) >= 0) || (h.translatedText && h.translatedText.toLowerCase().indexOf(q) >= 0);
        });
      }
      dom.histList.innerHTML = '';
      if (items.length === 0) {
        dom.histList.innerHTML = '<div class="empty-state">No translation history yet.</div>';
        return;
      }
      items.forEach(function(h) {
        var item = document.createElement('div');
        item.className = 'hist-item';
        var date = new Date(h.timestamp).toLocaleDateString();
        item.innerHTML =
          '<div class="hist-item__source">' + esc((h.sourceText || '').slice(0, 60)) + '</div>' +
          '<div class="hist-item__target">' + esc((h.translatedText || '').slice(0, 80)) + '</div>' +
          '<div class="hist-item__meta">' + h.sourceLang + ' → ' + h.targetLang + ' · ' + date + '</div>';
        item.addEventListener('click', function() {
          dom.inputText.value = h.sourceText;
          dom.outputText.textContent = h.translatedText;
          dom.outputText.classList.remove('hidden');
          dom.outputMeta.classList.remove('hidden');
          dom.outputActions.classList.remove('hidden');
          dom.panelHistory.classList.add('hidden');
        });
        dom.histList.appendChild(item);
      });
    } catch (err) {
      dom.histList.innerHTML = '<div class="empty-state">Error loading history.</div>';
    }
  }

  async function loadQuiz() {
    quizIndex = 0; quizScore = 0; quizStreak = 0; quizBestStreak = 0;
    updateQuizScore();
    dom.quizComplete.classList.add('hidden');
    dom.quizEmpty.classList.add('hidden');
    dom.quizCard.classList.remove('hidden');
    dom.quizScoreBar.classList.remove('hidden');
    try {
      var response = await msg('GET_WORDS');
      var allWords = response.words || [];
      if (allWords.length === 0) {
        dom.quizCard.classList.add('hidden');
        dom.quizScoreBar.classList.add('hidden');
        dom.quizEmpty.classList.remove('hidden');
        return;
      }
      quizWords = allWords.slice().sort(function() { return Math.random() - 0.5; });
      showQuizWord();
    } catch (err) {
      dom.quizCard.classList.add('hidden');
      dom.quizScoreBar.classList.add('hidden');
      dom.quizEmpty.classList.remove('hidden');
    }
  }

  function updateQuizScore() {
    dom.quizScoreValue.textContent = quizScore + ' / ' + quizIndex;
    dom.quizStreak.textContent = quizStreak;
  }

  function showQuizWord() {
    if (quizIndex >= quizWords.length) { showQuizComplete(); return; }
    var word = quizWords[quizIndex];
    dom.quizProgress.textContent = 'Word ' + (quizIndex + 1) + ' of ' + quizWords.length;
    dom.quizQuestion.textContent = word.word;
    dom.quizInput.value = '';
    dom.quizInput.disabled = false;
    dom.quizFeedback.classList.add('hidden');
    dom.quizNext.classList.add('hidden');
    dom.quizSkip.classList.remove('hidden');
    dom.quizInputArea.classList.remove('hidden');
    dom.quizInputArea.classList.remove('answered');
    dom.quizInput.focus();
  }

  function checkQuizAnswer() {
    var word = quizWords[quizIndex];
    var userAnswer = dom.quizInput.value.trim().toLowerCase();
    var correctAnswer = (word.translation || '').trim().toLowerCase();
    if (!userAnswer) return;
    dom.quizInput.disabled = true;
    dom.quizInputArea.classList.add('answered');
    dom.quizSkip.classList.add('hidden');

    var isCorrect = userAnswer === correctAnswer ||
      correctAnswer.indexOf(userAnswer) >= 0 ||
      userAnswer.indexOf(correctAnswer) >= 0 ||
      levenshteinDistance(userAnswer, correctAnswer) <= Math.max(2, Math.floor(correctAnswer.length * 0.3));

    if (isCorrect) {
      quizScore++;
      quizStreak++;
      if (quizStreak > quizBestStreak) quizBestStreak = quizStreak;
      dom.quizFeedback.textContent = 'Correct!';
      dom.quizFeedback.className = 'quiz-feedback correct';
    } else {
      quizStreak = 0;
      dom.quizFeedback.innerHTML = 'Incorrect<br/><span class="quiz-correct-answer">Answer: ' + esc(word.translation) + '</span>';
      dom.quizFeedback.className = 'quiz-feedback incorrect';
    }
    dom.quizFeedback.classList.remove('hidden');
    dom.quizNext.classList.remove('hidden');
    updateQuizScore();
  }

  function skipQuizWord() {
    var word = quizWords[quizIndex];
    quizStreak = 0;
    dom.quizInput.disabled = true;
    dom.quizSkip.classList.add('hidden');
    dom.quizFeedback.innerHTML = 'Answer: <strong>' + esc(word.translation) + '</strong>';
    dom.quizFeedback.className = 'quiz-feedback skipped';
    dom.quizFeedback.classList.remove('hidden');
    dom.quizNext.classList.remove('hidden');
    updateQuizScore();
  }

  function nextQuizWord() {
    quizIndex++;
    dom.quizInputArea.classList.remove('answered');
    showQuizWord();
  }

  function showQuizComplete() {
    dom.quizCard.classList.add('hidden');
    dom.quizComplete.classList.remove('hidden');
    var pct = quizWords.length > 0 ? Math.round((quizScore / quizWords.length) * 100) : 0;
    var grade = 'Keep practicing!';
    if (pct >= 90) grade = 'Outstanding!';
    else if (pct >= 70) grade = 'Great job!';
    else if (pct >= 50) grade = 'Good effort!';
    dom.quizCompleteStats.innerHTML =
      '<div>' + grade + '</div>' +
      '<div>Score: <strong>' + quizScore + ' / ' + quizWords.length + '</strong> (' + pct + '%)</div>' +
      '<div>Best Streak: <strong>' + quizBestStreak + '</strong></div>';
  }

  function levenshteinDistance(a, b) {
    var matrix = [];
    for (var i = 0; i <= b.length; i++) matrix[i] = [i];
    for (var j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (var i2 = 1; i2 <= b.length; i2++) {
      for (var j2 = 1; j2 <= a.length; j2++) {
        if (b.charAt(i2 - 1) === a.charAt(j2 - 1)) matrix[i2][j2] = matrix[i2 - 1][j2 - 1];
        else matrix[i2][j2] = Math.min(matrix[i2 - 1][j2 - 1] + 1, matrix[i2][j2 - 1] + 1, matrix[i2 - 1][j2] + 1);
      }
    }
    return matrix[b.length][a.length];
  }

  function bindEvents() {
    dom.inputText.addEventListener('input', function() {
      dom.charCount.textContent = dom.inputText.value.length + ' / 2000';
    });
    dom.inputText.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doTranslate(); }
    });
    dom.langSource.addEventListener('click', function() { showLangPicker(dom.langSource, 'source'); });
    dom.langTarget.addEventListener('click', function() { showLangPicker(dom.langTarget, 'target'); });
    dom.btnSwap.addEventListener('click', async function() {
      var tmp = sourceLang; sourceLang = targetLang; targetLang = tmp;
      settings.sourceLang = sourceLang; settings.targetLang = targetLang;
      updateLangDisplay(); updateTTSVisibility();
      try { await msg('SAVE_SETTINGS', { sourceLang: sourceLang, targetLang: targetLang }); } catch (e) { /* ignore */ }
    });
    dom.btnTranslate.addEventListener('click', doTranslate);
    dom.btnClearInput.addEventListener('click', function() {
      dom.inputText.value = ''; dom.charCount.textContent = '0 / 2000';
      dom.outputText.classList.add('hidden'); dom.outputMeta.classList.add('hidden'); dom.outputActions.classList.add('hidden');
    });
    dom.btnTTSInput.addEventListener('click', function() { speakText(dom.inputText.value, sourceLang); });
    dom.btnTTSOutput.addEventListener('click', function() { speakText(dom.outputText.textContent, targetLang); });
    dom.btnCopy.addEventListener('click', function() {
      navigator.clipboard.writeText(dom.outputText.textContent).then(function() {
        showToast('Copied!', 'success');
      });
    });
    dom.btnSaveWord.addEventListener('click', async function() {
      var word = dom.inputText.value.trim();
      var translation = dom.outputText.textContent.trim();
      if (!word || !translation) return;
      try {
        await msg('ADD_WORD', { word: word, translation: translation, sourceLang: sourceLang, targetLang: targetLang, tag: 'general', important: false });
        showToast('Saved to dictionary', 'success');
        if (!dom.panelDictionary.classList.contains('hidden')) loadDictionary(currentDictTag, dom.dictSearch.value);
      } catch (err) { showToast('Failed to save', 'error'); }
    });
    dom.btnTranslatePage.addEventListener('click', async function() {
      var tab = await getActiveTab();
      if (!tab || (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')))) {
        showToast('Cannot translate this page', 'error'); return;
      }
      try {
        await chrome.tabs.sendMessage(tab.id, { type: isPageTranslated ? 'RESTORE_PAGE' : 'TRANSLATE_PAGE', sourceLang: sourceLang, targetLang: targetLang });
      } catch (e) {
        try {
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
          setTimeout(async function() {
            try { await chrome.tabs.sendMessage(tab.id, { type: 'TRANSLATE_PAGE', sourceLang: sourceLang, targetLang: targetLang }); } catch (e2) { /* ignore */ }
          }, 500);
        } catch (e3) { showToast('Cannot translate this page', 'error'); return; }
      }
      isPageTranslated = !isPageTranslated;
      dom.btnTranslatePageText.textContent = isPageTranslated ? 'Restore Page' : 'Translate Page';
      dom.btnTranslatePage.classList.toggle('active', isPageTranslated);
    });
    dom.btnSettings.addEventListener('click', function() {
      chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') });
    });
    dom.btnDictionary.addEventListener('click', async function() { dom.panelDictionary.classList.remove('hidden'); await loadDictionary(); });
    dom.btnQuiz.addEventListener('click', async function() { dom.panelQuiz.classList.remove('hidden'); await loadQuiz(); });
    $('btnCloseHistory').addEventListener('click', function() { dom.panelHistory.classList.add('hidden'); });
    $('btnCloseDictionary').addEventListener('click', function() { dom.panelDictionary.classList.add('hidden'); });
    $('btnCloseQuiz').addEventListener('click', function() { dom.panelQuiz.classList.add('hidden'); });
    document.querySelectorAll('.tag-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        document.querySelectorAll('.tag-btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        currentDictTag = btn.dataset.tag;
        loadDictionary(currentDictTag, dom.dictSearch.value);
      });
    });
    dom.dictSearch.addEventListener('input', function() { loadDictionary(currentDictTag, dom.dictSearch.value); });
    dom.histSearch.addEventListener('input', function() { loadHistory(dom.histSearch.value); });
    dom.quizSubmit.addEventListener('click', checkQuizAnswer);
    dom.quizInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); dom.quizNext.classList.contains('hidden') ? checkQuizAnswer() : nextQuizWord(); }
    });
    dom.quizSkip.addEventListener('click', skipQuizWord);
    dom.quizNext.addEventListener('click', nextQuizWord);
    dom.quizRestart.addEventListener('click', loadQuiz);

    // Glossary
    dom.btnGlossary.addEventListener('click', async function() {
      var tab = await getActiveTab();
      if (!tab || (tab.url && tab.url.startsWith('chrome://'))) { showToast('Cannot use on this page', 'error'); return; }
      var active = dom.btnGlossary.classList.toggle('active');
      if (active) {
        try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: function(lang) { window.__ntTargetLang = lang; }, args: [targetLang] }); } catch (e) { /* ignore */ }
        try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['lib/glossary.js'] }); } catch (e) { showToast('Cannot inject on this page', 'error'); }
        showToast('Glossary active', 'success');
      } else {
        try { chrome.tabs.sendMessage(tab.id, { type: 'REMOVE_GLOSSARY' }); } catch (e) { /* ignore */ }
        showToast('Glossary removed');
      }
    });

    // History panel
    dom.btnHistory.addEventListener('click', async function() { dom.panelHistory.classList.remove('hidden'); await loadHistory(); });
  }

  function esc(str) {
    var d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  var toastTimer = null;
  function showToast(message, type) {
    type = type || 'info';
    var toast = document.getElementById('popup-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'popup-toast';
      toast.className = 'popup-toast';
      document.querySelector('.app').appendChild(toast);
    }
    toast.textContent = message;
    toast.className = 'popup-toast show' + (type !== 'info' ? ' ' + type : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function() { toast.classList.remove('show'); }, 2500);
  }

  init();
})();

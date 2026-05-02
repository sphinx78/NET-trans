// NET-Trans — Glossary Overlay
// Highlights complex words on the page and shows translations on hover.

(() => {
  'use strict';

  if (window.__ntGlossaryActive) return;
  window.__ntGlossaryActive = true;

  let glossaryTargetLang = window.__ntTargetLang || 'ne';
  let glossarySourceLang = 'en';

  try {
    chrome.runtime.sendMessage({ type: 'GET_SETTINGS', payload: {} }, (resp) => {
      if (resp?.settings) {
        glossaryTargetLang = window.__ntTargetLang || resp.settings.targetLang || glossaryTargetLang;
        glossarySourceLang = resp.settings.sourceLang || glossarySourceLang;
      }
    });
  } catch {}

  // common words we skip
  const COMMON = new Set([
    'the','be','to','of','and','a','in','that','have','it','for','not','on',
    'with','he','as','you','do','at','this','but','his','by','from','they',
    'we','say','her','she','or','an','will','my','one','all','would','there',
    'their','what','so','up','out','if','about','who','get','which','go','me',
    'when','make','can','like','time','no','just','him','know','take','people',
    'into','year','your','good','some','could','them','see','other','than',
    'then','now','look','only','come','its','over','think','also','back','after',
    'use','two','how','our','work','first','well','way','even','new','want',
    'because','any','these','give','day','most','us','great','between','need',
    'large','often','hand','high','place','hold','turn','here','why','ask',
    'went','men','read','land','different','home','move','try','kind',
    'picture','again','change','off','play','spell','air','away','animal',
    'house','point','page','letter','mother','answer','found','study','still',
    'learn','should','world','think','such','through','form',
  ]);

  // high-value vocabulary words to always highlight
  const HIGH_VALUE = new Set([
    'albeit','ubiquitous','paradigm','exacerbate','mitigate',
    'concurrently','juxtapose','ambiguous','empirical','hypothesis','synthesis',
    'qualitative','quantitative','methodology','phenomenon','correlation',
    'causation','inference','abstract','theoretical','pragmatic','discourse',
    'dichotomy','autonomy','sovereignty','hegemony','ideology','rhetoric',
    'algorithm','heuristic','recursion','abstraction','polymorphism','encapsulation',
    'asynchronous','concurrent','latency','throughput','scalability','refactor',
    'deprecate','instantiate','iteration','optimization','infrastructure',
    'ameliorate','promulgate','obfuscate','circumvent','proliferate','coherent',
    'unprecedented','intrinsic','extrinsic','ambivalent','detrimental',
    'alleviate','pervasive','inextricably','consequently',
    'notwithstanding','inadvertently','inherently','substantially','predominantly',
  ]);

  function scoreWord(word) {
    const w = word.toLowerCase().replace(/[^a-z]/g, '');
    if (w.length < 5 || COMMON.has(w)) return 0;
    if (HIGH_VALUE.has(w)) return 3;
    const syllables = w.replace(/[^aeiou]/g, '').length;
    if (syllables >= 4 || w.length >= 10) return 2;
    if (syllables >= 3 || w.length >= 8) return 1;
    return 0;
  }

  // tooltip
  let tooltip = null;

  function getTooltip() {
    if (tooltip) return tooltip;
    tooltip = document.createElement('div');
    tooltip.className = 'nt-gloss-tooltip';
    tooltip.setAttribute('data-nt-skip', '1');
    document.body.appendChild(tooltip);
    return tooltip;
  }

  function showTooltip(word, x, y) {
    const t = getTooltip();
    t.innerHTML = `<div class="lgt-word">${esc(word)}</div><div class="lgt-loading">Looking up…</div><div class="lgt-body" style="display:none"></div>`;
    t.style.left = (x + 12) + 'px';
    t.style.top = (y + window.scrollY + 16) + 'px';
    requestAnimationFrame(() => {
      const rect = t.getBoundingClientRect();
      if (rect.right > window.innerWidth - 8) t.style.left = (window.innerWidth - rect.width - 8) + 'px';
    });
    t.classList.add('visible');

    chrome.runtime.sendMessage({
      type: 'SMART_SELECT',
      payload: { text: word, sourceLang: glossarySourceLang, targetLang: glossaryTargetLang },
    }, (response) => {
      const loading = t.querySelector('.lgt-loading');
      const body = t.querySelector('.lgt-body');
      if (!loading || !body) return;
      loading.style.display = 'none';
      body.style.display = 'block';
      if (response?.result?.translation) {
        const r = response.result;
        body.innerHTML = `<div class="lgt-translation">${esc(r.translation)}</div>` +
          (r.synonyms?.length ? `<div class="lgt-synonyms">Also: ${r.synonyms.slice(0, 3).join(', ')}</div>` : '') +
          (r.idiom ? `<div class="lgt-idiom">💡 ${esc(r.idiom.explanation)}</div>` : '');
      } else {
        body.textContent = 'No definition found.';
      }
    });
  }

  function hideTooltip() { tooltip?.classList.remove('visible'); }

  // highlight engine
  const SKIP_TAGS = new Set(['SCRIPT','STYLE','NOSCRIPT','CODE','PRE','KBD','INPUT','TEXTAREA','SELECT','BUTTON','MATH','SVG']);

  function highlightTextNode(node) {
    const text = node.textContent;
    const words = text.split(/(\b\w+\b)/);
    let any = false;
    const frag = document.createDocumentFragment();
    for (const part of words) {
      const score = scoreWord(part);
      if (score > 0) {
        const span = document.createElement('mark');
        span.className = `nt-gloss nt-gloss--lvl${score}`;
        span.setAttribute('data-nt-word', part);
        span.textContent = part;
        frag.appendChild(span);
        any = true;
      } else {
        frag.appendChild(document.createTextNode(part));
      }
    }
    if (any) node.parentNode.replaceChild(frag, node);
  }

  function applyGlossary(root) {
    root = root || document.body;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (SKIP_TAGS.has(p.tagName)) return NodeFilter.FILTER_REJECT;
        if (p.classList.contains('nt-gloss')) return NodeFilter.FILTER_REJECT;
        if (p.closest('[data-nt-skip]')) return NodeFilter.FILTER_REJECT;
        if (node.textContent.trim().length < 4) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) nodes.push(node);
    nodes.forEach(highlightTextNode);
  }

  function removeGlossary() {
    document.querySelectorAll('.nt-gloss').forEach((el) => {
      el.replaceWith(document.createTextNode(el.textContent));
    });
    hideTooltip();
    window.__ntGlossaryActive = false;
    delete window.__ntGlossaryActive;
  }

  // events
  document.addEventListener('mouseover', (e) => {
    if (e.target.classList?.contains('nt-gloss')) {
      showTooltip(e.target.dataset.ntWord, e.clientX, e.clientY);
    }
  });
  document.addEventListener('mouseout', (e) => {
    if (e.target.classList?.contains('nt-gloss')) {
      setTimeout(() => { if (!tooltip?.matches(':hover')) hideTooltip(); }, 200);
    }
  });
  tooltip && tooltip.addEventListener('mouseleave', hideTooltip);

  // inject styles
  const style = document.createElement('style');
  style.textContent = `
    .nt-gloss { border-radius: 3px; cursor: help; background: transparent; color: inherit; transition: background 0.15s; padding: 0 1px; }
    .nt-gloss--lvl1 { border-bottom: 1.5px dotted rgba(9,105,179,0.4); }
    .nt-gloss--lvl2 { border-bottom: 1.5px solid rgba(9,105,179,0.6); background: rgba(9,105,179,0.04); }
    .nt-gloss--lvl3 { border-bottom: 2px solid rgba(9,105,179,0.8); background: rgba(9,105,179,0.08); font-weight: 600; }
    .nt-gloss:hover { background: rgba(9,105,179,0.1) !important; }
    .nt-gloss-tooltip { position: absolute; z-index: 2147483640; width: 220px; background: #fff; border: 1px solid #d8dee4; border-radius: 10px; padding: 10px 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 12px; color: #1f2937; box-shadow: 0 8px 24px rgba(0,0,0,0.1); opacity: 0; transform: translateY(4px); transition: opacity 0.15s, transform 0.15s; pointer-events: none; }
    .nt-gloss-tooltip.visible { opacity: 1; transform: translateY(0); pointer-events: auto; }
    .lgt-word { font-size: 14px; font-weight: 800; color: #0969b3; margin-bottom: 5px; }
    .lgt-translation { font-size: 13px; color: #1f2937; font-weight: 600; margin-bottom: 4px; }
    .lgt-synonyms { font-size: 11px; color: #6b7280; margin-top: 4px; }
    .lgt-idiom { font-size: 11px; color: #6b7280; margin-top: 5px; padding: 5px 8px; background: #f6f8fa; border-radius: 5px; border-left: 2px solid #0969b3; }
    .lgt-loading { font-size: 11px; color: #9ca3af; }
  `;
  document.head.appendChild(style);

  applyGlossary();
  window.__ntRemoveGlossary = removeGlossary;

  function esc(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }
})();

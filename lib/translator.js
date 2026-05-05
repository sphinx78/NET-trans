// NET-Trans — Translation Engine
// Handles API calls, cultural notes, idiom detection, grammar tagging, and synonyms.
// Only imported in background.js — API key never leaves the service worker.

// cultural notes for Nepali/Tamang words
const CULTURAL_NOTES = {
  ne: {
    namaste: 'Formal greeting in Nepali culture, used universally across age groups.',
    dai: '"Dai" (दाई) respectfully addresses an older male, even strangers.',
    bahini: '"Bahini" (बहिनी) means younger sister; used to address younger women.',
    tapai: '"Tapai" (तपाई) is formal "you" — always use with elders or strangers.',
    hajur: '"Hajur" (हजुर) is the most respectful "you" — for elders or officials.',
    timi: '"Timi" (तिमी) is informal "you" — used with friends and peers.',
    ta: '"Ta" (त) is very informal "you" — only with close friends; can be rude.',
  },
  tmg: {
    lama: 'In Tamang culture, "Lama" refers to a Buddhist monk or spiritual leader.',
  },
};

export function getCulturalNote(word, targetLang) {
  return (CULTURAL_NOTES[targetLang] || {})[word.toLowerCase()] || null;
}

// English idiom detection
const IDIOMS = {
  en: {
    'break a leg': 'Means "good luck" — wishing someone success.',
    'hit the nail on the head': 'To describe something exactly right.',
    'bite the bullet': 'To endure a painful situation bravely.',
    'cost an arm and a leg': 'Something very expensive.',
    'once in a blue moon': 'Something that happens very rarely.',
    'under the weather': 'Feeling sick or unwell.',
  },
};

export function detectIdiom(text, sourceLang) {
  const idiomMap = IDIOMS[sourceLang] || {};
  const lower = text.toLowerCase().trim();
  for (const [phrase, explanation] of Object.entries(idiomMap)) {
    if (lower.includes(phrase)) return { phrase, explanation };
  }
  return null;
}

// basic grammar tagging
export function getGrammarBreakdown(text) {
  const words = text.trim().split(/\s+/);
  const articles = new Set(['a', 'an', 'the']);
  const preps = new Set(['in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'about']);
  const conj = new Set(['and', 'but', 'or', 'nor', 'so', 'yet', 'although', 'because', 'since', 'while']);
  const aux = new Set(['is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can', 'shall']);
  const pronouns = new Set(['i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his', 'its', 'our', 'their']);

  return words.map(word => {
    const w = word.toLowerCase().replace(/[.,!?;:]$/, '');
    let pos = 'Noun/Other';
    if (articles.has(w)) pos = 'Article';
    else if (preps.has(w)) pos = 'Preposition';
    else if (conj.has(w)) pos = 'Conjunction';
    else if (aux.has(w)) pos = 'Auxiliary verb';
    else if (pronouns.has(w)) pos = 'Pronoun';
    else if (w.endsWith('ly')) pos = 'Adverb';
    else if (w.endsWith('ing') || w.endsWith('ed') || w.endsWith('tion') || w.endsWith('ment')) pos = 'Verb/Noun';
    else if (w.endsWith('ful') || w.endsWith('less') || w.endsWith('ous') || w.endsWith('ive')) pos = 'Adjective';
    return { word, pos };
  });
}

// TMT API client (Google TMT Hackathon 2026)
const TMT_API = 'https://tmt.ilprl.ku.edu.np/lang-translate';

export async function callTMTAPI(text, sourceLang, targetLang, apiKey) {
  const cleanKey = apiKey.replace(/^Bearer\s+/i, '').trim();
  const langMap = { en: 'en', ne: 'ne', tmg: 'tmg', eng: 'en', nep: 'ne' };
  const src = langMap[sourceLang] || sourceLang;
  const tgt = langMap[targetLang] || targetLang;

  if (src === tgt) return { translatedText: text, confidence: 1.0, provider: 'passthrough' };

  const response = await fetch(TMT_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cleanKey}` },
    body: JSON.stringify({ text, src_lang: src, tgt_lang: tgt }),
    signal: AbortSignal.timeout(15000),
  });

  const data = await response.json();
  if (data.message_type !== 'SUCCESS') throw new Error(data.message || `TMT API error: ${response.status}`);

  let translated = data.output;
  if (tgt === 'tmg') translated = dedup(translated);

  return { translatedText: translated, confidence: 1.0, provider: 'tmt-api', srcLang: data.src_lang, tgtLang: data.target_lang };
}

// TMT sometimes returns repeated phrases for Tamang — clean that up
function dedup(text) {
  if (!text || text.length < 3) return text;

  // try sentence-level dedup
  const parts = text.split(/([।\.!?]+)/).filter(Boolean);
  if (parts.length > 2) {
    const seen = new Set();
    const result = [];
    for (const part of parts) {
      const t = part.trim();
      if (/^[।\.!?]+$/.test(t)) { result.push(part); continue; }
      if (!t) continue;
      if (!seen.has(t)) { seen.add(t); result.push(part); }
    }
    const joined = result.join('').trim();
    if (joined) return joined;
  }

  // try word-level repeating unit detection
  const words = text.split(/\s+/);
  if (words.length >= 4) {
    for (let len = 1; len <= Math.floor(words.length / 2); len++) {
      const unit = words.slice(0, len).join(' ');
      let match = true;
      for (let i = len; i < words.length; i += len) {
        if (words.slice(i, i + len).join(' ') !== unit) { match = false; break; }
      }
      if (match && words.length % len === 0) return unit;
    }
  }

  return text;
}

// local synonym lookup
const SYNONYMS = {
  happy: ['joyful', 'content', 'pleased', 'delighted', 'cheerful'],
  sad: ['unhappy', 'sorrowful', 'dejected', 'melancholy'],
  big: ['large', 'huge', 'enormous', 'vast', 'grand'],
  small: ['tiny', 'little', 'miniature', 'petite', 'compact'],
  fast: ['quick', 'rapid', 'swift', 'speedy'],
  slow: ['sluggish', 'gradual', 'unhurried', 'leisurely'],
  good: ['excellent', 'fine', 'great', 'superb', 'splendid'],
  bad: ['poor', 'inferior', 'awful', 'terrible'],
  beautiful: ['gorgeous', 'lovely', 'stunning', 'attractive'],
  smart: ['intelligent', 'clever', 'bright', 'sharp'],
};

export function getSynonyms(word) {
  return SYNONYMS[word.toLowerCase()] || [];
}

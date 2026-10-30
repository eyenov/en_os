/**
 * Word-level timing estimates for line-level transcripts.
 *
 * Podcast VTT and some YouTube timedtext payloads only provide line/cue
 * boundaries. We estimate the words inside a line with syllable weights and
 * punctuation pauses instead of raw character counts, which keeps the
 * highlight much closer to natural speech.
 */

const WORD_RE = /[\p{L}\p{N}]+(?:['’.\-][\p{L}\p{N}]+)*/gu;
const PAUSE_AFTER = [
  [/[,，、]/, 0.11],
  [/[;；:：]/, 0.16],
  [/[.!?。！？]/, 0.22],
  [/[—–]/, 0.12],
  [/…/, 0.2],
];

const FUNCTION_WORDS = new Set([
  'a', 'an', 'the', 'of', 'to', 'in', 'on', 'at', 'is', 'are', 'was', 'were',
  'it', 'its', 'and', 'or', 'for', 'with', 'from', 'as', 'that', 'this',
  'these', 'those', 'be', 'been', 'am', 'do', 'does', 'did', 'has', 'have',
  'had', 'but', 'if', 'so', 'we', 'you', 'they', 'he', 'she', 'i',
]);

function cleanWord(value = '') {
  return String(value).replace(/[^\p{L}\p{N}']/gu, '').toLowerCase();
}

export function estimateSyllables(value = '') {
  const token = String(value).trim();
  const word = cleanWord(token);
  if (!word) return 1;
  if (/^\d+$/.test(word)) {
    return Math.max(1, Math.ceil(word.length * 0.8));
  }
  // Initialisms such as US, RSS, AI are spoken letter by letter.
  if (/^[A-Z]{2,4}$/.test(token.replace(/[^\p{L}]/gu, ''))) {
    return Math.max(2, token.replace(/[^\p{L}]/gu, '').length);
  }
  if (/^\d+[a-z]{1,2}$/.test(word)) return 1;
  let count = word.match(/[aeiouy]+/g)?.length || 1;
  if (word.length > 2 && /e$/.test(word) && !/[aeiouy]e$/.test(word)) count -= 1;
  if (/[^aeiouy]le$/.test(word)) count += 1;
  return Math.max(1, count);
}

function pauseFor(punctuation = '') {
  for (const [pattern, seconds] of PAUSE_AFTER) {
    if (pattern.test(punctuation)) return seconds;
  }
  return 0;
}

function normalizeToken(token) {
  if (typeof token === 'string') {
    const original = token.trim();
    const core = original.match(WORD_RE)?.[0] || original;
    const tail = original.slice(original.lastIndexOf(core) + core.length);
    return { text: original, punct: tail.match(/^\s*([^\p{L}\p{N}\s]+)/u)?.[1] || '' };
  }
  const text = String(token?.text || '').trim();
  const punct = String(token?.punct || '');
  return {
    text: `${text}${punct}`,
    punct,
  };
}

export function tokenizeTimedText(text = '') {
  const source = String(text);
  const tokens = [];
  for (const match of source.matchAll(WORD_RE)) {
    const tail = source.slice(match.index + match[0].length).match(/^\s*([^\p{L}\p{N}\s]+)/u)?.[1] || '';
    tokens.push({ text: match[0], punct: tail });
  }
  return tokens;
}

export function distributeWords(tokens = [], start = 0, end = 1) {
  const normalized = tokens.map(normalizeToken).filter((token) => token.text);
  if (!normalized.length) return [];
  const from = Number(start);
  const to = Number(end);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return [];

  const paused = normalized.map((token) => pauseFor(token.punct));
  paused[paused.length - 1] = 0;
  let pauseTotal = paused.reduce((sum, value) => sum + value, 0);
  const duration = to - from;
  const maxPause = duration * 0.26;
  if (pauseTotal > maxPause) {
    const scale = maxPause / pauseTotal;
    for (let index = 0; index < paused.length; index += 1) paused[index] *= scale;
    paused[paused.length - 1] = 0;
    pauseTotal = paused.reduce((sum, value) => sum + value, 0);
  }
  const spoken = Math.max(0.04, duration - pauseTotal);
  const weights = normalized.map((token) => {
    const syllables = estimateSyllables(token.text);
    const base = syllables + 0.35;
    return FUNCTION_WORDS.has(cleanWord(token.text)) ? base * 0.82 : base;
  });
  const totalWeight = weights.reduce((sum, value) => sum + value, 0) || 1;
  const minDuration = duration >= normalized.length * 0.055 ? 0.055 : 0;

  let cursor = from;
  return normalized.map((token, index) => {
    const wordDuration = Math.max(minDuration, (spoken * weights[index]) / totalWeight);
    const wordStart = Math.min(to, cursor);
    const wordEnd = Math.min(to, wordStart + wordDuration);
    cursor = Math.min(to, wordEnd + paused[index]);
    return {
      text: token.text,
      start: Math.round(wordStart * 1000) / 1000,
      end: Math.round(Math.max(wordStart, wordEnd) * 1000) / 1000,
    };
  });
}

/** Pure text-scoring helpers. Shared by the browser app and the Node tests. */

export function hashString(input = '') {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function mulberry32(seed) {
  let value = seed >>> 0;
  return function random() {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(items, seed = 1) {
  const random = mulberry32(seed);
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

export function escapeRegExp(value = '') {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normaliseText(value = '') {
  return value
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[^a-z0-9'\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(value = '') {
  const normalised = normaliseText(value);
  return normalised ? normalised.split(' ') : [];
}

export function wordsOnly(value = '') {
  return (value.match(/[A-Za-z][A-Za-z'-]*/g) || []);
}

export function countWords(value = '') {
  return wordsOnly(value).length;
}

export function countSentences(value = '') {
  const pieces = String(value || '')
    .split(/(?<=[.!?])\s+/)
    .map((piece) => piece.trim())
    .filter(Boolean);
  return pieces.length;
}

export function uniqueRatio(value = '') {
  const tokens = tokenize(value);
  if (!tokens.length) return 0;
  return new Set(tokens).size / tokens.length;
}

export function containsWord(text = '', word = '') {
  if (!word) return false;
  return new RegExp(`\\b${escapeRegExp(word)}(?:s|es|ed|d|ing)?\\b`, 'i').test(text);
}

export function containsPhrase(text = '', phrase = '') {
  if (!phrase) return false;
  return normaliseText(text).includes(normaliseText(phrase));
}

export function lcsLength(a, b) {
  const left = Array.isArray(a) ? a : tokenize(a);
  const right = Array.isArray(b) ? b : tokenize(b);
  if (!left.length || !right.length) return 0;
  let previous = new Array(right.length + 1).fill(0);
  for (let i = 1; i <= left.length; i += 1) {
    const current = new Array(right.length + 1).fill(0);
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = left[i - 1] === right[j - 1]
        ? previous[j - 1] + 1
        : Math.max(previous[j], current[j - 1]);
    }
    previous = current;
  }
  return previous[right.length];
}

export function similarity(a, b) {
  const left = tokenize(a);
  const right = tokenize(b);
  if (!left.length && !right.length) return 1;
  if (!left.length || !right.length) return 0;
  return (2 * lcsLength(left, right)) / (left.length + right.length);
}

/**
 * Compare a shadowing attempt with the model sentence.
 * accuracy = matched words / model words (word order aware via LCS).
 */
export function compareSpeech(target, transcript, durationSeconds = 0) {
  const targetTokens = tokenize(target);
  const heardTokens = tokenize(transcript);
  const matched = lcsLength(targetTokens, heardTokens);
  const accuracy = targetTokens.length ? matched / targetTokens.length : 0;

  const heardSet = new Set(heardTokens);
  const missing = [];
  for (const token of targetTokens) {
    if (!heardSet.has(token) && !missing.includes(token)) missing.push(token);
  }

  const extra = heardTokens.filter((token) => !targetTokens.includes(token));
  const duration = Number(durationSeconds) || 0;
  const wordsPerMinute = duration > 1 ? Math.round((heardTokens.length / duration) * 60) : null;

  return {
    accuracy: Math.max(0, Math.min(1, accuracy)),
    matched,
    total: targetTokens.length,
    missing: missing.slice(0, 12),
    extra: extra.slice(0, 12),
    words: heardTokens.length,
    wordsPerMinute,
    transcript: transcript.trim(),
  };
}

const LINKING_WORDS = [
  'however', 'therefore', 'because', 'although', 'while', 'moreover', 'furthermore',
  'for example', 'for instance', 'in contrast', 'as a result', 'consequently',
  'firstly', 'finally', 'in addition', 'on the other hand',
];

export function linkingWordsIn(text = '') {
  const normalised = ` ${normaliseText(text)} `;
  return LINKING_WORDS.filter((word) => normalised.includes(` ${normaliseText(word)} `));
}

/**
 * A transparent local rubric for writing (used offline and as a fallback when
 * the model is unavailable). Band 4.5 - 8.0.
 */
export function scoreWriting(text, options = {}) {
  const {
    word = '',
    learned = [],
    structure = null,
    minWords = 50,
    maxWords = 110,
  } = options;

  const wordCount = countWords(text);
  const sentenceCount = countSentences(text);
  const sentences = String(text || '').split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
  const lengths = sentences.map((sentence) => countWords(sentence));
  const averageSentence = lengths.length ? lengths.reduce((sum, value) => sum + value, 0) / lengths.length : 0;
  const variety = new Set(lengths.map((length) => Math.round(length / 4))).size;
  const linking = linkingWordsIn(text);
  const learnedHits = learned.filter((item) => containsWord(text, item));
  const targetUsed = containsWord(text, word);
  const structureUsed = structure ? structure.regex.test(text) : false;

  const lengthScore = wordCount >= minWords && wordCount <= maxWords
    ? 1
    : wordCount < minWords
      ? Math.max(0, wordCount / Math.max(minWords, 1)) * 0.8
      : Math.max(0.4, maxWords / Math.max(wordCount, 1));

  const taskScore = (targetUsed ? 0.5 : 0) + (learned.length ? (learnedHits.length / learned.length) * 0.3 : 0.3) + lengthScore * 0.2;
  const lexisScore = (targetUsed ? 0.55 : 0) + (learned.length ? Math.min(1, learnedHits.length / Math.max(1, Math.min(learned.length, 3))) * 0.25 : 0.2) + Math.min(1, uniqueRatio(text) / 0.6) * 0.2;
  const grammarScore = (structureUsed ? 0.5 : 0.2) + Math.min(1, variety / 3) * 0.25 + (averageSentence >= 9 && averageSentence <= 26 ? 0.25 : 0.1);
  const coherenceScore = Math.min(1, linking.length / 2) * 0.7 + Math.min(1, sentenceCount / 3) * 0.3;

  const composite = 0.3 * taskScore + 0.3 * lexisScore + 0.2 * grammarScore + 0.2 * coherenceScore;
  const band = Math.round((4.5 + composite * 3.5) * 2) / 2;

  const feedback = [];
  if (wordCount < minWords) feedback.push(`再补充 ${minWords - wordCount} 词，把例子或原因说完整。`);
  if (wordCount > maxWords) feedback.push(`目前 ${wordCount} 词，超出 ${maxWords} 词上限，删掉重复表述。`);
  if (!targetUsed) feedback.push(`还没有用上目标词 “${word}”，它是本步的必达项。`);
  if (learned.length && learnedHits.length < 2) feedback.push(`尝试复用已学词：${learned.slice(0, 3).join(' / ')}。`);
  if (linking.length < 2) feedback.push('加入两个真实逻辑连接词（because / however / for example），而不是堆砌。');
  if (!structureUsed && structure) feedback.push(`用上本步结构：${structure.pattern}。`);
  if (averageSentence > 28) feedback.push('句子偏长，挑一句拆成两句，读者更容易跟上。');
  if (!feedback.length) feedback.push('结构完整、目标词到位。下一步：替换一个重复词，让表达更精确。');

  return {
    band,
    wordCount,
    sentenceCount,
    averageSentence: Math.round(averageSentence * 10) / 10,
    linking,
    learnedHits,
    targetUsed,
    structureUsed,
    criteria: {
      task: Math.round(taskScore * 9 * 10) / 10,
      lexis: Math.round(lexisScore * 9 * 10) / 10,
      grammar: Math.round(grammarScore * 9 * 10) / 10,
      coherence: Math.round(coherenceScore * 9 * 10) / 10,
    },
    feedback,
  };
}

export function bandFromScore(score) {
  const value = 4.5 + (Math.max(0, Math.min(100, score)) / 100) * 3.5;
  return Math.round(value * 2) / 2;
}

export function formatDuration(totalSeconds = 0) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

export function percent(value, digits = 0) {
  const clamped = Math.max(0, Math.min(1, Number(value) || 0));
  return `${(clamped * 100).toFixed(digits)}%`;
}

/** Pure subtitle timing helpers, shared by the watch page and the Node tests. */

export function normalizeCues(rawCues = []) {
  const cues = [];
  for (const raw of rawCues) {
    const start = Number(raw?.start);
    const end = Number(raw?.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const words = (Array.isArray(raw.words) ? raw.words : [])
      .map((word) => ({
        text: String(word?.text || '').trim(),
        start: Number(word?.start),
        end: Number(word?.end),
      }))
      .filter((word) => word.text && Number.isFinite(word.start) && Number.isFinite(word.end) && word.end > word.start);
    const en = String(raw.en ?? raw.text ?? '').replace(/\s+/g, ' ').trim()
      || words.map((word) => word.text).join(' ');
    cues.push({
      start,
      end,
      en,
      zh: String(raw.zh || '').replace(/\s+/g, ' ').trim(),
      words,
    });
  }
  cues.sort((a, b) => a.start - b.start || a.end - b.end);
  return cues;
}

/** Last cue whose start <= time; -1 when time is before the first cue or in a gap. */
export function findCueIndex(cues, time) {
  if (!cues.length) return -1;
  let low = 0;
  let high = cues.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (cues[middle].start <= time) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  if (found < 0) return -1;
  const cue = cues[found];
  if (time >= cue.start && time < cue.end) return found;
  return -1;
}

export function findWordIndex(words = [], time) {
  if (!words.length || !Number.isFinite(time)) return -1;
  let low = 0;
  let high = words.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (words[middle].start <= time) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found >= 0 && time < words[found].end ? found : -1;
}

export function cueProgress(cue, time) {
  if (!cue) return 0;
  const span = Math.max(0.001, cue.end - cue.start);
  return Math.max(0, Math.min(1, (time - cue.start) / span));
}

export function activeCharCount(text = '', progress = 0) {
  const chars = Array.from(String(text));
  if (!chars.length) return 0;
  return Math.max(0, Math.min(chars.length, Math.ceil(chars.length * Math.max(0, Math.min(1, progress)))));
}

export function formatTimestamp(seconds = 0) {
  const whole = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

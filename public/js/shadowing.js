const SMALL_NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const CONTRACTIONS = new Map([
  ["can't", 'can not'], ["cannot", 'can not'], ["won't", 'will not'],
  ["i'm", 'i am'], ["it's", 'it is'], ["that's", 'that is'],
  ["there's", 'there is'], ["let's", 'let us'],
]);
const WEAK_WORDS = new Set(['a', 'an', 'the', 'to', 'of', 'in', 'and', 'is', 'it', 'on', 'for', 'or', 'at']);

export function speechTokens(text = '') {
  const normalized = String(text).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019]/g, "'").toLowerCase();
  return (normalized.match(/[a-z0-9]+(?:'[a-z0-9]+)*/g) || []).flatMap((token) => {
    if (/^\d{1,2}$/.test(token)) {
      const value = Number(token);
      return value < 20 ? [SMALL_NUMBERS[value]] : [TENS[Math.floor(value / 10)], ...(value % 10 ? [SMALL_NUMBERS[value % 10]] : [])];
    }
    if (CONTRACTIONS.has(token)) return CONTRACTIONS.get(token).split(' ');
    if (token.endsWith("n't")) return [token.slice(0, -3), 'not'];
    for (const [suffix, word] of [["'re", 'are'], ["'ve", 'have'], ["'ll", 'will']]) {
      if (token.endsWith(suffix)) return [token.slice(0, -suffix.length), word];
    }
    return [token.replace(/'/g, '')];
  });
}

function timedWords(cue) {
  return cue.words?.length ? cue.words : (String(cue.en || '').match(/\S+/g) || []).map((text, wordIndex, items) => ({
      text,
      start: cue.start + (cue.end - cue.start) * wordIndex / items.length,
      end: cue.start + (cue.end - cue.start) * (wordIndex + 1) / items.length,
  }));
}

export function describeShadowingAttempt(cue, { matched = [], startWordIndex = 0, status = 'active' } = {}) {
  const words = timedWords(cue).map((word, wordIndex) => ({ ...word, wordIndex }))
    .filter((word) => word.wordIndex >= startWordIndex && speechTokens(word.text).length);
  const aligned = new Set(matched);
  const matchedWords = words.filter((word) => aligned.has(word.wordIndex)).length;
  const completed = status !== 'active';
  const checkedThrough = completed ? Infinity : Math.max(startWordIndex - 1, ...aligned);
  const missing = words.filter((word) => word.wordIndex <= checkedThrough && !aligned.has(word.wordIndex));
  const missingWords = missing.map((word) => word.text.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, ''));
  const missingWordIndexes = missing.map((word) => word.wordIndex);
  const totalWords = words.length;
  let summary = matchedWords ? `已对齐 ${matchedWords}/${totalWords} 词` : '尚未对齐';
  let advice = `从「${words[0]?.text || ''}」开始，放慢一点再读。`;
  if (missingWords.length) advice = `「${missingWords.slice(0, 3).join(' / ')}」未对齐，下一遍单独读清后再连起来。`;
  else if (matchedWords === totalWords && totalWords) {
    summary = startWordIndex > 0 ? '本段已对齐' : '整句已对齐';
    advice = '保持当前节奏，句末留出自然停顿。';
  } else if (matchedWords) advice = '保持当前节奏，继续读下一词。';
  if (!totalWords) { summary = '无可点评字幕'; advice = ''; }
  return { status, summary, advice, matchedWords, totalWords, coverage: totalWords ? matchedWords / totalWords : 0, missingWords, missingWordIndexes };
}

export class ShadowingReviewLog {
  constructor(cues = [], records = []) {
    this.cues = cues;
    this.history = new Map();
    this.pass = new Map();
    for (const record of (Array.isArray(records) ? records : []).slice(-2000)) {
      const cue = cues[record?.cueIndex];
      if (!cue || record.en !== cue.en || !Number.isInteger(record.number) || record.number < 1) continue;
      const wordCount = timedWords(cue).length;
      const matched = (Array.isArray(record.matched) ? record.matched : [])
        .filter((wordIndex) => Number.isInteger(wordIndex) && wordIndex >= 0 && wordIndex < wordCount);
      const items = this.history.get(record.cueIndex) || [];
      items.push({
        cueIndex: record.cueIndex, number: record.number,
        startWordIndex: Math.max(0, Math.min(wordCount - 1, Number(record.startWordIndex) || 0)),
        matched: new Set(matched), status: record.status === 'complete' ? 'complete' : 'stopped',
        updatedAt: Number.isFinite(record.updatedAt) ? record.updatedAt : 0,
      });
      this.history.set(record.cueIndex, items.slice(-20));
    }
    this.begin(0);
  }

  begin(cueIndex, wordIndex = 0) {
    this.finish();
    this.anchorCue = cueIndex;
    this.anchorWord = wordIndex;
    this.pass = new Map();
    this.lastTranscript = '';
    this.lastMatchedSize = -1;
  }

  attempt(cueIndex, now) {
    if (!this.cues[cueIndex]) return null;
    if (this.pass.has(cueIndex)) return this.pass.get(cueIndex);
    const items = this.history.get(cueIndex) || [];
    const record = {
      cueIndex, number: (items.at(-1)?.number || 0) + 1,
      startWordIndex: cueIndex === this.anchorCue ? this.anchorWord : 0,
      matched: new Set(), status: 'active', updatedAt: now,
    };
    items.push(record);
    this.history.set(cueIndex, items.slice(-20));
    this.pass.set(cueIndex, record);
    return record;
  }

  record(position, matched, now = Date.now()) {
    if (!position.transcript || position.transcript === this.lastTranscript && matched.size === this.lastMatchedSize) return;
    this.lastTranscript = position.transcript;
    this.lastMatchedSize = matched.size;
    this.attempt(this.anchorCue, now);
    for (const key of matched) {
      const [cueIndex, wordIndex] = key.split(':').map(Number);
      if (cueIndex < this.anchorCue || cueIndex === this.anchorCue && wordIndex < this.anchorWord) continue;
      const record = this.attempt(cueIndex, now);
      if (!record) continue;
      if (!record.matched.has(wordIndex)) {
        record.matched.add(wordIndex);
        record.updatedAt = now;
      }
    }
    for (const record of this.pass.values()) {
      if (record.cueIndex < position.cueIndex || position.done
        || position.nextCueIndex > record.cueIndex && position.cueIndex >= record.cueIndex) record.status = 'complete';
    }
  }

  finish() {
    for (const record of this.pass.values()) {
      if (record.status === 'active') record.status = 'stopped';
    }
  }

  reviews(cueIndex) {
    const cue = this.cues[cueIndex];
    if (!cue) return [];
    return (this.history.get(cueIndex) || []).map((record) => ({
      ...describeShadowingAttempt(cue, { ...record, matched: record.matched }),
      number: record.number, updatedAt: record.updatedAt,
    }));
  }

  export() {
    return Array.from(this.history.values()).flat().map((record) => ({
      ...record, en: this.cues[record.cueIndex].en, matched: Array.from(record.matched).sort((left, right) => left - right),
    })).sort((left, right) => left.updatedAt - right.updatedAt).slice(-2000);
  }
}

function referenceWords(cues) {
  return cues.flatMap((cue, cueIndex) => {
    return cue.words.flatMap((word, wordIndex) => speechTokens(word.text).map((token) => ({
      token, cueIndex, wordIndex, start: word.start, end: word.end, text: word.text,
    })));
  });
}

function alignSpeech(tokens, spoken, base) {
  let cursor = base;
  const matched = [];
  for (const [spokenIndex, word] of spoken.entries()) {
    const end = Math.min(tokens.length, cursor + 6);
    for (let target = cursor; target < end; target += 1) {
      if (tokens[target].token !== word) continue;
      const nextMatches = spoken[spokenIndex + 1] === tokens[target + 1]?.token;
      if (target > cursor + 1 && WEAK_WORDS.has(word) && !nextMatches) continue;
      matched.push(target);
      cursor = target + 1;
      break;
    }
  }
  return { cursor, matched };
}

export class ShadowingTracker {
  constructor(cues = []) {
    this.cues = cues.map((cue) => cue.words?.length ? cue : { ...cue, words: timedWords(cue) });
    this.tokens = referenceWords(this.cues);
    this.wordTokens = new Map();
    this.tokens.forEach((word, tokenIndex) => {
      const key = `${word.cueIndex}:${word.wordIndex}`;
      const indexes = this.wordTokens.get(key) || [];
      indexes.push(tokenIndex);
      this.wordTokens.set(key, indexes);
    });
    this.seek(0);
  }

  seek(cueIndex, wordIndex = 0) {
    const target = this.tokens.findIndex((word) => word.cueIndex >= cueIndex
      && (word.cueIndex > cueIndex || word.wordIndex >= wordIndex));
    this.anchor = target >= 0 ? target : this.tokens.length;
    this.cursor = this.anchor;
    this.segments = new Map();
    this.matched = new Set();
    this.matchedTokens = new Set();
    this.alignedWords = new Set();
    this.transcript = '';
    this.firstMatch = null;
    this.lastMatch = null;
    return this.snapshot();
  }

  consume(alternatives, { segmentId = 'default', final = false, now = performance.now() } = {}) {
    const texts = (Array.isArray(alternatives) ? alternatives : [alternatives]).map((text) => String(text || '').slice(0, 8000));
    let segment = this.segments.get(segmentId);
    if (!segment) {
      segment = { base: this.cursor, final: false };
      this.segments.set(segmentId, segment);
      if (this.segments.size > 128) this.segments.delete(this.segments.keys().next().value);
    }
    if (segment.final) return this.snapshot();
    let best = { cursor: segment.base, matched: [], text: texts[0] || '' };
    for (const text of texts.slice(0, 5)) {
      const alignment = alignSpeech(this.tokens, speechTokens(text), segment.base);
      if (alignment.matched.length > best.matched.length) best = { ...alignment, text };
    }
    const previous = this.cursor;
    this.cursor = Math.max(previous, best.cursor);
    this.transcript = best.text.trim();
    segment.final = final;
    for (const index of best.matched) {
      const word = this.tokens[index];
      const key = `${word.cueIndex}:${word.wordIndex}`;
      this.matched.add(key);
      this.matchedTokens.add(index);
      if (this.wordTokens.get(key).every((tokenIndex) => this.matchedTokens.has(tokenIndex))) this.alignedWords.add(key);
    }
    if (this.cursor > previous) {
      this.firstMatch ??= now;
      this.lastMatch = now;
    }
    return { ...this.snapshot(), advanced: this.cursor > previous };
  }

  snapshot() {
    const current = this.cursor > this.anchor ? this.tokens[this.cursor - 1] : null;
    const next = this.tokens[this.cursor];
    const focus = current || next;
    const elapsed = (this.lastMatch ?? 0) - (this.firstMatch ?? 0);
    return {
      cueIndex: focus?.cueIndex ?? -1,
      wordIndex: current?.wordIndex ?? -1,
      nextCueIndex: next?.cueIndex ?? -1,
      nextWordIndex: next?.wordIndex ?? -1,
      nextWord: next?.text || '',
      time: current ? Math.max(current.start, current.end - 0.015) : next?.start ?? 0,
      progress: this.tokens.length > this.anchor ? (this.cursor - this.anchor) / (this.tokens.length - this.anchor) : 0,
      matchedWords: this.matched.size,
      pace: elapsed >= 3000 ? Math.round(Math.max(0, this.matched.size - 1) * 60_000 / elapsed) : 0,
      done: this.tokens.length > 0 && this.cursor === this.tokens.length,
      transcript: this.transcript,
      advanced: false,
    };
  }
}

const SPEECH_ERRORS = {
  unsupported: '当前浏览器不支持语音识别',
  'not-allowed': '麦克风权限未开启',
  'service-not-allowed': '语音识别服务不可用',
  'audio-capture': '未找到可用麦克风',
  network: '语音识别连接失败',
  'language-not-supported': '识别服务不支持英语',
  interrupted: '语音识别已中断',
};

export class SpeechSession {
  constructor({
    Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition,
    lang = 'en-US', onResult = () => {}, onState = () => {}, onSpeech = () => {},
    setTimer = (callback, delay) => setTimeout(callback, delay),
    clearTimer = (timer) => clearTimeout(timer), now = () => performance.now(),
  } = {}) {
    this.Recognition = Recognition;
    this.lang = lang;
    this.onResult = onResult;
    this.onState = onState;
    this.onSpeech = onSpeech;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.now = now;
    this.recognition = null;
    this.closing = null;
    this.releaseTimer = null;
    this.releaseWaiters = new Set();
    this.releaseConfirmed = true;
    this.timer = null;
    this.generation = 0;
    this.retries = 0;
    this.requested = false;
    this.state = 'idle';
  }

  emit(state, details = {}) {
    this.state = state;
    this.onState(state, details);
  }

  start() {
    if (!this.Recognition) {
      this.emit('error', { code: 'unsupported', message: SPEECH_ERRORS.unsupported, fatal: true });
      return false;
    }
    if (this.requested) return true;
    this.requested = true;
    this.retries = 0;
    if (this.closing) this.emit('starting');
    else this.open();
    return this.requested;
  }

  open() {
    if (!this.requested || this.closing) return;
    const generation = ++this.generation;
    let recognition;
    try {
      recognition = new this.Recognition();
      this.recognition = recognition;
      this.releaseConfirmed = true;
      recognition.lang = this.lang;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 3;
      const started = this.now();
      const current = () => this.recognition === recognition && this.requested;
      recognition.onstart = () => { if (current()) this.emit('listening'); };
      recognition.onspeechstart = () => { if (current()) this.onSpeech(true); };
      recognition.onspeechend = () => { if (current()) this.onSpeech(false); };
      recognition.onresult = (event) => {
        if (!current()) return;
        this.retries = 0;
        for (let index = event.resultIndex || 0; index < event.results.length; index += 1) {
          const result = event.results[index];
          const alternatives = Array.from(result).slice(0, 3).map((item) => item.transcript);
          this.onResult(alternatives, { segmentId: `${generation}:${index}`, final: Boolean(result.isFinal), now: this.now() });
          if (!current()) break;
        }
      };
      recognition.onerror = (event) => {
        if (!current()) return;
        if (event.error === 'no-speech') {
          this.onSpeech(false);
          return;
        }
        if (event.error === 'aborted') return;
        this.pause();
        this.emit('error', {
          code: event.error,
          message: SPEECH_ERRORS[event.error] || SPEECH_ERRORS.interrupted,
          fatal: ['not-allowed', 'service-not-allowed', 'audio-capture'].includes(event.error),
        });
      };
      recognition.onend = () => {
        if (!current()) return;
        this.detach({ ended: true });
        this.onSpeech(false);
        if (this.now() - started > 3000) this.retries = 0;
        if (++this.retries > 3) {
          this.requested = false;
          this.emit('error', { code: 'interrupted', message: SPEECH_ERRORS.interrupted });
          return;
        }
        this.emit('reconnecting');
        this.timer = this.setTimer(() => {
          this.timer = null;
          this.open();
        }, Math.min(1500, this.retries * 400));
      };
      this.emit('starting');
      recognition.start();
    } catch {
      this.pause();
      this.emit('error', { code: 'interrupted', message: SPEECH_ERRORS.interrupted });
    }
  }

  detach({ ended = false } = {}) {
    const recognition = this.recognition;
    this.recognition = null;
    if (!recognition) return;
    for (const event of ['onstart', 'onspeechstart', 'onspeechend', 'onresult', 'onerror', 'onend']) recognition[event] = null;
    if (ended) return;
    this.closing = recognition;
    this.releaseConfirmed = false;
    const release = (confirmed = true) => {
      if (this.closing !== recognition) return;
      this.clearTimer(this.releaseTimer);
      this.releaseTimer = null;
      this.closing = null;
      this.releaseConfirmed = confirmed;
      recognition.onend = null;
      for (const resolve of this.releaseWaiters) resolve(confirmed);
      this.releaseWaiters.clear();
      if (!this.requested) return;
      if (confirmed) this.open();
      else {
        this.requested = false;
        this.emit('error', { code: 'interrupted', message: SPEECH_ERRORS.interrupted });
      }
    };
    recognition.onend = () => release();
    this.releaseTimer = this.setTimer(() => release(false), 1500);
    try { recognition.abort(); } catch { release(); }
  }

  pause() {
    this.requested = false;
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    this.detach();
    this.onSpeech(false);
    this.emit('paused');
  }

  whenReleased() {
    if (!this.closing) return Promise.resolve(!this.recognition && this.releaseConfirmed);
    return new Promise((resolve) => this.releaseWaiters.add(resolve));
  }

  restart() {
    const listening = this.requested;
    this.pause();
    if (listening) this.start();
  }
}

export class SilentMediaFollower {
  constructor(adapter, { now = () => performance.now(), requestFrame = (callback) => requestAnimationFrame(callback), cancelFrame = (frame) => cancelAnimationFrame(frame) } = {}) {
    this.adapter = adapter;
    this.now = now;
    this.requestFrame = requestFrame;
    this.cancelFrame = cancelFrame;
    this.frame = null;
    this.active = false;
    this.following = false;
    this.target = null;
    this.lastInput = null;
  }

  begin() {
    if (this.active) return;
    this.saved = { muted: this.adapter.getMuted(), rate: this.adapter.getRate(), playing: this.adapter.isPlaying() };
    this.active = true;
    this.adapter.pause();
    this.adapter.setMuted(true);
  }

  jump(time) {
    if (!this.active || !Number.isFinite(time)) return;
    this.target = Math.max(0, time);
    this.lastInput = this.now();
    this.hold();
  }

  follow(time) {
    if (!this.active || !Number.isFinite(time)) return;
    const now = this.now();
    const delta = Math.max(0, time - (this.target ?? time));
    const elapsed = Math.max(0.15, (now - (this.lastInput ?? now - 500)) / 1000);
    this.target = Math.max(0, time);
    this.lastInput = now;
    this.adapter.setMuted(true);
    if (this.adapter.static || delta <= 0.015) {
      this.hold();
      return;
    }
    const current = this.adapter.time();
    if (current > this.target || this.target - current > 3) this.adapter.seek(Math.max(0, this.target - Math.min(delta, 0.5)));
    this.adapter.setRate(Math.max(0.25, Math.min(2, delta / elapsed)));
    this.following = true;
    Promise.resolve(this.adapter.play()).catch(() => this.hold());
    if (this.frame !== null) this.cancelFrame(this.frame);
    const tick = () => {
      this.frame = null;
      if (!this.active) return;
      if (this.adapter.time() >= this.target - 0.02 || this.now() - this.lastInput >= 500) {
        this.hold();
        return;
      }
      this.frame = this.requestFrame(tick);
    };
    this.frame = this.requestFrame(tick);
  }

  hold() {
    if (this.frame !== null) this.cancelFrame(this.frame);
    this.frame = null;
    this.following = false;
    if (!this.active) return;
    this.adapter.pause();
    if (this.target !== null) this.adapter.seek(this.target);
  }

  restore({ resume = true } = {}) {
    if (!this.active) return;
    this.hold();
    this.active = false;
    this.adapter.setRate(this.saved.rate);
    this.adapter.setMuted(this.saved.muted);
    if (resume && this.saved.playing) Promise.resolve(this.adapter.play()).catch(() => {});
  }
}
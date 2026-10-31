import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeShadowingAttempt, ShadowingReviewLog, ShadowingTracker, SilentMediaFollower, SpeechSession, speechTokens } from '../public/js/shadowing.js';
import { clearAllData, getShadowingReviews, saveShadowingReviews } from '../public/js/store.js';
import { PronunciationPlayer } from '../public/js/pronunciation.js';

function cues(lines = ['Cities should plant more trees.', 'The shaded street is quiet.']) {
  return lines.map((en, cueIndex) => ({
    en, zh: '', start: cueIndex * 6, end: cueIndex * 6 + 5,
    words: en.split(' ').map((text, wordIndex) => ({ text, start: cueIndex * 6 + wordIndex, end: cueIndex * 6 + wordIndex + 0.8 })),
  }));
}

test('speech token normalization handles punctuation, contractions and small numbers', () => {
  assert.deepEqual(speechTokens("I’m sure we can't plant 24 trees."), ['i', 'am', 'sure', 'we', 'can', 'not', 'plant', 'twenty', 'four', 'trees']);
  assert.deepEqual(speechTokens("You've said we won't."), ['you', 'have', 'said', 'we', 'will', 'not']);
});

test('interim speech advances through timed words without replaying repeated results', () => {
  const tracker = new ShadowingTracker(cues());
  assert.equal(tracker.consume('Cities').wordIndex, 0);
  assert.equal(tracker.consume('Cities should').wordIndex, 1);
  const repeated = tracker.consume('Cities should');
  assert.equal(repeated.wordIndex, 1);
  assert.equal(repeated.advanced, false);
  assert.equal(repeated.matchedWords, 2);
});

test('interim revisions never rewind a confirmed speech position', () => {
  const tracker = new ShadowingTracker(cues());
  tracker.consume('Cities should plant');
  const revision = tracker.consume('City shore', { final: true });
  assert.equal(revision.wordIndex, 2);
  assert.ok(Math.abs(revision.time - 2.785) < 0.000001);
});

test('new recognition segments continue and duplicate finals do not advance', () => {
  const tracker = new ShadowingTracker(cues(['very very good']));
  tracker.consume('very', { segmentId: 'first', final: true });
  assert.equal(tracker.consume('very', { segmentId: 'first', final: true }).wordIndex, 0);
  assert.equal(tracker.consume('very good', { segmentId: 'second', final: true }).done, true);
});

test('unrelated speech cannot jump to distant cues or weak words', () => {
  const tracker = new ShadowingTracker(cues());
  assert.equal(tracker.consume('banana the quiet').advanced, false);
  assert.equal(tracker.snapshot().wordIndex, -1);
  assert.equal(tracker.snapshot().time, 0);
});

test('nearby missed words and recognition alternatives remain usable', () => {
  const tracker = new ShadowingTracker(cues());
  const match = tracker.consume(['city shore', 'Cities plant more trees'], { final: true });
  assert.equal(match.wordIndex, 4);
  assert.equal(match.matchedWords, 4);
  assert.equal(match.transcript, 'Cities plant more trees');
});

test('speech determines cue changes and stays still without new input', () => {
  const tracker = new ShadowingTracker(cues());
  tracker.consume('Cities should plant more trees', { segmentId: 'first', final: true, now: 1000 });
  const next = tracker.consume('The shaded street', { segmentId: 'second', now: 7000 });
  assert.equal(next.cueIndex, 1);
  assert.equal(next.wordIndex, 2);
  assert.equal(next.pace, 70);
  assert.deepEqual(tracker.snapshot(), tracker.snapshot());
});

test('seeking starts a fresh passage and discards old recognition segments', () => {
  const tracker = new ShadowingTracker(cues());
  tracker.consume('Cities should plant', { final: true });
  const reset = tracker.seek(1, 1);
  assert.equal(reset.cueIndex, 1);
  assert.equal(reset.wordIndex, -1);
  assert.equal(reset.nextWord, 'shaded');
  assert.equal(reset.matchedWords, 0);
  assert.equal(tracker.consume('shaded street is quiet', { final: true }).done, true);
});

test('sentence-only captions receive an internal timed reference', () => {
  const tracker = new ShadowingTracker([{ en: 'Hello everyone', start: 2, end: 4 }]);
  const match = tracker.consume('Hello everyone', { final: true });
  assert.equal(match.done, true);
  assert.equal(match.wordIndex, 1);
  assert.equal(match.time, 3.985);
});

test('empty captions are not mistaken for a completed practice', () => {
  const tracker = new ShadowingTracker();
  assert.equal(tracker.snapshot().done, false);
  assert.equal(tracker.consume('Hello').advanced, false);
});

test('sentence feedback names skipped words and gives a focused adjustment', () => {
  const review = describeShadowingAttempt(cues()[0], { matched: [0, 2, 3, 4], status: 'complete' });
  assert.equal(review.matchedWords, 4);
  assert.equal(review.totalWords, 5);
  assert.equal(review.coverage, 0.8);
  assert.deepEqual(review.missingWords, ['should']);
  assert.match(review.advice, /should/);
});

test('live feedback does not label upcoming unread words as omissions', () => {
  const review = describeShadowingAttempt(cues()[0], { matched: [0, 1] });
  assert.equal(review.status, 'active');
  assert.deepEqual(review.missingWords, []);
  assert.equal(review.coverage, 0.4);
});

test('sentence feedback respects a practice anchor inside the sentence', () => {
  const review = describeShadowingAttempt(cues()[0], { startWordIndex: 2, matched: [2, 3, 4], status: 'complete' });
  assert.equal(review.coverage, 1);
  assert.equal(review.totalWords, 3);
  assert.deepEqual(review.missingWords, []);
  assert.ok(review.advice);
  assert.notEqual(review.summary, describeShadowingAttempt(cues()[0], { matched: [0, 1, 2, 3, 4], status: 'complete' }).summary);
});

test('empty sentence feedback does not manufacture a successful score', () => {
  const review = describeShadowingAttempt({ en: '', start: 0, end: 1 }, { status: 'complete' });
  assert.equal(review.coverage, 0);
  assert.equal(review.totalWords, 0);
  assert.equal(review.advice, '');
});

test('sentence history keeps every repeat and ignores duplicate interim results', () => {
  const tracker = new ShadowingTracker(cues());
  const log = new ShadowingReviewLog(tracker.cues);
  const position = tracker.consume('Cities plant more trees');
  log.record(position, tracker.matched, 1000);
  log.record(tracker.consume('Cities plant more trees'), tracker.matched, 1100);
  assert.equal(log.reviews(0).length, 1);
  assert.equal(log.reviews(0)[0].status, 'complete');
  assert.deepEqual(log.reviews(0)[0].missingWords, ['should']);
  tracker.seek(0);
  log.begin(0);
  log.record(tracker.consume('Cities should plant more trees'), tracker.matched, 2000);
  assert.deepEqual(log.reviews(0).map((review) => review.number), [1, 2]);
  assert.equal(log.reviews(0)[1].coverage, 1);
});

test('one recognition segment spanning sentences produces separate aligned reviews', () => {
  const tracker = new ShadowingTracker(cues());
  const log = new ShadowingReviewLog(tracker.cues);
  log.record(tracker.consume('Cities should plant more trees the shaded street'), tracker.matched);
  assert.equal(log.reviews(0)[0].status, 'complete');
  assert.equal(log.reviews(0)[0].coverage, 1);
  assert.equal(log.reviews(1)[0].status, 'active');
  log.finish();
  assert.equal(log.reviews(1)[0].status, 'stopped');
  assert.deepEqual(log.reviews(1)[0].missingWords, ['is', 'quiet']);
});

test('sentence review history survives reentry but rejects changed captions', () => {
  const tracker = new ShadowingTracker(cues());
  const log = new ShadowingReviewLog(tracker.cues);
  log.record(tracker.consume('Cities should'), tracker.matched, 1000);
  const records = log.export();
  const restored = new ShadowingReviewLog(tracker.cues, records);
  assert.equal(restored.reviews(0)[0].status, 'stopped');
  assert.equal(restored.reviews(0)[0].matchedWords, 2);
  assert.equal(new ShadowingReviewLog(cues(['Another sentence']), records).reviews(0).length, 0);
  assert.equal(records[0].transcript, undefined);
});

test('unrelated speech creates a retry suggestion without crediting a word', () => {
  const tracker = new ShadowingTracker(cues());
  const log = new ShadowingReviewLog(tracker.cues);
  log.record(tracker.consume('banana'), tracker.matched);
  assert.equal(log.reviews(0)[0].coverage, 0);
  assert.match(log.reviews(0)[0].advice, /Cities/);
});

test('sentence reviews require all tokens of a contraction before crediting the source word', () => {
  const tracker = new ShadowingTracker(cues(["We can't stop."]));
  const log = new ShadowingReviewLog(tracker.cues);
  log.record(tracker.consume('We can stop'), tracker.alignedWords);
  assert.equal(log.reviews(0)[0].matchedWords, 2);
  assert.deepEqual(log.reviews(0)[0].missingWords, ["can't"]);
  log.record(tracker.consume('We can not stop'), tracker.alignedWords);
  assert.equal(log.reviews(0)[0].coverage, 1);
});

test('partial spoken numbers do not earn a full word in sentence feedback', () => {
  const tracker = new ShadowingTracker(cues(['Plant 24 trees.']));
  const log = new ShadowingReviewLog(tracker.cues);
  log.record(tracker.consume('Plant twenty trees'), tracker.alignedWords);
  assert.deepEqual(log.reviews(0)[0].missingWords, ['24']);
  const reset = tracker.seek(0);
  log.begin(reset.cueIndex);
  assert.equal(tracker.alignedWords.size, 0);
  log.record(tracker.consume('Plant twenty four trees'), tracker.alignedWords);
  assert.equal(log.reviews(0)[1].coverage, 1);
});

test('review storage keeps media separate and clears only application data', () => {
  const originalStorage = globalThis.localStorage;
  const originalWindow = globalThis.window;
  const values = new Map([['unrelated.app', 'keep']]);
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    key: (index) => Array.from(values.keys())[index],
    get length() { return values.size; },
  };
  globalThis.window = { dispatchEvent() {} };
  try {
    assert.equal(saveShadowingReviews('video:first', [{ number: 1 }]), true);
    assert.equal(saveShadowingReviews('podcast:first', [{ number: 2 }]), true);
    assert.deepEqual(getShadowingReviews('video:first'), [{ number: 1 }]);
    assert.deepEqual(getShadowingReviews('podcast:first'), [{ number: 2 }]);
    assert.equal(saveShadowingReviews('', []), false);
    clearAllData();
    assert.deepEqual(getShadowingReviews('video:first'), []);
    assert.equal(values.get('unrelated.app'), 'keep');
  } finally {
    globalThis.localStorage = originalStorage;
    globalThis.window = originalWindow;
  }
});

function recognitionFixture() {
  const instances = [];
  class Recognition {
    constructor() { instances.push(this); }
    start() { this.onstart?.(); }
    abort() { this.aborted = true; this.onend?.(); }
    result(text, final = false) {
      const result = Object.assign([{ transcript: text }], { isFinal: final });
      this.onresult?.({ resultIndex: 0, results: [result] });
    }
  }
  return { Recognition, instances };
}

test('speech session configures native interim English recognition and reports candidates', () => {
  const fixture = recognitionFixture();
  const results = [];
  const session = new SpeechSession({ Recognition: fixture.Recognition, onResult: (...args) => results.push(args) });
  assert.equal(session.start(), true);
  const recognition = fixture.instances[0];
  assert.equal(recognition.lang, 'en-US');
  assert.equal(recognition.interimResults, true);
  assert.equal(session.state, 'listening');
  recognition.result('Hello');
  assert.deepEqual(results[0][0], ['Hello']);
  assert.equal(results[0][1].segmentId, '1:0');
  session.pause();
});

test('pausing aborts the microphone and late callbacks cannot advance practice', () => {
  const fixture = recognitionFixture();
  let count = 0;
  const session = new SpeechSession({ Recognition: fixture.Recognition, onResult: () => { count += 1; } });
  session.start();
  const staleCallback = fixture.instances[0].onresult;
  session.pause();
  staleCallback({ resultIndex: 0, results: [Object.assign([{ transcript: 'Hello' }], { isFinal: true })] });
  assert.equal(count, 0);
  assert.equal(fixture.instances[0].aborted, true);
  session.start();
  assert.equal(fixture.instances.length, 2);
  session.pause();
});

test('restarting waits for the previous microphone session to actually end', () => {
  const fixture = recognitionFixture();
  fixture.Recognition.prototype.abort = function () { this.aborted = true; };
  const timers = new Map();
  let timerId = 0;
  const session = new SpeechSession({
    Recognition: fixture.Recognition,
    setTimer: (callback) => { timers.set(++timerId, callback); return timerId; },
    clearTimer: (timer) => timers.delete(timer),
  });
  session.start();
  session.pause();
  session.start();
  assert.equal(fixture.instances.length, 1);
  assert.equal(session.state, 'starting');
  fixture.instances[0].onend();
  assert.equal(fixture.instances.length, 2);
  assert.equal(session.state, 'listening');
  session.pause();
  fixture.instances[1].onend();
  assert.equal(timers.size, 0);
});

test('pronunciation can wait for confirmed microphone release before playing', async () => {
  const fixture = recognitionFixture();
  fixture.Recognition.prototype.abort = function () { this.aborted = true; };
  const session = new SpeechSession({ Recognition: fixture.Recognition });
  session.start();
  session.pause();
  let released = false;
  const ready = session.whenReleased().then((value) => { released = value; });
  await Promise.resolve();
  assert.equal(released, false);
  fixture.instances[0].onend();
  await ready;
  assert.equal(released, true);
});

test('pronunciation does not proceed after an unconfirmed microphone abort', async () => {
  const fixture = recognitionFixture();
  fixture.Recognition.prototype.abort = function () {};
  let release;
  const session = new SpeechSession({
    Recognition: fixture.Recognition, setTimer: (callback) => { release = callback; return 1; }, clearTimer() {},
  });
  session.start();
  session.pause();
  const ready = session.whenReleased();
  release();
  assert.equal(await ready, false);
  assert.equal(await session.whenReleased(), false);
});

function pronunciationFixture() {
  const spoken = [];
  const synthesis = {
    getVoices: () => [{ lang: 'zh-CN' }, { lang: 'en-GB' }, { lang: 'en-US' }],
    speak: (utterance) => spoken.push(utterance),
    cancel() { this.cancelled = true; },
  };
  class Utterance { constructor(text) { this.text = text; } }
  return { spoken, synthesis, Utterance };
}

test('pronunciation chooses an English voice and settles after the example ends', async () => {
  const fixture = pronunciationFixture();
  const player = new PronunciationPlayer(fixture);
  const playing = player.play('should');
  assert.equal(fixture.spoken[0].text, 'should');
  assert.equal(fixture.spoken[0].lang, 'en-US');
  assert.equal(fixture.spoken[0].rate, 0.85);
  fixture.spoken[0].onend();
  assert.equal(await playing, true);
  assert.equal(player.current, null);
});

test('stopping a pronunciation example cancels speech and ignores late callbacks', async () => {
  const fixture = pronunciationFixture();
  const player = new PronunciationPlayer(fixture);
  const playing = player.play('should');
  const lateEnd = fixture.spoken[0].onend;
  player.cancel();
  lateEnd();
  assert.equal(await playing, false);
  assert.equal(fixture.synthesis.cancelled, true);
  assert.equal(player.current, null);
});

test('unsupported or missing English synthesis fails without claiming to play', async () => {
  await assert.rejects(new PronunciationPlayer({ synthesis: null, Utterance: null }).play('should'));
  const fixture = pronunciationFixture();
  fixture.synthesis.getVoices = () => [{ lang: 'zh-CN' }];
  await assert.rejects(new PronunciationPlayer(fixture).play('should'), /English/);
  assert.equal(fixture.spoken.length, 0);
});

test('permission denial is fatal and does not silently restart capture', () => {
  const fixture = recognitionFixture();
  const states = [];
  const session = new SpeechSession({ Recognition: fixture.Recognition, onState: (state, details) => states.push({ state, ...details }) });
  session.start();
  fixture.instances[0].onerror({ error: 'not-allowed' });
  assert.equal(session.requested, false);
  assert.equal(states.at(-1).fatal, true);
  assert.equal(states.at(-1).code, 'not-allowed');
});

test('unsupported recognition reports an actionable state without opening a microphone', () => {
  const session = new SpeechSession({ Recognition: null });
  assert.equal(session.start(), false);
  assert.equal(session.state, 'error');
});

test('recognizer reconnects a bounded number of times and pause cancels pending retries', () => {
  const fixture = recognitionFixture();
  const queue = new Map();
  let timerId = 0;
  const session = new SpeechSession({
    Recognition: fixture.Recognition, now: () => 0,
    setTimer: (callback) => { queue.set(++timerId, callback); return timerId; },
    clearTimer: (timer) => queue.delete(timer),
  });
  session.start();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    fixture.instances.at(-1).onend();
    const next = queue.entries().next().value;
    if (next) { queue.delete(next[0]); next[1](); }
  }
  assert.equal(session.state, 'error');
  assert.equal(fixture.instances.length, 4);
  session.start();
  fixture.instances.at(-1).onend();
  session.pause();
  assert.equal(queue.size, 0);
});

function mediaFixture(staticMedia = false) {
  const state = { time: 0, muted: false, rate: 0.75, playing: true };
  const adapter = {
    static: staticMedia, time: () => state.time,
    getMuted: () => state.muted, getRate: () => state.rate, isPlaying: () => state.playing,
    seek: (time) => { state.time = time; }, setMuted: (muted) => { state.muted = muted; },
    setRate: (rate) => { state.rate = rate; },
    pause: () => { state.playing = false; }, play: () => { state.playing = true; },
  };
  return { state, adapter };
}

test('silent video follows speech speed, stops at the spoken position and restores audio settings', () => {
  const fixture = mediaFixture();
  let now = 0;
  let frame;
  const follower = new SilentMediaFollower(fixture.adapter, {
    now: () => now, requestFrame: (callback) => { frame = callback; return 1; }, cancelFrame: () => { frame = null; },
  });
  follower.begin();
  assert.equal(fixture.state.muted, true);
  assert.equal(fixture.state.playing, false);
  follower.jump(1);
  now = 2000;
  follower.follow(2);
  assert.equal(fixture.state.rate, 0.5);
  assert.equal(fixture.state.playing, true);
  now = 2600;
  frame();
  assert.equal(fixture.state.playing, false);
  assert.equal(fixture.state.time, 2);
  follower.restore();
  assert.equal(fixture.state.muted, false);
  assert.equal(fixture.state.rate, 0.75);
  assert.equal(fixture.state.playing, true);
});

test('podcast practice never plays audio and manual backwards seeking remains possible', () => {
  const fixture = mediaFixture(true);
  const follower = new SilentMediaFollower(fixture.adapter);
  follower.begin();
  follower.jump(10);
  follower.follow(12);
  assert.equal(fixture.state.time, 12);
  assert.equal(fixture.state.playing, false);
  assert.equal(fixture.state.muted, true);
  follower.jump(2);
  assert.equal(fixture.state.time, 2);
  follower.restore({ resume: false });
  assert.equal(fixture.state.playing, false);
});
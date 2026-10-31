import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ShadowingTracker, SilentMediaFollower, SpeechSession, speechTokens } from '../public/js/shadowing.js';

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
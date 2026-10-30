import { test } from 'node:test';
import assert from 'node:assert/strict';

class FakeUtterance {
  constructor(text) { this.text = text; }
}

const synth = {
  paused: true,
  speaking: false,
  pending: false,
  resumed: 0,
  spoken: [],
  speak(utterance) { this.spoken.push(utterance); this.speaking = true; },
  cancel() { this.speaking = false; },
  pause() { this.paused = true; },
  resume() { this.paused = false; this.resumed += 1; },
  getVoices() { return []; },
  addEventListener() {},
};

globalThis.window = { speechSynthesis: synth };
globalThis.SpeechSynthesisUtterance = FakeUtterance;

const { speak, speakWords, stopSpeaking } = await import('../public/js/speech.js');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('speak resumes a paused synthesizer and queues the first chunk', async () => {
  synth.paused = true;
  speak('Hello world. Second line.', {});
  await sleep(80);
  assert.equal(synth.paused, false, 'resume() is called before speaking');
  assert.equal(synth.spoken.length, 1);
  assert.equal(synth.spoken[0].text, 'Hello world.');
});

test('word boundaries carry the offset of the sentence inside the line', async () => {
  synth.spoken.length = 0;
  const boundaries = [];
  const ends = [];
  speak('Hello world. Second line.', {
    onBoundary: (event) => boundaries.push(event),
    onEnd: () => ends.push(true),
  });
  await sleep(80);
  assert.equal(synth.spoken.length, 1);

  synth.spoken[0].onstart();
  synth.spoken[0].onboundary({ charIndex: 6, charLength: 5, name: 'word' });
  assert.equal(boundaries.at(-1).charIndex, 6);
  assert.equal(boundaries.at(-1).name, 'word');

  synth.spoken[0].onend();
  assert.equal(synth.spoken.length, 2, 'next sentence is queued');
  assert.equal(synth.spoken[1].text, 'Second line.');
  synth.spoken[1].onboundary({ charIndex: 0, charLength: 6, name: 'word' });
  assert.equal(boundaries.at(-1).charIndex, 13, 'offset includes the first sentence and space');

  synth.spoken[1].onend();
  assert.equal(ends.length, 1, 'onEnd fires after the last chunk');
});

test('speakWords reports each word exactly once', async () => {
  synth.spoken.length = 0;
  const seen = [];
  let done = false;
  speakWords(['One', 'two', 'three'], {
    onWord: (index) => seen.push(index),
    onEnd: () => { done = true; },
  });
  await sleep(60);
  assert.equal(synth.spoken.length, 3);
  synth.spoken.forEach((utterance) => utterance.onstart());
  assert.deepEqual(seen, [0, 1, 2]);
  synth.spoken[2].onend();
  assert.equal(done, true);
});

test('stopSpeaking cancels and clears a paused state', () => {
  synth.paused = true;
  const before = synth.resumed;
  stopSpeaking();
  assert.equal(synth.paused, false);
  assert.ok(synth.resumed > before);
});

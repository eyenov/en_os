import test from 'node:test';
import assert from 'node:assert/strict';
import { distributeWords, estimateSyllables, tokenizeTimedText } from '../server/word-timing.mjs';

test('word timing uses syllables rather than raw character count', () => {
  assert.ok(estimateSyllables('newsletter') >= 2);
  assert.ok(estimateSyllables('newsletter') < 'newsletter'.length);
  assert.equal(estimateSyllables('the'), 1);
  assert.ok(estimateSyllables('RSS') >= 2);
});

test('word timing leaves a pause after punctuation without overflowing the cue', () => {
  const words = distributeWords(tokenizeTimedText('Hello, world again.'), 1, 4);
  assert.equal(words[0].text, 'Hello,');
  assert.equal(words.at(-1).text, 'again.');
  assert.ok(words[1].start > words[0].end);
  assert.equal(words.at(-1).end, 4);
  assert.ok(words.every((word) => word.start >= 1 && word.end <= 4 && word.end > word.start));
});

test('domains stay one token and very short cues never create empty words', () => {
  assert.equal(tokenizeTimedText('podnews.net is here').length, 3);
  const words = distributeWords(tokenizeTimedText('One two three four.'), 2, 2.1);
  assert.equal(words.length, 4);
  assert.ok(words.every((word) => word.end > word.start && word.end <= 2.1));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLessonIndex, wordCandidates, wordFromText } from '../public/js/lookup.js';
import { localDialogue } from '../public/js/dialogue.js';

test('wordFromText expands a caret to the English word under it', () => {
  const text = 'Hello, world!';
  assert.equal(wordFromText(text, 0), 'Hello');
  assert.equal(wordFromText(text, 5), 'Hello');
  assert.equal(wordFromText(text, 7), 'world');
  assert.equal(wordFromText(text, 12), 'world');
  assert.equal(wordFromText(text, 13), '');
  assert.equal(wordFromText('', 0), '');
});

test('wordFromText keeps apostrophes and hyphens inside words', () => {
  assert.equal(wordFromText("I don't know.", 4), "don't");
  assert.equal(wordFromText('A well-known writer.', 4), 'well-known');
  assert.equal(wordFromText('AI最新技术', 1), 'AI');
  assert.equal(wordFromText('中文 only', 4), 'only');
  assert.equal(wordFromText('I am here', 0), 'I');
});

test('wordCandidates covers common inflections', () => {
  assert.ok(wordCandidates('meetings').includes('meeting'));
  assert.ok(wordCandidates('running').includes('run'));
  assert.ok(wordCandidates('studies').includes('study'));
  assert.ok(wordCandidates('walked').includes('walk'));
  assert.deepEqual(wordCandidates('box'), ['box']);
});

test('lesson index exposes the local dialogue vocabulary', () => {
  const dialogue = localDialogue('campus', { band: 5.5 });
  const index = buildLessonIndex(dialogue);
  assert.equal(index.size, 24);
  const ready = index.get('ready');
  assert.equal(ready.zh, '准备好的');
  assert.match(ready.en, /prepared/);
  assert.match(ready.usage, /be ready for/);
  assert.equal(ready.source, 'lesson');

  const withPhrase = buildLessonIndex({ lines: [{ words: [{ term: 'public transport', zh: '公共交通' }] }] });
  assert.equal(withPhrase.has('public transport'), false);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDialoguePrompt,
  buildListeningResult,
  countWords,
  fallbackChunks,
  localDialogue,
  normaliseRole,
  parseDialogue,
  resolveChunks,
} from '../public/js/dialogue.js';
import { parseListeningCommand, speechChunks } from '../public/js/speech.js';

function modelLine(index) {
  return {
    speaker: index % 2 ? 'B' : 'A',
    text: 'This is a short English sentence for listening practice.',
    zh: '这是一句用于听力练习的英文句子。',
    structure: '主系表结构：主语 + be + 表语。',
    chunks: [
      { text: 'This', role: '主语' },
      { text: 'is a short English sentence', role: '表语' },
      { text: 'for listening practice.', role: '状语' },
    ],
    words: [{
      term: 'practice',
      pos: 'n.',
      zh: '练习',
      gloss: 'repeated exercise to improve a skill',
      usage: 'listening practice; practise + verb',
    }],
    grammar: '一般现在时表示习惯。',
  };
}

function modelPayload(count = 10) {
  return {
    title: 'A short conversation',
    lines: Array.from({ length: count }, (_, index) => modelLine(index)),
  };
}

test('local fallback dialogue is complete and bilingual', () => {
  const dialogue = localDialogue('在咖啡店点单', { band: 5.5 });
  assert.equal(dialogue.source, 'local');
  assert.equal(dialogue.lines.length, 12);
  for (const line of dialogue.lines) {
    assert.ok(countWords(line.text) >= 3);
    assert.match(line.text, /^[A-Za-z]/);
    assert.match(line.zh, /[\u4e00-\u9fff]/);
    assert.ok(Array.isArray(line.words) && line.words.length >= 2);
    assert.ok(line.structure && line.grammar);
    for (const word of line.words) {
      assert.match(word.gloss, /[A-Za-z]/);
      assert.match(word.usage, /[A-Za-z]/);
      assert.match(word.zh, /[\u4e00-\u9fff]/);
    }
    const chunks = resolveChunks(line.text, line.chunks);
    assert.ok(chunks.length >= 2, `expected annotated chunks in: ${line.text}`);
    assert.equal(
      chunks.map((chunk) => chunk.text).join('').replace(/\s+/g, ''),
      line.text.replace(/\s+/g, ''),
      `chunks must cover the sentence: ${line.text}`,
    );
  }
  const speakers = dialogue.lines.map((line) => line.speaker);
  assert.deepEqual([...new Set(speakers)].sort(), ['A', 'B']);
});

test('parseDialogue keeps syntax chunks and enriched vocabulary', () => {
  const dialogue = parseDialogue(JSON.stringify(modelPayload(10)), { topic: 'campus life', band: 6, source: 'ai' });
  assert.ok(dialogue);
  assert.equal(dialogue.lines[0].chunks.length, 3);
  assert.equal(dialogue.lines[0].chunks[1].role, '表语');
  assert.equal(dialogue.lines[0].words[0].gloss, 'repeated exercise to improve a skill');
  assert.match(dialogue.lines[0].words[0].usage, /listening practice/);
  const resolved = resolveChunks(dialogue.lines[0].text, dialogue.lines[0].chunks);
  assert.deepEqual(resolved.map((chunk) => chunk.role), ['主语', '表语', '状语']);
  assert.equal(resolved.map((chunk) => chunk.text).join(' '), dialogue.lines[0].text);
});

test('chunks align to the sentence and fall back safely', () => {
  const aligned = resolveChunks('I need five more minutes.', [
    { text: 'I', role: '主语' },
    { text: 'need', role: '谓语' },
    { text: 'five more minutes.', role: '宾语' },
  ]);
  assert.deepEqual(aligned.map((chunk) => chunk.text), ['I', 'need', 'five more minutes.']);

  // Unknown role is normalised, including English aliases.
  assert.equal(normaliseRole('subject'), '主语');
  assert.equal(normaliseRole('宾语从句'), '从句');

  const fallback = resolveChunks('Only one block here.', [{ text: 'missing text', role: '主语' }]);
  assert.deepEqual(fallback, [{ text: 'Only one block here.', role: '句子' }]);

  const clauses = fallbackChunks('No problem, we can start.');
  assert.equal(clauses.length, 2);
  assert.equal(clauses[0].role, '主句');
  assert.equal(clauses[1].role, '从句');
});

test('parseDialogue accepts valid model output and normalises fields', () => {
  const dialogue = parseDialogue(JSON.stringify(modelPayload(10)), { topic: 'campus life', band: 6, source: 'ai' });
  assert.ok(dialogue);
  assert.equal(dialogue.lines.length, 10);
  assert.equal(dialogue.source, 'ai');
  assert.equal(dialogue.topic, 'campus life');
  assert.equal(dialogue.lines[0].speaker, 'A');
  assert.equal(dialogue.lines[1].speaker, 'B');
  assert.equal(dialogue.lines[0].words[0].term, 'practice');
  assert.ok(dialogue.id.startsWith('lst-'));
});

test('parseDialogue accepts realistic short reactions and multi-sentence turns', () => {
  const payload = modelPayload(10);
  payload.lines[0] = {
    ...modelLine(0),
    text: 'Really?',
    structure: '省略句，表示惊讶或追问。',
    chunks: [{ text: 'Really?', role: '意群' }],
    words: [{
      term: 'really',
      pos: 'adv.',
      zh: '真的吗',
      gloss: 'used to show surprise or interest',
      usage: 'a one-word reaction in conversation',
    }],
  };
  payload.lines[1] = {
    ...modelLine(1),
    text: "That makes sense. Let's try it.",
    chunks: [
      { text: 'That makes sense.', role: '主句' },
      { text: "Let's try it.", role: '主句' },
    ],
  };
  const dialogue = parseDialogue(payload, { topic: 'test' });
  assert.ok(dialogue);
  assert.equal(dialogue.lines.length, 10);
  assert.equal(dialogue.lines[0].text, 'Really?');
  assert.equal(dialogue.lines[1].text, "That makes sense. Let's try it.");
});

test('parseDialogue rejects incomplete or non-English output', () => {
  assert.equal(parseDialogue(JSON.stringify(modelPayload(7))), null);
  assert.equal(parseDialogue('not json'), null);

  const chinese = modelPayload(10);
  chinese.lines = chinese.lines.map((line) => ({ ...line, text: '这是中文句子，不是英文。' }));
  assert.equal(parseDialogue(chinese), null);

  const noTranslation = modelPayload(10);
  noTranslation.lines = noTranslation.lines.map((line) => ({ ...line, zh: '' }));
  assert.equal(parseDialogue(noTranslation), null);
});

test('dialogue prompt asks for annotation JSON and anchors the topic', () => {
  const prompt = buildDialoguePrompt('共享单车', { band: 5.5 });
  assert.match(prompt.user, /共享单车/);
  assert.match(prompt.user, /5\.5/);
  assert.doesNotMatch(prompt.user, /Scene flavour|lab|night/i);
  assert.match(prompt.system, /STRICTLY about the user topic/);
  assert.match(prompt.system, /Make it sound like real speech/);
  assert.match(prompt.system, /make the topic clear from the first turn/);
  assert.match(prompt.system, /Do not change the topic/);
  assert.match(prompt.system, /short reactions/);
  assert.match(prompt.system, /"lines"/);
  assert.match(prompt.system, /translation/);
  assert.match(prompt.system, /JSON/);
  assert.match(prompt.system, /chunks/);
  assert.match(prompt.system, /主语/);
  assert.match(prompt.system, /gloss/);
  assert.match(prompt.system, /usage/);
});

test('result text contains transcript and side-by-side translation', () => {
  const dialogue = localDialogue('campus', { band: 5.5 });
  const result = buildListeningResult(dialogue);
  assert.equal(result.lines.length, 12);
  assert.match(result.transcript, /^01\. A: Hi, are you ready/);
  assert.match(result.translation, /^01\. 你好/);
  assert.match(result.bilingual, /你好，你准备好我们的会议了吗？/);
  assert.equal(result.transcript.split('\n').length, 12);
});

test('speech chunks keep offsets for word highlighting', () => {
  const chunks = speechChunks('Really? That sounds useful.');
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].text, 'Really?');
  assert.equal(chunks[0].start, 0);
  assert.equal(chunks[1].text, 'That sounds useful.');
  assert.equal(chunks[1].start, 8);
  assert.deepEqual(speechChunks('  '), []);
});

test('listening voice commands cover playback, position and phases', () => {
  assert.equal(parseListeningCommand('播放一下').intent, 'play');
  assert.equal(parseListeningCommand('暂停').intent, 'pause');
  assert.equal(parseListeningCommand('停止').intent, 'stop');
  assert.equal(parseListeningCommand('下一句').intent, 'next');
  assert.equal(parseListeningCommand('上一句').intent, 'prev');
  assert.equal(parseListeningCommand('再听一遍').intent, 'repeat');
  assert.equal(parseListeningCommand('随机一句').intent, 'random');
  assert.equal(parseListeningCommand('慢速').intent, 'slow');
  assert.equal(parseListeningCommand('正常语速').intent, 'normal');
  assert.equal(parseListeningCommand('显示文本').intent, 'show');
  assert.equal(parseListeningCommand('隐藏文本').intent, 'hide');
  assert.equal(parseListeningCommand('生成结果').intent, 'finish');

  assert.deepEqual(parseListeningCommand('第 4 句'), { intent: 'line', index: 3 });
  assert.deepEqual(parseListeningCommand('第十一句'), { intent: 'line', index: 10 });
  assert.deepEqual(parseListeningCommand('sentence 2'), { intent: 'line', index: 1 });
  assert.equal(parseListeningCommand('hello there'), null);
});

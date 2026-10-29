import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  analyzeInput,
  applyAIStep,
  buildLocalStep,
  buildStepPrompt,
  buildTutorMessages,
  createSession,
  deriveVocabulary,
  evaluateStep,
  makeProgressCheck,
  MODULES,
  STEP_SPECS,
  summarizeSession,
} from '../public/js/engine.js';
import { compareSpeech, countWords, scoreWriting, similarity } from '../public/js/scoring.js';
import { parseCommand } from '../public/js/speech.js';
import { getScene } from '../public/js/scenes.js';

const bank = JSON.parse(await readFile(new URL('../data/core100.json', import.meta.url), 'utf8')).words;

const SAMPLE = `Urban planners increasingly argue that cities should abandon the idea of building wider roads.
Instead, they advocate investing in public transport and shaded walking routes.
A recent study found that streets with trees are used more often, even when the distance is the same.`;

function makeSession(overrides = {}) {
  return createSession({ text: SAMPLE, sceneId: 'music', band: 6.5, bank, mode: 'local', ...overrides });
}

function passProgress(step) {
  const checks = {
    answer: true,
    accuracy: 1,
    turns: 2,
    wordUsed: true,
    wordCount: 80,
    sentences: 3,
    structure: true,
    linking: 2,
    band: 8,
  };
  return { checks, evidence: {} };
}

test('dataset has 100 unique, complete entries', () => {
  assert.equal(bank.length, 100);
  assert.equal(new Set(bank.map((entry) => entry.id)).size, 100);
  for (const entry of bank) {
    assert.match(entry.example, new RegExp(entry.word, 'i'), `example must contain ${entry.word}`);
    assert.equal(entry.synonyms.length, 2);
    assert.equal(entry.collocations.length, 2);
    assert.equal(entry.family.length, 2);
    assert.ok(entry.scenes.every((scene) => ['music', 'comic', 'sports', 'science', 'travel', 'food', 'tech', 'nature'].includes(scene)));
  }
});

test('analysis extracts eight targets and IELTS points', () => {
  const analysis = analyzeInput(SAMPLE, { bank, sceneId: 'tech', band: 6.5 });
  assert.equal(analysis.targetWords.length, 8);
  assert.ok(analysis.matchedCount >= 2);
  assert.equal(analysis.stats.sentences, 3);
  assert.ok(analysis.grammar.length >= 3);
  assert.ok(analysis.points.some((point) => point.type === 'synonym'));
  assert.ok(analysis.points.some((point) => point.type === 'scene'));
});

test('every step has a valid, completable payload', () => {
  const session = makeSession();
  for (let index = 0; index < STEP_SPECS.length; index += 1) {
    const step = buildLocalStep(session, index, bank);
    session.steps[index] = step;
    assert.equal(step.key, STEP_SPECS[index].key);
    assert.equal(step.derived.length, 10);
    assert.equal(step.grammarPoints.length, 2);
    assert.ok(step.word.word);
    if (step.payload.options) {
      assert.ok(step.payload.answerIndex >= 0 && step.payload.answerIndex < step.payload.options.length, step.key);
      assert.equal(new Set(step.payload.options).size, step.payload.options.length);
    }
    if (step.kind === 'listen_dictation') {
      assert.ok(step.payload.answer.toLowerCase().includes(step.word.word.toLowerCase()));
      assert.match(step.payload.visible, /____/);
    }
    if (step.kind === 'listen_pick' || step.kind === 'read_synonym') {
      assert.equal(step.payload.options.length, 4);
    }
    if (step.kind === 'read_inference') {
      assert.deepEqual(step.payload.options, ['TRUE', 'FALSE', 'NOT GIVEN']);
    }
    const evaluation = evaluateStep(step, passProgress(step));
    assert.equal(evaluation.completed, true, `${step.key} should complete with full checks`);
    assert.equal(evaluation.score, 100);
  }
});

test('rubric thresholds gate completion', () => {
  const session = makeSession();
  const dictation = buildLocalStep(session, 1, bank);
  assert.equal(evaluateStep(dictation, { checks: { accuracy: 0.79 } }).completed, false);
  assert.equal(evaluateStep(dictation, { checks: { accuracy: 0.8 } }).completed, true);

  const pick = buildLocalStep(session, 0, bank);
  assert.equal(evaluateStep(pick, { checks: { answer: false } }).completed, false);
  assert.equal(evaluateStep(pick, { checks: { answer: true } }).completed, true);

  const writing = buildLocalStep(session, 7, bank);
  const low = evaluateStep(writing, { checks: { wordCount: 80, wordUsed: true, linking: 2, band: 5.5 } });
  assert.equal(low.completed, false);
  assert.equal(low.items.find((item) => item.id === 'band').met, false);

  const frame = buildLocalStep(session, 6, bank);
  const short = evaluateStep(frame, { checks: { wordCount: 10, wordUsed: true, structure: true, sentences: 2 } });
  assert.equal(short.completed, false);
});

test('summarise aggregates 80 vocabulary exposures and 16 grammar contacts', () => {
  const session = makeSession();
  for (let index = 0; index < STEP_SPECS.length; index += 1) {
    const step = buildLocalStep(session, index, bank);
    session.steps[index] = step;
    const progress = passProgress(step);
    assert.ok(evaluateStep(step, progress).completed, step.key);
    session.results[index] = { ...evaluateStep(step, progress), checks: progress.checks, timeSpent: 120 };
  }
  const summary = summarizeSession(session);
  assert.equal(summary.completedSteps, 8);
  assert.equal(summary.totalSeconds, 960);
  assert.equal(summary.vocab.exposures, 80);
  assert.equal(summary.vocab.target, 80);
  assert.equal(summary.vocab.core.length, 8);
  assert.equal(summary.grammar.exposures, 16);
  assert.equal(summary.overall, 100);
  assert.equal(summary.band, 8);
  assert.equal(summary.timeline.length, 8);
  assert.ok(summary.achievements.every((item) => item.met));
  assert.equal(summary.moduleStats.length, 4);
  assert.ok(summary.strengths.length >= 1);
  assert.ok(summary.next.length >= 1);
});

test('AI step overlay is validated and keeps the target word', () => {
  const session = makeSession();
  const step = buildLocalStep(session, 0, bank);
  const candidate = { ...step.payload, explanation: 'AI 改写过的解释' };
  const merged = applyAIStep(step, candidate);
  assert.equal(merged.source, 'ai');
  assert.equal(merged.payload.explanation, 'AI 改写过的解释');

  const invalid = { ...step.payload, audioText: 'This sentence has no target.' };
  assert.equal(applyAIStep(step, invalid).source, 'local');

  const prompt = buildStepPrompt(session, step);
  assert.match(prompt.system, /JSON/);
  assert.ok(prompt.user.includes(step.word.word));
  assert.ok(prompt.user.includes(step.kind));
});

test('tutor messages include role-play system and openings', () => {
  const session = makeSession();
  const step = buildLocalStep(session, 5, bank);
  const messages = buildTutorMessages(session, step, [{ role: 'user', text: 'I think it matters.' }]);
  assert.equal(messages[0].role, 'system');
  assert.match(messages[0].content, /IELTS speaking tutor/);
  assert.equal(messages[1].role, 'assistant');
  assert.equal(messages.at(-1).role, 'user');
});

test('derived vocabulary uses synonyms, family, chunks and scene words', () => {
  const entry = bank[0];
  const items = deriveVocabulary(entry, getScene('music'), 0, bank);
  assert.equal(items.length, 10);
  assert.equal(new Set(items.map((item) => item.term.toLowerCase())).size, 10);
  assert.ok(items.some((item) => item.type === 'synonym'));
  assert.ok(items.some((item) => item.type === 'family'));
  assert.ok(items.some((item) => item.type === 'chunk'));
  assert.ok(items.some((item) => item.type === 'scene'));
});

test('speech comparison and writing rubric behave sensibly', () => {
  const exact = compareSpeech('Many students abandon their plans.', 'many students abandon their plans');
  assert.equal(exact.accuracy, 1);
  const partial = compareSpeech('Many students abandon their plans.', 'many students give up their plans');
  assert.ok(partial.accuracy < 1 && partial.accuracy > 0.4);
  assert.ok(partial.missing.includes('abandon'));

  const strong = scoreWriting(
    'Small habits accumulate into remarkable results over a single academic year. However, many students abandon their plans because the first week feels uncomfortable. For example, a ten-minute walk can build momentum, and that momentum makes the next choice easier. Therefore, patience matters more than talent.',
    { word: 'abandon', learned: ['accumulate', 'momentum'], structure: { regex: /however|therefore/i }, minWords: 50, maxWords: 110 },
  );
  assert.ok(strong.band >= 6, `expected band >= 6, got ${strong.band}`);
  assert.equal(strong.targetUsed, true);
  assert.ok(strong.linking.length >= 2);

  const weak = scoreWriting('I like it.', { word: 'abandon', learned: [], minWords: 50, maxWords: 110 });
  assert.ok(weak.band < strong.band);
  assert.equal(weak.targetUsed, false);
  assert.ok(countWords('one two three') === 3);
  assert.ok(similarity('a b c', 'a b c') === 1);
});

test('voice commands parse bilingual intents', () => {
  assert.deepEqual(parseCommand('next step'), { intent: 'next' });
  assert.deepEqual(parseCommand('下一步'), { intent: 'next' });
  assert.deepEqual(parseCommand('choose B'), { intent: 'option', index: 1 });
  assert.deepEqual(parseCommand('播放一下'), { intent: 'play' });
  assert.deepEqual(parseCommand('提示'), { intent: 'hint' });
  assert.equal(parseCommand('search for urban gardening').intent, 'search');
  assert.equal(parseCommand('hello there'), null);
});

test('module order is listening, reading, speaking, writing', () => {
  assert.deepEqual(MODULES.map((module) => module.id), ['listening', 'reading', 'speaking', 'writing']);
  assert.deepEqual(STEP_SPECS.map((spec) => spec.module), [
    'listening', 'listening', 'reading', 'reading', 'speaking', 'speaking', 'writing', 'writing',
  ]);
});

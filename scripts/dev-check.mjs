import { readFile } from 'node:fs/promises';
import {
  analyzeInput,
  buildLocalStep,
  buildStepPrompt,
  createSession,
  evaluateStep,
  makeProgressCheck,
  summarizeSession,
} from '../public/js/engine.js';

const bank = JSON.parse(await readFile(new URL('../data/core100.json', import.meta.url), 'utf8')).words;

const sample = `Urban planners increasingly argue that cities should abandon the idea of building wider roads.
Instead, they advocate investing in public transport and shaded walking routes.
A recent study found that streets with trees are used more often, even when the distance is the same.`;

const analysis = analyzeInput(sample, { bank, sceneId: 'tech', band: 6.5 });
console.log('targets:', analysis.targetWords.map((entry) => entry.word).join(', '));
console.log('grammar:', analysis.grammar.join(', '));
console.log('stats:', analysis.stats);

const session = createSession({ text: sample, sceneId: 'tech', band: 6.5, bank });
for (let index = 0; index < 8; index += 1) {
  const step = buildLocalStep(session, index, bank);
  session.steps[index] = step;
}
for (const step of session.steps) {
  const payload = step.payload;
  if (payload.options) {
    if (!payload.options[payload.answerIndex]) throw new Error(`bad answerIndex ${step.key}`);
  }
  if (step.kind === 'listen_dictation' && !payload.answer.includes(step.word.word)) {
    throw new Error(`dictation chunk misses target: ${payload.answer}`);
  }
}
console.log('steps:', session.steps.map((step) => `${step.key}:${step.word.word}`).join(' '));
console.log('prompt chars:', buildStepPrompt(session, session.steps[2]).user.length);

session.results[0] = { completed: true, score: 100, timeSpent: 120, checks: makeProgressCheck(session.steps[0].kind, { correct: true }) };
session.results[1] = { completed: false, score: 80, timeSpent: 180, checks: { accuracy: 0.8 } };
console.log('eval:', evaluateStep(session.steps[0], session.results[0]));
const summary = summarizeSession(session);
console.log('summary:', { overall: summary.overall, band: summary.band, vocab: summary.vocab.exposures, grammar: summary.grammar.exposures });

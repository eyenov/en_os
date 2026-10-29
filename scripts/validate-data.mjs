import { readFile } from 'node:fs/promises';

const data = JSON.parse(await readFile(new URL('../data/core100.json', import.meta.url), 'utf8'));
const words = data.words;
const problems = [];
const ids = new Set();

for (const entry of words) {
  if (ids.has(entry.id)) problems.push(`duplicate id: ${entry.id}`);
  ids.add(entry.id);
  if (!entry.example.toLowerCase().includes(entry.word.toLowerCase())) {
    problems.push(`example does not contain word: ${entry.word}`);
  }
  for (const key of ['id', 'word', 'ipa', 'pos', 'zh', 'def', 'example', 'exampleZh', 'collocations', 'synonyms', 'family', 'scenes', 'band']) {
    if (entry[key] === undefined) problems.push(`missing ${key}: ${entry.word}`);
  }
  if (entry.synonyms?.length !== 2) problems.push(`need 2 synonyms: ${entry.word}`);
  if (entry.family?.length !== 2) problems.push(`need 2 family words: ${entry.word}`);
  if (entry.collocations?.length !== 2) problems.push(`need 2 collocations: ${entry.word}`);
}

const scenes = new Set(words.flatMap((entry) => entry.scenes));
const sceneBank = new Set(['music', 'comic', 'sports', 'science', 'travel', 'food', 'tech', 'nature']);
for (const scene of scenes) if (!sceneBank.has(scene)) problems.push(`unknown scene: ${scene}`);

console.log(`entries: ${words.length}`);
console.log(`unique ids: ${ids.size}`);
console.log(`bands: ${[...new Set(words.map((entry) => entry.band))].sort().join(', ')}`);
console.log(`scenes: ${[...scenes].sort().join(', ')}`);
console.log(`avg sentence length: ${Math.round(words.reduce((sum, entry) => sum + entry.example.split(/\s+/).length, 0) / words.length)} words`);
console.log(`problems: ${problems.length}`);
for (const problem of problems) console.log(` - ${problem}`);
if (problems.length || words.length !== 100) process.exitCode = 1;

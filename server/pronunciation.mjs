import { readFile } from 'node:fs/promises';
import { HttpError } from './providers.mjs';
import { speechTokens } from '../public/js/shadowing.js';

let dictionaryPromise = null;

function pronunciations(value = '') {
  return String(value).match(/\/[^/]+\//g)?.slice(0, 4) || [];
}

async function dictionary() {
  dictionaryPromise ??= readFile(new URL('./ipa-en-us.txt', import.meta.url), 'utf8').then((content) =>
    new Map(content.trim().split(/\r?\n/).map((line) => line.split('\t'))));
  return dictionaryPromise;
}

export async function getPronunciation(text) {
  if (typeof text !== 'string' || text.length > 120) throw new HttpError(400, '单词不合法。', 'BAD_WORD');
  const word = text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[\u2018\u2019]/g, "'")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, '').toLowerCase();
  if (!/^[a-z0-9]+(?:['-][a-z0-9]+)*$/.test(word) || word.length > 80) throw new HttpError(400, '单词不合法。', 'BAD_WORD');
  const entries = await dictionary();
  let ipa = pronunciations(entries.get(word));
  if (!ipa.length) {
    const tokens = word.includes('-') ? word.split('-').flatMap(speechTokens) : speechTokens(word);
    if (tokens.length > 1) {
      const parts = tokens.map((token) => pronunciations(entries.get(token))[0]);
      if (parts.every(Boolean)) ipa = [`/${parts.map((part) => part.slice(1, -1)).join(' ')}/`];
    }
  }
  return { word, ipa, accent: 'en-US', source: 'ipa-dict' };
}
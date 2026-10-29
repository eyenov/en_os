/**
 * Hover-to-translate for English words anywhere in the app.
 * Order: words from the current listening lesson → 100 core words → AI dictionary.
 */
import { aiReady, lookupWord } from './api.js';
import { getSettings, saveSettings } from './store.js';
import { h, icon } from './ui.js';
import { speak } from './speech.js';

const CACHE_KEY = 'enos.lookup.cache.v1';
const SOURCE_LABEL = { lesson: '本课词', core: '核心词库', basic: '基础词', ai: 'AI 词典' };

/** Tiny offline glossary for function words, so key-less hovers still help. */
const BASIC_ENTRIES = {
  the: ['art.', '定冠词：特指', 'used before a noun that is already known'],
  a: ['art.', '一个（辅音前）', 'one, not a particular one'],
  an: ['art.', '一个（元音前）', 'one, before a vowel sound'],
  is: ['v.', '是（第三人称单数）', 'be, present tense'],
  are: ['v.', '是（复数/第二人称）', 'be, present tense'],
  am: ['v.', '是（第一人称）', 'be, present tense'],
  was: ['v.', '是（过去式）', 'be, past tense'],
  were: ['v.', '是（过去式复数）', 'be, past tense'],
  be: ['v.', '是；存在', 'the base form of is / are / was'],
  do: ['v.', '做；助动词', 'to perform an action; used in questions'],
  does: ['v.', '做（第三人称）', 'do, present tense'],
  did: ['v.', '做（过去式）；助动词', 'do, past tense'],
  have: ['v.', '有', 'to own or hold'],
  has: ['v.', '有（第三人称）', 'have, present tense'],
  had: ['v.', '有（过去式）', 'have, past tense'],
  will: ['modal', '将会', 'used for the future'],
  would: ['modal', '会（假设/礼貌）', 'used for polite requests or unreal situations'],
  can: ['modal', '能，可以', 'be able to; be allowed to'],
  could: ['modal', '能（过去/委婉）', 'past of can; a polite request'],
  should: ['modal', '应该', 'used to give advice'],
  may: ['modal', '可能；可以', 'used for possibility or permission'],
  might: ['modal', '也许', 'used for a weaker possibility'],
  must: ['modal', '必须', 'used for strong obligation'],
  not: ['adv.', '不', 'used to make a negative'],
  of: ['prep.', '……的', 'showing belonging or relation'],
  to: ['prep.', '到；向；不定式符号', 'towards; before a verb'],
  in: ['prep.', '在……里', 'inside a place or period'],
  on: ['prep.', '在……上', 'touching a surface; about'],
  at: ['prep.', '在（某点/时刻）', 'a point in place or time'],
  for: ['prep.', '为了；给', 'intended for; because of'],
  from: ['prep.', '从', 'the starting point'],
  with: ['prep.', '和……一起；带有', 'together with; having'],
  by: ['prep.', '由；在……旁边；通过', 'agent, place or method'],
  and: ['conj.', '和', 'used to join words or clauses'],
  but: ['conj.', '但是', 'used to show contrast'],
  or: ['conj.', '或者', 'used to show a choice'],
  so: ['conj.', '所以', 'used to show a result'],
  because: ['conj.', '因为', 'used to give a reason'],
  if: ['conj.', '如果', 'used for a condition'],
  this: ['pron.', '这个', 'the thing near you'],
  that: ['pron.', '那个；引导从句', 'the thing further away; introduces a clause'],
  it: ['pron.', '它', 'the thing already mentioned'],
  i: ['pron.', '我', 'the speaker'],
  you: ['pron.', '你/你们', 'the person spoken to'],
  we: ['pron.', '我们', 'the speaker and other people'],
  they: ['pron.', '他们/它们', 'other people or things'],
  he: ['pron.', '他', 'a male person'],
  she: ['pron.', '她', 'a female person'],
  there: ['adv.', '那里；存在', 'a place; used in there is / there are'],
  here: ['adv.', '这里', 'this place'],
  what: ['pron.', '什么', 'asks about a thing'],
  why: ['adv.', '为什么', 'asks about a reason'],
  how: ['adv.', '如何', 'asks about a way'],
  when: ['adv.', '何时', 'asks about a time'],
  where: ['adv.', '哪里', 'asks about a place'],
  who: ['pron.', '谁', 'asks about a person'],
  very: ['adv.', '非常', 'to a high degree'],
  more: ['adv.', '更多', 'a larger amount'],
  also: ['adv.', '也', 'in addition'],
  just: ['adv.', '刚刚；只是', 'a short time ago; only'],
  only: ['adv.', '只', 'no more than'],
  than: ['conj.', '比', 'used in comparisons'],
  then: ['adv.', '然后', 'after that'],
  now: ['adv.', '现在', 'at this time'],
};
const basicIndex = new Map(Object.entries(BASIC_ENTRIES).map(([word, [pos, zh, en]]) => [word, {
  word, pos, zh, en, phonetic: '', usage: '', example: '', source: 'basic',
}]));

let installed = false;
let rootEl = null;
let toggleButton = null;
let enabled = false;
let pop = null;
let wordEl = null;
let ipaEl = null;
let zhEl = null;
let enEl = null;
let usageRow = null;
let usageEl = null;
let exampleRow = null;
let exampleEl = null;
let sourceEl = null;

let lessonIndex = new Map();
let bankIndex = new Map();
let bankPromise = null;
let currentWord = '';
let lastPoint = { x: 0, y: 0 };
let hoverTimer = null;
let hideTimer = null;
let overPopover = false;
let lookupSeq = 0;
const aiCache = loadCache();

/** Expand a caret offset to the English word that contains it. */
export function wordFromText(text, offset) {
  const value = String(text || '');
  const isWordChar = (char) => Boolean(char) && /[A-Za-z'’-]/.test(char);
  let start = Math.max(0, Math.min(Number(offset) || 0, value.length));
  let end = start;
  while (start > 0 && isWordChar(value[start - 1])) start -= 1;
  while (end < value.length && isWordChar(value[end])) end += 1;
  const raw = value.slice(start, end).replace(/^['’-]+|['’-]+$/g, '');
  if (!/[A-Za-z]{2,}/.test(raw) && !/^[Ii]$/.test(raw)) return '';
  return raw;
}

/** Lookup forms: exact, then a few common inflections. */
export function wordCandidates(word) {
  const base = String(word || '').toLowerCase().trim();
  if (!base) return [];
  const list = [base];
  if (base.endsWith('ies') && base.length > 4) list.push(`${base.slice(0, -3)}y`);
  if (base.endsWith('es') && base.length > 4) list.push(base.slice(0, -2));
  if (base.endsWith('s') && !base.endsWith('ss') && base.length > 3) list.push(base.slice(0, -1));
  if (base.endsWith('ing') && base.length > 5) {
    const stem = base.slice(0, -3);
    list.push(stem, `${stem}e`);
    if (/([b-df-hj-np-tv-z])\1$/.test(stem)) list.push(stem.slice(0, -1));
  }
  if (base.endsWith('ed') && base.length > 4) {
    const stem = base.slice(0, -2);
    list.push(stem);
    if (/([b-df-hj-np-tv-z])\1$/.test(stem)) list.push(stem.slice(0, -1));
  }
  return [...new Set(list)];
}

/** Index single-word entries from the current listening dialogue. */
export function buildLessonIndex(dialogue) {
  const index = new Map();
  for (const line of dialogue?.lines || []) {
    for (const word of line.words || []) {
      const term = String(word.term || '').trim().toLowerCase();
      if (!/^[a-z][a-z'’-]*$/.test(term)) continue;
      index.set(term, {
        word: term,
        phonetic: '',
        pos: word.pos || '',
        zh: word.zh || '',
        en: word.gloss || '',
        usage: word.usage || '',
        example: '',
        source: 'lesson',
      });
    }
  }
  return index;
}

export function setLessonVocabulary(dialogue) {
  lessonIndex = buildLessonIndex(dialogue);
}

export function clearLessonVocabulary() {
  lessonIndex = new Map();
}

function loadCache() {
  try {
    const data = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function saveCache() {
  try {
    const entries = Object.entries(aiCache).slice(-300);
    localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* storage full or unavailable */
  }
}

function loadBank() {
  if (bankPromise || bankIndex.size) return;
  bankPromise = fetch('/data/core100.json', { headers: { Accept: 'application/json' } })
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => {
      const index = new Map();
      for (const item of data?.words || []) {
        index.set(String(item.word || '').toLowerCase(), {
          word: item.word,
          phonetic: item.ipa || '',
          pos: item.pos || '',
          zh: item.zh || '',
          en: item.def || '',
          usage: Array.isArray(item.collocations) ? item.collocations.join(' · ') : '',
          example: item.example || '',
          source: 'core',
        });
      }
      bankIndex = index;
    })
    .catch(() => { bankPromise = null; });
}

function localLookup(word) {
  for (const candidate of wordCandidates(word)) {
    if (lessonIndex.has(candidate)) return lessonIndex.get(candidate);
    if (bankIndex.has(candidate)) return bankIndex.get(candidate);
    if (basicIndex.has(candidate)) return basicIndex.get(candidate);
  }
  return null;
}

function buildPopover() {
  wordEl = h('strong', { class: 'wp-word' });
  ipaEl = h('span', { class: 'wp-ipa' });
  zhEl = h('div', { class: 'wp-zh' });
  enEl = h('div', { class: 'wp-en' });
  usageEl = h('span', {});
  exampleEl = h('span', {});
  usageRow = h('div', { class: 'wp-row', hidden: true }, h('span', { class: 'wp-key' }, '用法'), usageEl);
  exampleRow = h('div', { class: 'wp-row', hidden: true }, h('span', { class: 'wp-key' }, '例句'), exampleEl);
  sourceEl = h('span', { class: 'wp-src' });
  pop = h('div', { class: 'word-pop', id: 'word-pop', role: 'dialog', 'aria-live': 'polite', hidden: true },
    h('div', { class: 'wp-head' },
      wordEl,
      ipaEl,
      h('button', {
        class: 'wp-say',
        type: 'button',
        'aria-label': '朗读单词',
        title: '朗读',
        onclick: () => { if (currentWord) speak(currentWord, { rate: 0.85 }); },
      }, h('span', { html: icon('volume', 15) }))),
    zhEl,
    enEl,
    usageRow,
    exampleRow,
    h('div', { class: 'wp-foot' }, sourceEl, h('span', {}, 'Esc 关闭')));
  pop.addEventListener('pointerenter', () => {
    overPopover = true;
    clearTimeout(hoverTimer);
    clearTimeout(hideTimer);
  });
  pop.addEventListener('pointerleave', () => {
    overPopover = false;
    scheduleHide();
  });
  document.body.append(pop);
}

function place(x, y) {
  pop.hidden = false;
  pop.style.left = '0px';
  pop.style.top = '0px';
  const rect = pop.getBoundingClientRect();
  const margin = 12;
  let left = x + 16;
  if (left + rect.width > window.innerWidth - margin) left = Math.max(margin, x - rect.width - 16);
  let top = y + 18;
  if (top + rect.height > window.innerHeight - margin) top = Math.max(margin, y - rect.height - 14);
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
}

function renderEntry(entry) {
  wordEl.textContent = currentWord;
  ipaEl.textContent = [entry.pos, entry.phonetic].filter(Boolean).join(' · ');
  zhEl.textContent = entry.zh || '—';
  zhEl.classList.remove('wp-loading');
  enEl.textContent = entry.en || '';
  usageEl.textContent = entry.usage || '';
  usageRow.hidden = !entry.usage;
  exampleEl.textContent = entry.example || '';
  exampleRow.hidden = !entry.example;
  sourceEl.textContent = SOURCE_LABEL[entry.source] || '';
  place(lastPoint.x, lastPoint.y);
}

function renderLoading(word) {
  wordEl.textContent = word;
  ipaEl.textContent = '';
  zhEl.textContent = '查询中…';
  zhEl.classList.add('wp-loading');
  enEl.textContent = '';
  usageRow.hidden = true;
  exampleRow.hidden = true;
  sourceEl.textContent = '';
}

function renderMissing() {
  zhEl.textContent = '本地词库未收录';
  zhEl.classList.remove('wp-loading');
  enEl.textContent = '配置 API Key 后可查询任意单词；本课关键词和 100 核心词无需 Key。';
  usageRow.hidden = true;
  exampleRow.hidden = true;
  sourceEl.textContent = '未收录';
  place(lastPoint.x, lastPoint.y);
}

function renderError(message) {
  zhEl.textContent = '查询失败';
  zhEl.classList.remove('wp-loading');
  enEl.textContent = message || '请稍后再试。';
  usageRow.hidden = true;
  exampleRow.hidden = true;
  sourceEl.textContent = '';
  place(lastPoint.x, lastPoint.y);
}

async function showWord(word, x, y) {
  const key = word.toLowerCase();
  currentWord = word;
  lastPoint = { x, y };
  const seq = (lookupSeq += 1);
  renderLoading(word);
  place(x, y);
  clearTimeout(hideTimer);

  const local = localLookup(key);
  if (local) {
    renderEntry(local);
    return;
  }
  if (!aiReady(getSettings())) {
    renderMissing();
    return;
  }
  if (aiCache[key]) {
    renderEntry(aiCache[key]);
    return;
  }

  try {
    const data = await lookupWord(key);
    if (seq !== lookupSeq) return;
    const entry = {
      word: key,
      phonetic: data.phonetic || '',
      pos: '',
      zh: data.zh || '',
      en: data.en || '',
      usage: data.usage || '',
      example: data.example || '',
      source: 'ai',
    };
    aiCache[key] = entry;
    saveCache();
    renderEntry(entry);
  } catch (error) {
    if (seq !== lookupSeq) return;
    renderError(error.status === 404 ? '查词服务还没启动，请重启 npm start。' : error.message);
  }
}

function hide() {
  if (!pop) return;
  pop.hidden = true;
  currentWord = '';
  lookupSeq += 1;
}

function scheduleHide() {
  if (overPopover) return;
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { if (!overPopover) hide(); }, 180);
}

function isEditableTarget(target) {
  return Boolean(target?.closest?.('input, textarea, select, option, [contenteditable="true"], [data-no-lookup], .word-pop'));
}

function wordAtPoint(x, y) {
  let range = null;
  if (typeof document.caretRangeFromPoint === 'function') {
    range = document.caretRangeFromPoint(x, y);
  } else if (typeof document.caretPositionFromPoint === 'function') {
    const position = document.caretPositionFromPoint(x, y);
    if (position) {
      range = document.createRange();
      range.setStart(position.offsetNode, position.offset);
      range.collapse(true);
    }
  }
  if (!range) return '';
  const node = range.startContainer;
  if (!node || node.nodeType !== 3) return '';
  if (!rootEl || !rootEl.contains(node)) return '';
  return wordFromText(node.textContent || '', range.startOffset);
}

function onPointerMove(event) {
  if (!enabled || event.pointerType === 'touch' || overPopover) return;
  const target = event.target;
  if (!rootEl || !rootEl.contains(target) || isEditableTarget(target)) {
    scheduleHide();
    return;
  }
  const word = wordAtPoint(event.clientX, event.clientY);
  if (!word) {
    scheduleHide();
    return;
  }
  if (word.toLowerCase() === currentWord.toLowerCase() && !pop.hidden) return;
  clearTimeout(hideTimer);
  clearTimeout(hoverTimer);
  hoverTimer = setTimeout(() => showWord(word, event.clientX, event.clientY), 260);
}

function onPointerDown(event) {
  if (!pop || pop.hidden) return;
  if (!pop.contains(event.target)) hide();
}

function onKeyDown(event) {
  if (event.key === 'Escape') hide();
}

function syncToggle() {
  if (!toggleButton) return;
  toggleButton.classList.toggle('on', enabled);
  toggleButton.setAttribute('aria-pressed', enabled ? 'true' : 'false');
  toggleButton.title = enabled ? '取词已开启：鼠标停在英文单词上查看释义' : '取词已关闭';
}

function setEnabled(value) {
  enabled = Boolean(value);
  syncToggle();
  if (!enabled) hide();
}

export function installLookup({ root = document.getElementById('app'), button = null } = {}) {
  if (installed) {
    if (button) {
      toggleButton = button;
      syncToggle();
    }
    return;
  }
  installed = true;
  rootEl = root;
  toggleButton = button;
  buildPopover();
  setEnabled(getSettings().lookup !== false);
  loadBank();

  if (toggleButton) {
    toggleButton.addEventListener('click', () => {
      setEnabled(!enabled);
      saveSettings({ lookup: enabled });
    });
  }
  document.addEventListener('pointermove', onPointerMove, { passive: true });
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('scroll', hide, true);
}

export function destroyLookup() {
  if (!installed) return;
  pop?.remove();
  pop = null;
  installed = false;
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getLocale, msg, setLocale, t } from '../public/js/i18n.js';
import english from '../public/js/locales/en.js';
import { describeShadowingAttempt } from '../public/js/shadowing.js';
import { ApiError, errorMessage, getBooks } from '../public/js/api.js';

globalThis.window = new EventTarget();
const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
};

test('interface starts in Chinese and switches both static and interpolated messages', () => {
  assert.equal(getLocale(), 'zh-CN');
  assert.equal(t('设置'), '设置');
  setLocale('en');
  assert.equal(t('设置'), 'Settings');
  assert.equal(t('第 {{number}} 遍', { number: 3 }), 'Attempt 3');
  assert.equal(t('{{count}}次记录', { count: 1 }), '1 attempt');
  assert.equal(t('{{count}}次记录', { count: 2 }), '2 attempts');
  assert.equal(t('第 {{number}} 遍 · {{status}}', { number: 2, status: msg('已读完') }), 'Attempt 2 · Completed');
  setLocale('zh-CN');
  assert.equal(t('{{count}}次记录', { count: 2 }), '2次记录');
  assert.equal(t('第 {{number}} 遍 · {{status}}', { number: 2, status: msg('已读完') }), '第 2 遍 · 已读完');
});

test('localization preserves supplied media values and uses no HTML interpolation', () => {
  setLocale('en');
  assert.equal(t('开始下载：{{title}}', { title: '城市与树木 <video>' }), 'Downloading: 城市与树木 <video>');
  assert.equal(t('An original English sentence.'), 'An original English sentence.');
  assert.deepEqual(msg('第 {{number}} 遍', { number: 2 }), { i18nKey: '第 {{number}} 遍', values: { number: 2 } });
  setLocale('zh-CN');
});

test('English catalog contains nonempty translations with matching interpolation names', () => {
  const tokens = (value) => [...value.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort();
  for (const [key, value] of Object.entries(english)) {
    assert.equal(typeof value, 'string');
    assert.ok(value.trim(), key);
    assert.deepEqual(tokens(value), tokens(key), key);
  }
});

test('sentence feedback follows interface language without altering the caption', () => {
  const cue = { start: 0, end: 2, en: 'Cities should' };
  setLocale('en');
  const englishReview = describeShadowingAttempt(cue, { matched: [0], status: 'stopped' });
  assert.equal(englishReview.summary, '1/2 words aligned');
  assert.ok(englishReview.advice.includes('“should”'));
  assert.equal(cue.en, 'Cities should');
  setLocale('zh-CN');
  assert.equal(describeShadowingAttempt(cue, { matched: [0] }).summary, '已对齐 1/2 词');
  assert.equal(t(englishReview.summaryMessage.i18nKey, englishReview.summaryMessage.values), '已对齐 1/2 词');
  assert.ok(t(englishReview.adviceMessage.i18nKey, englishReview.adviceMessage.values).includes('「should」'));
});

test('API error messages follow locale while preserving diagnostic details', async () => {
  const original = globalThis.fetch;
  const error = new ApiError('EPUB 目录已损坏。', 'BOOK_BAD_EPUB', 502);
  const display = errorMessage(error);
  setLocale('en');
  assert.equal(t(display.i18nKey, display.values), 'The EPUB is damaged or cannot be safely decompressed.');
  assert.equal(error.message, 'EPUB 目录已损坏。');
  setLocale('zh-CN');
  assert.equal(t(display.i18nKey, display.values), 'EPUB 已损坏或无法安全解压。');
  try {
    globalThis.fetch = async () => new Response('', { status: 503 });
    await assert.rejects(getBooks(), (failure) => {
      const message = errorMessage(failure);
      setLocale('en');
      assert.equal(t(message.i18nKey, message.values), 'Request failed (503)');
      return failure.status === 503;
    });
  } finally { globalThis.fetch = original; setLocale('zh-CN'); }
});
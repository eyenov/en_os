import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { clearAllData, DEFAULT_SETTINGS, getSettings, resetSettings, saveSettings } from '../public/js/store.js';

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
  key: (index) => [...storage.keys()][index] ?? null,
  get length() { return storage.size; },
};
globalThis.window = new EventTarget();

beforeEach(() => {
  clearAllData();
  storage.clear();
});

test('invalid persisted settings fall back to fresh defaults', () => {
  for (const value of [null, [], false, 'invalid']) {
    clearAllData();
    storage.set('enos.settings.v1', JSON.stringify(value));
    assert.deepEqual(getSettings(), DEFAULT_SETTINGS);
  }
});

test('settings retain only supported fields and valid provider strings', () => {
  storage.set('enos.settings.v1', JSON.stringify({
    provider: '__proto__', keys: { custom: ' fixture-key ', unknown: 'discard' },
    baseUrls: [], models: { custom: 123 }, youtubeKey: {}, voiceRate: 1.2, scene: 'music',
  }));
  assert.deepEqual(getSettings(), { ...DEFAULT_SETTINGS, keys: { custom: 'fixture-key' } });
});

test('partial saves merge provider maps and resets do not reuse old maps', () => {
  saveSettings({ keys: { custom: 'fixture-key' }, baseUrls: { custom: 'https://example.com/v1' } });
  saveSettings({ keys: { kimi: 'second-key' } });
  assert.equal(getSettings().keys.custom, 'fixture-key');
  const { keys } = getSettings();
  resetSettings();
  saveSettings({ keys });
  assert.deepEqual(getSettings().keys, { custom: 'fixture-key', kimi: 'second-key' });
  assert.deepEqual(getSettings().baseUrls, {});
  assert.deepEqual(DEFAULT_SETTINGS.keys, {});
});

test('clearing removes application preferences and old data without touching other storage', () => {
  saveSettings({ keys: { custom: 'fixture-key' } });
  storage.set('enos.podcast.offset.v1.example', '0.5');
  storage.set('enos.sessions.v1', '[]');
  storage.set('unrelated-app', 'keep');
  clearAllData();
  assert.deepEqual([...storage], [['unrelated-app', 'keep']]);
  assert.deepEqual(getSettings(), DEFAULT_SETTINGS);
});

test('interface language defaults to Chinese, persists English and rejects unsupported values', () => {
  assert.equal(getSettings().locale, 'zh-CN');
  saveSettings({ locale: 'en' });
  assert.equal(getSettings().locale, 'en');
  assert.equal(JSON.parse(storage.get('enos.settings.v1')).locale, 'en');
  for (const locale of ['fr', null, {}, 'en-US']) {
    saveSettings({ locale });
    assert.equal(getSettings().locale, 'zh-CN');
  }
  saveSettings({ locale: 'en' });
  resetSettings();
  assert.equal(getSettings().locale, 'zh-CN');
});
const SETTINGS_KEY = 'enos.settings.v1';
const PROVIDER_IDS = new Set(['deepseek', 'kimi', 'zhipu', 'mimo', 'custom']);

const memory = new Map();

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return memory.has(key) ? memory.get(key) : fallback;
    return JSON.parse(raw);
  } catch {
    return memory.has(key) ? memory.get(key) : fallback;
  }
}

function write(key, value) {
  memory.set(key, value);
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.warn('localStorage write failed', error);
    return false;
  }
}

export const DEFAULT_SETTINGS = Object.freeze({
  provider: 'deepseek',
  keys: Object.freeze({}),
  baseUrls: Object.freeze({}),
  models: Object.freeze({}),
  aiMode: 'auto',
  youtubeKey: '',
});

function stringMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([key, text]) => PROVIDER_IDS.has(key) && typeof text === 'string')
    .map(([key, text]) => [key, text.trim().slice(0, 8192)]));
}

function normalizeSettings(value) {
  const stored = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    provider: PROVIDER_IDS.has(stored.provider) ? stored.provider : DEFAULT_SETTINGS.provider,
    keys: stringMap(stored.keys),
    baseUrls: stringMap(stored.baseUrls),
    models: stringMap(stored.models),
    aiMode: stored.aiMode === 'off' ? 'off' : 'auto',
    youtubeKey: typeof stored.youtubeKey === 'string' ? stored.youtubeKey.trim().slice(0, 8192) : '',
  };
}

let settingsCache = null;

export function getSettings() {
  if (!settingsCache) {
    settingsCache = normalizeSettings(read(SETTINGS_KEY, {}));
  }
  return settingsCache;
}

export function saveSettings(patch = {}) {
  const next = { ...getSettings(), ...patch };
  if (patch.keys) next.keys = { ...getSettings().keys, ...patch.keys };
  if (patch.baseUrls) next.baseUrls = { ...getSettings().baseUrls, ...patch.baseUrls };
  if (patch.models) next.models = { ...getSettings().models, ...patch.models };
  settingsCache = normalizeSettings(next);
  write(SETTINGS_KEY, settingsCache);
  window.dispatchEvent(new CustomEvent('enos:settings'));
  return settingsCache;
}

export function resetSettings() {
  settingsCache = normalizeSettings(DEFAULT_SETTINGS);
  write(SETTINGS_KEY, settingsCache);
  window.dispatchEvent(new CustomEvent('enos:settings'));
}

export function clearAllData() {
  memory.clear();
  try {
    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index));
    for (const key of keys) {
      if (key?.startsWith('enos.')) localStorage.removeItem(key);
    }
  } catch {
    console.warn('无法清理浏览器存储。');
  }
  settingsCache = null;
  window.dispatchEvent(new CustomEvent('enos:settings'));
}

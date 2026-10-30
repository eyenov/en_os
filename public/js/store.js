import { getScene } from './scenes.js';

const SETTINGS_KEY = 'enos.settings.v1';
const CURRENT_KEY = 'enos.session.current.v1';
const SESSIONS_KEY = 'enos.sessions.v1';
const LISTENING_CURRENT_KEY = 'enos.listening.current.v1';
const LISTENING_SESSIONS_KEY = 'enos.listening.sessions.v1';
const MAX_SESSIONS = 8;
const MAX_LISTENING_SESSIONS = 8;

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

export const DEFAULT_SETTINGS = {
  provider: 'deepseek',
  keys: {},
  baseUrls: {},
  models: {},
  aiMode: 'auto',
  voiceRate: 0.92,
  voiceLang: 'en-GB',
  scene: 'music',
  band: 6.5,
  name: '',
  lookup: true,
  youtubeKey: '',
};

let settingsCache = null;

export function getSettings() {
  if (!settingsCache) {
    const stored = read(SETTINGS_KEY, {});
    settingsCache = {
      ...DEFAULT_SETTINGS,
      ...stored,
      keys: { ...DEFAULT_SETTINGS.keys, ...(stored.keys || {}) },
      baseUrls: { ...(stored.baseUrls || {}) },
      models: { ...(stored.models || {}) },
    };
  }
  return settingsCache;
}

export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  if (patch.keys) next.keys = { ...getSettings().keys, ...patch.keys };
  if (patch.baseUrls) next.baseUrls = { ...getSettings().baseUrls, ...patch.baseUrls };
  if (patch.models) next.models = { ...getSettings().models, ...patch.models };
  settingsCache = next;
  write(SETTINGS_KEY, next);
  window.dispatchEvent(new CustomEvent('enos:settings', { detail: next }));
  return next;
}

export function resetSettings() {
  settingsCache = { ...DEFAULT_SETTINGS, keys: {} };
  write(SETTINGS_KEY, settingsCache);
  window.dispatchEvent(new CustomEvent('enos:settings', { detail: settingsCache }));
}

export function getCurrentSession() {
  const session = read(CURRENT_KEY, null);
  if (!session || !Array.isArray(session.steps)) return null;
  return session;
}

export function saveCurrentSession(session) {
  session.updatedAt = new Date().toISOString();
  return write(CURRENT_KEY, session);
}

export function clearCurrentSession() {
  memory.delete(CURRENT_KEY);
  try { localStorage.removeItem(CURRENT_KEY); } catch { /* ignore */ }
}

export function listSessions() {
  const sessions = read(SESSIONS_KEY, []);
  return Array.isArray(sessions) ? sessions : [];
}

export function getSessionById(id) {
  return listSessions().find((session) => session.id === id) || null;
}

export function saveFinishedSession(session) {
  session.status = 'done';
  session.finishedAt = session.finishedAt || new Date().toISOString();
  const sessions = listSessions().filter((item) => item.id !== session.id);
  sessions.unshift(session);
  const trimmed = sessions.slice(0, MAX_SESSIONS);
  write(SESSIONS_KEY, trimmed);
  clearCurrentSession();
  window.dispatchEvent(new CustomEvent('enos:sessions'));
  return trimmed;
}

export function deleteSession(id) {
  const sessions = listSessions().filter((item) => item.id !== id);
  write(SESSIONS_KEY, sessions);
  window.dispatchEvent(new CustomEvent('enos:sessions'));
}

/* ---------- Listening lab ---------- */

export function getCurrentListening() {
  const value = read(LISTENING_CURRENT_KEY, null);
  if (!value || !value.dialogue || !Array.isArray(value.dialogue.lines)) return null;
  return value;
}

export function saveCurrentListening(value) {
  value.updatedAt = new Date().toISOString();
  return write(LISTENING_CURRENT_KEY, value);
}

export function clearCurrentListening() {
  memory.delete(LISTENING_CURRENT_KEY);
  try { localStorage.removeItem(LISTENING_CURRENT_KEY); } catch { /* ignore */ }
}

export function listListeningSessions() {
  const sessions = read(LISTENING_SESSIONS_KEY, []);
  return Array.isArray(sessions) ? sessions : [];
}

export function saveListeningSession(session) {
  const sessions = listListeningSessions().filter((item) => item.id !== session.id);
  sessions.unshift(session);
  write(LISTENING_SESSIONS_KEY, sessions.slice(0, MAX_LISTENING_SESSIONS));
  window.dispatchEvent(new CustomEvent('enos:listening'));
  return sessions.slice(0, MAX_LISTENING_SESSIONS);
}

export function deleteListeningSession(id) {
  write(LISTENING_SESSIONS_KEY, listListeningSessions().filter((item) => item.id !== id));
  window.dispatchEvent(new CustomEvent('enos:listening'));
}

export function updateStoredSession(session) {
  const sessions = listSessions();
  const index = sessions.findIndex((item) => item.id === session.id);
  if (index < 0) return false;
  sessions[index] = session;
  write(SESSIONS_KEY, sessions);
  window.dispatchEvent(new CustomEvent('enos:sessions'));
  return true;
}

export function clearAllData() {
  for (const key of [SETTINGS_KEY, CURRENT_KEY, SESSIONS_KEY, LISTENING_CURRENT_KEY, LISTENING_SESSIONS_KEY]) {
    memory.delete(key);
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  }
  settingsCache = { ...DEFAULT_SETTINGS, keys: {} };
}

export function describeSession(session) {
  const scene = getScene(session.sceneId);
  const text = String(session.input?.text || '').replace(/\s+/g, ' ').trim();
  return {
    id: session.id,
    title: text.length > 68 ? `${text.slice(0, 68)}…` : text,
    scene,
    createdAt: session.createdAt,
    finishedAt: session.finishedAt,
    band: session.band,
    mode: session.mode,
    status: session.status,
    completedSteps: Object.values(session.results || {}).filter((result) => result?.completed).length,
    overall: session.summary?.overall ?? null,
  };
}

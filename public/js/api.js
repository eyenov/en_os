import { getSettings } from './store.js';

export class ApiError extends Error {
  constructor(message, code = 'API_ERROR', status = 0) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

export const FALLBACK_PROVIDERS = [
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-flash', models: ['deepseek-flash', 'deepseek-v4-pro'], docs: 'https://platform.deepseek.com', note: '支持 JSON 输出与流式对话。' },
  { id: 'kimi', label: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k3.1-pro', models: ['kimi-k3.1-pro', 'kimi-k3', 'kimi-k2.6'], docs: 'https://platform.kimi.com', note: '国内站 api.moonshot.cn，国际站可换 .ai。' },
  { id: 'zhipu', label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-5.3-flash', models: ['glm-5.3-flash', 'glm-5.3', 'glm-4-flash'], docs: 'https://bigmodel.cn', note: 'OpenAI 兼容模型接口。' },
  { id: 'mimo', label: 'MiMo', baseUrl: 'https://api.xiaomimimo.com/v1', model: 'mimo-v2.6-flash', models: ['mimo-v2.6-flash', 'mimo-v2.6-pro'], docs: 'https://platform.xiaomimimo.com', note: 'OpenAI 兼容协议。' },
  { id: 'custom', label: '自定义', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', models: [], docs: '', note: '任何兼容 /chat/completions 的服务。' },
];

let healthPromise = null;
let healthCache = null;

export function getProviders() {
  return healthCache?.providers?.length ? healthCache.providers : FALLBACK_PROVIDERS;
}

export function getProvider(id) {
  return getProviders().find((provider) => provider.id === id) || getProviders()[0];
}

export async function getHealth(force = false) {
  if (!force && healthCache) return healthCache;
  if (!force && healthPromise) return healthPromise;
  healthPromise = fetch('/api/health', { headers: { Accept: 'application/json' } })
    .then(async (response) => {
      if (!response.ok) throw new Error(`health ${response.status}`);
      healthCache = await response.json();
      return healthCache;
    })
    .catch(() => null)
    .finally(() => { healthPromise = null; });
  return healthPromise;
}

export function apiKeyFor(settings = getSettings(), providerId = settings.provider) {
  return String(settings.keys?.[providerId] || '').trim();
}

export function providerHasEnvKey(providerId) {
  return Boolean(healthCache?.providers?.find((provider) => provider.id === providerId)?.hasEnvKey);
}

export function hasKey(settings = getSettings(), providerId = settings.provider) {
  return Boolean(apiKeyFor(settings, providerId)) || providerHasEnvKey(providerId);
}

export function aiReady(settings = getSettings()) {
  if (settings.aiMode === 'off') return false;
  return hasKey(settings);
}

export function configFor(settings = getSettings()) {
  const provider = getProvider(settings.provider);
  return {
    provider: provider.id,
    apiKey: apiKeyFor(settings, provider.id),
    baseUrl: settings.baseUrls?.[provider.id] || provider.baseUrl,
    model: settings.models?.[provider.id] || provider.model,
  };
}

async function parseError(response) {
  let code = 'API_ERROR';
  let message = `请求失败（${response.status}）`;
  try {
    const data = await response.json();
    if (data?.error) {
      code = data.error.code || code;
      message = data.error.message || message;
    }
  } catch {
    /* ignore */
  }
  return new ApiError(message, code, response.status);
}

export async function chat({ messages, json = false, maxTokens = 1400, temperature = 0.7, signal, settings = getSettings() } = {}) {
  const config = configFor(settings);
  if (!config.apiKey && !providerHasEnvKey(config.provider)) {
    throw new ApiError('还没有配置 API Key。请在设置中配置模型服务。', 'NO_KEY', 401);
  }
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ ...config, messages, json, maxTokens, temperature }),
    signal,
  });
  if (!response.ok) throw await parseError(response);
  return response.json();
}

export async function chatStream({ messages, maxTokens = 700, temperature = 0.7, signal, onDelta, settings = getSettings() }) {
  const config = configFor(settings);
  if (!config.apiKey && !providerHasEnvKey(config.provider)) {
    throw new ApiError('还没有配置 API Key。', 'NO_KEY', 401);
  }
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ ...config, messages, stream: true, maxTokens, temperature }),
    signal,
  });
  if (!response.ok) throw await parseError(response);
  if (!response.body) throw new ApiError('浏览器不支持流式响应。', 'NO_STREAM');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\n\n/);
    buffer = blocks.pop() || '';
    for (const block of blocks) {
      for (const line of block.split(/\n/)) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const data = JSON.parse(payload);
          const delta = data?.choices?.[0]?.delta?.content || data?.choices?.[0]?.message?.content || '';
          if (delta) {
            full += delta;
            onDelta?.(full, delta);
          }
        } catch {
          /* ignore keep-alive frames */
        }
      }
    }
  }
  return full;
}

export function youtubeKeyFor(settings = getSettings()) {
  return String(settings.youtubeKey || '').trim();
}

export function youtubeHasEnvKey() {
  return Boolean(healthCache?.youtube?.hasEnvKey);
}

export async function searchVideos(query, { settings = getSettings(), maxResults = 24 } = {}) {
  const response = await fetch('/api/youtube/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, maxResults, youtubeKey: youtubeKeyFor(settings) }),
  });
  if (!response.ok) throw await parseError(response);
  return response.json();
}

export async function fetchVideoCaptions(videoId) {
  const response = await fetch('/api/youtube/captions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ videoId }),
  });
  if (!response.ok) throw await parseError(response);
  return response.json();
}

export async function translateVideoCaptions(videoId, cues, { settings = getSettings() } = {}) {
  const config = configFor(settings);
  if (!config.apiKey && !providerHasEnvKey(config.provider)) {
    throw new ApiError('还没有配置 API Key，无法生成中文字幕。', 'NO_KEY', 401);
  }
  const response = await fetch('/api/youtube/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ ...config, videoId, cues: cues.map((cue) => ({ en: cue.en || cue.text || '' })) }),
  });
  if (!response.ok) throw await parseError(response);
  return response.json();
}

export async function translateVideoCaptionsFree(videoId, cues) {
  const response = await fetch('/api/youtube/translate-free', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ videoId, cues: cues.map((cue) => ({ en: cue.en || cue.text || '' })) }),
  });
  if (!response.ok) throw await parseError(response);
  return response.json();
}

export async function getPodcastChannels() {
  const response = await fetch('/api/podcasts/channels', { headers: { Accept: 'application/json' } });
  if (!response.ok) throw await parseError(response);
  return response.json();
}

export async function getPodcastEpisodes(channel) {
  const response = await fetch(`/api/podcasts/episodes?channel=${encodeURIComponent(channel)}`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw await parseError(response);
  return response.json();
}

export async function getPodcastEpisode(channel, episode) {
  const response = await fetch(`/api/podcasts/episode?channel=${encodeURIComponent(channel)}&episode=${encodeURIComponent(episode)}`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw await parseError(response);
  return response.json();
}

export async function getBooks() {
  const response = await fetch('/api/books', { headers: { Accept: 'application/json' } });
  if (!response.ok) throw await parseError(response);
  return response.json();
}

export async function readBook(category, date) {
  const response = await fetch(`/api/books/read?category=${encodeURIComponent(category)}&date=${encodeURIComponent(date)}`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw await parseError(response);
  return response.json();
}

export function bookFileUrl(category, date, format) {
  return `/api/books/file?category=${encodeURIComponent(category)}&date=${encodeURIComponent(date)}&format=${encodeURIComponent(format)}`;
}

export async function testConnection(settings = getSettings()) {
  const started = performance.now();
  const data = await chat({
    messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
    maxTokens: 8,
    temperature: 0,
    settings,
  });
  return { latency: Math.round(performance.now() - started), model: data.model, reply: String(data.content || '').slice(0, 40) };
}


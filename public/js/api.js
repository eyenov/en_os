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
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-flash', models: ['deepseek-flash', 'deepseek-v4-pro'], docs: 'https://platform.deepseek.com', search: 'deepseek', note: '支持 JSON 输出，自带 Search / Fetch。' },
  { id: 'kimi', label: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k3.1-pro', models: ['kimi-k3.1-pro', 'kimi-k3', 'kimi-k2.6'], docs: 'https://platform.kimi.com', search: 'kimi', note: '国内站 api.moonshot.cn，国际站可换 .ai。' },
  { id: 'zhipu', label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-5.3-flash', models: ['glm-5.3-flash', 'glm-5.3', 'glm-4-flash'], docs: 'https://bigmodel.cn', search: 'zhipu', note: '使用 /web_search 联网。' },
  { id: 'mimo', label: 'MiMo', baseUrl: 'https://api.xiaomimimo.com/v1', model: 'mimo-v2.6-flash', models: ['mimo-v2.6-flash', 'mimo-v2.6-pro'], docs: 'https://platform.xiaomimimo.com', search: 'none', note: 'OpenAI 兼容协议。' },
  { id: 'custom', label: '自定义', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', models: [], docs: '', search: 'none', note: '任何兼容 /chat/completions 的服务。' },
];

let healthPromise = null;
let healthCache = null;
let bankPromise = null;

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
    throw new ApiError('还没有配置 API Key。可以先用本地引擎学习，或在设置里填入 Key。', 'NO_KEY', 401);
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

export async function searchTopic(query, { count = 5, summarize = true, settings = getSettings() } = {}) {
  const config = configFor(settings);
  const response = await fetch('/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ ...config, query, count, summarize }),
  });
  if (!response.ok) throw await parseError(response);
  return response.json();
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

export async function loadBank() {
  if (!bankPromise) {
    bankPromise = fetch('/data/core100.json')
      .then(async (response) => {
        if (!response.ok) throw new Error('词库加载失败');
        const data = await response.json();
        return data;
      })
      .catch((error) => {
        bankPromise = null;
        throw error;
      });
  }
  return bankPromise;
}

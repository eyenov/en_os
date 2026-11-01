import { getSettings } from './store.js';
import { msg } from './i18n.js';

const ERROR_MESSAGES = {
  BAD_QUERY: '请输入至少 2 个字符的关键词。',
  BAD_VIDEO_ID: '视频 ID 不合法。',
  YOUTUBE_SEARCH_FAILED: 'YouTube 搜索失败。可在设置中配置 YouTube Data API Key。',
  YOUTUBE_PAGE_FAILED: '无法打开 YouTube 视频页。',
  NO_KEY: '还没有配置 API Key。请在设置中配置模型服务。',
  NO_STREAM: '浏览器不支持流式响应。',
  BAD_BASE_URL: 'Base URL 无效，请使用 HTTPS 地址（本地调试可用 HTTP），且不要包含凭据、查询参数或片段。',
  BAD_PROVIDER: '未知的模型服务商。',
  KEY_SCOPE: '环境密钥只能用于服务端配置的 Base URL。',
  NO_MODEL: '缺少模型名称。',
  BAD_MESSAGES: '对话内容不合法。',
  TOO_LONG: '上下文过长。',
  TIMEOUT: '上游请求超时或被取消。',
  NETWORK: '无法连接上游服务，请检查网络和 Base URL。',
  BAD_KEY: '上游服务拒绝了 API Key，请检查密钥。',
  RATE_LIMIT: '请求太频繁，请稍后再试。',
  UPSTREAM_ERROR: '上游服务返回错误，请检查模型名称和服务配置。',
  EMPTY_CONTENT: '上游返回了空内容。',
  BAD_CUES: '没有需要翻译的字幕。',
  BAD_TRANSLATION: '模型返回的字幕条数不一致，请重试。',
  FREE_TRANSLATE_FAILED: '自动翻译暂时不可用，请稍后重试。',
  BOOK_CATALOG_FAILED: '图书目录加载失败',
  BOOK_BAD_EPUB: 'EPUB 已损坏或无法安全解压。',
  BOOK_EMPTY: 'EPUB 中未找到可阅读章节。',
  BOOK_BAD_REQUEST: '图书参数不正确。',
  BOOK_NOT_FOUND: '没有找到这本书。',
  BOOK_NO_EPUB: '这本书没有 EPUB 版本，无法在线阅读。',
  BOOK_DOWNLOAD_FAILED: '图书下载失败，请检查网络。',
  BOOK_FORMAT_NOT_FOUND: '没有这种图书格式。',
  PODCAST_BAD_URL: '播客资源地址无效或不受信任。',
  PODCAST_REDIRECT: '播客资源重定向过多。',
  PODCAST_FEED_FAILED: '播客源加载失败',
  PODCAST_CHANNEL_NOT_FOUND: '播客频道不存在。',
  PODCAST_TRANSCRIPT_FAILED: '播客字幕加载失败',
  EMPTY_PODCAST_TRANSCRIPT: '字幕文件没有可用的时间轴。',
  PODCAST_EPISODE_NOT_FOUND: '播客单集不存在。',
  PODCAST_AUDIO_FAILED: '音频无法播放，请检查网络或代理',
  BAD_RANGE: '只支持单段字节范围。',
  BAD_WORD: '单词不合法。',
  RESOURCE_TOO_LARGE: '远程资源超过允许的大小。',
  UNSUPPORTED_MEDIA_TYPE: '请求体必须使用 application/json。',
  BODY_TOO_LARGE: '请求体过大。',
  BAD_BODY: '请求体必须是 JSON 对象。',
  BAD_JSON: '请求体不是合法 JSON。',
  FORBIDDEN: '不允许访问该路径。',
  BAD_HOST: '主机地址不受信任。',
  BAD_ORIGIN: '跨站请求被拒绝。',
  BAD_PATH: 'URL 路径不合法。',
  METHOD_NOT_ALLOWED: '请求方法不受支持。',
  NOT_FOUND: '接口不存在。',
  INTERNAL: '服务暂时不可用，请稍后重试。',
};

export class ApiError extends Error {
  constructor(message, code = 'API_ERROR', status = 0, displayMessage = null) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.displayMessage = displayMessage || msg(ERROR_MESSAGES[code] || message);
  }
}

export function errorMessage(error, fallback = '请稍后重试') {
  return error?.displayMessage || msg(error?.message || fallback);
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
  let message = '';
  try {
    const data = await response.json();
    if (data?.error) {
      code = data.error.code || code;
      message = data.error.message || message;
    }
  } catch {
    /* ignore */
  }
  return new ApiError(message || `请求失败（${response.status}）`, code, response.status,
    message ? null : msg('请求失败（{{status}}）', { status: response.status }));
}

const pronunciationCache = new Map();

export function getWordPronunciation(text) {
  const word = String(text || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019]/g, "'").replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, '').toLowerCase();
  if (!/^[a-z0-9]+(?:['-][a-z0-9]+)*$/.test(word) || word.length > 80) return Promise.resolve({ word, ipa: [] });
  if (pronunciationCache.has(word)) return pronunciationCache.get(word);
  const request = fetch(`/api/pronunciation?word=${encodeURIComponent(word)}`, {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000),
  }).then(async (response) => {
    if (!response.ok) throw await parseError(response);
    return response.json();
  }).catch((error) => {
    pronunciationCache.delete(word);
    throw error;
  });
  pronunciationCache.set(word, request);
  if (pronunciationCache.size > 1000) pronunciationCache.delete(pronunciationCache.keys().next().value);
  return request;
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


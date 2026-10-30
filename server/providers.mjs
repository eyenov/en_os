/**
 * Provider registry + OpenAI-compatible chat client.
 * Keys never leave this process except in the upstream Authorization header.
 */
export class HttpError extends Error {
  constructor(status, message, code = 'UPSTREAM_ERROR') {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

export const PROVIDERS = {
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-flash',
    models: ['deepseek-flash', 'deepseek-v4-pro'],
    keyEnv: 'DEEPSEEK_API_KEY',
    docs: 'https://platform.deepseek.com',
    note: '用于字幕翻译与视频内问答。',
    thinking: true,
  },
  kimi: {
    id: 'kimi',
    label: 'Kimi（Moonshot）',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'kimi-k3.1-pro',
    models: ['kimi-k3.1-pro', 'kimi-k3', 'kimi-k2.6'],
    keyEnv: 'MOONSHOT_API_KEY',
    docs: 'https://platform.kimi.com',
    note: '国内站 base URL 为 api.moonshot.cn；国际站可改为 https://api.moonshot.ai/v1。',
  },
  zhipu: {
    id: 'zhipu',
    label: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-5.3-flash',
    models: ['glm-5.3-flash', 'glm-5.3', 'glm-4-flash'],
    keyEnv: 'ZHIPU_API_KEY',
    docs: 'https://bigmodel.cn',
    note: '用于字幕翻译与视频内问答。',
  },
  mimo: {
    id: 'mimo',
    label: '小米 MiMo',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    model: 'mimo-v2.6-flash',
    models: ['mimo-v2.6-flash', 'mimo-v2.6-pro'],
    keyEnv: 'MIMO_API_KEY',
    docs: 'https://platform.xiaomimimo.com',
    note: 'OpenAI 兼容协议；Token Plan 用户请把 base URL 换成专属地址。',
  },
  custom: {
    id: 'custom',
    label: '兼容 OpenAI 的自定义服务',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    models: [],
    keyEnv: 'CUSTOM_API_KEY',
    docs: '',
    note: '兼容 OpenAI /chat/completions 的服务。',
  },
};

export function publicProviders() {
  return Object.values(PROVIDERS).map((provider) => ({
    id: provider.id,
    label: provider.label,
    baseUrl: process.env[provider.keyEnv.replace(/_API_KEY$/, '_BASE_URL')] || provider.baseUrl,
    model: provider.model,
    models: provider.models,
    docs: provider.docs,
    note: provider.note,
    hasEnvKey: Boolean(process.env[provider.keyEnv]),
  }));
}

function trimSlash(value = '') {
  return String(value).replace(/\/+$/, '');
}

function validateBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(400, 'Base URL 不是合法网址。', 'BAD_BASE_URL');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new HttpError(400, 'Base URL 不能包含凭据、查询参数或片段。', 'BAD_BASE_URL');
  }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new HttpError(400, 'Base URL 必须是 https（本地调试允许 http://localhost）。', 'BAD_BASE_URL');
  }
  return trimSlash(url.toString());
}

export function resolveRequest(body = {}) {
  const providerId = String(body.provider || 'deepseek');
  const provider = PROVIDERS[providerId];
  if (!provider) throw new HttpError(400, `未知的服务商：${providerId}`, 'BAD_PROVIDER');
  const explicitKey = String(body.apiKey || '').trim();
  const apiKey = explicitKey || String(process.env[provider.keyEnv] || '').trim();
  if (!apiKey) {
    throw new HttpError(401, '还没有配置 API Key。请到「设置」填写，或给服务端设置对应环境变量。', 'NO_KEY');
  }
  const serverBaseUrl = validateBaseUrl(process.env[provider.keyEnv.replace(/_API_KEY$/, '_BASE_URL')] || provider.baseUrl);
  const baseUrl = validateBaseUrl(body.baseUrl || serverBaseUrl);
  if (!explicitKey && baseUrl !== serverBaseUrl) {
    throw new HttpError(403, '环境密钥只能用于服务端配置的 Base URL。', 'KEY_SCOPE');
  }
  const model = String(body.model || provider.model).trim();
  if (!model) throw new HttpError(400, '缺少模型名称。', 'NO_MODEL');
  return { provider, providerId, apiKey, baseUrl, model };
}

export async function createChatCompletion({
  provider,
  providerId,
  apiKey,
  baseUrl,
  model,
  messages,
  temperature = 0.7,
  maxTokens = 1400,
  json = false,
  stream = false,
  signal,
}) {
  if (!Array.isArray(messages) || !messages.length) {
    throw new HttpError(400, 'messages 不能为空。', 'BAD_MESSAGES');
  }
  if (messages.length > 60) throw new HttpError(400, 'messages 过多。', 'BAD_MESSAGES');
  let totalChars = 0;
  const safeMessages = messages.map((message) => {
    const role = ['system', 'user', 'assistant'].includes(message?.role) ? message.role : 'user';
    const content = String(message?.content ?? '');
    totalChars += content.length;
    return { role, content };
  });
  if (totalChars > 220_000) throw new HttpError(413, '上下文过长。', 'TOO_LONG');

  const payload = {
    model,
    messages: safeMessages,
    temperature: Math.max(0, Math.min(2, Number(temperature) || 0)),
    max_tokens: Math.max(16, Math.min(8192, Number(maxTokens) || 1400)),
    stream: Boolean(stream),
  };
  if (json) payload.response_format = { type: 'json_object' };
  if (provider?.thinking) payload.thinking = { type: 'disabled' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('upstream timeout')), stream ? 180_000 : 90_000);
  const onAbort = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', onAbort, { once: true });
  }

  let response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: stream ? 'text/event-stream' : 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
      redirect: 'error',
    });
  } catch (error) {
    clearTimeout(timeout);
    if (signal) signal.removeEventListener('abort', onAbort);
    if (error?.name === 'AbortError') throw new HttpError(504, '上游请求超时或被取消。', 'TIMEOUT');
    throw new HttpError(502, `无法连接上游服务：${error.message}`, 'NETWORK');
  }

  if (!response.ok) {
    clearTimeout(timeout);
    if (signal) signal.removeEventListener('abort', onAbort);
    let detail = '';
    try {
      const text = await response.text();
      try {
        const parsed = JSON.parse(text);
        detail = parsed?.error?.message || parsed?.message || text.slice(0, 300);
      } catch {
        detail = text.slice(0, 300);
      }
    } catch {
      detail = '（无法读取错误响应）';
    }
    const status = response.status === 401 ? 401 : response.status === 429 ? 429 : response.status >= 500 ? 502 : 400;
    const code = response.status === 401 ? 'BAD_KEY' : response.status === 429 ? 'RATE_LIMIT' : 'UPSTREAM_ERROR';
    const safeDetail = String(detail || response.statusText).replaceAll(apiKey, '[redacted]').slice(0, 300);
    throw new HttpError(status, `上游返回 ${response.status}：${safeDetail}`, code);
  }

  const cleanup = () => {
    clearTimeout(timeout);
    if (signal) signal.removeEventListener('abort', onAbort);
  };
  return { response, cleanup };
}

export async function readChatJSON(response, cleanup) {
  try {
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new HttpError(502, '上游返回了空内容。', 'EMPTY_CONTENT');
    }
    return { content, model: data?.model, usage: data?.usage || null };
  } finally {
    cleanup?.();
  }
}

export function extractJSON(text = '') {
  const trimmed = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export { trimSlash, validateBaseUrl };

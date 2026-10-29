import http from 'node:http';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  HttpError,
  PROVIDERS,
  createChatCompletion,
  publicProviders,
  readChatJSON,
  resolveRequest,
  validateBaseUrl,
} from './providers.mjs';
import { searchWeb } from './search.mjs';

const ROOT = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const VERSION = '1.0.0';
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': [
    "default-src 'self'",
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self'",
    "connect-src 'self'",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
};

const buckets = new Map();

function rateLimited(ip, limit = 240, windowMs = 60_000) {
  const now = Date.now();
  const bucket = buckets.get(ip);
  if (!bucket || now - bucket.start > windowMs) {
    buckets.set(ip, { start: now, count: 1 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > limit;
}

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendError(res, error) {
  const status = error instanceof HttpError ? error.status : 500;
  const code = error instanceof HttpError ? error.code : 'INTERNAL';
  const message = error instanceof HttpError ? error.message : '服务器处理请求时出错了。';
  if (!(error instanceof HttpError)) console.error('[error]', error);
  sendJSON(res, status, { error: { code, message } });
}

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, '请求体过大。', 'BODY_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new HttpError(400, '请求体不是合法 JSON。', 'BAD_JSON'));
      }
    });
    req.on('error', reject);
  });
}

function resolveSearchConfig(body = {}) {
  const providerId = String(body.provider || 'deepseek');
  const provider = PROVIDERS[providerId];
  if (!provider) throw new HttpError(400, `未知的服务商：${providerId}`, 'BAD_PROVIDER');
  const apiKey = String(body.apiKey || process.env[provider.keyEnv] || '').trim();
  const baseUrl = validateBaseUrl(body.baseUrl || provider.baseUrl);
  const model = String(body.model || provider.model).trim();
  return { provider, providerId, apiKey, baseUrl, model };
}

async function handleChat(req, res) {
  const body = await readBody(req);
  const config = resolveRequest(body);
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const stream = Boolean(body.stream);
  const controller = new AbortController();
  res.on('close', () => controller.abort());

  const started = Date.now();
  const { response, cleanup } = await createChatCompletion({
    ...config,
    messages,
    temperature: body.temperature ?? 0.7,
    maxTokens: body.maxTokens ?? 1400,
    json: Boolean(body.json),
    stream,
    signal: controller.signal,
  });

  if (stream) {
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    try {
      await pipeline(Readable.fromWeb(response.body), res);
    } catch (error) {
      if (!controller.signal.aborted) console.error('[stream]', error.message);
    } finally {
      cleanup();
    }
    return;
  }

  const data = await readChatJSON(response, cleanup);
  sendJSON(res, 200, {
    content: data.content,
    model: data.model || config.model,
    usage: data.usage,
    provider: config.providerId,
    latencyMs: Date.now() - started,
  });
}

async function handleSearch(req, res) {
  const body = await readBody(req);
  const config = resolveSearchConfig(body);
  const controller = new AbortController();
  res.on('close', () => controller.abort());
  const result = await searchWeb({
    ...config,
    query: body.query,
    count: Math.max(1, Math.min(8, Number(body.count) || 5)),
    summarize: body.summarize !== false,
  });
  sendJSON(res, 200, result);
}

async function handleStatic(req, res, urlPath) {
  let filePath;
  if (urlPath === '/' || urlPath === '/index.html') {
    filePath = path.join(PUBLIC_DIR, 'index.html');
  } else if (urlPath === '/report' || urlPath === '/report/') {
    filePath = path.join(PUBLIC_DIR, 'report.html');
  } else if (urlPath.startsWith('/data/')) {
    filePath = path.join(DATA_DIR, urlPath.slice('/data/'.length));
  } else {
    filePath = path.join(PUBLIC_DIR, urlPath.replace(/^\/+/, ''));
  }

  let resolved = path.resolve(filePath);
  const allowedRoots = [PUBLIC_DIR, DATA_DIR];
  if (!allowedRoots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`))) {
    return sendJSON(res, 403, { error: { code: 'FORBIDDEN', message: '不允许访问该路径。' } });
  }

  let info;
  try {
    info = await stat(resolved);
    if (info.isDirectory()) {
      resolved = path.join(resolved, 'index.html');
      info = await stat(resolved);
    }
  } catch {
    const fallback = path.join(PUBLIC_DIR, '404.html');
    try {
      const body = await stat(fallback);
      res.writeHead(404, {
        ...SECURITY_HEADERS,
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': body.size,
      });
      createReadStream(fallback).pipe(res);
    } catch {
      sendJSON(res, 404, { error: { code: 'NOT_FOUND', message: '页面不存在。' } });
    }
    return;
  }

  const ext = path.extname(resolved).toLowerCase();
  const isHtml = ext === '.html';
  const isData = resolved.startsWith(DATA_DIR);
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': isHtml ? 'no-cache' : isData ? 'public, max-age=300' : 'no-cache',
    'Content-Length': info.size,
  });
  createReadStream(resolved).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const urlPath = decodeURIComponent(url.pathname);
  const ip = req.socket.remoteAddress || 'local';

  try {
    if (urlPath === '/api/health') {
      return sendJSON(res, 200, {
        ok: true,
        name: 'EnOS · 雅思语境学习',
        version: VERSION,
        node: process.version,
        providers: publicProviders(),
        mode: process.env.ENOS_DEMO_ONLY === '1' ? 'local-only' : 'auto',
      });
    }

    if (urlPath.startsWith('/api/')) {
      const origin = req.headers.origin;
      if (origin) {
        const host = req.headers.host || '';
        const allowed = [`http://${host}`, `https://${host}`];
        if (!allowed.includes(origin)) throw new HttpError(403, '跨站请求被拒绝。', 'BAD_ORIGIN');
      }
      if (rateLimited(ip)) throw new HttpError(429, '请求太频繁，请稍后再试。', 'RATE_LIMIT');
      if (urlPath === '/api/chat' || urlPath === '/api/search') {
        if (req.method !== 'POST') throw new HttpError(405, '该接口只接受 POST。', 'METHOD_NOT_ALLOWED');
        if (urlPath === '/api/chat') {
          await handleChat(req, res);
          console.log(`[api] chat ${res.statusCode} ${Date.now() - started}ms`);
          return;
        }
        await handleSearch(req, res);
        console.log(`[api] search ${res.statusCode} ${Date.now() - started}ms`);
        return;
      }
      throw new HttpError(404, '接口不存在。', 'NOT_FOUND');
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      throw new HttpError(405, '只支持 GET。', 'METHOD_NOT_ALLOWED');
    }
    if (req.method === 'HEAD') {
      res.writeHead(200, SECURITY_HEADERS);
      return res.end();
    }
    await handleStatic(req, res, urlPath);
  } catch (error) {
    if (!res.headersSent) sendError(res, error);
    else res.end();
    if (!(error instanceof HttpError)) console.error('[error]', error);
  }
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  EnOS · 雅思语境学习');
  console.log(`  http://${HOST}:${PORT}`);
  console.log(`  模式：${process.env.ENOS_DEMO_ONLY === '1' ? '仅本地引擎' : '自动（有 Key 用 AI，无 Key 用本地引擎）'}`);
  console.log('');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}

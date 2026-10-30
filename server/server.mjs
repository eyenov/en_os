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
  extractJSON,
  publicProviders,
  readChatJSON,
  resolveRequest,
  validateBaseUrl,
} from './providers.mjs';
import { searchWeb } from './search.mjs';
import { extractFromUrl } from './extract.mjs';
import { getVideoCaptions, searchYouTube, translateCues, translateCuesFree } from './youtube.mjs';
import { getPodcastEpisode, listPodcastChannels, listPodcastEpisodes, openPodcastAudio } from './podcasts.mjs';
import { listBooks, openBookFile, readBook } from './books.mjs';

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
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': [
    "default-src 'self'",
    "img-src 'self' data: blob: https://i.ytimg.com https://img.youtube.com https://podnews.net https://storage.buzzsprout.com",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self' https://www.youtube.com https://s.ytimg.com",
    "connect-src 'self'",
    "media-src 'self' blob: https://podnews.net https://op3.dev https://www.buzzsprout.com https://audio.buzzsprout.com https://storage.buzzsprout.com",
    "font-src 'self' data:",
    "frame-src https://www.youtube.com https://www.youtube-nocookie.com",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
};

const buckets = new Map();
const WORD_CACHE = new Map();

const WORD_SYSTEM = [
  'You are a concise English-Chinese dictionary for Chinese learners of English.',
  'Return ONLY a JSON object with keys:',
  'phonetic (IPA in slashes), zh (Simplified Chinese meaning, at most 2 senses),',
  'en (one short English definition, at most 20 words),',
  'usage (one short English usage note or collocation, at most 16 words),',
  'example (one short English example sentence, at most 18 words).',
  'No markdown, no extra text.',
].join(' ');

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

async function handleExtract(req, res) {
  const body = await readBody(req);
  const url = String(body.url || '').trim();
  if (!url) throw new HttpError(400, '缺少文章链接。', 'BAD_URL');
  const result = await extractFromUrl(url, {
    allowLocal: process.env.ENOS_ALLOW_LOCAL_FETCH === '1',
  });
  sendJSON(res, 200, result);
}

async function handleWord(req, res) {
  const body = await readBody(req);
  const word = String(body.word || '').trim().toLowerCase();
  if (!/^[a-z][a-z'’-]{1,40}$/.test(word)) {
    throw new HttpError(400, '请提供一个英文单词。', 'BAD_WORD');
  }
  const cached = WORD_CACHE.get(word);
  if (cached) return sendJSON(res, 200, { ...cached, cached: true });

  const config = resolveSearchConfig(body);
  if (!config.apiKey) {
    throw new HttpError(401, '还没有配置 API Key，暂时只能查本课词与核心词库。', 'NO_KEY');
  }

  const controller = new AbortController();
  res.on('close', () => controller.abort());
  const { response, cleanup } = await createChatCompletion({
    ...config,
    messages: [
      { role: 'system', content: WORD_SYSTEM },
      { role: 'user', content: `Word: ${word}` },
    ],
    temperature: 0.2,
    maxTokens: 240,
    json: true,
    signal: controller.signal,
  });
  const { content } = await readChatJSON(response, cleanup);
  const data = extractJSON(content) || {};
  const zh = String(data.zh || data.chinese || '').trim();
  if (!zh || !/[\u4e00-\u9fff]/.test(zh)) {
    throw new HttpError(502, '词典没有返回可用的中文释义。', 'BAD_DEFINITION');
  }
  const entry = {
    word,
    phonetic: String(data.phonetic || data.ipa || '').trim().slice(0, 60),
    zh: zh.slice(0, 160),
    en: String(data.en || data.definition || '').trim().slice(0, 240),
    usage: String(data.usage || data.collocation || '').trim().slice(0, 200),
    example: String(data.example || '').trim().slice(0, 240),
    source: 'ai',
  };
  if (WORD_CACHE.size >= 600) WORD_CACHE.delete(WORD_CACHE.keys().next().value);
  WORD_CACHE.set(word, entry);
  sendJSON(res, 200, entry);
}

async function handleYoutubeSearch(req, res) {
  const body = await readBody(req);
  const result = await searchYouTube({
    query: body.query,
    apiKey: String(body.youtubeKey || process.env.YOUTUBE_API_KEY || '').trim(),
    maxResults: body.maxResults,
  });
  sendJSON(res, 200, result);
}

async function handleYoutubeCaptions(req, res) {
  const body = await readBody(req);
  const videoId = String(body.videoId || '').trim();
  const result = await getVideoCaptions({ videoId });
  console.log(`[youtube] captions ${videoId} cues=${result.cues.length} reason=${result.reason || '-'} source=${result.source || '-'}`);
  sendJSON(res, 200, result);
}

async function handleYoutubeTranslate(req, res) {
  const body = await readBody(req);
  const cues = Array.isArray(body.cues) ? body.cues : [];
  if (!cues.length) throw new HttpError(400, '缺少字幕内容。', 'BAD_CUES');
  const config = resolveRequest(body);
  const result = await translateCues({
    videoId: String(body.videoId || ''),
    cues,
    config,
  });
  sendJSON(res, 200, result);
}

async function handleYoutubeTranslateFree(req, res) {
  const body = await readBody(req);
  const cues = Array.isArray(body.cues) ? body.cues : [];
  if (!cues.length) throw new HttpError(400, '缺少字幕内容。', 'BAD_CUES');
  const result = await translateCuesFree({
    videoId: String(body.videoId || ''),
    cues,
  });
  console.log(`[youtube] free-translate ${String(body.videoId || '')} lines=${cues.length} engine=${result.engine}`);
  sendJSON(res, 200, result);
}

async function handleStatic(req, res, urlPath) {
  let filePath;
  if (urlPath === '/' || urlPath === '/index.html') {
    filePath = path.join(PUBLIC_DIR, 'videos.html');
  } else if (urlPath === '/report' || urlPath === '/report/') {
    filePath = path.join(PUBLIC_DIR, 'report.html');
  } else if (urlPath === '/videos' || urlPath === '/videos/') {
    filePath = path.join(PUBLIC_DIR, 'videos.html');
  } else if (urlPath === '/watch' || urlPath === '/watch/') {
    filePath = path.join(PUBLIC_DIR, 'watch.html');
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
        youtube: { hasEnvKey: Boolean(process.env.YOUTUBE_API_KEY), hasCookie: Boolean(process.env.YOUTUBE_COOKIE) },
        proxy: { enabled: Boolean(process.env.NODE_USE_ENV_PROXY === '1' && (process.env.HTTPS_PROXY || process.env.HTTP_PROXY)) },
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
      if (urlPath === '/api/books') {
        if (req.method !== 'GET') throw new HttpError(405, '该接口只接受 GET。', 'METHOD_NOT_ALLOWED');
        const data = await listBooks();
        sendJSON(res, 200, data);
        console.log(`[api] books ${res.statusCode} ${data.books.length} ${Date.now() - started}ms`);
        return;
      }
      if (urlPath === '/api/books/read') {
        if (req.method !== 'GET') throw new HttpError(405, '该接口只接受 GET。', 'METHOD_NOT_ALLOWED');
        const data = await readBook(
          String(url.searchParams.get('category') || ''),
          String(url.searchParams.get('date') || ''),
        );
        sendJSON(res, 200, data);
        console.log(`[api] book-read ${res.statusCode} ${data.chapters.length} chapters ${Date.now() - started}ms`);
        return;
      }
      if (urlPath === '/api/books/file') {
        if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, '该接口只接受 GET。', 'METHOD_NOT_ALLOWED');
        const { response, filename, contentType } = await openBookFile(
          String(url.searchParams.get('category') || ''),
          String(url.searchParams.get('date') || ''),
          String(url.searchParams.get('format') || ''),
        );
        const headers = {
          ...SECURITY_HEADERS,
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'public, max-age=3600',
        };
        const length = response.headers.get('content-length');
        if (length) headers['Content-Length'] = length;
        res.writeHead(200, headers);
        if (req.method === 'HEAD' || !response.body) return res.end();
        Readable.fromWeb(response.body).pipe(res);
        console.log(`[api] book-file ${res.statusCode} ${filename} ${Date.now() - started}ms`);
        return;
      }
      if (urlPath === '/api/podcasts/audio') {
        if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, '该接口只接受 GET。', 'METHOD_NOT_ALLOWED');
        const { response, episode } = await openPodcastAudio(
          String(url.searchParams.get('channel') || ''),
          String(url.searchParams.get('episode') || ''),
          String(req.headers.range || ''),
        );
        const headers = {
          'Content-Type': response.headers.get('content-type') || 'audio/mpeg',
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=3600',
        };
        if (url.searchParams.get('download') === '1') {
          const filename = `${String(episode.title || 'podcast').replace(/[^\w.-]+/g, '_').slice(0, 90)}.mp3`;
          headers['Content-Disposition'] = `attachment; filename="${filename}"`;
        }
        for (const name of ['content-length', 'content-range', 'last-modified', 'etag']) {
          const value = response.headers.get(name);
          if (value) headers[name] = value;
        }
        res.writeHead(response.status, headers);
        if (req.method === 'HEAD' || !response.body) return res.end();
        Readable.fromWeb(response.body).pipe(res);
        console.log(`[api] podcast-audio ${res.statusCode} ${Date.now() - started}ms`);
        return;
      }
      if (urlPath === '/api/podcasts/channels') {
        if (req.method !== 'GET') throw new HttpError(405, '该接口只接受 GET。', 'METHOD_NOT_ALLOWED');
        sendJSON(res, 200, { channels: listPodcastChannels() });
        console.log(`[api] podcast-channels ${res.statusCode} ${Date.now() - started}ms`);
        return;
      }
      if (urlPath === '/api/podcasts/episodes') {
        if (req.method !== 'GET') throw new HttpError(405, '该接口只接受 GET。', 'METHOD_NOT_ALLOWED');
        const data = await listPodcastEpisodes(String(url.searchParams.get('channel') || ''));
        sendJSON(res, 200, data);
        console.log(`[api] podcast-episodes ${res.statusCode} ${Date.now() - started}ms`);
        return;
      }
      if (urlPath === '/api/podcasts/episode') {
        if (req.method !== 'GET') throw new HttpError(405, '该接口只接受 GET。', 'METHOD_NOT_ALLOWED');
        const data = await getPodcastEpisode(
          String(url.searchParams.get('channel') || ''),
          String(url.searchParams.get('episode') || ''),
        );
        sendJSON(res, 200, data);
        console.log(`[api] podcast-episode ${res.statusCode} ${Date.now() - started}ms`);
        return;
      }
      if (urlPath === '/api/chat' || urlPath === '/api/search' || urlPath === '/api/extract' || urlPath === '/api/word'
        || urlPath === '/api/youtube/search' || urlPath === '/api/youtube/captions' || urlPath === '/api/youtube/translate'
        || urlPath === '/api/youtube/translate-free') {
        if (req.method !== 'POST') throw new HttpError(405, '该接口只接受 POST。', 'METHOD_NOT_ALLOWED');
        if (urlPath === '/api/chat') {
          await handleChat(req, res);
          console.log(`[api] chat ${res.statusCode} ${Date.now() - started}ms`);
          return;
        }
        if (urlPath === '/api/extract') {
          await handleExtract(req, res);
          console.log(`[api] extract ${res.statusCode} ${Date.now() - started}ms`);
          return;
        }
        if (urlPath === '/api/word') {
          await handleWord(req, res);
          console.log(`[api] word ${res.statusCode} ${Date.now() - started}ms`);
          return;
        }
        if (urlPath === '/api/youtube/search') {
          await handleYoutubeSearch(req, res);
          console.log(`[api] youtube-search ${res.statusCode} ${Date.now() - started}ms`);
          return;
        }
        if (urlPath === '/api/youtube/captions') {
          await handleYoutubeCaptions(req, res);
          console.log(`[api] youtube-captions ${res.statusCode} ${Date.now() - started}ms`);
          return;
        }
        if (urlPath === '/api/youtube/translate') {
          await handleYoutubeTranslate(req, res);
          console.log(`[api] youtube-translate ${res.statusCode} ${Date.now() - started}ms`);
          return;
        }
        if (urlPath === '/api/youtube/translate-free') {
          await handleYoutubeTranslateFree(req, res);
          console.log(`[api] youtube-translate-free ${res.statusCode} ${Date.now() - started}ms`);
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

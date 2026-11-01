import http from 'node:http';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  HttpError,
  createChatCompletion,
  publicProviders,
  readChatJSON,
  resolveRequest,
} from './providers.mjs';
import { getVideoCaptions, searchYouTube, translateCues, translateCuesFree } from './youtube.mjs';
import { getPodcastEpisode, listPodcastChannels, listPodcastEpisodes, openPodcastAudio } from './podcasts.mjs';
import { listBooks, openBookFile, readBook } from './books.mjs';
import { getPronunciation } from './pronunciation.mjs';

const ROOT = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const PUBLIC_DIR = path.join(ROOT, 'public');
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
    "object-src 'none'",
  ].join('; '),
};

const buckets = new Map();

function rateLimited(ip, limit = 240, windowMs = 60_000) {
  const now = Date.now();
  const bucket = buckets.get(ip);
  if (!bucket || now - bucket.start > windowMs) {
    for (const [address, entry] of buckets) {
      if (now - entry.start > windowMs) buckets.delete(address);
    }
    if (buckets.size >= 10_000) buckets.delete(buckets.keys().next().value);
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
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
    throw new HttpError(415, '请求体必须使用 application/json。', 'UNSUPPORTED_MEDIA_TYPE');
  }
  return new Promise((resolve, reject) => {
    let size = 0;
    let exceeded = false;
    const chunks = [];
    req.on('data', (chunk) => {
      if (exceeded) return;
      size += chunk.length;
      if (size > limit) {
        exceeded = true;
        chunks.length = 0;
        reject(new HttpError(413, '请求体过大。', 'BODY_TOO_LARGE'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (exceeded) return;
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        const body = JSON.parse(raw);
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          return reject(new HttpError(400, '请求体必须是 JSON 对象。', 'BAD_BODY'));
        }
        resolve(body);
      } catch {
        reject(new HttpError(400, '请求体不是合法 JSON。', 'BAD_JSON'));
      }
    });
    req.on('error', reject);
  });
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
  if (urlPath === '/watch' || urlPath === '/watch/' || urlPath === '/watch.html') {
    const fallback = path.join(PUBLIC_DIR, '404.html');
    const body = await stat(fallback);
    res.writeHead(404, {
      ...SECURITY_HEADERS,
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': body.size,
    });
    if (req.method === 'HEAD') res.end();
    else await pipeline(createReadStream(fallback), res);
    return;
  }
  let filePath;
  if (urlPath === '/' || urlPath === '/index.html') {
    filePath = path.join(PUBLIC_DIR, 'videos.html');
  } else if (urlPath === '/videos' || urlPath === '/videos/') {
    filePath = path.join(PUBLIC_DIR, 'videos.html');
  } else {
    filePath = path.join(PUBLIC_DIR, urlPath.replace(/^\/+/, ''));
  }

  let resolved = path.resolve(filePath);
  if (!resolved.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    throw new HttpError(403, '不允许访问该路径。', 'FORBIDDEN');
  }

  let info;
  try {
    info = await stat(resolved);
    if (info.isDirectory()) {
      resolved = path.join(resolved, 'index.html');
      info = await stat(resolved);
    }
    resolved = await realpath(resolved);
    if (!resolved.startsWith(`${PUBLIC_DIR}${path.sep}`) || !info.isFile()) {
      throw new HttpError(403, '不允许访问该路径。', 'FORBIDDEN');
    }
  } catch (error) {
    if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
    const fallback = path.join(PUBLIC_DIR, '404.html');
    const body = await stat(fallback);
    res.writeHead(404, {
      ...SECURITY_HEADERS,
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': body.size,
    });
    if (req.method === 'HEAD') res.end();
    else await pipeline(createReadStream(fallback), res);
    return;
  }

  const ext = path.extname(resolved).toLowerCase();
  const codeAsset = ['.html', '.htm', '.js', '.mjs', '.css'].includes(ext);
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': codeAsset ? 'no-store, max-age=0' : 'no-cache',
    'Content-Length': info.size,
  });
  if (req.method === 'HEAD') res.end();
  else await pipeline(createReadStream(resolved), res);
}

function validateOrigin(req) {
  let host;
  try { host = new URL(`http://${req.headers.host}`); } catch {
    throw new HttpError(403, '主机地址不受信任。', 'BAD_HOST');
  }
  const allowedHosts = new Set([HOST, 'localhost', '127.0.0.1', '[::1]']);
  if (!allowedHosts.has(host.hostname) || Number(host.port || 80) !== PORT) {
    throw new HttpError(403, '主机地址不受信任。', 'BAD_HOST');
  }
  const origin = req.headers.origin;
  if (req.headers['sec-fetch-site'] === 'cross-site'
    || (origin && ![`http://${req.headers.host}`, `https://${req.headers.host}`].includes(origin))) {
    throw new HttpError(403, '跨站请求被拒绝。', 'BAD_ORIGIN');
  }
}

async function sendMedia(req, res, response, headers) {
  res.writeHead(response.status, { ...SECURITY_HEADERS, ...headers });
  if (req.method === 'HEAD' || !response.body) {
    try { await response.body?.cancel(); } catch { /* ignore */ }
    res.end();
    return;
  }
  const stream = Readable.fromWeb(response.body);
  const fail = (error) => {
    if (error && error.name !== 'AbortError' && error.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
      console.error('[media]', error.message || error);
    }
    if (!res.destroyed) res.destroy();
  };
  stream.on('error', fail);
  res.on('close', () => {
    if (!stream.destroyed) stream.destroy();
  });
  try {
    await pipeline(stream, res);
  } catch (error) {
    fail(error);
  }
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const ip = req.socket.remoteAddress || 'local';

  try {
    const url = new URL(req.url || '/', 'http://localhost');
    let urlPath;
    try {
      urlPath = decodeURIComponent(url.pathname);
    } catch {
      throw new HttpError(400, 'URL 编码不合法。', 'BAD_PATH');
    }
    if (/[\0\\]/.test(urlPath)) throw new HttpError(400, 'URL 路径不合法。', 'BAD_PATH');
    if (urlPath.startsWith('/api/')) {
      validateOrigin(req);
      if (rateLimited(ip)) throw new HttpError(429, '请求太频繁，请稍后再试。', 'RATE_LIMIT');
    }
    if (urlPath === '/api/health') {
      if (req.method !== 'GET') throw new HttpError(405, '该接口只接受 GET。', 'METHOD_NOT_ALLOWED');
      return sendJSON(res, 200, {
        ok: true,
        name: 'EnOS · 学习工作台',
        version: VERSION,
        node: process.version,
        providers: publicProviders(),
        youtube: { hasEnvKey: Boolean(process.env.YOUTUBE_API_KEY), hasCookie: Boolean(process.env.YOUTUBE_COOKIE) },
        proxy: { enabled: Boolean(process.env.NODE_USE_ENV_PROXY === '1' && (process.env.HTTPS_PROXY || process.env.HTTP_PROXY)) },
      });
    }

    if (urlPath.startsWith('/api/')) {
      if (urlPath === '/api/pronunciation') {
        if (req.method !== 'GET') throw new HttpError(405, '该接口只接受 GET。', 'METHOD_NOT_ALLOWED');
        return sendJSON(res, 200, await getPronunciation(url.searchParams.get('word') || ''));
      }
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
        await sendMedia(req, res, response, headers);
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
          'Content-Type': /^audio\/[\w.+-]+$/.test(response.headers.get('content-type') || '') ? response.headers.get('content-type') : 'application/octet-stream',
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
        await sendMedia(req, res, response, headers);
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
      if (urlPath === '/api/chat'
        || urlPath === '/api/youtube/search' || urlPath === '/api/youtube/captions' || urlPath === '/api/youtube/translate'
        || urlPath === '/api/youtube/translate-free') {
        if (req.method !== 'POST') throw new HttpError(405, '该接口只接受 POST。', 'METHOD_NOT_ALLOWED');
        if (urlPath === '/api/chat') {
          await handleChat(req, res);
          console.log(`[api] chat ${res.statusCode} ${Date.now() - started}ms`);
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
      }
      throw new HttpError(404, '接口不存在。', 'NOT_FOUND');
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      throw new HttpError(405, '只支持 GET。', 'METHOD_NOT_ALLOWED');
    }
    await handleStatic(req, res, urlPath);
  } catch (error) {
    if (!res.headersSent) sendError(res, error);
    else res.destroy();
  }
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  EnOS · YouTube / 播客 / 图书');
  console.log(`  http://${HOST}:${PORT}`);
  console.log('');
});

// A client closing an audio/book range request must not take down the whole
// local server. Log the failure, keep serving other requests.
process.on('uncaughtException', (error) => {
  console.error('[uncaught]', error?.stack || error);
});
process.on('unhandledRejection', (error) => {
  console.error('[unhandled-rejection]', error?.stack || error);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}

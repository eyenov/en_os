import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const APP_PORT = 8917;
const MOCK_PORT = 8918;
const BASE = `http://127.0.0.1:${APP_PORT}`;
const MOCK = `http://127.0.0.1:${MOCK_PORT}/v1`;
let app;
let mock;

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); }
    });
  });
}

async function waitFor(url, timeout = 12_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Server did not start: ${url}`);
}

before(async () => {
  mock = http.createServer(async (req, res) => {
    if (!req.url.endsWith('/chat/completions')) return json(res, 404, { error: { message: 'not found' } });
    const body = await readBody(req);
    const system = (body.messages || []).map((message) => message.content).join(' ');
    if (body.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'stream-' } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    }
    if (system.includes('translate English YouTube subtitles')) {
      const user = body.messages?.at(-1)?.content || '';
      let lines = [];
      try { lines = JSON.parse(user).lines || []; } catch { lines = []; }
      return json(res, 200, {
        model: 'mock-model',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: JSON.stringify({ translations: lines.map((line, index) => `中文${index + 1}：${String(line).slice(0, 14)}`) }),
          },
          finish_reason: 'stop',
        }],
      });
    }
    return json(res, 200, {
      model: 'mock-model',
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      usage: { total_tokens: 12 },
    });
  });
  await new Promise((resolve) => mock.listen(MOCK_PORT, '127.0.0.1', resolve));

  app = spawn(process.execPath, ['server/server.mjs'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, PORT: String(APP_PORT), HOST: '127.0.0.1', MIMO_API_KEY: 'environment-key-fixture', MIMO_BASE_URL: '', CUSTOM_API_KEY: '' },
    stdio: 'ignore',
  });
  await waitFor(`${BASE}/api/health`);
});

after(() => {
  app?.kill();
  mock?.close();
});

async function post(path, body) {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('health exposes providers without leaking keys', async () => {
  const response = await fetch(`${BASE}/api/health`);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ok, true);
  assert.equal(data.providers.length, 5);
  assert.deepEqual(data.providers.map((provider) => provider.id), ['deepseek', 'kimi', 'zhipu', 'mimo', 'custom']);
  assert.ok(data.providers.every((provider) => !('apiKey' in provider)));
});

test('workspace homepage and CSP are served without retired views', async () => {
  const response = await fetch(`${BASE}/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-security-policy') || '', /default-src 'self'/);
  const homepage = await response.text();
  assert.match(homepage, /id="rail-settings"/);
  assert.match(homepage, /id="tab-youtube"/);
  assert.doesNotMatch(homepage, /class="studio-topbar"|rail-chat|chat-view|data-route="(?:home|listening|reports)"/);

  const legacyIndex = await fetch(`${BASE}/index.html`);
  assert.equal(legacyIndex.status, 200);
  assert.match(await legacyIndex.text(), /id="rail-settings"/);

  const missing = await fetch(`${BASE}/nope.html`);
  assert.equal(missing.status, 404);
  assert.match(missing.headers.get('content-type') || '', /text\/html/);
});

test('path traversal is rejected', async () => {
  const response = await fetch(`${BASE}/data/..%2Fpackage.json`);
  assert.ok([403, 404].includes(response.status));
  const text = await response.text();
  assert.ok(!text.includes('"name": "enos-ielts"'));
});

test('chat proxy forwards with a key and returns JSON', async () => {
  const response = await post('/api/chat', {
    provider: 'custom', apiKey: 'sk-test', baseUrl: MOCK, model: 'mock',
    messages: [{ role: 'user', content: 'ping' }],
  });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.content, 'ok');
  assert.equal(data.provider, 'custom');
});

test('streaming chat returns SSE deltas', async () => {
  const response = await post('/api/chat', {
    provider: 'custom', apiKey: 'sk-test', baseUrl: MOCK, model: 'mock',
    messages: [{ role: 'user', content: 'ping' }],
    stream: true,
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /text\/event-stream/);
  const text = await response.text();
  assert.match(text, /stream-/);
  assert.match(text, /data: \[DONE\]/);
});

test('missing key is rejected with NO_KEY', async () => {
  const response = await post('/api/chat', {
    provider: 'custom', baseUrl: MOCK, model: 'mock',
    messages: [{ role: 'user', content: 'ping' }],
  });
  assert.equal(response.status, 401);
  const data = await response.json();
  assert.equal(data.error.code, 'NO_KEY');
});

test('non-https remote base URL is rejected', async () => {
  const response = await post('/api/chat', {
    provider: 'custom', apiKey: 'sk-test', baseUrl: 'http://example.com/v1', model: 'mock',
    messages: [{ role: 'user', content: 'ping' }],
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'BAD_BASE_URL');
});

test('environment keys cannot be forwarded to a client-selected upstream', async () => {
  const response = await post('/api/chat', {
    provider: 'mimo', baseUrl: MOCK, model: 'mock',
    messages: [{ role: 'user', content: 'ping' }],
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'KEY_SCOPE');
  const explicit = await post('/api/chat', {
    provider: 'mimo', apiKey: 'sk-test', baseUrl: MOCK, model: 'mock',
    messages: [{ role: 'user', content: 'ping' }],
  });
  assert.equal(explicit.status, 200);
});

test('provider URLs reject embedded credentials, query strings and fragments', async () => {
  for (const baseUrl of ['https://user:pass@example.com/v1', 'https://example.com/v1?token=value', 'https://example.com/v1#fragment']) {
    const response = await post('/api/chat', {
      provider: 'custom', apiKey: 'sk-test', baseUrl, messages: [{ role: 'user', content: 'ping' }],
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'BAD_BASE_URL');
  }
});

test('invalid JSON and wrong methods are handled', async () => {
  const bad = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{not json',
  });
  assert.equal(bad.status, 400);

  const wrongMethod = await fetch(`${BASE}/api/chat`);
  assert.equal(wrongMethod.status, 405);

  assert.equal((await post('/api/health', {})).status, 405);
});

test('JSON endpoints reject non-object bodies and unsupported media types', async () => {
  for (const body of [null, [], 'text', 1, true]) {
    const response = await post('/api/chat', body);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'BAD_BODY');
  }
  const response = await fetch(`${BASE}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}',
  });
  assert.equal(response.status, 415);
  assert.equal((await response.json()).error.code, 'UNSUPPORTED_MEDIA_TYPE');
});

test('oversized requests return a JSON 413 instead of closing the connection', async () => {
  const response = await post('/api/youtube/search', { query: 'x'.repeat(2 * 1024 * 1024) });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, 'BODY_TOO_LARGE');
});

test('malformed URL encoding does not crash the server', async () => {
  const response = await fetch(`${BASE}/%E0%A4%A`);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'BAD_PATH');
  assert.equal((await fetch(`${BASE}/api/health`)).status, 200);
});

test('retired APIs and pages return 404', async () => {
  for (const route of ['/api/search', '/api/extract', '/api/word']) {
    const response = await post(route, {});
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, 'NOT_FOUND');
  }
  for (const route of ['/watch.html', '/report.html', '/data/core100.json']) {
    assert.equal((await fetch(`${BASE}${route}`)).status, 404);
  }
});

test('static HEAD requests return the same status and length as GET', async () => {
  for (const route of ['/videos.html', '/no-such-page']) {
    const get = await fetch(`${BASE}${route}`);
    const head = await fetch(`${BASE}${route}`, { method: 'HEAD' });
    assert.equal(head.status, get.status);
    assert.equal(head.headers.get('content-length'), get.headers.get('content-length'));
    assert.equal(await head.text(), '');
  }
});

test('cross-site API requests and untrusted Host headers are rejected', async () => {
  for (const headers of [{ Origin: 'https://untrusted.example' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    const response = await fetch(`${BASE}/api/health`, { headers });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'BAD_ORIGIN');
  }
  const status = await new Promise((resolve, reject) => {
    http.get(`${BASE}/api/health`, { headers: { Host: 'untrusted.example' } }, (response) => {
      response.resume();
      resolve(response.statusCode);
    }).on('error', reject);
  });
  assert.equal(status, 403);
});

test('unknown API route returns JSON 404', async () => {
  const response = await fetch(`${BASE}/api/nope`);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, 'NOT_FOUND');
});

test('video pages are served and YouTube routes validate input', async () => {
  const videos = await fetch(`${BASE}/videos.html`);
  assert.equal(videos.status, 200);
  assert.match(await videos.text(), /video-search/);
  assert.match(videos.headers.get('content-security-policy') || '', /frame-src https:\/\/www\.youtube\.com/);

  const badId = await post('/api/youtube/captions', { videoId: 'bad' });
  assert.equal(badId.status, 400);
  assert.equal((await badId.json()).error.code, 'BAD_VIDEO_ID');

  const noKey = await post('/api/youtube/translate', {
    videoId: 'abc12345678',
    cues: [{ en: 'Hello' }],
  });
  assert.equal(noKey.status, 401);
  assert.equal((await noKey.json()).error.code, 'NO_KEY');
});

test('YouTube caption translation batches through the chat provider', async () => {
  const response = await post('/api/youtube/translate', {
    provider: 'custom', apiKey: 'sk-test', baseUrl: MOCK, model: 'mock',
    videoId: 'abc12345678',
    cues: [{ en: 'Hello' }, { en: 'World' }],
  });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.zh.length, 2);
  assert.match(data.zh[0], /中文1/);
  assert.equal(data.batches, 1);
});

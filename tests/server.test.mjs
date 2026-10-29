import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';

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
    if (req.url.endsWith('/tools/search')) {
      return json(res, 200, {
        results: [{
          title: 'Mock result',
          url: 'https://example.com/mock',
          snippet: 'Mock snippet',
          summary: 'Mock summary about cities and shade.',
          content: 'Mock content about shaded streets and public transport.',
        }],
      });
    }
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
    const content = system.includes('short IELTS reading passages') ? 'Mock article about shade.' : 'ok';
    return json(res, 200, {
      model: 'mock-model',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { total_tokens: 12 },
    });
  });
  await new Promise((resolve) => mock.listen(MOCK_PORT, '127.0.0.1', resolve));

  app = spawn(process.execPath, ['server/server.mjs'], {
    cwd: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
    env: { ...process.env, PORT: String(APP_PORT), HOST: '127.0.0.1' },
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

test('homepage, CSP and static data are served', async () => {
  const response = await fetch(`${BASE}/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-security-policy') || '', /default-src 'self'/);
  assert.match(await response.text(), /EnOS/);

  const data = await fetch(`${BASE}/data/core100.json`);
  assert.equal(data.status, 200);
  const bank = await data.json();
  assert.equal(bank.words.length, 100);

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

test('invalid JSON and wrong methods are handled', async () => {
  const bad = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{not json',
  });
  assert.equal(bad.status, 400);

  const wrongMethod = await fetch(`${BASE}/api/chat`);
  assert.equal(wrongMethod.status, 405);
});

test('native search plus model summary works', async () => {
  const response = await post('/api/search', {
    provider: 'deepseek', apiKey: 'sk-test', baseUrl: MOCK, model: 'mock',
    query: 'urban shade', count: 3, summarize: true,
  });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.source, 'deepseek');
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].title, 'Mock result');
  assert.equal(data.article, 'Mock article about shade.');
  assert.equal(data.degraded, false);
});

test('unknown API route returns JSON 404', async () => {
  const response = await fetch(`${BASE}/api/nope`);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, 'NOT_FOUND');
});

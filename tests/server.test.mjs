import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';

const APP_PORT = 8917;
const MOCK_PORT = 8918;
const ARTICLE_PORT = 8919;
const BASE = `http://127.0.0.1:${APP_PORT}`;
const MOCK = `http://127.0.0.1:${MOCK_PORT}/v1`;
const ARTICLE = `http://127.0.0.1:${ARTICLE_PORT}`;
let app;
let mock;
let articleSite;

const ARTICLE_HTML = `<!doctype html><html><head><title>Shade and the city | Example</title>
<script>window.dataLayer = [];</script><style>body{margin:0}</style></head>
<body><nav><a href="/">Home</a><a href="/news">News</a></nav>
<header><h1>Shade and the city</h1></header>
<article>
<p>Urban planners increasingly argue that cities should stop widening roads. Instead, they advocate spending on public transport and shaded walking routes, because a street with trees invites people to stay outside longer.</p>
<p>A study of three European cities found that pedestrians walked further when the route offered shade and benches. The effect was strongest in summer, when surface temperatures on unshaded asphalt can be several degrees higher than in a park.</p>
<p>Critics point out that trees need water and maintenance, and that narrow streets leave less room for delivery vans. Planners reply that the costs are predictable, while the health benefits of cooler streets accumulate over decades.</p>
<p>The debate is now moving from design magazines into city budgets. In Seville, a programme that covers streets with light fabric has cut summer temperatures by several degrees, and shopkeepers who opposed the scheme now ask for more shade.</p>
<p>None of this means that every road should be planted. What matters, researchers say, is that a city treats shade as infrastructure rather than decoration, and budgets for it the way it budgets for drains and streetlights.</p>
</article>
<aside><p>Subscribe to our newsletter for more stories about cities and climate.</p></aside>
<footer>© 2026 Example. All rights reserved.</footer></body></html>`;

const CHINESE_HTML = `<!doctype html><html><head><title>人工智能</title></head><body><article>
<p>人工智能正在改变很多行业。研究人员指出，大型语言模型需要大量算力，而企业开始把这些模型部署到客服和写作场景中。</p>
<p>不过，模型的输出仍然需要人来检查。专家建议团队建立评估流程，并记录每次上线后的真实效果。</p>
</article></body></html>`;

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
      const body = await readBody(req);
      const query = String(body.query || body.text_query || '');
      const url = /rewrite/i.test(query) ? `${ARTICLE}/missing` : `${ARTICLE}/article`;
      const snippet = /rewrite/i.test(query)
        ? 'Mock snippet about a page that cannot be fetched.'
        : 'Mock snippet about shade and public transport.';
      return json(res, 200, {
        results: [{
          title: 'Mock result',
          url,
          snippet,
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
    const content = system.includes('short English web search query')
      ? 'urban shade'
      : system.includes('short IELTS reading passages')
        ? 'Mock article about shade.'
        : 'ok';
    return json(res, 200, {
      model: 'mock-model',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { total_tokens: 12 },
    });
  });
  await new Promise((resolve) => mock.listen(MOCK_PORT, '127.0.0.1', resolve));

  articleSite = http.createServer((req, res) => {
    if (req.url.startsWith('/article')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(ARTICLE_HTML);
    }
    if (req.url.startsWith('/chinese')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(CHINESE_HTML);
    }
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<html><body><p>not found</p></body></html>');
  });
  await new Promise((resolve) => articleSite.listen(ARTICLE_PORT, '127.0.0.1', resolve));

  app = spawn(process.execPath, ['server/server.mjs'], {
    cwd: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
    env: { ...process.env, PORT: String(APP_PORT), HOST: '127.0.0.1', ENOS_ALLOW_LOCAL_FETCH: '1' },
    stdio: 'ignore',
  });
  await waitFor(`${BASE}/api/health`);
});

after(() => {
  app?.kill();
  mock?.close();
  articleSite?.close();
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

  const extractGet = await fetch(`${BASE}/api/extract`);
  assert.equal(extractGet.status, 405);
});

test('native search extracts a real English excerpt from the top result', async () => {
  const response = await post('/api/search', {
    provider: 'deepseek', apiKey: 'sk-test', baseUrl: MOCK, model: 'mock',
    query: 'urban shade', count: 3, summarize: true,
  });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.source, 'deepseek');
  assert.equal(data.mode, 'excerpt');
  assert.equal(data.degraded, false);
  assert.equal(data.items[0].title, 'Mock result');
  assert.ok(data.article.startsWith('Urban planners increasingly argue'));
  assert.match(data.article, /[.!?]$/);
  assert.ok(!data.article.includes('Subscribe'), 'navigation noise must not leak into the excerpt');
  assert.ok(data.articleMeta.wordCount >= 150 && data.articleMeta.wordCount <= 220);
  assert.equal(data.articleMeta.url, `${ARTICLE}/article`);
});

test('a Chinese topic is translated into an English search query', async () => {
  const response = await post('/api/search', {
    provider: 'deepseek', apiKey: 'sk-test', baseUrl: MOCK, model: 'mock',
    query: '人工智能最新技术', count: 3, summarize: true,
  });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.query, '人工智能最新技术');
  assert.equal(data.usedQuery, 'urban shade');
  assert.equal(data.translated, true);
  assert.equal(data.mode, 'excerpt');
});

test('search falls back to a model rewrite when the page cannot be fetched', async () => {
  const response = await post('/api/search', {
    provider: 'deepseek', apiKey: 'sk-test', baseUrl: MOCK, model: 'mock',
    query: 'rewrite this page', count: 1, summarize: true,
  });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.mode, 'rewrite');
  assert.equal(data.article, 'Mock article about shade.');
  assert.ok(data.warnings.some((warning) => warning.includes('不是原文')));
});

test('/api/extract returns a sentence-aligned English excerpt', async () => {
  const response = await post('/api/extract', { url: `${ARTICLE}/article` });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.ok(data.wordCount >= 150 && data.wordCount <= 220);
  assert.ok(data.excerpt.startsWith('Urban planners increasingly argue'));
  assert.match(data.excerpt, /[.!?]$/);
  assert.equal(data.title, 'Shade and the city | Example');
});

test('/api/extract rejects pages without usable English prose', async () => {
  const chinese = await post('/api/extract', { url: `${ARTICLE}/chinese` });
  assert.equal(chinese.status, 422);
  assert.equal((await chinese.json()).error.code, 'NO_EXCERPT');

  const missing = await post('/api/extract', {});
  assert.equal(missing.status, 400);
  assert.equal((await missing.json()).error.code, 'BAD_URL');
});

test('unknown API route returns JSON 404', async () => {
  const response = await fetch(`${BASE}/api/nope`);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, 'NOT_FOUND');
});

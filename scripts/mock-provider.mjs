/**
 * Local OpenAI-compatible mock used by the AI-path smoke test.
 * Start: node scripts/mock-provider.mjs (listens on 127.0.0.1:9999)
 */
import http from 'node:http';

const PORT = Number(process.env.MOCK_PORT || 9999);

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); }
    });
  });
}

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function reply(res, content) {
  sendJSON(res, 200, {
    id: 'mock-1',
    object: 'chat.completion',
    model: 'mock',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  });
}

function streamReply(res, content) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const words = content.split(/(\s+)/).filter(Boolean);
  let index = 0;
  const timer = setInterval(() => {
    if (index >= words.length) {
      clearInterval(timer);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: words[index] } }] })}\n\n`);
    index += 1;
  }, 35);
}

function templateFrom(user) {
  const start = user.indexOf('{');
  if (start < 0) return null;
  try {
    return JSON.parse(user.slice(start));
  } catch {
    try {
      const end = user.lastIndexOf('}');
      return JSON.parse(user.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') return sendJSON(res, 200, { ok: true });
  if (req.method === 'POST' && req.url.endsWith('/tools/search')) {
    return sendJSON(res, 200, {
      results: [
        {
          title: 'Mock search result',
          url: 'https://example.com/mock',
          snippet: 'A mock snippet about urban planning and shaded streets.',
          summary: 'A mock summary about urban planning, public transport and shaded walking routes.',
          content: 'Cities are experimenting with shaded walking routes and better public transport. The mock article explains why small changes matter.',
        },
      ],
    });
  }
  if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) {
    return sendJSON(res, 404, { error: { message: 'not found' } });
  }

  const body = await readBody(req);
  const messages = body.messages || [];
  const system = messages.map((message) => message.content).join('\n');
  const user = messages[messages.length - 1]?.content || '';
  const wantsStream = Boolean(body.stream);

  if (system.includes('IELTS coach who writes one')) {
    const payload = templateFrom(user);
    if (!payload?.template) return reply(res, JSON.stringify({ error: 'no template' }));
    const template = { ...payload.template };
    template.explanation = `${template.explanation || ''} · AI 已按${payload.scene?.name || '场景'}改写`.trim();
    if (template.opening) template.opening = `${template.opening} Let us stay in the scene.`;
    if (template.prompt) template.prompt = `${template.prompt} Keep the ${payload.scene?.name || ''} setting.`;
    return reply(res, JSON.stringify(template));
  }

  if (system.includes('translate English YouTube subtitles')) {
    let lines = [];
    try { lines = JSON.parse(user).lines || []; } catch { lines = []; }
    return reply(res, JSON.stringify({
      translations: lines.map((line, index) => `中文${index + 1}：${String(line).slice(0, 14)}`),
    }));
  }

  if (system.includes('IELTS writing examiner')) {
    return reply(res, JSON.stringify({
      band: 7.5,
      criteria: { task: 7.5, coherence: 7.5, lexis: 7.5, grammar: 7 },
      feedbackZh: '结构清楚，目标词使用自然。下一步可以把一个泛化名词换成更具体的表达。',
      corrections: [{ from: 'very important', to: 'crucial', whyZh: '更精确，也更符合学术语域。' }],
      betterSentence: 'Small choices can shape a neighbourhood more than grand plans do.',
    }));
  }

  if (system.includes('IELTS pronunciation and fluency coach')) {
    return reply(res, JSON.stringify({
      feedbackZh: '重音落在第一个音节，连读自然。结尾的降调可以再明显一点。',
      tips: ['先慢读 target word', '句末降调'],
      betterVersion: 'Contemporary dance often blends classical technique with street styles.',
    }));
  }

  if (system.includes('IELTS learning coach')) {
    return reply(res, JSON.stringify({
      headline: 'AI 教练：输入已经变成输出',
      summaryZh: '这一轮你把一段关于城市交通的文字拆成了听、读、说、写四项任务，目标词与语法点都进入了真实表达。下一步要让句子更具体，减少泛化形容词。',
      strengths: ['目标词使用稳定', '四项任务全部达标', '写作结构清楚'],
      nextSteps: ['把两个泛化词换成具体名词', '用同一段输入再做一次口语复述', '第二天只听写搭配'],
    }));
  }

  if (system.includes('IELTS speaking tutor')) {
    const content = 'Good point — that sounds realistic. (AI) Can you give one concrete example from your own neighbourhood?';
    if (wantsStream) return streamReply(res, content);
    return reply(res, content);
  }

  if (system.includes('short IELTS reading passages')) {
    return reply(res, 'Urban Shade\n\nA mock article explains how shaded walking routes and reliable public transport change the way people move through a city. Small interventions can have measurable effects on comfort and safety.');
  }

  const content = 'ok';
  if (wantsStream) return streamReply(res, content);
  return reply(res, content);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock provider: http://127.0.0.1:${PORT}/v1`);
});

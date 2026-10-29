import { createChatCompletion, HttpError, readChatJSON } from './providers.mjs';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 EnOS/1.0';

function decodeEntities(value = '') {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function stripTags(value = '') {
  return decodeEntities(String(value).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

async function fetchWithTimeout(url, options = {}, ms = 15_000) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(ms),
  });
  return response;
}

async function searchDeepSeek({ baseUrl, apiKey, query, count = 5 }) {
  const response = await fetchWithTimeout(`${baseUrl}/tools/search`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, count, need_content: true }),
  }, 25_000);
  if (!response.ok) throw new Error(`DeepSeek Search ${response.status}`);
  const data = await response.json();
  return (data.results || []).slice(0, count).map((item) => ({
    title: firstText(item.title, item.url),
    url: item.url || '',
    snippet: firstText(item.snippet, item.summary, item.content).slice(0, 360),
    content: firstText(item.content, item.summary, item.snippet).slice(0, 4000),
    site: firstText(item.site_name),
    date: item.date || '',
    engine: 'deepseek',
  }));
}

async function searchKimi({ baseUrl, apiKey, query, count = 5 }) {
  const response = await fetchWithTimeout(`${baseUrl}/tools/search`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text_query: query, limit: count, include_content: true, timeout_seconds: 25 }),
  }, 30_000);
  if (!response.ok) throw new Error(`Kimi Search ${response.status}`);
  const data = await response.json();
  const list = data.search_results || data.results || [];
  return list.slice(0, count).map((item) => ({
    title: firstText(item.title, item.url),
    url: item.url || item.link || '',
    snippet: firstText(item.snippet, item.summary).slice(0, 360),
    content: firstText(
      Array.isArray(item.chunks) ? item.chunks.map((chunk) => chunk.text).join('\n\n') : '',
      item.content,
      item.summary,
      item.snippet,
    ).slice(0, 4000),
    site: firstText(item.site_name, item.site),
    date: item.date || '',
    engine: 'kimi',
  }));
}

async function searchZhipu({ baseUrl, apiKey, query, count = 5 }) {
  const response = await fetchWithTimeout(`${baseUrl}/web_search`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      search_query: query.slice(0, 70),
      search_engine: 'search_std',
      search_intent: false,
      count,
      content_size: 'high',
    }),
  }, 25_000);
  if (!response.ok) throw new Error(`Zhipu Search ${response.status}`);
  const data = await response.json();
  return (data.search_result || []).slice(0, count).map((item) => ({
    title: stripTags(item.title),
    url: item.link || '',
    snippet: stripTags(item.content).slice(0, 360),
    content: stripTags(item.content).slice(0, 4000),
    site: stripTags(item.media),
    date: item.publish_date || '',
    engine: 'zhipu',
  }));
}

export async function searchWikipedia(query, count = 3) {
  const url = `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrlimit=${count}&prop=extracts|info&inprop=url&explaintext=1&exintro=1&exchars=1400&format=json&origin=*`;
  const response = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 8000);
  if (!response.ok) throw new Error(`Wikipedia ${response.status}`);
  const data = await response.json();
  const pages = Object.values(data?.query?.pages || {});
  return pages
    .sort((a, b) => (a.index || 0) - (b.index || 0))
    .map((page) => ({
      title: page.title,
      url: page.fullurl || `https://en.wikipedia.org/?curid=${page.pageid}`,
      snippet: String(page.extract || '').slice(0, 360),
      content: String(page.extract || '').slice(0, 4000),
      site: 'Wikipedia',
      date: '',
      engine: 'wikipedia',
    }))
    .filter((item) => item.snippet);
}

export async function searchDuckDuckGo(query, count = 4) {
  const response = await fetchWithTimeout(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {}, 8000);
  if (!response.ok) throw new Error(`DuckDuckGo ${response.status}`);
  const html = await response.text();
  const items = [];
  const linkPattern = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = linkPattern.exec(html)) && items.length < count) {
    let url = decodeEntities(match[1]);
    const redirect = url.match(/[?&]uddg=([^&]+)/);
    if (redirect) url = decodeURIComponent(redirect[1]);
    const title = stripTags(match[2]);
    if (!title) continue;
    const after = html.slice(linkPattern.lastIndex, linkPattern.lastIndex + 1200);
    const snippetMatch = after.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|span)>/i);
    items.push({
      title,
      url,
      snippet: snippetMatch ? stripTags(snippetMatch[1]) : '',
      content: snippetMatch ? stripTags(snippetMatch[1]) : '',
      site: 'DuckDuckGo',
      date: '',
      engine: 'duckduckgo',
    });
  }
  return items;
}

function composeLocalArticle(query, items) {
  if (!items.length) return '';
  const parts = items.slice(0, 3).map((item) => {
    const body = item.content || item.snippet;
    return `${item.title}. ${body}`.replace(/\s+/g, ' ').trim();
  });
  const joined = parts.join('\n\n').slice(0, 2200);
  return `${query.charAt(0).toUpperCase()}${query.slice(1)}\n\n${joined}`;
}

async function composeWithModel({ provider, providerId, apiKey, baseUrl, model, query, items }) {
  const sources = items.slice(0, 5).map((item, index) => `[${index + 1}] ${item.title} — ${item.content || item.snippet}`).join('\n\n').slice(0, 7000);
  const system = [
    'You write short IELTS reading passages for learners.',
    'Write ONE plain-text article in English, 150–190 words, in 3 short paragraphs.',
    'Keep the facts that appear in the sources; do not invent numbers or quotes.',
    'Start with a title line, then the passage. No markdown headings, no bullet points, no source list.',
  ].join(' ');
  const user = `Topic: ${query}\n\nSources:\n${sources}`;
  const { response, cleanup } = await createChatCompletion({
    provider, providerId, apiKey, baseUrl, model,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    temperature: 0.5,
    maxTokens: 600,
  });
  const { content } = await readChatJSON(response, cleanup);
  return content.trim();
}

async function generateArticle({ provider, providerId, apiKey, baseUrl, model, query }) {
  const system = [
    'You write short IELTS reading passages for learners.',
    'Write ONE plain-text article in English, 150–180 words, 3 short paragraphs, about the topic.',
    'Use accurate general knowledge, avoid precise statistics or recent events you cannot verify.',
    'Start with a title line, then the passage. No markdown, no list.',
  ].join(' ');
  const { response, cleanup } = await createChatCompletion({
    provider, providerId, apiKey, baseUrl, model,
    messages: [{ role: 'system', content: system }, { role: 'user', content: `Topic: ${query}` }],
    temperature: 0.75,
    maxTokens: 600,
  });
  const { content } = await readChatJSON(response, cleanup);
  return content.trim();
}

export async function searchWeb({ provider, providerId, apiKey, baseUrl, model, query, count = 5, summarize = true }) {
  const cleanQuery = String(query || '').trim().slice(0, 120);
  if (cleanQuery.length < 2) throw new HttpError(400, '搜索词太短。', 'BAD_QUERY');

  const warnings = [];
  let items = [];
  let source = 'none';

  const native = provider.search;
  const nativeRunner = native === 'deepseek' ? searchDeepSeek : native === 'kimi' ? searchKimi : native === 'zhipu' ? searchZhipu : null;
  if (nativeRunner && apiKey) {
    try {
      items = await nativeRunner({ baseUrl, apiKey, query: cleanQuery, count });
      if (items.length) source = native;
      else warnings.push(`${provider.label} 搜索没有返回结果。`);
    } catch (error) {
      warnings.push(`${provider.label} 搜索不可用（${error.message}），已切换备用检索。`);
    }
  }

  if (!items.length) {
    try {
      items = await searchWikipedia(cleanQuery, 3);
      if (items.length) source = 'wikipedia';
    } catch (error) {
      warnings.push(`维基百科检索失败（${error.message}）。`);
    }
  }

  if (!items.length) {
    try {
      items = await searchDuckDuckGo(cleanQuery, 4);
      if (items.length) source = 'duckduckgo';
    } catch (error) {
      warnings.push(`网页检索失败（${error.message}）。`);
    }
  }

  let degraded = false;
  let article = '';
  if (items.length && summarize && apiKey) {
    try {
      article = await composeWithModel({ provider, providerId, apiKey, baseUrl, model, query: cleanQuery, items });
    } catch (error) {
      warnings.push(`整理成学习文章失败（${error.message}），已改用检索摘要。`);
      article = composeLocalArticle(cleanQuery, items);
    }
  } else if (items.length) {
    article = composeLocalArticle(cleanQuery, items);
  }

  if (!items.length) {
    if (!apiKey) {
      const detail = warnings.length
        ? `（${warnings.map((warning) => warning.replace(/。$/, '')).join('；')}）`
        : '';
      throw new HttpError(502, `联网检索暂时不可用${detail}。可以直接粘贴英文，或在设置里配置 API Key 后使用服务商搜索。`, 'SEARCH_UNAVAILABLE');
    }
    degraded = true;
    source = 'ai-generated';
    try {
      article = await generateArticle({ provider, providerId, apiKey, baseUrl, model, query: cleanQuery });
      warnings.push('没有拿到实时网页结果，以下内容由模型根据通识生成，请当作泛读材料而非新闻。');
    } catch (error) {
      throw new HttpError(502, `联网检索失败，模型生成也失败了：${error.message}`, 'SEARCH_FAILED');
    }
  }

  return {
    query: cleanQuery,
    items: items.slice(0, 6).map(({ content, ...rest }) => ({ ...rest, content: content.slice(0, 1200) })),
    article,
    source,
    degraded,
    warnings,
    fetchedAt: new Date().toISOString(),
  };
}

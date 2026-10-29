/**
 * Zero-dependency article extraction.
 *
 * Goal: given a web page URL, return a faithful English excerpt of 150-220 words,
 * cut on sentence boundaries, so the learner reads real prose instead of an
 * AI rewrite. No readability dependency, no network assumptions beyond `fetch`.
 */
import { HttpError } from './providers.mjs';

const PAGE_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 EnOS/1.0';

const NOISE_PATTERNS = [
  /^(advertisement|advertising|sponsored)\b/i,
  /^(subscribe|sign up|sign in|log ?in|register)\b/i,
  /^(share|tweet|email|print|download)\b/i,
  /^(related|recommended|read more|more from|see also)\b/i,
  /^(photo|image|video|illustration|graphic|source|credit)\s*[:：]/i,
  /^(getty images|reuters|associated press|afp|shutterstock)\b/i,
  /all rights reserved/i,
  /^(cookie|we use cookies|this site uses cookies)\b/i,
  /^(follow us|listen to|watch:|sign up for)\b/i,
  /^©/,
];

const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'fig', 'no', 'al',
  'inc', 'ltd', 'co', 'corp', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep',
  'sept', 'oct', 'nov', 'dec', 'u.s', 'u.k', 'e.g', 'i.e', 'a.m', 'p.m',
]);

const CJK_RE = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/;

export function decodeEntities(value = '') {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeFromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeFromCodePoint(Number(dec)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…')
    .replace(/&rsquo;/g, '’')
    .replace(/&lsquo;/g, '‘')
    .replace(/&rdquo;/g, '”')
    .replace(/&ldquo;/g, '“');
}

function safeFromCodePoint(code) {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

export function textFromHtml(fragment = '') {
  const withoutTags = String(fragment)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|blockquote|h[1-6])>/gi, ' ')
    .replace(/<[^>]*>/g, ' ');
  return decodeEntities(withoutTags)
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function countWords(text = '') {
  return (String(text).match(/[A-Za-z][A-Za-z'’-]*/g) || []).length;
}

export function isEnglishText(text = '') {
  const value = String(text);
  const letters = (value.match(/[A-Za-z]/g) || []).length;
  const cjk = (value.match(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  if (letters < 200) return false;
  return cjk / Math.max(1, letters + cjk) < 0.02;
}

/** Split prose into sentences while keeping common abbreviations intact. */
export function splitSentences(text = '') {
  const normalized = String(text).replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  const chunks = normalized
    .replace(/([.!?])["'”’)\]]*\s+/g, '$1\u0000')
    .split('\u0000');
  const sentences = [];
  for (const chunk of chunks) {
    const piece = chunk.trim();
    if (!piece) continue;
    const previous = sentences[sentences.length - 1];
    const lastWord = previous ? (previous.match(/([A-Za-z.]+)\.$/)?.[1] || '').toLowerCase() : '';
    if (previous && (ABBREVIATIONS.has(lastWord) || /\b[A-Z]\.$/.test(previous))) {
      sentences[sentences.length - 1] = `${previous} ${piece}`;
      continue;
    }
    sentences.push(piece);
  }
  return sentences;
}

/**
 * Build a passage of roughly [minWords, maxWords], never cutting mid-sentence.
 * Returns '' when there is not enough coherent English prose.
 */
export function buildExcerpt(text, { minWords = 150, maxWords = 220 } = {}) {
  const sentences = splitSentences(text);
  const picked = [];
  let words = 0;
  for (const sentence of sentences) {
    const sentenceWords = countWords(sentence);
    if (!sentenceWords) continue;
    if (!picked.length && sentenceWords < 5) continue; // headings, bylines, captions
    if (picked.length && words + sentenceWords > maxWords) break;
    if (picked.length && words >= minWords) break;
    if (!picked.length && sentenceWords > maxWords) {
      // One monstrous sentence: cut on a word boundary and mark the omission.
      const clipped = sentence.split(/\s+/).slice(0, maxWords).join(' ').replace(/[,;:]$/, '');
      return { text: `${clipped} …`, wordCount: maxWords };
    }
    picked.push(sentence);
    words += sentenceWords;
    if (words >= maxWords) break;
  }
  const excerpt = picked.join(' ').trim();
  if (words < Math.min(120, minWords)) return { text: '', wordCount: words };
  return { text: excerpt, wordCount: words };
}

function isNoise(text) {
  return NOISE_PATTERNS.some((pattern) => pattern.test(text));
}

function paragraphsFromHtml(html = '') {
  const paragraphs = [];
  const pattern = /<(p|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    const text = textFromHtml(match[2]);
    if (text.length < 60 || text.length > 4000) continue;
    if (isNoise(text)) continue;
    if (!/[.!?]/.test(text)) continue;
    paragraphs.push(text);
  }
  return paragraphs;
}

export function extractTitle(html = '') {
  const candidates = [];
  const og = html.match(/<meta[^>]+(?:property|name)=["']og:title["'][^>]*>/i)?.[0];
  if (og) candidates.push(og.match(/content=["']([^"']+)["']/i)?.[1] || '');
  candidates.push(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '');
  candidates.push(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
  for (const candidate of candidates) {
    const text = textFromHtml(candidate);
    if (text) return text.slice(0, 160);
  }
  return '';
}

/** Pull paragraphs, preferring <article>/<main> containers over the whole page. */
export function readArticle(html = '', { url = '' } = {}) {
  const cleaned = String(html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|canvas|template|iframe|form|nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');

  let bestParagraphs = [];
  let bestWords = 0;
  const containers = [
    ...cleaned.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi),
    ...cleaned.matchAll(/<main\b[^>]*>([\s\S]*?)<\/main>/gi),
  ].map((match) => match[1]);

  for (const container of containers) {
    const paragraphs = paragraphsFromHtml(container);
    const words = countWords(paragraphs.join(' '));
    if (words > bestWords) {
      bestWords = words;
      bestParagraphs = paragraphs;
    }
  }

  if (bestWords < 80) {
    bestParagraphs = paragraphsFromHtml(cleaned);
    bestWords = countWords(bestParagraphs.join(' '));
  }

  const text = bestParagraphs.join('\n\n');
  const { text: excerpt, wordCount } = buildExcerpt(text);
  return {
    url,
    title: extractTitle(cleaned),
    paragraphs: bestParagraphs.length,
    text,
    excerpt,
    wordCount,
  };
}

function isPrivateHost(hostname = '') {
  const host = String(hostname).toLowerCase().replace(/^\[|\]$/g, '');
  if (['localhost', '127.0.0.1', '0.0.0.0', '::1', '::'].includes(host)) return true;
  if (host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  return false;
}

async function readLimited(response, maxBytes) {
  if (!response.body) {
    const text = await response.text();
    return text.slice(0, maxBytes);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let text = '';
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    text += decoder.decode(value, { stream: true });
    if (total >= maxBytes) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  text += decoder.decode();
  return text;
}

/**
 * Fetch a page and return a sentence-aligned English excerpt.
 * `allowLocal` exists for tests only; production keeps private hosts blocked.
 */
export async function extractFromUrl(rawUrl, {
  timeoutMs = 12_000,
  maxBytes = 1_500_000,
  allowLocal = false,
  fetchImpl = fetch,
} = {}) {
  let url;
  try {
    url = new URL(String(rawUrl || ''));
  } catch {
    throw new HttpError(400, '链接不合法。', 'BAD_URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new HttpError(400, '只支持 http / https 链接。', 'BAD_URL');
  }
  if (!allowLocal && isPrivateHost(url.hostname)) {
    throw new HttpError(400, '出于安全考虑，不允许抓取内网地址。', 'BLOCKED_URL');
  }

  let response;
  try {
    response = await fetchImpl(url.toString(), {
      redirect: 'follow',
      headers: {
        'User-Agent': PAGE_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
        'Accept-Language': 'en-GB,en;q=0.9',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const reason = error?.name === 'TimeoutError' ? '请求超时' : error.message;
    throw new HttpError(502, `抓取原文失败（${reason}）。`, 'FETCH_FAILED');
  }

  if (!response.ok) {
    throw new HttpError(502, `抓取原文失败（HTTP ${response.status}）。`, 'FETCH_FAILED');
  }
  if (!allowLocal && isPrivateHost(new URL(response.url || url.toString()).hostname)) {
    throw new HttpError(400, '页面跳转到了内网地址，已拒绝。', 'BLOCKED_URL');
  }
  const contentType = response.headers.get('content-type') || '';
  if (contentType && !/html/i.test(contentType)) {
    throw new HttpError(415, '这个链接不是网页，无法截取正文。', 'NOT_HTML');
  }

  const html = await readLimited(response, maxBytes);
  const article = readArticle(html, { url: response.url || url.toString() });
  if (!article.excerpt || article.wordCount < 100) {
    throw new HttpError(422, '这个页面没有找到足够的英文正文。', 'NO_EXCERPT');
  }
  if (!isEnglishText(article.excerpt)) {
    throw new HttpError(422, '这篇不是英文文章，换一篇英文网页试试。', 'NOT_ENGLISH');
  }

  return {
    url: response.url || url.toString(),
    title: article.title || url.hostname,
    excerpt: article.excerpt,
    wordCount: article.wordCount,
    paragraphs: article.paragraphs,
  };
}

export { CJK_RE, isPrivateHost };

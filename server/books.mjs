import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { HttpError } from './providers.mjs';

const REPO = 'hehonghui/awesome-english-ebooks';
const TREE_URL = `https://api.github.com/repos/${REPO}/git/trees/master?recursive=1`;
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/master/`;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const CATALOG_TTL = 30 * 60_000;
const BOOK_TTL = 60 * 60_000;

export const BOOK_CATEGORIES = [
  {
    id: '01_economist',
    name: 'The Economist',
    short: 'THE ECONOMIST',
    accent: '#e3120b',
    description: '经济学人 · 周刊',
  },
  {
    id: '02_new_yorker',
    name: 'The New Yorker',
    short: 'THE NEW YORKER',
    accent: '#191919',
    description: '纽约客 · 周刊',
  },
  {
    id: '04_atlantic',
    name: 'The Atlantic',
    short: 'THE ATLANTIC',
    accent: '#1f4f8b',
    description: '大西洋月刊 · 月刊',
  },
  {
    id: '05_wired',
    name: 'Wired',
    short: 'WIRED',
    accent: '#111111',
    description: '连线 · 月刊',
  },
];

const CATEGORY_MAP = new Map(BOOK_CATEGORIES.map((category) => [category.id, category]));
const catalogCache = new Map();
const bookCache = new Map();

function cacheGet(map, key, ttl) {
  const hit = map.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > ttl) {
    map.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(map, key, value, max = 24) {
  if (map.size >= max) map.delete(map.keys().next().value);
  map.set(key, { at: Date.now(), value });
}

function decodeEntities(text = '') {
  return String(text)
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&hellip;/gi, '…')
    .replace(/&rsquo;/gi, '’')
    .replace(/&lsquo;/gi, '‘')
    .replace(/&rdquo;/gi, '”')
    .replace(/&ldquo;/gi, '“');
}

function stripTags(text = '') {
  return decodeEntities(String(text).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function attrs(text = '') {
  const result = {};
  for (const match of text.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    result[match[1].toLowerCase()] = decodeEntities(match[3] ?? match[4] ?? '');
  }
  return result;
}

function resolveHref(base, href = '') {
  const clean = decodeEntities(String(href)).split('#')[0].trim();
  if (!clean || /^[a-z]+:/i.test(clean)) return '';
  try {
    return path.posix.normalize(path.posix.join(base, decodeURIComponent(clean)));
  } catch {
    return path.posix.normalize(path.posix.join(base, clean));
  }
}

function formatBytes(size = 0) {
  if (!size) return '';
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${size} B`;
}

export function parseBooksFromTree(tree = []) {
  const issues = new Map();
  for (const item of tree) {
    if (item?.type !== 'blob') continue;
    const match = String(item.path || '').match(/^([^/]+)\/([^/]+)\/([^/]+)\.(epub|pdf|mobi)$/i);
    if (!match) continue;
    const [, categoryId, directory, , extension] = match;
    const category = CATEGORY_MAP.get(categoryId);
    if (!category) continue;
    const date = directory.replace(/^te_/, '');
    if (!/^\d{4}\.\d{2}\.\d{2}$/.test(date)) continue;
    const id = `${categoryId}/${directory}`;
    let book = issues.get(id);
    if (!book) {
      book = {
        id,
        category: categoryId,
        magazine: category.name,
        short: category.short,
        accent: category.accent,
        date,
        title: `${category.name} · ${date}`,
        directory,
        formats: [],
        sourceUrl: `https://github.com/${REPO}/tree/master/${categoryId}/${directory}`,
      };
      issues.set(id, book);
    }
    const format = extension.toLowerCase();
    if (book.formats.some((entry) => entry.format === format)) continue;
    book.formats.push({
      format,
      size: Number(item.size) || 0,
      sizeLabel: formatBytes(Number(item.size) || 0),
      path: item.path,
    });
  }
  const order = new Map([['epub', 0], ['pdf', 1], ['mobi', 2]]);
  const books = [...issues.values()].map((book) => {
    book.formats.sort((a, b) => (order.get(a.format) ?? 9) - (order.get(b.format) ?? 9));
    book.readable = book.formats.some((entry) => entry.format === 'epub');
    book.epub = book.formats.find((entry) => entry.format === 'epub') || null;
    book.primaryFormat = book.formats[0]?.format || '';
    return book;
  });
  books.sort((a, b) => b.date.localeCompare(a.date) || a.magazine.localeCompare(b.magazine));
  return books;
}

export function listBookChannels() {
  return BOOK_CATEGORIES.map((category) => ({
    id: category.id,
    name: category.name,
    short: category.short,
    accent: category.accent,
    description: category.description,
  }));
}

export async function listBooks() {
  const cached = cacheGet(catalogCache, 'catalog', CATALOG_TTL);
  if (cached) return cached;
  let response;
  try {
    response = await fetch(TREE_URL, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(25_000),
    });
  } catch (error) {
    throw new HttpError(502, `无法读取 GitHub 图书目录：${error.message}`, 'BOOK_CATALOG_FAILED');
  }
  if (!response.ok) throw new HttpError(502, `GitHub 目录返回 HTTP ${response.status}`, 'BOOK_CATALOG_FAILED');
  const data = await response.json();
  if (!Array.isArray(data.tree)) throw new HttpError(502, 'GitHub 目录格式异常。', 'BOOK_CATALOG_FAILED');
  const books = parseBooksFromTree(data.tree);
  const counts = new Map();
  for (const book of books) counts.set(book.category, (counts.get(book.category) || 0) + 1);
  const channels = listBookChannels().map((channel) => ({
    ...channel,
    count: counts.get(channel.id) || 0,
  }));
  const result = {
    source: `https://github.com/${REPO}`,
    updatedAt: new Date().toISOString(),
    channels,
    books,
  };
  cacheSet(catalogCache, 'catalog', result, 4);
  return result;
}

function findBook(books, categoryId, date) {
  return books.find((book) => book.category === categoryId && book.date === date) || null;
}

function zipEntries(buffer) {
  let eocd = -1;
  const lowest = Math.max(0, buffer.length - 65557);
  for (let offset = buffer.length - 22; offset >= lowest; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new HttpError(502, 'EPUB 不是有效的 ZIP 文件。', 'BOOK_BAD_EPUB');
  const count = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  const entries = new Map();
  let offset = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    entries.set(name, { method, compressedSize, uncompressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readZipEntry(buffer, entries, name) {
  const entry = entries.get(name);
  if (!entry) return null;
  const local = entry.localOffset;
  if (buffer.readUInt32LE(local) !== 0x04034b50) return null;
  const nameLength = buffer.readUInt16LE(local + 26);
  const extraLength = buffer.readUInt16LE(local + 28);
  const start = local + 30 + nameLength + extraLength;
  const compressed = buffer.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(compressed);
  if (entry.method === 8) return inflateRawSync(compressed);
  throw new HttpError(502, `EPUB 使用了不支持的压缩方式：${entry.method}`, 'BOOK_BAD_EPUB');
}

function parseNcx(ncx, opfDir) {
  const map = new Map();
  const text = String(ncx || '');
  const pairs = [...text.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>[\s\S]*?<content\b[^>]*src\s*=\s*"([^"]+)"/gi)];
  for (const pair of pairs) {
    const title = stripTags(pair[1]);
    const target = resolveHref(opfDir, pair[2]);
    if (title && target && !map.has(target)) map.set(target, title);
  }
  return map;
}

function parseNav(nav, opfDir) {
  const map = new Map();
  for (const match of String(nav || '').matchAll(/<a\b[^>]*href\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const target = resolveHref(opfDir, match[1]);
    const title = stripTags(match[2]);
    if (title && target && !map.has(target)) map.set(target, title);
  }
  return map;
}

function blocksFromHtml(html = '') {
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || html;
  const cleaned = body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, '')
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object\b[\s\S]*?<\/object>/gi, '')
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, '');
  const blocks = [];
  const seen = new Set();
  const blockPattern = /<(h[1-4]|p|blockquote|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  for (const match of cleaned.matchAll(blockPattern)) {
    const tag = match[1].toLowerCase();
    const text = stripTags(match[2]);
    if (!text || /downloaded by zlibrary|zlibrary from|www\.economist\.com\/the-world/i.test(text)) continue;
    if (seen.has(`${tag}:${text}`)) continue;
    seen.add(`${tag}:${text}`);
    if (tag === 'li') blocks.push({ type: 'bullet', text });
    else if (tag.startsWith('h')) blocks.push({ type: 'heading', text });
    else blocks.push({ type: 'paragraph', text });
  }
  if (blocks.length) return blocks;
  const text = stripTags(cleaned);
  return text ? text.split(/\n{2,}/).map((part) => ({ type: 'paragraph', text: part.trim() })).filter((block) => block.text) : [];
}

function meaningfulTitle(value, book) {
  const title = stripTags(value).replace(/\s+/g, ' ').trim();
  if (!title || /^(cover|contents|table of contents|广告|优质App推荐)$/i.test(title)) return '';
  if (/^(TheEconomist|NewYorker|TheNewYorker|new_yorker|Atlantic_|TheAtlantic|The Atlantic|Wired\b|wired_)/i.test(title)) return '';
  const normalized = title.replace(/[^a-z0-9]/gi, '').toLowerCase();
  const bookNormalized = String(book.title || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (normalized && normalized === bookNormalized) return '';
  return title;
}

function chapterTitle(html, fallback) {
  const candidates = [
    html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1],
    html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1],
    html.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1],
  ]
    .map((value) => stripTags(value).replace(/\s+/g, ' ').trim())
    .filter((value) => value && !/^(cover|contents|table of contents|广告|优质App推荐)$/i.test(value))
    .filter((value) => !/^(TheEconomist|NewYorker|TheNewYorker|new_yorker|Atlantic_|TheAtlantic|The Atlantic|Wired\b|wired_)/i.test(value));
  return candidates[0] || fallback;
}

function parseEpub(buffer, book) {
  const entries = zipEntries(buffer);
  const container = readZipEntry(buffer, entries, 'META-INF/container.xml')?.toString('utf8') || '';
  const opfPath = container.match(/full-path\s*=\s*"([^"]+)"/i)?.[1];
  if (!opfPath) throw new HttpError(502, 'EPUB 缺少 content.opf。', 'BOOK_BAD_EPUB');
  const opf = readZipEntry(buffer, entries, opfPath)?.toString('utf8') || '';
  const opfDir = path.posix.dirname(opfPath);
  const manifest = new Map();
  for (const match of opf.matchAll(/<item\b([^>]*?)\/?>/gi)) {
    const item = attrs(match[1]);
    if (item.id && item.href) manifest.set(item.id, item);
  }
  const spine = [...opf.matchAll(/<itemref\b([^>]*?)\/?>/gi)].map((match) => attrs(match[1])).filter(Boolean);
  const ncxItem = [...manifest.values()].find((item) => /ncx/i.test(item['media-type'] || ''));
  const navItem = [...manifest.values()].find((item) => /(^|\s)nav(\s|$)/i.test(item.properties || ''));
  const titles = new Map();
  if (ncxItem?.href) {
    const ncx = readZipEntry(buffer, entries, resolveHref(opfDir, ncxItem.href))?.toString('utf8') || '';
    for (const [key, value] of parseNcx(ncx, opfDir)) titles.set(key, value);
  }
  if (navItem?.href) {
    const nav = readZipEntry(buffer, entries, resolveHref(opfDir, navItem.href))?.toString('utf8') || '';
    for (const [key, value] of parseNav(nav, opfDir)) {
      if (!titles.has(key)) titles.set(key, value);
    }
  }
  const chapters = [];
  for (const ref of spine) {
    if (!ref.idref || ref.linear === 'no') continue;
    const item = manifest.get(ref.idref);
    if (!item?.href) continue;
    const file = resolveHref(opfDir, item.href);
    if (!file || /(?:^|\/)(cover|book_toc|ad_page|nav)(?:\.|_|$)/i.test(file)) continue;
    const html = readZipEntry(buffer, entries, file)?.toString('utf8');
    if (!html) continue;
    const blocks = blocksFromHtml(html);
    const textLength = blocks.reduce((total, block) => total + block.text.length, 0);
    const wordCount = blocks.reduce((total, block) => total + block.text.split(/\s+/).filter(Boolean).length, 0);
    if (textLength < 80 || wordCount < 25) continue;
    const title = meaningfulTitle(titles.get(file), book)
      || (blocks[0]?.type === 'paragraph' && blocks[0].text.length <= 52 && blocks[1]?.type === 'heading' ? blocks[0].text : '')
      || chapterTitle(html, `Part ${chapters.length + 1}`);
    if (/^(cover|contents|table of contents|广告|优质App推荐)$/i.test(title)) continue;
    if (blocks.some((block) => /优质App推荐|英阅阅读器/.test(block.text))) continue;
    chapters.push({
      id: `chapter-${chapters.length}`,
      title,
      wordCount,
      blocks,
    });
  }
  if (!chapters.length) throw new HttpError(502, 'EPUB 中未找到可阅读章节。', 'BOOK_EMPTY');
  return {
    book: {
      ...book,
      chapterCount: chapters.length,
      wordCount: chapters.reduce((total, chapter) => total + chapter.wordCount, 0),
    },
    chapters,
  };
}

export async function readBook(categoryId, date) {
  const category = CATEGORY_MAP.get(String(categoryId));
  if (!category || !/^\d{4}\.\d{2}\.\d{2}$/.test(String(date))) {
    throw new HttpError(400, '图书参数不正确。', 'BOOK_BAD_REQUEST');
  }
  const key = `${categoryId}/${date}`;
  const cached = cacheGet(bookCache, key, BOOK_TTL);
  if (cached) return cached;
  const catalog = await listBooks();
  const book = findBook(catalog.books, categoryId, date);
  if (!book) throw new HttpError(404, '没有找到这本书。', 'BOOK_NOT_FOUND');
  const epub = book.formats.find((entry) => entry.format === 'epub');
  if (!epub) throw new HttpError(400, '这本书没有 EPUB 版本，无法在线阅读。', 'BOOK_NO_EPUB');
  let response;
  try {
    response = await fetch(`${RAW_BASE}${epub.path.split('/').map(encodeURIComponent).join('/')}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/epub+zip,*/*' },
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    throw new HttpError(502, `下载 EPUB 失败：${error.message}`, 'BOOK_DOWNLOAD_FAILED');
  }
  if (!response.ok) throw new HttpError(502, `EPUB 返回 HTTP ${response.status}`, 'BOOK_DOWNLOAD_FAILED');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 100) throw new HttpError(502, 'EPUB 文件为空。', 'BOOK_DOWNLOAD_FAILED');
  const parsed = parseEpub(buffer, book);
  cacheSet(bookCache, key, parsed, 3);
  return parsed;
}

export async function openBookFile(categoryId, date, format) {
  const catalog = await listBooks();
  const book = findBook(catalog.books, categoryId, date);
  if (!book) throw new HttpError(404, '没有找到这本书。', 'BOOK_NOT_FOUND');
  const entry = book.formats.find((item) => item.format === String(format));
  if (!entry) throw new HttpError(404, '没有这种格式。', 'BOOK_FORMAT_NOT_FOUND');
  let response;
  try {
    response = await fetch(`${RAW_BASE}${entry.path.split('/').map(encodeURIComponent).join('/')}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
      signal: AbortSignal.timeout(120_000),
      redirect: 'follow',
    });
  } catch (error) {
    throw new HttpError(502, `下载图书失败：${error.message}`, 'BOOK_DOWNLOAD_FAILED');
  }
  if (!response.ok) throw new HttpError(502, `图书返回 HTTP ${response.status}`, 'BOOK_DOWNLOAD_FAILED');
  const types = { epub: 'application/epub+zip', pdf: 'application/pdf', mobi: 'application/x-mobipocket-ebook' };
  return {
    response,
    filename: `${book.magazine.replace(/[^\w.-]+/g, '_')}_${book.date}.${entry.format}`,
    contentType: types[entry.format] || 'application/octet-stream',
  };
}

export function _clearBookCaches() {
  catalogCache.clear();
  bookCache.clear();
}

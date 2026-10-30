/**
 * YouTube search + timed captions without third-party dependencies.
 *
 * Search: YouTube Data API v3 when a key is available, otherwise the public
 * results page (ytInitialData). Captions: the watch page's
 * ytInitialPlayerResponse -> captionTracks -> timedtext JSON3.
 *
 * Everything is proxied by the local Node server, so the browser never talks to
 * Google directly (the iframe player is the only exception).
 */
import { createChatCompletion, HttpError, extractJSON, readChatJSON } from './providers.mjs';

const YOUTUBE = 'https://www.youtube.com';
const API = 'https://www.googleapis.com/youtube/v3';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 EnOS/1.0';
const PAGE_HEADERS = {
  'User-Agent': USER_AGENT,
  'Accept-Language': 'en-US,en;q=0.9',
  Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
};

function cookieHeader() {
  const extra = String(process.env.YOUTUBE_COOKIE || '').trim();
  return extra ? `CONSENT=YES+1; SOCS=CAI; ${extra}` : 'CONSENT=YES+1; SOCS=CAI';
}

const SEARCH_TTL = 3 * 60_000;
const CAPTION_TTL = 10 * 60_000;
const TRANSLATE_TTL = 30 * 60_000;
const MAX_ENTRIES = 60;

const searchCache = new Map();
const captionCache = new Map();
const translateCache = new Map();

function cacheGet(map, key, ttl) {
  const hit = map.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > ttl) {
    map.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(map, key, value) {
  if (map.size >= MAX_ENTRIES) map.delete(map.keys().next().value);
  map.set(key, { at: Date.now(), value });
}

function hash(value = '') {
  let result = 2166136261;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    result ^= text.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

export function isValidVideoId(value = '') {
  return /^[A-Za-z0-9_-]{11}$/.test(String(value));
}

function decodeHtml(value = '') {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

export function parseClock(value = '') {
  const parts = String(value).trim().split(':').map(Number);
  if (!parts.length || parts.some((part) => !Number.isFinite(part))) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

export function formatClock(totalSeconds = 0) {
  const seconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours) return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

export function parseIsoDuration(value = '') {
  const match = String(value).match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i);
  if (!match) return 0;
  const [, days, hours, minutes, seconds] = match;
  return (Number(days) || 0) * 86400 + (Number(hours) || 0) * 3600 + (Number(minutes) || 0) * 60 + Math.round(Number(seconds) || 0);
}

function formatCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count)) return '';
  if (count >= 1_000_000_000) return `${(count / 1_000_000_000).toFixed(1)}B views`;
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M views`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K views`;
  return `${count} views`;
}

export function parseBalancedObject(text, start) {
  if (text[start] !== '{') return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, index + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function extractJsonObject(text = '', marker = /ytInitialData\s*=\s*/) {
  const match = marker.exec(text);
  if (!match) return null;
  const brace = text.indexOf('{', match.index + Math.max(0, match[0].lastIndexOf('{')));
  if (brace < 0) return null;
  return parseBalancedObject(text, brace);
}

function thumbnailOf(thumbnails = [], id = '') {
  const list = Array.isArray(thumbnails) ? [...thumbnails] : [];
  list.sort((a, b) => (Number(b.width) || 0) - (Number(a.width) || 0));
  let url = list.find((item) => item?.url)?.url || (id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : '');
  if (url.startsWith('//')) url = `https:${url}`;
  return url;
}

function textRuns(value) {
  if (!value) return '';
  if (typeof value === 'string') return decodeHtml(value);
  if (value.simpleText) return decodeHtml(value.simpleText);
  if (Array.isArray(value.runs)) return decodeHtml(value.runs.map((run) => run.text || '').join(''));
  return '';
}

function descriptionOf(renderer = {}) {
  const meta = renderer.detailedMetadataSnippets?.[0]?.snippetText;
  return (textRuns(meta) || textRuns(renderer.descriptionSnippet) || '').trim().slice(0, 220);
}

export function parseVideoRenderer(renderer = {}) {
  const id = renderer.videoId;
  if (!id) return null;
  const badges = (renderer.badges || [])
    .map((badge) => badge?.metadataBadgeRenderer?.label || '')
    .filter(Boolean)
    .join(' ');
  const duration = textRuns(renderer.lengthText) || '';
  return {
    id,
    title: textRuns(renderer.title) || 'Untitled video',
    channel: textRuns(renderer.ownerText) || textRuns(renderer.longBylineText) || '',
    channelId: renderer.ownerText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId || '',
    thumbnail: thumbnailOf(renderer.thumbnail?.thumbnails, id),
    duration,
    durationSeconds: parseClock(duration),
    views: textRuns(renderer.viewCountText) || '',
    published: textRuns(renderer.publishedTimeText) || '',
    description: descriptionOf(renderer),
    badges,
    hasCaptions: /(^|\s)(CC|Subtitles?)(\s|$)|caption|字幕/i.test(badges),
    url: `https://www.youtube.com/watch?v=${id}`,
  };
}

/** Newer YouTube search markup uses lockupViewModel instead of videoRenderer. */
export function parseLockupRenderer(lockup = {}) {
  const id = String(lockup.contentId || '');
  if (!isValidVideoId(id)) return null;
  if (lockup.contentType && !/VIDEO/i.test(lockup.contentType)) return null;
  const metadata = lockup.metadata?.lockupMetadataViewModel || {};
  const parts = (metadata.metadata?.contentMetadataViewModel?.metadataRows || [])
    .flatMap((row) => row?.metadataParts || [])
    .map((part) => part?.text?.content || part?.text?.simpleText || '')
    .filter(Boolean);
  const thumbnailVm = lockup.contentImage?.thumbnailViewModel || {};
  const sources = thumbnailVm.image?.sources || [];
  const overlayTexts = (thumbnailVm.overlays || [])
    .flatMap((overlay) => overlay?.thumbnailOverlayBadgeViewModel?.thumbnailBadges || [])
    .map((badge) => badge?.thumbnailBadgeViewModel?.text || '')
    .filter(Boolean);
  const badgeTexts = overlayTexts.length
    ? overlayTexts
    : JSON.stringify(lockup).match(/"text":"[^"]{1,20}"/g)?.map((item) => item.slice(8, -1)) || [];
  const duration = badgeTexts.find((text) => /^\d{1,2}:\d{2}(?::\d{2})?$/.test(text))
    || parts.find((text) => /^\d{1,2}:\d{2}(?::\d{2})?$/.test(text))
    || '';
  const badges = badgeTexts.filter((text) => /^(CC|Subtitles?|字幕)$/i.test(text)).join(' ');
  return {
    id,
    title: textRuns(metadata.title?.content || metadata.title?.simpleText) || 'Untitled video',
    channel: textRuns(parts[0] || ''),
    channelId: '',
    thumbnail: thumbnailOf(sources, id),
    duration,
    durationSeconds: parseClock(duration),
    views: parts.find((text) => /views/i.test(text)) || '',
    published: parts.find((text) => /ago|hour|day|week|month|year/i.test(text)) || '',
    description: '',
    badges,
    hasCaptions: Boolean(badges),
    url: `https://www.youtube.com/watch?v=${id}`,
  };
}

export function parseSearchData(data) {
  const items = [];
  const seen = new Set();

  const walk = (node, depth = 0) => {
    if (!node || depth > 60) return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child, depth + 1);
      return;
    }
    if (typeof node !== 'object') return;
    if (node.videoRenderer?.videoId && !seen.has(node.videoRenderer.videoId)) {
      const item = parseVideoRenderer(node.videoRenderer);
      if (item) {
        seen.add(item.id);
        items.push(item);
      }
    }
    if (node.lockupViewModel?.contentId && !seen.has(node.lockupViewModel.contentId)) {
      const item = parseLockupRenderer(node.lockupViewModel);
      if (item) {
        seen.add(item.id);
        items.push(item);
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'videoRenderer') continue;
      walk(value, depth + 1);
    }
  };

  walk(data);
  return items;
}

async function fetchText(url, { timeoutMs = 12_000, headers = {}, fetchImpl = fetch } = {}) {
  let response;
  try {
    response = await fetchImpl(url, {
      redirect: 'follow',
      headers: { ...PAGE_HEADERS, Cookie: cookieHeader(), ...headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const reason = error?.name === 'TimeoutError' ? '请求超时' : (error.message || '网络错误');
    throw new Error(reason);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function getJson(url, { timeoutMs = 12_000, fetchImpl = fetch } = {}) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const reason = error?.name === 'TimeoutError' ? '请求超时' : (error.message || '网络错误');
    throw new Error(reason);
  }
  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = null; }
  if (!response.ok) {
    const message = data?.error?.message || `HTTP ${response.status}`;
    throw new Error(message);
  }
  if (!data) throw new Error('接口返回了无法解析的内容');
  return data;
}

async function apiSearch({ query, key, maxResults, fetchImpl }) {
  const params = new URLSearchParams({
    part: 'snippet',
    type: 'video',
    maxResults: String(maxResults),
    q: query,
    safeSearch: 'moderate',
    videoEmbeddable: 'true',
    relevanceLanguage: 'en',
    key,
  });
  const search = await getJson(`${API}/search?${params.toString()}`, { fetchImpl });
  const ids = (search.items || [])
    .map((item) => item?.id?.videoId)
    .filter(Boolean)
    .slice(0, maxResults);
  if (!ids.length) throw new Error('YouTube Data API 没有返回视频');

  let details = {};
  try {
    const data = await getJson(`${API}/videos?part=contentDetails,statistics&id=${ids.join(',')}&key=${encodeURIComponent(key)}`, { fetchImpl });
    details = Object.fromEntries((data.items || []).map((item) => [item.id, item]));
  } catch {
    details = {};
  }

  return ids.map((id) => {
    const item = (search.items || []).find((entry) => entry?.id?.videoId === id) || {};
    const snippet = item.snippet || {};
    const extra = details[id] || {};
    const seconds = parseIsoDuration(extra.contentDetails?.duration || '');
    return {
      id,
      title: snippet.title || 'Untitled video',
      channel: snippet.channelTitle || '',
      channelId: snippet.channelId || '',
      thumbnail: thumbnailOf(snippet.thumbnails ? Object.values(snippet.thumbnails) : [], id),
      duration: seconds ? formatClock(seconds) : '',
      durationSeconds: seconds,
      views: extra.statistics?.viewCount ? formatCount(extra.statistics.viewCount) : '',
      published: snippet.publishedAt ? String(snippet.publishedAt).slice(0, 10) : '',
      description: String(snippet.description || '').trim().slice(0, 220),
      badges: '',
      hasCaptions: false,
      url: `https://www.youtube.com/watch?v=${id}`,
    };
  });
}

async function webSearch({ query, maxResults, fetchImpl }) {
  const url = `${YOUTUBE}/results?search_query=${encodeURIComponent(query)}&hl=en&gl=US&persist_hl=1`;
  const html = await fetchText(url, { fetchImpl });
  const data = extractJsonObject(html, /ytInitialData\s*=\s*/);
  if (!data) throw new Error('页面结构无法识别（可能需要登录或同意 Cookie）');
  const items = parseSearchData(data).slice(0, maxResults);
  if (!items.length) throw new Error('没有解析到可播放的视频');
  return items;
}

export async function searchYouTube({ query, apiKey = '', maxResults = 24, fetchImpl = fetch } = {}) {
  const cleanQuery = String(query || '').trim().slice(0, 120);
  if (cleanQuery.length < 2) throw new HttpError(400, '请输入至少 2 个字符的关键词。', 'BAD_QUERY');
  const count = Math.max(1, Math.min(30, Number(maxResults) || 24));
  const key = String(apiKey || process.env.YOUTUBE_API_KEY || '').trim();
  const cacheKey = `${cleanQuery}:${count}:${key ? 'api' : 'web'}`;
  const cached = cacheGet(searchCache, cacheKey, SEARCH_TTL);
  if (cached) return { ...cached, cached: true };

  let warning = '';
  if (key) {
    try {
      const items = await apiSearch({ query: cleanQuery, key, maxResults: count, fetchImpl });
      const result = { query: cleanQuery, items, source: 'youtube-api', warning: '' };
      cacheSet(searchCache, cacheKey, result);
      return result;
    } catch (error) {
      warning = `YouTube Data API 不可用（${error.message}），已自动改用网页检索。`;
    }
  }

  try {
    const items = await webSearch({ query: cleanQuery, maxResults: count, fetchImpl });
    const result = { query: cleanQuery, items, source: 'youtube-web', warning };
    cacheSet(searchCache, cacheKey, result);
    return result;
  } catch (error) {
    throw new HttpError(502, `YouTube 搜索失败：${error.message}${warning ? `。${warning}` : ''}。可在设置中配置 YouTube Data API Key。`, 'YOUTUBE_SEARCH_FAILED');
  }
}

function wordTokens(value = '') {
  return String(value)
    .replace(/\u200b/g, '')
    .replace(/\n/g, ' ')
    .replace(/>>/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token && /[\p{L}\p{N}]/u.test(token));
}

function distributeWords(tokens, from, to) {
  const weights = tokens.map((token) => Math.max(2, token.replace(/[^\p{L}\p{N}]/gu, '').length));
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const span = Math.max(0.15, to - from);
  let cursor = from;
  return tokens.map((text, index) => {
    const duration = Math.max(0.06, (span * weights[index]) / total);
    const start = cursor;
    cursor = Math.min(to, cursor + duration);
    return { text, start: Math.round(start * 1000) / 1000, end: Math.round(cursor * 1000) / 1000 };
  });
}

/** Parse YouTube timedtext JSON3 into cues with word-level timings. */
export function parseTimedText(payload) {
  const events = Array.isArray(payload?.events) ? payload.events : [];
  const cues = [];
  for (const event of events) {
    if (!event?.segs || !Array.isArray(event.segs)) continue;
    const start = Math.max(0, Number(event.tStartMs) || 0) / 1000;
    const duration = Math.max(0.2, Number(event.dDurationMs) || 0) / 1000;
    const end = start + duration;
    const segs = event.segs;
    const words = [];
    const hasOffsets = segs.some((seg) => Number.isFinite(seg?.tOffsetMs));

    if (!hasOffsets) {
      const tokens = segs.flatMap((seg) => wordTokens(decodeHtml(seg.utf8 || '')));
      if (!tokens.length) continue;
      words.push(...distributeWords(tokens, start, end));
    } else {
      for (let index = 0; index < segs.length; index += 1) {
        const seg = segs[index];
        const tokens = wordTokens(decodeHtml(seg.utf8 || ''));
        if (!tokens.length) continue;
        let segStart = Number.isFinite(seg.tOffsetMs) ? start + seg.tOffsetMs / 1000 : null;
        let segEnd = end;
        if (segStart !== null) {
          for (let next = index + 1; next < segs.length; next += 1) {
            if (Number.isFinite(segs[next].tOffsetMs)) {
              segEnd = start + segs[next].tOffsetMs / 1000;
              break;
            }
          }
          segEnd = Math.max(segStart + 0.08, Math.min(end, segEnd));
        } else {
          segStart = words.length ? words[words.length - 1].end : start;
        }
        words.push(...distributeWords(tokens, segStart, segEnd));
      }
    }

    if (!words.length) continue;
    const text = words.map((word) => word.text).join(' ').trim();
    if (!text) continue;
    cues.push({ start, end, text, words });
  }
  return cues;
}

/** Merge tiny ASR events into readable subtitle lines without losing word timings. */
export function mergeCues(cues = [], { maxChars = 92, maxDuration = 8, maxGap = 1.1 } = {}) {
  const merged = [];
  for (const cue of cues) {
    if (!cue?.words?.length) continue;
    const last = merged[merged.length - 1];
    if (last) {
      const gap = cue.start - last.end;
      const combined = `${last.text} ${cue.text}`;
      if (gap <= maxGap && combined.length <= maxChars && cue.end - last.start <= maxDuration) {
        last.end = cue.end;
        last.text = combined;
        last.words.push(...cue.words);
        continue;
      }
    }
    merged.push({ start: cue.start, end: cue.end, text: cue.text, words: cue.words.map((word) => ({ ...word })) });
  }
  return merged;
}

/** Align translated cues to English cues by temporal overlap, then nearest start. */
export function alignTranslations(enCues = [], zhCues = []) {
  if (!zhCues.length) return enCues.map(() => '');
  return enCues.map((cue) => {
    const overlaps = zhCues.filter((item) => item.end > cue.start + 0.05 && item.start < cue.end - 0.05);
    if (overlaps.length) return overlaps.map((item) => item.text).join('').replace(/\s+/g, ' ').trim();
    let best = null;
    let distance = Number.POSITIVE_INFINITY;
    for (const item of zhCues) {
      const current = Math.abs(item.start - cue.start);
      if (current < distance) {
        distance = current;
        best = item;
      }
    }
    return best && distance <= 2.5 ? best.text.trim() : '';
  });
}

export function chooseCaptionTrack(tracks = []) {
  const english = tracks.filter((track) => String(track.languageCode || '').toLowerCase().startsWith('en'));
  return english.find((track) => track.kind !== 'asr')
    || english[0]
    || tracks[0]
    || null;
}

async function fetchCaptionJson(baseUrl, { tlang = '', fetchImpl = fetch } = {}) {
  try {
    let raw = decodeHtml(baseUrl);
    if (raw.startsWith('//')) raw = `https:${raw}`;
    const url = new URL(raw);
    url.searchParams.set('fmt', 'json3');
    if (tlang) url.searchParams.set('tlang', tlang);
    const response = await fetchImpl(url.toString(), {
      headers: { 'User-Agent': USER_AGENT, Accept: '*/*', 'Accept-Language': 'en-US,en;q=0.9', Cookie: cookieHeader() },
      signal: AbortSignal.timeout(12_000),
      redirect: 'follow',
    });
    if (!response.ok) return null;
    const text = await response.text();
    if (!text.trim() || !text.trim().startsWith('{')) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function playerFromHtml(html) {
  return extractJsonObject(html, /ytInitialPlayerResponse\s*=\s*/)
    || extractJsonObject(html, /"ytInitialPlayerResponse"\]\s*=\s*/)
    || extractJsonObject(html, /"ytInitialPlayerResponse"\s*:\s*/);
}

/** Convert the sentence-level segments returned by get-youtube-transcript. */
export function segmentsToCues(segments = []) {
  const cues = [];
  for (const segment of segments) {
    const start = Number(segment?.start);
    const duration = Number(segment?.duration);
    if (!Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0) continue;
    const text = String(segment.text || '').replace(/\s+/g, ' ').trim();
    if (!text || /^\[(music|applause|laughter|silence)\]$/i.test(text)) continue;
    const tokens = wordTokens(text);
    if (!tokens.length) continue;
    const end = start + Math.max(0.15, duration);
    const words = distributeWords(tokens, start, end);
    cues.push({ start, end, text: words.map((word) => word.text).join(' '), words });
  }
  return cues;
}

/**
 * 2026: timedtext returns an empty 200 unless the request carries a video-bound
 * PoToken. get-youtube-transcript mints one with BotGuard. It is an optional
 * dependency so the rest of EnOS still runs without `npm install`.
 */
async function poTokenCues(videoId, languages = ['en']) {
  let helper;
  try {
    helper = await import('get-youtube-transcript');
  } catch {
    throw new Error('PO_TOKEN_HELPER_MISSING');
  }
  if (typeof helper.getTranscript !== 'function') throw new Error('PO_TOKEN_HELPER_MISSING');

  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await helper.getTranscript(videoId, { languages });
      const cues = segmentsToCues(result.segments || []);
      if (!cues.length) throw new Error('Empty transcript');
      return { cues, language: result.language || '' };
    } catch (error) {
      lastError = error;
      if (/PO_TOKEN_HELPER_MISSING/i.test(String(error?.message || ''))) break;
      if (attempt === 0) await sleep(300);
    }
  }
  throw lastError;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * YouTube's bot gate is flaky: the same video can return LOGIN_REQUIRED once
 * and a normal player response a second later. Try a couple of URL variants
 * before treating it as a real failure.
 */
async function fetchWatchPlayer(videoId, fetchImpl) {
  const urls = [
    `${YOUTUBE}/watch?v=${videoId}&hl=en&gl=US`,
    `${YOUTUBE}/watch?v=${videoId}&hl=en&gl=US&bpctr=9999999999&has_verified=1`,
  ];
  let lastPlayer = null;
  let lastError = null;
  for (let attempt = 0; attempt < urls.length; attempt += 1) {
    try {
      const html = await fetchText(urls[attempt], { timeoutMs: 15_000, fetchImpl });
      const player = playerFromHtml(html);
      if (player) {
        lastPlayer = player;
        const tracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
        if (player.playabilityStatus?.status === 'OK' || tracks.length) return player;
      }
    } catch (error) {
      lastError = error;
    }
    if (attempt < urls.length - 1) await sleep(250);
  }
  if (lastPlayer) return lastPlayer;
  throw lastError || new Error('YouTube 返回了无法识别的视频页');
}

export async function getVideoCaptions({ videoId, fetchImpl = fetch, usePoToken = fetchImpl === fetch } = {}) {
  if (!isValidVideoId(videoId)) throw new HttpError(400, '视频 ID 不合法。', 'BAD_VIDEO_ID');
  const cacheKey = videoId;
  const cached = cacheGet(captionCache, cacheKey, CAPTION_TTL);
  if (cached) return { ...cached, cached: true };

  let player;
  try {
    player = await fetchWatchPlayer(videoId, fetchImpl);
  } catch (error) {
    throw new HttpError(502, `无法打开 YouTube 视频页：${error.message}`, 'YOUTUBE_PAGE_FAILED');
  }

  const details = player.videoDetails || {};
  const meta = {
    videoId,
    title: details.title || 'YouTube video',
    channel: details.author || '',
    thumbnail: thumbnailOf(details.thumbnail?.thumbnails, videoId),
    durationSeconds: Number(details.lengthSeconds) || 0,
    duration: formatClock(Number(details.lengthSeconds) || 0),
    viewCount: details.viewCount ? formatCount(details.viewCount) : '',
    playable: player.playabilityStatus?.status === 'OK',
    hasCaptions: false,
    hasChinese: false,
    language: 'en',
    tracks: [],
    cues: [],
    reason: '',
    source: 'youtube',
  };

  const tracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  const playability = player.playabilityStatus?.status || '';
  let cues = [];
  let reason = '';

  if (tracks.length) {
    meta.tracks = tracks.slice(0, 12).map((item) => ({
      lang: item.languageCode || '',
      kind: item.kind || '',
      name: textRuns(item.name) || item.languageCode || '',
    }));
    const track = chooseCaptionTrack(tracks);
    if (!track?.baseUrl) {
      reason = 'NO_CAPTIONS';
    } else {
      meta.language = track.languageCode || 'en';
      const english = await fetchCaptionJson(track.baseUrl, { fetchImpl });
      if (!english) {
        reason = 'CAPTION_FETCH_FAILED';
      } else {
        cues = mergeCues(parseTimedText(english));
        if (!cues.length) reason = 'EMPTY_CAPTIONS';
      }

      if (cues.length) {
        const zhPayload = await fetchCaptionJson(track.baseUrl, { tlang: 'zh-Hans', fetchImpl });
        const zhCues = zhPayload ? mergeCues(parseTimedText(zhPayload), { maxChars: 60, maxDuration: 8 }) : [];
        if (zhCues.some((cue) => /[\u4e00-\u9fff]/.test(cue.text))) {
          const translations = alignTranslations(cues, zhCues);
          cues.forEach((cue, index) => { cue.zh = translations[index] || ''; });
          meta.hasChinese = cues.some((cue) => cue.zh);
        }
      }
    }
  } else {
    reason = playability === 'LOGIN_REQUIRED'
      ? 'LOGIN_REQUIRED'
      : playability === 'ERROR' ? 'VIDEO_UNAVAILABLE' : 'NO_CAPTIONS';
  }

  // timedtext is empty for many videos in 2026 even when captionTracks exist;
  // retry through the BotGuard/PoToken helper before giving up.
  if (!cues.length && usePoToken) {
    try {
      const fallback = await poTokenCues(videoId, ['en']);
      cues = mergeCues(fallback.cues);
      if (cues.length) {
        meta.source = 'youtube-po-token';
        reason = '';
        const zhTrack = meta.tracks.find((item) => /^zh/i.test(item.lang));
        if (zhTrack) {
          try {
            const zhFallback = await poTokenCues(videoId, [zhTrack.lang, 'zh-Hans', 'zh-CN']);
            if (zhFallback.cues.some((cue) => /[\u4e00-\u9fff]/.test(cue.text))) {
              const translations = alignTranslations(cues, zhFallback.cues);
              cues.forEach((cue, index) => { cue.zh = translations[index] || ''; });
              meta.hasChinese = cues.some((cue) => cue.zh);
            }
          } catch {
            /* keep English; client can generate Chinese with AI */
          }
        }
      }
    } catch (error) {
      const message = String(error?.message || '');
      if (/LOGIN_REQUIRED/i.test(message)) reason = 'LOGIN_REQUIRED';
      else if (/no captions/i.test(message)) reason = reason || 'NO_CAPTIONS';
      else if (/empty transcript/i.test(message)) reason = 'CAPTION_FETCH_FAILED';
      else if (/PO_TOKEN_HELPER_MISSING/i.test(message) && !reason) reason = 'CAPTION_FETCH_FAILED';
    }
  }

  if (!cues.length) {
    meta.reason = reason || 'NO_CAPTIONS';
    // LOGIN_REQUIRED / CAPTION_FETCH_FAILED 是瞬时的，不能缓存成 10 分钟的空字幕。
    return meta;
  }

  meta.hasCaptions = true;
  meta.cues = cues.map((cue) => ({ ...cue, zh: cue.zh || '' }));
  meta.reason = '';
  cacheSet(captionCache, cacheKey, meta);
  return meta;
}

function chunk(items, size) {
  const out = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

/** Translate subtitle cues into Chinese with the user's configured chat model. */
export async function translateCues({ videoId, cues = [], config, fetchImpl = fetch } = {}) {
  if (!config?.apiKey) throw new HttpError(401, '还没有配置 API Key，无法生成中文字幕。', 'NO_KEY');
  const lines = cues
    .map((cue) => String(cue?.en || cue?.text || '').replace(/\s+/g, ' ').trim().slice(0, 400))
    .filter(Boolean)
    .slice(0, 250);
  if (!lines.length) throw new HttpError(400, '没有需要翻译的字幕。', 'BAD_CUES');

  const key = `${videoId}:${hash(lines.join('|'))}`;
  const cached = cacheGet(translateCache, key, TRANSLATE_TTL);
  if (cached) return { zh: cached.zh, cached: true, batches: 0 };

  const system = [
    'You translate English YouTube subtitles into natural Simplified Chinese for Chinese learners.',
    'Return ONLY a JSON object: {"translations":["...", ...]}',
    'Keep exactly one translation per input line, in the same order.',
    'Preserve names, numbers and meaning; do not add explanations or merge lines.',
    'If a line is just noise like [Music], translate it briefly or keep it as is.',
  ].join(' ');

  const zh = [];
  const batches = chunk(lines, 25);
  for (const batch of batches) {
    const { response, cleanup } = await createChatCompletion({
      ...config,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify({ lines: batch }) },
      ],
      temperature: 0.2,
      maxTokens: 2000,
      json: true,
    });
    const data = await readChatJSON(response, cleanup);
    const parsed = extractJSON(data.content);
    const translations = Array.isArray(parsed?.translations)
      ? parsed.translations
      : Array.isArray(parsed?.zh) ? parsed.zh : null;
    if (!translations || translations.length !== batch.length) {
      throw new HttpError(502, '模型返回的字幕条数不一致，请重试。', 'BAD_TRANSLATION');
    }
    for (const line of translations) {
      zh.push(String(line || '').replace(/\s+/g, ' ').trim().slice(0, 300));
    }
  }

  cacheSet(translateCache, key, { zh });
  return { zh, cached: false, batches: batches.length };
}

/**
 * Free fallback when the user has not configured a chat provider.
 * Google Translate is batched with numbered sentinels so each translation can
 * be mapped back to its cue; no key is required.
 */
export async function translateCuesFree({ videoId = '', cues = [], fetchImpl = fetch } = {}) {
  const lines = cues
    .map((cue) => String(cue?.en || cue?.text || '').replace(/\s+/g, ' ').trim().slice(0, 400))
    .filter(Boolean)
    .slice(0, 250);
  if (!lines.length) throw new HttpError(400, '没有需要翻译的字幕。', 'BAD_CUES');

  const key = `free:${videoId}:${hash(lines.join('|'))}`;
  const cached = cacheGet(translateCache, key, TRANSLATE_TTL);
  if (cached) return { zh: cached.zh, cached: true, batches: 0, engine: 'google' };

  const batches = chunk(lines, 20);
  const zh = [];
  for (const batch of batches) {
    const query = batch.map((line, index) => `[[${index + 1}]] ${line}`).join('\n');
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=${encodeURIComponent(query)}`;
    let payload;
    try {
      const response = await fetchImpl(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      payload = await response.json();
    } catch (error) {
      throw new HttpError(502, `自动翻译暂时不可用：${error.message}`, 'FREE_TRANSLATE_FAILED');
    }

    const text = (Array.isArray(payload?.[0]) ? payload[0] : [])
      .map((segment) => (Array.isArray(segment) ? segment[0] : ''))
      .join('');
    const translated = Array.from({ length: batch.length }, () => '');
    const pattern = /\[\[(\d+)\]\]\s*([\s\S]*?)(?=\n?\[\[\d+\]\]|$)/g;
    let match;
    while ((match = pattern.exec(text))) {
      const index = Number(match[1]) - 1;
      if (index >= 0 && index < translated.length) {
        translated[index] = match[2].replace(/\s+/g, ' ').trim();
      }
    }
    for (const line of translated) zh.push(String(line || '').slice(0, 300));
  }

  cacheSet(translateCache, key, { zh });
  return { zh, cached: false, batches: batches.length, engine: 'google' };
}

export function _clearCaches() {
  searchCache.clear();
  captionCache.clear();
  translateCache.clear();
}

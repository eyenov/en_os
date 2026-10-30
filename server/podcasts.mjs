import { HttpError } from './providers.mjs';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const FEED_TTL = 10 * 60_000;
const TRANSCRIPT_TTL = 30 * 60_000;
const MAX_EPISODES = 24;

export const PODCAST_CHANNELS = [
  {
    id: 'podnews-daily',
    name: 'Podnews Daily',
    feed: 'https://podnews.net/rss',
    site: 'https://podnews.net',
    description: '每天 3–6 分钟的播客行业新闻；每集带 WebVTT 逐句字幕。',
    language: 'en',
  },
  {
    id: 'podnews-weekly',
    name: 'Podnews Weekly Review',
    feed: 'https://feeds.buzzsprout.com/1538779.rss',
    site: 'https://podnews.net/podcast/i5hv2',
    description: '每周播客行业回顾，带 WebVTT 字幕，适合长听力。',
    language: 'en',
  },
];

const feedCache = new Map();
const transcriptCache = new Map();

function hash(value = '') {
  let result = 2166136261;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    result ^= text.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

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
  if (map.size > 12) map.delete(map.keys().next().value);
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
    .replace(/&hellip;/gi, '…');
}

function stripHtml(text = '') {
  return decodeEntities(String(text).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function getTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? match[1] : '';
}

function getAttr(xml, tag, name) {
  const match = xml.match(new RegExp(`<${tag}\\b[^>]*\\b${name}="([^"]*)"`, 'i'));
  return match ? decodeEntities(match[1]) : '';
}

function parseDuration(value) {
  const text = String(value || '').trim();
  if (!text) return 0;
  if (/^\d+$/.test(text)) return Number(text);
  const parts = text.split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return 0;
  if (parts.length === 3) return Math.round(parts[0] * 3600 + parts[1] * 60 + parts[2]);
  if (parts.length === 2) return Math.round(parts[0] * 60 + parts[1]);
  return 0;
}

function formatClock(seconds) {
  const value = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

function parseDate(value) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function parseChannel(xml, channel) {
  const head = xml.split(/<item\b/i)[0] || '';
  const image = getAttr(head, 'itunes:image', 'href') || getAttr(head, 'image', 'href');
  return {
    id: channel.id,
    name: channel.name,
    description: channel.description,
    site: channel.site,
    language: channel.language,
    image,
  };
}

function transcriptOf(item) {
  const tags = [...item.matchAll(/<podcast:transcript\b[^>]*>/gi)].map((match) => match[0]);
  for (const tag of tags) {
    const url = getAttr(tag, 'podcast:transcript', 'url');
    const type = getAttr(tag, 'podcast:transcript', 'type').toLowerCase();
    if (!url) continue;
    if (type.includes('vtt') || /\.vtt(\?|$)/i.test(url)) return url;
  }
  return '';
}

function audioOf(item) {
  const enclosure = item.match(/<enclosure\b[^>]*>/i)?.[0] || '';
  const url = getAttr(enclosure, 'enclosure', 'url');
  if (url) return url;
  return getAttr(item, 'media:content', 'url');
}

function parseItem(item, channel) {
  const title = stripHtml(getTag(item, 'title')) || 'Untitled episode';
  const description = stripHtml(getTag(item, 'itunes:summary') || getTag(item, 'description') || getTag(item, 'content:encoded')).slice(0, 320);
  const audio = audioOf(item);
  const transcript = transcriptOf(item);
  if (!audio || !transcript) return null;
  const durationSeconds = parseDuration(getTag(item, 'itunes:duration'));
  const date = parseDate(getTag(item, 'pubDate'));
  const image = getAttr(item, 'itunes:image', 'href') || getAttr(item, 'media:thumbnail', 'url') || channel.image;
  return {
    id: hash(transcript || audio),
    title,
    description,
    audio,
    transcript,
    image,
    date,
    durationSeconds,
    duration: durationSeconds ? formatClock(durationSeconds) : '',
    channelId: channel.id,
    channel: channel.name,
  };
}

async function fetchFeed(channel) {
  let response;
  try {
    response = await fetch(channel.feed, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml,text/xml,*/*' },
      signal: AbortSignal.timeout(25_000),
      redirect: 'follow',
    });
  } catch (error) {
    throw new HttpError(502, `播客源请求失败：${error.message}`, 'PODCAST_FEED_FAILED');
  }
  if (!response.ok) throw new HttpError(502, `播客源返回 HTTP ${response.status}`, 'PODCAST_FEED_FAILED');
  const xml = await response.text();
  const channelInfo = parseChannel(xml, channel);
  const items = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)]
    .map((match) => parseItem(match[1], channelInfo))
    .filter(Boolean)
    .slice(0, MAX_EPISODES);
  return { channel: channelInfo, episodes: items };
}

function channelById(id) {
  return PODCAST_CHANNELS.find((channel) => channel.id === id) || null;
}

export function listPodcastChannels() {
  return PODCAST_CHANNELS.map(({ feed, ...channel }) => ({ ...channel, episodeCount: null }));
}

export async function listPodcastEpisodes(channelId) {
  const channel = channelById(channelId);
  if (!channel) throw new HttpError(404, '播客频道不存在。', 'PODCAST_CHANNEL_NOT_FOUND');
  const cached = cacheGet(feedCache, channelId, FEED_TTL);
  if (cached) return cached;
  const data = await fetchFeed(channel);
  cacheSet(feedCache, channelId, data);
  return data;
}

function parseVttTime(value) {
  const parts = String(value).trim().split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return NaN;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return NaN;
}

function wordTokens(text) {
  return String(text).match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu) || [];
}

function distributeWords(tokens, start, end) {
  const total = tokens.reduce((sum, token) => sum + Math.max(2, token.length), 0) || 1;
  let cursor = start;
  return tokens.map((text, index) => {
    const weight = Math.max(2, text.length);
    const wordEnd = index === tokens.length - 1 ? end : Math.min(end, cursor + ((end - start) * weight) / total);
    const word = { text, start: Math.round(cursor * 1000) / 1000, end: Math.round(Math.max(cursor + 0.06, wordEnd) * 1000) / 1000 };
    cursor = word.end;
    return word;
  });
}

export function parseVtt(text) {
  const cues = [];
  const blocks = String(text).replace(/\r\n?/g, '\n').split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n').filter((line) => line.trim());
    if (!lines.length) continue;
    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex < 0) continue;
    const timing = lines[timingIndex].split('-->');
    const start = parseVttTime(timing[0]);
    const end = parseVttTime(String(timing[1] || '').trim().split(/\s+/)[0]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const content = lines.slice(timingIndex + 1)
      .join(' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!content) continue;
    cues.push({ start, end, text: content });
  }

  const merged = [];
  for (const cue of cues) {
    const last = merged.at(-1);
    const canMerge = last
      && cue.start - last.end < 1.2
      && cue.end - last.start <= 12
      && last.text.length + cue.text.length <= 120
      && !/[.!?]["')\]]?$/.test(last.text);
    if (canMerge) {
      last.end = cue.end;
      last.text = `${last.text} ${cue.text}`.replace(/\s+/g, ' ').trim();
    } else {
      merged.push({ ...cue });
    }
  }

  return merged.map((cue) => {
    const tokens = wordTokens(cue.text);
    return {
      start: Math.round(cue.start * 1000) / 1000,
      end: Math.round(cue.end * 1000) / 1000,
      en: cue.text,
      zh: '',
      words: distributeWords(tokens, cue.start, cue.end),
    };
  });
}

async function fetchTranscript(url) {
  const cached = cacheGet(transcriptCache, url, TRANSCRIPT_TTL);
  if (cached) return cached;
  let response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/vtt,text/plain,*/*' },
      signal: AbortSignal.timeout(25_000),
      redirect: 'follow',
    });
  } catch (error) {
    throw new HttpError(502, `字幕请求失败：${error.message}`, 'PODCAST_TRANSCRIPT_FAILED');
  }
  if (!response.ok) throw new HttpError(502, `字幕返回 HTTP ${response.status}`, 'PODCAST_TRANSCRIPT_FAILED');
  const text = await response.text();
  const cues = parseVtt(text);
  if (!cues.length) throw new HttpError(502, '字幕文件没有可用的时间轴。', 'EMPTY_PODCAST_TRANSCRIPT');
  cacheSet(transcriptCache, url, cues);
  return cues;
}

export async function getPodcastEpisode(channelId, episodeId) {
  const data = await listPodcastEpisodes(channelId);
  const episode = data.episodes.find((item) => item.id === episodeId);
  if (!episode) throw new HttpError(404, '播客单集不存在。', 'PODCAST_EPISODE_NOT_FOUND');
  const cues = await fetchTranscript(episode.transcript);
  const { transcript, ...publicEpisode } = episode;
  return { channel: data.channel, episode: publicEpisode, cues };
}

export async function openPodcastAudio(channelId, episodeId, range = '') {
  const data = await listPodcastEpisodes(channelId);
  const episode = data.episodes.find((item) => item.id === episodeId);
  if (!episode) throw new HttpError(404, '播客单集不存在。', 'PODCAST_EPISODE_NOT_FOUND');
  const headers = { 'User-Agent': 'Mozilla/5.0', Accept: 'audio/*,*/*' };
  if (range) headers.Range = range;
  let response;
  try {
    response = await fetch(episode.audio, {
      headers,
      redirect: 'follow',
    });
  } catch (error) {
    throw new HttpError(502, `音频请求失败：${error.message}`, 'PODCAST_AUDIO_FAILED');
  }
  if (!response.ok && response.status !== 206) {
    throw new HttpError(502, `音频返回 HTTP ${response.status}`, 'PODCAST_AUDIO_FAILED');
  }
  return { response, episode };
}

export function _clearPodcastCaches() {
  feedCache.clear();
  transcriptCache.clear();
}

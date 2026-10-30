import {
  aiReady,
  bookFileUrl,
  chatStream,
  fetchVideoCaptions,
  getBooks,
  getHealth,
  getPodcastChannels,
  getPodcastEpisode,
  getPodcastEpisodes,
  readBook,
  searchVideos,
  translateVideoCaptions,
  translateVideoCaptionsFree,
} from './api.js';
import { getSettings } from './store.js';
import { activeCharCount, cueProgress, findCueIndex, findWordIndex, formatTimestamp, normalizeCues, serializeSrt } from './subtitle-sync.js';
import { h, icon, toast } from './ui.js';
import { renderSettings } from './views/settings.js';

const form = document.getElementById('video-search');
const input = document.getElementById('video-q');
const results = document.getElementById('video-results');
const channelList = document.getElementById('channel-list');
const treeCount = document.getElementById('tree-count');
const treeEyebrow = document.getElementById('tree-eyebrow');
const treeTitle = document.getElementById('tree-title');
const previewTitle = document.getElementById('preview-title');
const previewSubtitle = document.getElementById('preview-subtitle');
const previewSource = document.getElementById('preview-source');
const mediaView = document.getElementById('media-view');
const youtubePane = document.getElementById('youtube-pane');
const podcastPane = document.getElementById('podcast-pane');
const chatView = document.getElementById('chat-view');
const tabEmpty = document.getElementById('tab-empty');
const workspace = document.getElementById('media-view');
const treeOpen = document.getElementById('tree-open');
const treeCollapse = document.getElementById('tree-collapse');
const railChat = document.getElementById('rail-chat');
const railSettings = document.getElementById('rail-settings');
const settingsView = document.getElementById('settings-view');
let settingsReady = false;
const params = new URLSearchParams(window.location.search);
if (window.location.hash.startsWith('#/')) {
  const legacyRoute = window.location.hash.slice(2).split('?')[0];
  if (legacyRoute === 'settings') params.set('view', 'settings');
  const url = new URL('/videos.html', window.location.origin);
  url.search = params.toString();
  window.history.replaceState(null, '', url);
}

const SUGGESTIONS = ['TED-Ed', 'BBC Learning English', 'IELTS listening', 'National Geographic', 'Science explainer'];
const TREE_KEY = 'enos.videos.treeCollapsed.v1';
const compactViewport = window.matchMedia('(max-width: 900px)');

for (const element of document.querySelectorAll('[data-icon]')) {
  element.innerHTML = icon(element.dataset.icon, 18);
}

const state = {
  view: 'videos',
  tab: 'youtube',
  query: '',
  items: [],
  meta: null,
  channels: [],
  selectedChannel: 'all',
  expanded: new Set(),
  treeCollapsed: false,
  loading: false,
  detailOpen: false,
};

const podcast = {
  initialized: false,
  loading: false,
  channels: [],
  episodes: new Map(),
  promises: new Map(),
  expanded: new Set(),
  selectedChannel: '',
  selectedEpisode: null,
  cues: [],
  loadingTranscript: false,
  translating: false,
  activeCue: -1,
  activeWord: -1,
  activeChars: -1,
  offset: 0,
  follow: true,
  ticker: null,
  requestSeq: 0,
  translateSeq: 0,
  audioCtx: null,
  analyser: null,
  sourceNode: null,
  freqData: null,
  visualFrame: null,
  wavePhase: 0,
  waveValues: [],
};

const podcastTitle = document.getElementById('podcast-title');
const podcastAudio = document.getElementById('podcast-audio');
const podcastPlay = document.getElementById('podcast-play');
const podcastWave = document.getElementById('podcast-wave');
const podcastCurrent = document.getElementById('podcast-current');
const podcastDuration = document.getElementById('podcast-duration');
const podcastStatus = document.getElementById('podcast-status');
const podcastTranslate = document.getElementById('podcast-translate');
const podcastEn = document.getElementById('podcast-en');
const podcastZh = document.getElementById('podcast-zh');
const podcastOffset = document.getElementById('podcast-offset');
const podcastPosition = document.getElementById('podcast-position');
const podcastAudioState = document.getElementById('podcast-audio-state');
const podcastDownload = document.getElementById('podcast-download');
const podcastDetails = document.getElementById('podcast-details');
const podcastDetailsDialog = document.getElementById('podcast-details-dialog');
const podcastPrev = document.getElementById('podcast-prev');
const podcastNext = document.getElementById('podcast-next');
const podcastRepeat = document.getElementById('podcast-repeat');
let podcastCueEls = [];
let podcastWordEls = [];
let podcastCharEls = [];

const videoDetail = document.getElementById('video-detail');
const detailTitle = document.getElementById('detail-title');
const detailMeta = document.getElementById('detail-meta');
const detailBody = document.getElementById('detail-body');
const detailPlayerMount = document.getElementById('detail-player');
const detailFallback = document.getElementById('detail-fallback');
const detailStatus = document.getElementById('detail-status');
const detailTranslate = document.getElementById('detail-translate');
const detailExport = document.getElementById('detail-export');
const detailEn = document.getElementById('detail-en');
const detailZh = document.getElementById('detail-zh');
const detailMessages = document.getElementById('detail-messages');
const detailChatForm = document.getElementById('detail-chat-form');
const detailChatInput = document.getElementById('detail-chat-input');
const detailChatSend = document.getElementById('detail-chat-send');
const detailResize = document.getElementById('detail-resize');
const detailBack = document.getElementById('detail-back');
let detailCueEls = [];
let detailWordEls = [];
let detailCharEls = [];

const detail = {
  open: false,
  item: null,
  player: null,
  playerReady: false,
  cues: [],
  activeCue: -1,
  activeWord: -1,
  activeChars: -1,
  ticker: null,
  loading: false,
  translating: false,
  requestSeq: 0,
  translateSeq: 0,
  chat: [],
  chatAvailable: false,
  chatBusy: false,
};

const booksPane = document.getElementById('books-pane');
const booksGrid = document.getElementById('books-grid');
const booksSubtitle = document.getElementById('books-subtitle');
const bookReader = document.getElementById('book-reader');
const bookTitle = document.getElementById('book-title');
const bookMeta = document.getElementById('book-meta');
const bookActions = document.getElementById('book-actions');
const bookToc = document.getElementById('book-toc');
const bookContent = document.getElementById('book-content');
const bookBack = document.getElementById('book-back');
const bookState = {
  initialized: false,
  loading: false,
  data: null,
  books: [],
  channels: [],
  selectedCategory: 'all',
  readerOpen: false,
  item: null,
  chapters: [],
  active: 0,
  requestSeq: 0,
  loadingBook: false,
  error: '',
};

function setQueryInUrl(query) {
  const url = new URL(window.location.href);
  if (query) url.searchParams.set('q', query);
  else url.searchParams.delete('q');
  window.history.replaceState(null, '', url);
}

function sourceLabel(source) {
  return source === 'youtube-api' ? 'YouTube Data API' : 'YouTube 网页检索';
}

function channelOf(item) {
  return String(item.channel || 'YouTube').trim() || 'YouTube';
}

function groupChannels(items) {
  const map = new Map();
  for (const item of items) {
    const name = channelOf(item);
    if (!map.has(name)) map.set(name, { name, videos: [] });
    map.get(name).videos.push(item);
  }
  return [...map.values()].sort((a, b) => b.videos.length - a.videos.length || a.name.localeCompare(b.name));
}

function initialOf(name) {
  return Array.from(name.trim())[0]?.toUpperCase() || 'Y';
}

function watchHref(item) {
  return `/watch.html?v=${encodeURIComponent(item.id)}${state.query ? `&q=${encodeURIComponent(state.query)}` : ''}`;
}

function previewCard(item) {
  const image = h('img', {
    src: item.thumbnail || `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`,
    alt: '',
    loading: 'lazy',
    decoding: 'async',
    referrerpolicy: 'no-referrer',
  });
  image.addEventListener('error', () => { image.style.display = 'none'; });
  const meta = [];
  if (item.views) meta.push(item.views);
  if (item.published) meta.push(item.published);
  if (item.duration) meta.push(item.duration);

  return h('button', {
    class: 'preview-card',
    type: 'button',
    title: item.title,
    onclick: () => openVideoDetail(item),
  },
    h('div', { class: 'preview-thumb' },
      image,
      item.duration ? h('span', { class: 'preview-duration' }, item.duration) : null,
      item.hasCaptions ? h('span', { class: 'preview-cc' }, 'CC') : null,
      h('span', { class: 'preview-play' }, h('span', {}, h('span', { html: icon('play', 14) }))),
    ),
    h('div', { class: 'preview-body' },
      h('div', { class: 'preview-title' }, item.title),
      h('div', { class: 'preview-channel' }, item.channel || 'YouTube'),
      item.description ? h('div', { class: 'preview-desc' }, item.description) : null,
      h('div', { class: 'preview-meta' },
        meta.map((text) => h('span', { class: 'preview-chip' }, text)),
        item.hasCaptions ? h('span', { class: 'preview-chip cc' }, '带字幕') : h('span', { class: 'preview-chip' }, '字幕待检测'),
      ),
      h('span', { class: 'preview-open' }, h('span', { html: icon('play', 12) }), '播放'),
    ),
  );
}

function renderChannels() {
  if (state.tab !== 'youtube' || state.view !== 'videos') return;
  channelList.replaceChildren();
  treeCount.textContent = state.items.length
    ? `${state.channels.length} 个频道 · ${state.items.length} 个视频`
    : '搜索后显示频道';

  const allRow = h('div', { class: 'tree-node' },
    h('div', { class: 'tree-row' },
      h('button', {
        class: `tree-main${state.selectedChannel === 'all' ? ' active' : ''}`,
        type: 'button',
        'data-channel': 'all',
        onclick: () => selectChannel('all'),
      },
      h('span', { class: 'tree-avatar' }, '全'),
      h('span', { class: 'tree-name' }, '全部频道'),
      h('span', { class: 'tree-count' }, String(state.items.length))),
    ),
  );
  channelList.append(allRow);

  if (!state.channels.length) {
    channelList.append(h('p', { class: 'tree-empty' }, state.query ? '没有解析到频道。换一个关键词试试。' : '输入关键词后，这里会按频道列出视频。'));
    return;
  }

  for (const channel of state.channels) {
    const expanded = state.expanded.has(channel.name);
    const node = h('div', { class: 'tree-node' });
    const row = h('div', { class: 'tree-row' });
    const caret = h('button', {
      class: 'tree-caret',
      type: 'button',
      title: expanded ? '收起频道视频' : '展开频道视频',
      'aria-label': expanded ? '收起频道视频' : '展开频道视频',
      onclick: () => {
        if (expanded) state.expanded.delete(channel.name);
        else state.expanded.add(channel.name);
        renderChannels();
      },
    }, h('span', { html: icon(expanded ? 'chevronDown' : 'chevronRight', 14) }));
    const main = h('button', {
      class: `tree-main${state.selectedChannel === channel.name ? ' active' : ''}`,
      type: 'button',
      'data-channel': channel.name,
      onclick: () => selectChannel(channel.name),
    },
    h('span', { class: 'tree-avatar' }, initialOf(channel.name)),
    h('span', { class: 'tree-name' }, channel.name),
    h('span', { class: 'tree-count' }, String(channel.videos.length)));
    row.append(caret, main);
    node.append(row);
    if (expanded) {
      node.append(h('div', { class: 'tree-sub' }, channel.videos.map((item) => h('button', {
        class: 'tree-video',
        type: 'button',
        title: item.title,
        onclick: () => openVideoDetail(item),
      }, item.title))));
    }
    channelList.append(node);
  }
}

function renderPreviews() {
  const items = state.selectedChannel === 'all'
    ? state.items
    : state.items.filter((item) => channelOf(item) === state.selectedChannel);
  previewTitle.textContent = state.selectedChannel === 'all' ? '全部频道' : state.selectedChannel;
  previewSubtitle.textContent = state.items.length
    ? `${items.length} 个视频 · 搜索“${state.query}”${state.meta?.cached ? ' · 缓存' : ''}`
    : '输入关键词后展示视频预览';
  previewSource.textContent = state.meta?.source ? sourceLabel(state.meta.source) : '';

  results.replaceChildren();
  if (!state.items.length) {
    results.append(h('div', { class: 'preview-empty' },
      h('div', {},
        h('h2', {}, '发现英文好内容'),
        h('p', {}, '讲座 / 新闻 / 科普 / 雅思'),
        h('div', { class: 'btn-row', style: 'display:flex;gap:6px;flex-wrap:wrap;justify-content:center;margin-top:10px' },
          SUGGESTIONS.map((text) => h('button', {
            class: 'chip', type: 'button', onclick: () => runSearch(text),
          }, text))),
      ),
    ));
    return;
  }
  if (state.meta?.warning) {
    results.append(h('div', { class: 'callout warn', style: 'margin-bottom:12px' }, h('span', { html: icon('info', 16) }), h('span', {}, state.meta.warning)));
  }
  if (!items.length) {
    results.append(h('div', { class: 'preview-empty' }, h('div', {}, h('h2', {}, '这个频道暂时没有视频'), h('p', {}, '在左侧选择“全部频道”，或换一个关键词。'))));
    return;
  }
  results.append(h('div', { class: 'preview-grid' }, items.map((item) => previewCard(item))));
}

function selectChannel(name) {
  state.selectedChannel = name;
  if (name !== 'all') state.expanded.add(name);
  renderChannels();
  renderPreviews();
}

/* ---------- podcast view ---------- */

function podcastChannelById(id) {
  return podcast.channels.find((channel) => channel.id === id) || null;
}

function loadPodcastEpisodes(channel) {
  if (podcast.episodes.has(channel.id)) return Promise.resolve(podcast.episodes.get(channel.id));
  if (podcast.promises.has(channel.id)) return podcast.promises.get(channel.id);
  const promise = getPodcastEpisodes(channel.id)
    .then((data) => {
      const episodes = Array.isArray(data.episodes) ? data.episodes : [];
      podcast.episodes.set(channel.id, episodes);
      return episodes;
    })
    .finally(() => podcast.promises.delete(channel.id));
  podcast.promises.set(channel.id, promise);
  return promise;
}

function podcastChannelAvatar(channel, episodes) {
  const image = episodes[0]?.image;
  if (!image) return h('span', { class: 'podcast-avatar' }, initialOf(channel.name));
  return h('span', { class: 'podcast-avatar' },
    h('img', {
      src: image,
      alt: '',
      loading: 'lazy',
      onerror: (event) => {
        event.currentTarget.replaceWith(document.createTextNode(initialOf(channel.name)));
      },
    }),
  );
}

async function downloadPodcastLatest(channel) {
  try {
    const episodes = await loadPodcastEpisodes(channel);
    const latest = episodes[0];
    if (!latest) throw new Error('这个频道还没有可下载的单集');
    const filename = `${String(latest.title || channel.name).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, '-').slice(0, 90)}.mp3`;
    const anchor = document.createElement('a');
    anchor.href = `/api/podcasts/audio?channel=${encodeURIComponent(channel.id)}&episode=${encodeURIComponent(latest.id)}&download=1`;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    toast(`开始下载：${latest.title}`, 'ok', 2800);
  } catch (error) {
    toast(error.message || '播客下载失败', 'err', 3600);
  }
}

function renderPodcastTree() {
  if (state.tab !== 'podcast' || state.view !== 'videos') return;
  channelList.replaceChildren();
  treeEyebrow.textContent = 'PODCAST CHANNELS';
  treeTitle.textContent = '播客列表';
  const loadedEpisodes = [...podcast.episodes.values()].reduce((total, items) => total + items.length, 0);
  treeCount.textContent = podcast.channels.length
    ? `${podcast.channels.length} 个频道 · ${loadedEpisodes || '…'} 集`
    : podcast.loading ? '正在读取播客频道…' : '暂无播客频道';
  if (!podcast.channels.length) {
    channelList.append(h('div', { class: 'tree-empty' }, podcast.loading ? '正在读取播客源…' : '暂时没有可用的播客频道。'));
    return;
  }

  for (const channel of podcast.channels) {
    const episodes = podcast.episodes.get(channel.id) || [];
    const expanded = podcast.expanded.has(channel.id);
    const selected = podcast.selectedChannel === channel.id;
    const row = h('div', { class: 'tree-row podcast-row' });
    row.append(h('button', {
      class: 'tree-caret',
      type: 'button',
      title: expanded ? '收起单集' : '展开单集',
      'aria-label': expanded ? '收起单集' : '展开单集',
      onclick: () => togglePodcastChannel(channel),
    }, h('span', { html: icon(expanded ? 'chevronDown' : 'chevronRight', 14) })));
    row.append(h('button', {
      class: `tree-main podcast-main${selected ? ' active' : ''}`,
      type: 'button',
      onclick: () => openPodcastChannel(channel, { selectLatest: true }),
    },
    podcastChannelAvatar(channel, episodes),
    h('span', { class: 'tree-name' }, channel.name),
    h('span', { class: 'tree-count podcast-count' }, episodes.length ? String(episodes.length) : '…')));
    row.append(h('button', {
      class: 'tree-download',
      type: 'button',
      title: '下载最新一期',
      'aria-label': `下载 ${channel.name} 最新一期`,
      onclick: (event) => {
        event.stopPropagation();
        downloadPodcastLatest(channel);
      },
    }, h('span', { html: icon('download', 14) })));
    const node = h('div', { class: 'tree-node' }, row);
    if (expanded && episodes.length) {
      node.append(h('div', { class: 'tree-sub' }, episodes.map((episode) => h('button', {
        class: `tree-video${podcast.selectedEpisode?.id === episode.id ? ' active' : ''}`,
        type: 'button',
        title: episode.title,
        onclick: () => openPodcastEpisode(channel, episode),
      }, episode.title))));
    }
    channelList.append(node);
  }
}

async function ensurePodcast() {
  if (podcast.initialized) {
    renderPodcastTree();
    return;
  }
  if (podcast.loading) return;
  podcast.loading = true;
  renderPodcastTree();
  try {
    const data = await getPodcastChannels();
    podcast.channels = Array.isArray(data.channels) ? data.channels : [];
    podcast.initialized = true;
    podcast.loading = false;
    renderPodcastTree();
    for (const channel of podcast.channels) {
      loadPodcastEpisodes(channel)
        .then(() => {
          if (state.tab === 'podcast' && state.view === 'videos') renderPodcastTree();
        })
        .catch(() => { /* 单集数量失败时保留省略号 */ });
    }
    const first = podcast.channels[0];
    if (first) await openPodcastChannel(first, { selectLatest: true });
  } catch (error) {
    podcast.loading = false;
    podcast.initialized = false;
    treeCount.textContent = '播客源暂时不可用';
    channelList.replaceChildren(h('div', { class: 'tree-empty' }, error.message || '无法读取播客频道。'));
    toast(error.message || '播客源加载失败', 'err', 4200);
  }
}

async function togglePodcastChannel(channel) {
  if (podcast.expanded.has(channel.id)) {
    podcast.expanded.delete(channel.id);
    renderPodcastTree();
    return;
  }
  podcast.expanded.add(channel.id);
  if (!podcast.episodes.has(channel.id)) {
    treeCount.textContent = `正在读取 ${channel.name}…`;
    try {
      await loadPodcastEpisodes(channel);
    } catch (error) {
      toast(error.message || '播客单集加载失败', 'err', 4200);
    }
  }
  renderPodcastTree();
}

async function openPodcastChannel(channel, { selectLatest = false } = {}) {
  podcast.selectedChannel = channel.id;
  if (!podcast.episodes.has(channel.id)) {
    podcast.loading = true;
    treeCount.textContent = `正在读取 ${channel.name}…`;
    try {
      await loadPodcastEpisodes(channel);
    } catch (error) {
      podcast.loading = false;
      toast(error.message || '播客单集加载失败', 'err', 4200);
      renderPodcastTree();
      return;
    }
    podcast.loading = false;
  }
  renderPodcastTree();
  const episodes = podcast.episodes.get(channel.id) || [];
  if (selectLatest && episodes.length) {
    const current = podcast.selectedEpisode;
    const sameChannel = current && current.channelId === channel.id;
    if (!sameChannel) await openPodcastEpisode(channel, episodes[0]);
  }
}

function setPodcastInfo(channel, episode) {
  podcastTitle.textContent = episode.title;
  podcastTitle.title = episode.title;
  podcastCurrent.textContent = '0:00';
  podcastDuration.textContent = episode.duration || '0:00';
  podcast.waveValues = [];
  podcastPlay.disabled = false;
  podcastDetails.disabled = false;
  podcastDownload.disabled = true;
  podcast.offset = 0;
  try { podcast.offset = Math.max(-3, Math.min(3, Number(localStorage.getItem(podcastOffsetKey())) || 0)); } catch {}
  podcastOffset.value = String(podcast.offset);
  if (podcastAudio.dataset.episode !== episode.id) {
    podcastAudio.pause();
    podcastAudio.dataset.episode = episode.id;
    podcastAudio.src = `/api/podcasts/audio?channel=${encodeURIComponent(channel.id)}&episode=${encodeURIComponent(episode.id)}`;
    podcastAudio.load();
    drawPodcastWave();
  }
  updatePodcastPlayButton();
}

function showPodcastDetails() {
  const episode = podcast.selectedEpisode;
  const channel = podcastChannelById(podcast.selectedChannel);
  if (!episode || !channel) return;
  const links = [];
  for (const [label, value] of [['播客网站', episode.link || channel.site], ['音频地址', episode.audio]]) {
    if (!value) continue;
    try {
      const url = new URL(value);
      if (!['https:', 'http:'].includes(url.protocol)) continue;
      links.push(h('div', {}, h('span', {}, label), h('a', { href: url.href, target: '_blank', rel: 'noopener noreferrer' }, url.href)));
    } catch {}
  }
  const metadata = [['频道', channel.name], ['日期', episode.date], ['时长', episode.duration]];
  document.getElementById('podcast-details-title').textContent = episode.title;
  document.getElementById('podcast-details-content').replaceChildren(
    h('div', { class: 'podcast-detail-summary' },
      episode.image ? h('img', { class: 'podcast-detail-cover', src: episode.image, alt: `${channel.name} 封面`, onerror: (event) => { event.target.hidden = true; } }) : null,
      h('dl', { class: 'podcast-detail-meta' }, metadata.filter(([, value]) => value).map(([label, value]) => h('div', {}, h('dt', {}, label), h('dd', {}, value)))),
    ),
    episode.subtitle ? h('p', { class: 'podcast-detail-subtitle' }, episode.subtitle) : null,
    episode.description ? h('p', { class: 'podcast-detail-description' }, episode.description) : null,
    h('div', { class: 'podcast-detail-links' }, links),
    h('a', {
      class: 'btn btn-soft btn-sm',
      href: `/api/podcasts/audio?channel=${encodeURIComponent(channel.id)}&episode=${encodeURIComponent(episode.id)}&download=1`,
    }, h('span', { html: icon('download', 15) }), '下载本集音频'),
  );
  podcastDetailsDialog.showModal();
}

function downloadPodcastSubtitles() {
  const content = serializeSrt(podcast.cues);
  if (!content) return;
  const blob = new Blob(['\uFEFF', content], { type: 'application/x-subrip;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const name = String(podcast.selectedEpisode?.title || 'podcast').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 120);
  const anchor = h('a', { href: url, download: `${name}.srt` });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function openPodcastEpisode(channel, episode) {
  podcast.selectedChannel = channel.id;
  podcast.selectedEpisode = episode;
  podcast.translateSeq += 1;
  podcast.translating = false;
  renderPodcastTree();
  setPodcastInfo(channel, episode);
  if (compactViewport.matches) setTreeCollapsed(true);
  podcast.cues = [];
  podcast.activeCue = -1;
  podcast.activeWord = -1;
  podcast.activeChars = -1;
  podcastCueEls = [];
  podcastWordEls = [];
  podcastCharEls = [];
  podcastEn.replaceChildren();
  podcastZh.replaceChildren();
  podcastPosition.textContent = '00 / 00';
  for (const button of [podcastPrev, podcastNext, podcastRepeat]) button.disabled = true;
  podcastStatus.textContent = '正在加载播客字幕…';
  podcastTranslate.classList.add('hidden');
  const request = ++podcast.requestSeq;
  try {
    const data = await getPodcastEpisode(channel.id, episode.id);
    if (request !== podcast.requestSeq) return;
    podcast.cues = normalizeCues(data.cues || []);
    if (!podcast.cues.length) {
      podcastStatus.textContent = '这一集没有可用字幕';
      podcastEn.replaceChildren(h('div', { class: 'podcast-empty' }, '没有读到可用的字幕。'));
      podcastZh.replaceChildren(h('div', { class: 'podcast-empty' }, '换一集试试。'));
      return;
    }
    renderPodcastSubtitles();
    podcastStatus.textContent = `共 ${podcast.cues.length} 句 · 正在自动翻译中文…`;
    await translatePodcast();
  } catch (error) {
    if (request !== podcast.requestSeq) return;
    podcastStatus.textContent = '播客字幕加载失败';
    podcastEn.replaceChildren(h('div', { class: 'podcast-empty' }, error.message || '无法加载字幕。'));
    podcastZh.replaceChildren(h('div', { class: 'podcast-empty' }, '字幕暂时不可用。'));
    toast(error.message || '播客字幕加载失败', 'err', 4200);
  }
}

function podcastScrollToCue(index) {
  if (index < 0 || !podcast.follow) return;
  const pair = podcastCueEls[index];
  if (!pair) return;
  for (const [container, element] of [[podcastEn, pair.en], [podcastZh, pair.zh]]) {
    if (!container || !element) continue;
    const containerRect = container.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const top = elementRect.top - containerRect.top + container.scrollTop;
    if (top < container.scrollTop + 8 || top + elementRect.height > container.scrollTop + container.clientHeight - 8) {
      container.scrollTo({ top: Math.max(0, top - container.clientHeight * 0.3), behavior: 'smooth' });
    }
  }
}

function setPodcastActiveCue(index) {
  if (index === podcast.activeCue) return;
  if (podcast.activeCue >= 0) {
    const pair = podcastCueEls[podcast.activeCue];
    pair?.en?.classList.remove('active');
    pair?.zh?.classList.remove('active');
    podcastWordEls[podcast.activeCue]?.forEach((word) => word.classList.remove('active'));
    podcastCharEls[podcast.activeCue]?.forEach((char) => char.classList.remove('active'));
  }
  podcastCueEls.forEach((pair, cueIndex) => {
    pair.en?.classList.toggle('past', cueIndex < index);
    pair.zh?.classList.toggle('past', cueIndex < index);
  });
  podcast.activeCue = index;
  podcast.activeWord = -1;
  podcast.activeChars = -1;
  podcastPosition.textContent = `${String(index + 1).padStart(2, '0')} / ${String(podcast.cues.length).padStart(2, '0')}`;
  if (index >= 0) {
    const pair = podcastCueEls[index];
    pair?.en?.classList.add('active');
    pair?.zh?.classList.add('active');
    podcastScrollToCue(index);
  }
}

function podcastOutputLatency() {
  const ctx = podcast.audioCtx;
  if (!ctx) return 0;
  return Math.min(0.4, Math.max(0, (Number(ctx.outputLatency) || 0) + (Number(ctx.baseLatency) || 0)));
}

function podcastPlaybackTime() {
  const raw = Number(podcastAudio.currentTime) || 0;
  // <audio> currentTime is the media clock; the samples actually leaving the
  // Web Audio graph (especially Bluetooth) are a little later. Align subtitles
  // to what the listener hears, not to the media clock.
  return Math.max(0, raw - podcast.offset - podcastOutputLatency());
}

function syncPodcast() {
  if (!podcast.cues.length) return;
  const time = podcastPlaybackTime();
  const index = findCueIndex(podcast.cues, time);
  if (index !== podcast.activeCue) setPodcastActiveCue(index);
  if (index < 0) return;
  const cue = podcast.cues[index];
  const words = cue.words?.length ? cue.words : [];
  const wordIndex = findWordIndex(words, time);
  if (wordIndex !== podcast.activeWord) {
    if (podcast.activeWord >= 0) podcastWordEls[index]?.[podcast.activeWord]?.classList.remove('active');
    podcast.activeWord = wordIndex;
    if (wordIndex >= 0) podcastWordEls[index]?.[wordIndex]?.classList.add('active');
  }
  const chars = podcastCharEls[index];
  if (chars?.length) {
    const count = activeCharCount(cue.zh, cueProgress(cue, time));
    if (count !== podcast.activeChars) {
      podcast.activeChars = count;
      chars.forEach((char, charIndex) => char.classList.toggle('active', charIndex < count));
    }
  }
}

function alignPodcastSubtitleRows() {
  if (podcastPane.classList.contains('hidden')) return;
  for (const pair of podcastCueEls) {
    pair.en.style.minHeight = '';
    pair.zh.style.minHeight = '';
  }
  if (window.matchMedia('(max-width: 600px)').matches) return;
  const heights = podcastCueEls.map((pair) => Math.ceil(Math.max(pair.en.getBoundingClientRect().height, pair.zh.getBoundingClientRect().height)));
  podcastCueEls.forEach((pair, index) => {
    pair.en.style.minHeight = `${heights[index]}px`;
    pair.zh.style.minHeight = `${heights[index]}px`;
  });
}

function renderPodcastSubtitles() {
  podcastEn.replaceChildren();
  podcastZh.replaceChildren();
  podcastCueEls = [];
  podcastWordEls = [];
  podcastCharEls = [];
  podcast.activeCue = -1;
  podcast.activeWord = -1;
  podcast.activeChars = -1;
  for (const button of [podcastPrev, podcastNext, podcastRepeat, podcastDownload]) button.disabled = !podcast.cues.length;

  podcast.cues.forEach((cue, index) => {
    const enRow = h('button', {
      class: 'podcast-cue',
      type: 'button',
      onclick: () => playPodcastCue(index),
    }, h('span', { class: 'podcast-time' }, formatTimestamp(cue.start)));
    const enLine = h('span', { class: 'podcast-en' });
    const wordNodes = [];
    const words = cue.words?.length ? cue.words : [];
    words.forEach((word, wordIndex) => {
      const node = h('span', { class: 'word' }, word.text);
      wordNodes.push(node);
      enLine.append(node);
      if (wordIndex < words.length - 1) enLine.append(document.createTextNode(' '));
    });
    if (!words.length) enLine.textContent = cue.en;
    enRow.append(enLine);
    if (cue.zh) enRow.append(h('span', { class: 'podcast-inline-zh', lang: 'zh-CN' }, cue.zh));

    const zhRow = h('button', {
      class: 'podcast-cue',
      type: 'button',
      onclick: () => playPodcastCue(index),
    }, h('span', { class: 'podcast-time' }, formatTimestamp(cue.start)));
    const zhLine = h('span', { class: 'podcast-zh' });
    const chars = [];
    if (cue.zh) {
      for (const char of Array.from(cue.zh)) {
        const span = h('span', { class: 'zh-char' }, char === ' ' ? '\u00a0' : char);
        chars.push(span);
        zhLine.append(span);
      }
    } else {
      zhLine.textContent = podcast.translating ? '…' : '—';
    }
    zhRow.append(zhLine);

    podcastCueEls.push({ en: enRow, zh: zhRow });
    podcastWordEls.push(wordNodes);
    podcastCharEls.push(chars);
    podcastEn.append(enRow);
    podcastZh.append(zhRow);
  });
  alignPodcastSubtitleRows();
  syncPodcast();
}

async function translatePodcast() {
  if (podcast.translating || !podcast.cues.length) return;
  podcast.translating = true;
  podcastTranslate.classList.add('hidden');
  podcastStatus.textContent = '正在自动翻译中文字幕…';
  const request = ++podcast.translateSeq;
  const totalChunks = Math.ceil(podcast.cues.length / 200);
  try {
    const settings = getSettings();
    const useAI = aiReady(settings);
    let engine = useAI ? 'ai' : 'google';
    let zh;
    if (useAI) {
      try {
        zh = [];
        for (let index = 0; index < podcast.cues.length; index += 200) {
          const part = podcast.cues.slice(index, index + 200);
          podcastStatus.textContent = `正在翻译中文字幕 ${Math.floor(index / 200) + 1}/${totalChunks}…`;
          const data = await translateVideoCaptions(`podcast:${podcast.selectedEpisode.id}`, part, { settings });
          const lines = Array.isArray(data.zh) ? data.zh : [];
          if (lines.length !== part.length) throw new Error('翻译条数不一致');
          zh.push(...lines);
        }
      } catch {
        engine = 'google';
        zh = null;
      }
    }
    if (!zh) {
      zh = [];
      for (let index = 0; index < podcast.cues.length; index += 200) {
        const part = podcast.cues.slice(index, index + 200);
        podcastStatus.textContent = `正在翻译中文字幕 ${Math.floor(index / 200) + 1}/${totalChunks}…`;
        const data = await translateVideoCaptionsFree(`podcast:${podcast.selectedEpisode.id}`, part);
        const lines = Array.isArray(data.zh) ? data.zh : [];
        if (lines.length !== part.length) throw new Error('翻译条数不一致');
        zh.push(...lines);
      }
    }
    if (request !== podcast.translateSeq) return;
    if (!zh.some(Boolean)) throw new Error('翻译结果为空');
    podcast.cues.forEach((cue, index) => { cue.zh = zh[index] || ''; });
    renderPodcastSubtitles();
    podcastStatus.textContent = `共 ${podcast.cues.length} 句 · 英文逐词 · ${engine === 'ai' ? 'AI 中文字幕' : '自动中文字幕'}`;
    podcastTranslate.classList.add('hidden');
  } catch (error) {
    if (request !== podcast.translateSeq) return;
    podcastStatus.textContent = '中文自动翻译失败';
    podcastTranslate.classList.remove('hidden');
    podcastTranslate.textContent = '重试翻译';
    toast(error.message || '播客字幕翻译失败', 'err', 3600);
  } finally {
    if (request === podcast.translateSeq) podcast.translating = false;
  }
}

function startPodcastTicker() {
  stopPodcastTicker();
  const tick = () => {
    syncPodcast();
    podcast.ticker = requestAnimationFrame(tick);
  };
  syncPodcast();
  podcast.ticker = requestAnimationFrame(tick);
}

function stopPodcastTicker() {
  if (podcast.ticker) cancelAnimationFrame(podcast.ticker);
  podcast.ticker = null;
}

podcastAudio.addEventListener('timeupdate', () => {
  updatePodcastTimes();
  drawPodcastWave();
  syncPodcast();
});
podcastAudio.addEventListener('seeked', () => { updatePodcastTimes(); updatePodcastPlayButton(); drawPodcastWave(); syncPodcast(); });
podcastAudio.addEventListener('seeking', syncPodcast);
podcastAudio.addEventListener('ratechange', syncPodcast);
podcastAudio.addEventListener('loadedmetadata', updatePodcastTimes);
podcastAudio.addEventListener('durationchange', updatePodcastTimes);
podcastAudio.addEventListener('play', () => {
  updatePodcastPlayButton();
  startPodcastTicker();
  startPodcastVisual();
});
podcastAudio.addEventListener('playing', updatePodcastPlayButton);
podcastAudio.addEventListener('waiting', () => { podcastAudioState.textContent = '缓冲中'; });
podcastAudio.addEventListener('pause', () => {
  updatePodcastPlayButton();
  stopPodcastTicker();
  stopPodcastVisual();
  drawPodcastWave();
  syncPodcast();
});
podcastAudio.addEventListener('ended', () => {
  stopPodcastTicker();
  stopPodcastVisual();
  updatePodcastPlayButton();
  drawPodcastWave();
  syncPodcast();
});
podcastAudio.addEventListener('error', () => {
  podcastStatus.textContent = '音频无法播放，请检查网络或代理';
  podcastAudioState.textContent = '播放失败';
});
podcastTranslate.addEventListener('click', translatePodcast);
podcastDetails.addEventListener('click', showPodcastDetails);
podcastDownload.addEventListener('click', downloadPodcastSubtitles);
document.getElementById('podcast-details-close').addEventListener('click', () => podcastDetailsDialog.close());
podcastDetailsDialog.addEventListener('click', (event) => {
  if (event.target !== podcastDetailsDialog) return;
  const rect = podcastDetailsDialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) podcastDetailsDialog.close();
});

function podcastDurationValue() {
  return Number(podcastAudio.duration) || Number(podcast.selectedEpisode?.durationSeconds) || 0;
}

function updatePodcastTimes() {
  podcastCurrent.textContent = formatTimestamp(podcastAudio.currentTime || 0);
  const duration = podcastDurationValue();
  podcastDuration.textContent = duration ? formatTimestamp(duration) : (podcast.selectedEpisode?.duration || '0:00');
}

function updatePodcastPlayButton() {
  podcastPlay.innerHTML = icon(podcastAudio.paused ? 'play' : 'pause', 18);
  podcastPlay.setAttribute('aria-label', podcastAudio.paused ? '播放' : '暂停');
  podcastPlay.title = podcastAudio.paused ? '播放' : '暂停';
  podcastPane.classList.toggle('is-playing', !podcastAudio.paused);
  podcastAudioState.textContent = !podcast.selectedEpisode ? '尚未选择单集'
    : podcastAudio.ended ? '播放结束'
      : podcastAudio.paused ? podcastAudio.currentTime > 0 ? '已暂停' : '待播放' : '正在播放';
}

const podcastMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function ensurePodcastAudioGraph() {
  if (podcast.audioCtx || !(window.AudioContext || window.webkitAudioContext)) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.55;
    const source = ctx.createMediaElementSource(podcastAudio);
    source.connect(analyser);
    analyser.connect(ctx.destination);
    podcast.audioCtx = ctx;
    podcast.analyser = analyser;
    podcast.sourceNode = source;
    podcast.freqData = new Uint8Array(analyser.frequencyBinCount);
  } catch {
    podcast.audioCtx = null;
    podcast.analyser = null;
  }
}

function drawPodcastWave() {
  const canvas = podcastWave;
  if (!canvas) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const points = 84;
  const values = [];
  if (!podcastAudio.paused && !podcastMotion.matches) podcast.wavePhase = podcastAudio.currentTime * 6;
  const phase = podcast.wavePhase;
  const hasSignal = podcast.analyser && podcast.audioCtx?.state === 'running' && !podcastAudio.paused;
  if (hasSignal) {
    podcast.analyser.getByteFrequencyData(podcast.freqData);
    let peak = 1;
    let power = 0;
    for (const value of podcast.freqData) {
      peak = Math.max(peak, value);
      power += value * value;
    }
    const energy = Math.min(1, Math.pow(Math.sqrt(power / podcast.freqData.length) / 28, 0.7));
    for (let index = 0; index < points; index += 1) {
      const bin = Math.floor(Math.pow(index / points, 1.45) * (podcast.freqData.length - 1));
      const raw = Math.pow(podcast.freqData[bin] / peak, 0.65);
      const pulse = 0.5 + Math.sin(index * 0.37 - phase * 1.7) * 0.5;
      const ripple = 0.5 + Math.sin(index * 0.79 + phase * 1.2) * 0.5;
      values.push(Math.min(0.98, 0.06 + raw * 0.74 + energy * (0.15 + pulse * 0.52 + ripple * 0.2)));
    }
    podcast.waveValues = values;
  } else if (podcast.waveValues?.length === points) {
    values.push(...podcast.waveValues);
  } else {
    for (let index = 0; index < points; index += 1) {
      const wave = Math.abs(Math.sin(index * 0.29 + phase)) * 0.55
        + Math.abs(Math.sin(index * 0.071 - phase * 0.7)) * 0.45;
      values.push(0.08 + wave * 0.68);
    }
  }

  const mid = height / 2;
  const progress = podcastDurationValue() ? Math.min(1, Math.max(0, podcastAudio.currentTime / podcastDurationValue())) : 0;
  const playX = width * progress;

  const curve = (color, lineWidth, fill, scale = 1) => {
    const amp = height * 0.46 * scale;
    ctx.beginPath();
    ctx.moveTo(0, mid);
    for (let index = 0; index < points; index += 1) {
      const x = (index / (points - 1)) * width;
      const y = mid - values[index] * amp;
      if (index === 0) ctx.lineTo(x, y);
      else {
        const prevX = ((index - 1) / (points - 1)) * width;
        const prevY = mid - values[index - 1] * amp;
        ctx.quadraticCurveTo((prevX + x) / 2, (prevY + y) / 2, x, y);
      }
    }
    for (let index = points - 1; index >= 0; index -= 1) {
      const x = (index / (points - 1)) * width;
      const y = mid + values[index] * amp;
      if (index === points - 1) ctx.lineTo(x, y);
      else {
        const nextX = ((index + 1) / (points - 1)) * width;
        const nextY = mid + values[index + 1] * amp;
        ctx.quadraticCurveTo((nextX + x) / 2, (nextY + y) / 2, x, y);
      }
    }
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (lineWidth) { ctx.strokeStyle = color; ctx.lineWidth = lineWidth; ctx.stroke(); }
  };

  curve('rgba(14,143,120,.68)', 1.2, 'rgba(14,143,120,.20)');
  curve('rgba(14,143,120,.38)', 1, null, 0.55);
  if (playX > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, playX, height);
    ctx.clip();
    curve('rgba(14,143,120,1)', 1.8, 'rgba(14,143,120,.48)');
    ctx.restore();
  }
  ctx.beginPath();
  ctx.strokeStyle = 'rgba(14,143,120,.1)';
  ctx.lineWidth = 1;
  ctx.moveTo(0, mid);
  ctx.lineTo(width, mid);
  ctx.stroke();
  if (playX >= 0) {
    ctx.beginPath();
    ctx.strokeStyle = '#0e8f78';
    ctx.lineWidth = 1.5;
    ctx.moveTo(playX, 5);
    ctx.lineTo(playX, height - 5);
    ctx.stroke();
    ctx.beginPath();
    ctx.fillStyle = '#0e8f78';
    ctx.arc(playX, mid, 2.8, 0, Math.PI * 2);
    ctx.fill();
  }
  canvas.setAttribute('aria-valuemin', '0');
  canvas.setAttribute('aria-valuemax', '100');
  canvas.setAttribute('aria-valuenow', String(Math.round(progress * 100)));
}

function startPodcastVisual() {
  if (podcast.visualFrame || podcastMotion.matches) return;
  const tick = () => {
    drawPodcastWave();
    podcast.visualFrame = requestAnimationFrame(tick);
  };
  podcast.visualFrame = requestAnimationFrame(tick);
}

function stopPodcastVisual() {
  if (podcast.visualFrame) cancelAnimationFrame(podcast.visualFrame);
  podcast.visualFrame = null;
}

podcastMotion.addEventListener('change', () => {
  stopPodcastVisual();
  if (!podcastAudio.paused) startPodcastVisual();
  drawPodcastWave();
});

async function togglePodcastPlay() {
  if (!podcastAudio.src) return;
  if (podcastAudio.paused) {
    try {
      ensurePodcastAudioGraph();
      await podcast.audioCtx?.resume?.();
      await podcastAudio.play();
    } catch (error) {
      podcastStatus.textContent = error.message || '音频无法播放';
    }
  } else {
    podcastAudio.pause();
  }
}

function podcastOffsetKey() {
  return `enos.podcast.offset.v1.${podcast.selectedChannel}.${podcast.selectedEpisode?.id || ''}`;
}

function setPodcastOffset(value) {
  podcast.offset = Math.max(-3, Math.min(3, Number(value) || 0));
  podcastOffset.value = String(podcast.offset);
  try { localStorage.setItem(podcastOffsetKey(), String(podcast.offset)); } catch {}
  syncPodcast();
}

function playPodcastCue(index) {
  const cue = podcast.cues[index];
  if (!cue) return;
  podcastAudio.currentTime = Math.max(0, cue.start + podcast.offset + podcastOutputLatency());
  updatePodcastTimes();
  syncPodcast();
  if (podcastAudio.paused) togglePodcastPlay();
}

function navigatePodcastCue(direction) {
  if (!podcast.cues.length) return;
  const time = podcastPlaybackTime();
  const index = direction > 0
    ? podcast.cues.findIndex((cue) => cue.start > time + 0.05)
    : podcast.cues.findLastIndex((cue) => cue.start < time - 0.1);
  playPodcastCue(index >= 0 ? index : direction > 0 ? podcast.cues.length - 1 : 0);
}

podcastPrev.addEventListener('click', () => navigatePodcastCue(-1));
podcastNext.addEventListener('click', () => navigatePodcastCue(1));
podcastRepeat.addEventListener('click', () => {
  const index = podcast.activeCue >= 0 ? podcast.activeCue : podcast.cues.findLastIndex((cue) => cue.start <= podcastPlaybackTime());
  playPodcastCue(Math.max(0, index));
});
document.getElementById('podcast-speed').addEventListener('change', (event) => {
  podcastAudio.defaultPlaybackRate = Number(event.target.value);
  podcastAudio.playbackRate = Number(event.target.value);
});
document.getElementById('podcast-follow').addEventListener('change', (event) => {
  podcast.follow = event.target.checked;
  if (podcast.follow) podcastScrollToCue(podcast.activeCue);
});
podcastOffset.addEventListener('change', () => setPodcastOffset(podcastOffset.value));
document.getElementById('podcast-offset-reset').addEventListener('click', () => setPodcastOffset(0));

function seekPodcastRatio(ratio) {
  const duration = podcastDurationValue();
  if (!duration) return;
  podcastAudio.currentTime = Math.min(duration, Math.max(0, ratio * duration));
  updatePodcastTimes();
  drawPodcastWave();
  syncPodcast();
}

podcastPlay.addEventListener('click', togglePodcastPlay);
const wavePointer = (event) => {
  const rect = podcastWave.getBoundingClientRect();
  seekPodcastRatio((event.clientX - rect.left) / Math.max(1, rect.width));
};
podcastWave.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  podcastWave.setPointerCapture?.(event.pointerId);
  wavePointer(event);
  const move = (moveEvent) => wavePointer(moveEvent);
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up, { once: true });
  };
  window.addEventListener('pointermove', move, { passive: true });
  window.addEventListener('pointerup', up, { once: true });
});
podcastWave.addEventListener('keydown', (event) => {
  const duration = podcastDurationValue();
  if (!duration) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    podcastAudio.currentTime = Math.min(duration, Math.max(0, podcastAudio.currentTime + (event.key === 'ArrowRight' ? 5 : -5)));
    updatePodcastTimes();
    drawPodcastWave();
    syncPodcast();
  } else if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault();
    podcastAudio.currentTime = event.key === 'Home' ? 0 : duration;
    updatePodcastTimes();
    drawPodcastWave();
    syncPodcast();
  }
});
if ('ResizeObserver' in window) {
  new ResizeObserver(() => drawPodcastWave()).observe(podcastWave);
  new ResizeObserver(alignPodcastSubtitleRows).observe(podcastEn.closest('.podcast-sub-columns'));
}
updatePodcastPlayButton();
requestAnimationFrame(drawPodcastWave);

/* ---------- in-pane video detail ---------- */

let youtubeApiPromise = null;
const DETAIL_WIDTH_KEY = 'enos.detail.left.v1';

function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youtubeApiPromise) return youtubeApiPromise;
  youtubeApiPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('播放器脚本加载超时')), 12_000);
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(timeout);
      previous?.();
      resolve(window.YT);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => {
      clearTimeout(timeout);
      reject(new Error('无法加载 YouTube 播放器'));
    };
    document.head.append(script);
  });
  return youtubeApiPromise;
}

function detailFallbackShow(message) {
  detailFallback.classList.remove('hidden');
  detailFallback.replaceChildren(
    h('strong', {}, message || '播放器没有加载成功'),
    h('p', {}, '字幕仍会尝试加载；也可以换一个允许嵌入的视频。'),
  );
}

function destroyDetailPlayer() {
  stopDetailTicker();
  try { detail.player?.destroy?.(); } catch { /* ignore */ }
  detail.player = null;
  detail.playerReady = false;
  detailPlayerMount.replaceChildren();
}

function mountDetailPlayer(item) {
  destroyDetailPlayer();
  detailFallback.classList.add('hidden');
  const target = h('div');
  detailPlayerMount.replaceChildren(target);
  loadYouTubeApi().then((YT) => {
    if (!state.detailOpen || detail.item?.id !== item.id) return;
    detail.player = new YT.Player(target, {
      videoId: item.id,
      playerVars: {
        autoplay: 0, rel: 0, modestbranding: 1, cc_load_policy: 0,
        playsinline: 1, hl: 'en', origin: window.location.origin, enablejsapi: 1,
      },
      events: {
        onReady: (event) => {
          detail.playerReady = true;
          detailFallback.classList.add('hidden');
          try {
            event.target.setOption?.('captions', 'track', {});
            event.target.unloadModule?.('captions');
            event.target.unloadModule?.('cc');
          } catch { /* native CC */ }
        },
        onStateChange: (event) => {
          if (event.data === 1) startDetailTicker();
          else if (event.data === 2 || event.data === 0) {
            stopDetailTicker();
            syncDetail();
          }
        },
        onError: (event) => {
          const blocked = event?.data === 101 || event?.data === 150;
          detailFallbackShow(blocked ? '上传者不允许嵌入播放' : '播放器没有加载成功');
        },
      },
    });
  }).catch((error) => detailFallbackShow(error.message));
}

function openVideoDetail(item) {
  state.detailOpen = true;
  detail.item = item;
  detail.requestSeq += 1;
  detail.translateSeq += 1;
  detail.translating = false;
  detail.cues = [];
  detail.activeCue = -1;
  detail.activeWord = -1;
  detail.activeChars = -1;
  detailCueEls = [];
  detailWordEls = [];
  detailCharEls = [];
  detailTitle.textContent = item.title;
  detailTitle.title = item.title;
  detailMeta.textContent = [item.channel, item.duration, item.views, item.published].filter(Boolean).join(' · ');
  detailMeta.title = detailMeta.textContent;
  detailStatus.textContent = '正在加载字幕…';
  detailTranslate.classList.add('hidden');
  detailEn.replaceChildren();
  detailZh.replaceChildren();
  detail.chat = [];
  detail.chatBusy = false;
  renderTabState();
  mountDetailPlayer(item);
  loadDetailCaptions(item);
  setupDetailChat(item);
  try {
    const saved = Number(localStorage.getItem(DETAIL_WIDTH_KEY));
    if (Number.isFinite(saved) && saved >= 36 && saved <= 72) detailBody.style.setProperty('--detail-left', `${saved}%`);
  } catch { /* ignore */ }
}

function closeVideoDetail({ restore = true } = {}) {
  state.detailOpen = false;
  detail.requestSeq += 1;
  detail.translateSeq += 1;
  detail.chatBusy = false;
  destroyDetailPlayer();
  detail.item = null;
  if (restore) renderTabState();
}

async function loadDetailCaptions(item) {
  const request = ++detail.requestSeq;
  detail.loading = true;
  try {
    const data = await fetchVideoCaptions(item.id);
    if (request !== detail.requestSeq) return;
    detail.loading = false;
    detail.cues = normalizeCues(data.cues || []);
    if (!detail.cues.length) {
      detailStatus.textContent = '这一集视频没有可用字幕';
      detailEn.replaceChildren(h('div', { class: 'podcast-empty' }, data.reason === 'CAPTION_FETCH_FAILED' ? '字幕接口返回空内容。' : '没有读到可用字幕。'));
      detailZh.replaceChildren(h('div', { class: 'podcast-empty' }, '换一个带字幕的视频试试。'));
      return;
    }
    renderDetailSubtitles();
    detailStatus.textContent = `共 ${detail.cues.length} 句 · 正在自动翻译中文…`;
    translateDetail();
  } catch (error) {
    if (request !== detail.requestSeq) return;
    detail.loading = false;
    detailStatus.textContent = '字幕加载失败';
    detailEn.replaceChildren(h('div', { class: 'podcast-empty' }, error.message || '无法加载字幕。'));
    detailZh.replaceChildren(h('div', { class: 'podcast-empty' }, '字幕暂时不可用。'));
    toast(error.message || '视频字幕加载失败', 'err', 3600);
  }
}

function detailScrollToCue(index) {
  if (index < 0) return;
  const pair = detailCueEls[index];
  if (!pair) return;
  for (const [container, element] of [[detailEn, pair.en], [detailZh, pair.zh]]) {
    if (!container || !element) continue;
    const containerRect = container.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const top = elementRect.top - containerRect.top + container.scrollTop;
    if (top < container.scrollTop + 6 || top + elementRect.height > container.scrollTop + container.clientHeight - 6) {
      container.scrollTo({ top: Math.max(0, top - container.clientHeight * 0.3), behavior: 'smooth' });
    }
  }
}

function setDetailActiveCue(index) {
  if (index === detail.activeCue) return;
  if (detail.activeCue >= 0) {
    const pair = detailCueEls[detail.activeCue];
    pair?.en?.classList.remove('active');
    pair?.zh?.classList.remove('active');
    detailWordEls[detail.activeCue]?.forEach((word) => word.classList.remove('active'));
    detailCharEls[detail.activeCue]?.forEach((char) => char.classList.remove('active'));
  }
  detailCueEls.forEach((pair, cueIndex) => {
    pair.en?.classList.toggle('past', cueIndex < index);
    pair.zh?.classList.toggle('past', cueIndex < index);
  });
  detail.activeCue = index;
  detail.activeWord = -1;
  detail.activeChars = -1;
  if (index >= 0) {
    const pair = detailCueEls[index];
    pair?.en?.classList.add('active');
    pair?.zh?.classList.add('active');
    detailScrollToCue(index);
  }
}

function syncDetail() {
  if (!detail.cues.length || !detail.playerReady) return;
  const time = Number(detail.player?.getCurrentTime?.()) || 0;
  const index = findCueIndex(detail.cues, time);
  if (index !== detail.activeCue) setDetailActiveCue(index);
  if (index < 0) return;
  const cue = detail.cues[index];
  const words = cue.words || [];
  const wordIndex = findWordIndex(words, time);
  if (wordIndex !== detail.activeWord) {
    if (detail.activeWord >= 0) detailWordEls[index]?.[detail.activeWord]?.classList.remove('active');
    detail.activeWord = wordIndex;
    if (wordIndex >= 0) detailWordEls[index]?.[wordIndex]?.classList.add('active');
  }
  const chars = detailCharEls[index];
  if (chars?.length) {
    const count = activeCharCount(cue.zh, cueProgress(cue, time));
    if (count !== detail.activeChars) {
      detail.activeChars = count;
      chars.forEach((char, charIndex) => char.classList.toggle('active', charIndex < count));
    }
  }
}

function startDetailTicker() {
  stopDetailTicker();
  let last = 0;
  const tick = (timestamp) => {
    if (timestamp - last >= 50) {
      last = timestamp;
      syncDetail();
    }
    detail.ticker = requestAnimationFrame(tick);
  };
  detail.ticker = requestAnimationFrame(tick);
}

function stopDetailTicker() {
  if (detail.ticker) cancelAnimationFrame(detail.ticker);
  detail.ticker = null;
}

function seekDetail(cue) {
  const index = detail.cues.indexOf(cue);
  if (index >= 0) setDetailActiveCue(index);
  if (detail.playerReady && detail.player?.seekTo) {
    detail.player.seekTo(cue.start, true);
    detail.player.playVideo?.();
  }
}

function renderDetailSubtitles() {
  detailEn.replaceChildren();
  detailZh.replaceChildren();
  detailCueEls = [];
  detailWordEls = [];
  detailCharEls = [];
  detail.activeCue = -1;
  detail.activeWord = -1;
  detail.activeChars = -1;

  detail.cues.forEach((cue) => {
    const enRow = h('button', { class: 'detail-cue', type: 'button', onclick: () => seekDetail(cue) },
      h('span', { class: 'detail-time' }, formatTimestamp(cue.start)));
    const enLine = h('span', { class: 'detail-en' });
    const wordNodes = [];
    for (const [wordIndex, word] of (cue.words || []).entries()) {
      const node = h('span', { class: 'word' }, word.text);
      wordNodes.push(node);
      enLine.append(node);
      if (wordIndex < cue.words.length - 1) enLine.append(document.createTextNode(' '));
    }
    if (!wordNodes.length) enLine.textContent = cue.en;
    enRow.append(enLine);

    const zhRow = h('button', { class: 'detail-cue', type: 'button', onclick: () => seekDetail(cue) },
      h('span', { class: 'detail-time' }, formatTimestamp(cue.start)));
    const zhLine = h('span', { class: 'detail-zh' });
    const chars = [];
    if (cue.zh) {
      for (const char of Array.from(cue.zh)) {
        const span = h('span', { class: 'zh-char' }, char === ' ' ? '\u00a0' : char);
        chars.push(span);
        zhLine.append(span);
      }
    } else {
      zhLine.textContent = detail.translating ? '…' : '—';
    }
    zhRow.append(zhLine);
    detailCueEls.push({ en: enRow, zh: zhRow });
    detailWordEls.push(wordNodes);
    detailCharEls.push(chars);
    detailEn.append(enRow);
    detailZh.append(zhRow);
  });
  syncDetail();
}

async function translateDetail() {
  if (detail.translating || !detail.cues.length || !detail.item) return;
  detail.translating = true;
  detailTranslate.classList.add('hidden');
  detailStatus.textContent = '正在自动翻译中文字幕…';
  const request = ++detail.translateSeq;
  const totalChunks = Math.ceil(detail.cues.length / 200);
  try {
    const settings = getSettings();
    const useAI = aiReady(settings);
    let engine = useAI ? 'ai' : 'google';
    let zh;
    if (useAI) {
      try {
        zh = [];
        for (let index = 0; index < detail.cues.length; index += 200) {
          const part = detail.cues.slice(index, index + 200);
          detailStatus.textContent = `正在翻译中文字幕 ${Math.floor(index / 200) + 1}/${totalChunks}…`;
          const data = await translateVideoCaptions(detail.item.id, part, { settings });
          const lines = Array.isArray(data.zh) ? data.zh : [];
          if (lines.length !== part.length) throw new Error('翻译条数不一致');
          zh.push(...lines);
        }
      } catch {
        engine = 'google';
        zh = null;
      }
    }
    if (!zh) {
      zh = [];
      for (let index = 0; index < detail.cues.length; index += 200) {
        const part = detail.cues.slice(index, index + 200);
        detailStatus.textContent = `正在翻译中文字幕 ${Math.floor(index / 200) + 1}/${totalChunks}…`;
        const data = await translateVideoCaptionsFree(detail.item.id, part);
        const lines = Array.isArray(data.zh) ? data.zh : [];
        if (lines.length !== part.length) throw new Error('翻译条数不一致');
        zh.push(...lines);
      }
    }
    if (request !== detail.translateSeq) return;
    detail.cues.forEach((cue, index) => { cue.zh = zh[index] || ''; });
    renderDetailSubtitles();
    detailStatus.textContent = `共 ${detail.cues.length} 句 · 英文逐词 · ${engine === 'ai' ? 'AI 中文字幕' : '自动中文字幕'}`;
  } catch (error) {
    if (request !== detail.translateSeq) return;
    detailStatus.textContent = '中文自动翻译失败';
    detailTranslate.classList.remove('hidden');
    detailTranslate.textContent = '重试翻译';
    toast(error.message || '视频字幕翻译失败', 'err', 3600);
  } finally {
    if (request === detail.translateSeq) detail.translating = false;
  }
}

function detailChatEmpty() {
  detailMessages.replaceChildren(h('div', { class: 'detail-empty' },
    h('strong', {}, detail.chatAvailable ? '问 Agent 这段视频' : '配置 API Key 后开始对话'),
    detail.chatAvailable ? h('p', {}, '可以问语法、词汇、总结或让 Agent 解释当前句。') : h('p', {}, h('a', { href: '/videos.html?view=settings', onclick: (event) => {
      event.preventDefault();
      setView('settings');
    } }, '去设置 →')),
  ));
}

function detailAddMessage(role, text, options = {}) {
  const bubble = h('div', { class: `detail-msg ${role}${options.pending ? ' pending' : ''}${options.error ? ' error' : ''}` }, text);
  detailMessages.append(bubble);
  detailMessages.scrollTop = detailMessages.scrollHeight;
  return bubble;
}

async function setupDetailChat(item) {
  detail.chat = [];
  detail.chatAvailable = false;
  detailChatInput.disabled = true;
  detailChatSend.disabled = true;
  detailChatInput.placeholder = '读取 Agent 状态…';
  detailMessages.replaceChildren(h('div', { class: 'detail-empty' }, '正在检查模型配置…'));
  await getHealth(true).catch(() => null);
  if (!state.detailOpen || detail.item?.id !== item.id) return;
  detail.chatAvailable = aiReady(getSettings());
  detailChatInput.disabled = !detail.chatAvailable;
  detailChatSend.disabled = !detail.chatAvailable;
  detailChatInput.placeholder = detail.chatAvailable ? '问 Agent：解释当前句 / 总结这段视频' : '配置 API Key 后与 Agent 对话';
  detailChatEmpty();
}

function detailContext() {
  const cues = detail.cues;
  const now = Number(detail.player?.getCurrentTime?.()) || 0;
  let index = cues.findIndex((cue) => now >= cue.start && now < cue.end);
  if (index < 0) index = cues.findIndex((cue) => cue.start >= now);
  if (index < 0) index = Math.max(0, cues.length - 1);
  const full = cues.map((cue) => `[${formatTimestamp(cue.start)}] ${cue.en}${cue.zh ? ` / ${cue.zh}` : ''}`).join('\n');
  const transcript = full.length <= 12_000 ? full : `${full.slice(0, 6000)}\n[... omitted ...]\n${full.slice(-3000)}`;
  const current = cues[index];
  return [
    'You are the EnOS video learning agent. Help a Chinese IELTS learner understand a YouTube video.',
    'Answer in Simplified Chinese unless asked otherwise. Quote the original line when explaining.',
    `Video: ${detail.item?.title || ''} · ${detail.item?.channel || ''}`,
    `Current line: ${current ? current.en : '(none)'}`,
    `Transcript:\n${transcript || '(subtitles still loading)'}`,
  ].join('\n');
}

async function sendDetailChat(text) {
  const question = String(text || '').trim();
  if (!question || detail.chatBusy || !detail.chatAvailable || !detail.item) return;
  detail.chatBusy = true;
  detailChatSend.disabled = true;
  detailChatInput.value = '';
  detailMessages.querySelector('.detail-empty')?.remove();
  detailAddMessage('user', question);
  detail.chat.push({ role: 'user', content: question });
  const bubble = detailAddMessage('assistant', '', { pending: true });
  const itemId = detail.item.id;
  try {
    const full = await chatStream({
      messages: [{ role: 'system', content: detailContext() }, ...detail.chat.slice(-10)],
      maxTokens: 900,
      temperature: 0.45,
      onDelta: (partial) => {
        if (detail.item?.id !== itemId) return;
        bubble.classList.remove('pending');
        bubble.textContent = partial;
        detailMessages.scrollTop = detailMessages.scrollHeight;
      },
    });
    if (detail.item?.id !== itemId) return;
    bubble.classList.remove('pending');
    bubble.textContent = full || '（Agent 没有返回内容）';
    if (full) detail.chat.push({ role: 'assistant', content: full });
  } catch (error) {
    bubble.classList.remove('pending');
    bubble.classList.add('error');
    bubble.textContent = `请求失败：${error.message || '请稍后重试'}`;
  } finally {
    detail.chatBusy = false;
    detailChatSend.disabled = false;
    detailChatInput.focus();
  }
}

function bindDetailResize() {
  let ratio = 58;
  try {
    const saved = Number(localStorage.getItem(DETAIL_WIDTH_KEY));
    if (Number.isFinite(saved) && saved >= 36 && saved <= 72) ratio = saved;
  } catch { /* ignore */ }
  detailBody.style.setProperty('--detail-left', `${ratio}%`);
  const apply = (value, save = true) => {
    ratio = Math.min(72, Math.max(36, value));
    detailBody.style.setProperty('--detail-left', `${ratio}%`);
    if (save) {
      try { localStorage.setItem(DETAIL_WIDTH_KEY, String(Math.round(ratio))); } catch { /* ignore */ }
    }
  };
  detailResize.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const rect = detailBody.getBoundingClientRect();
    const startX = event.clientX;
    const startRatio = ratio;
    let finished = false;
    try { detailResize.setPointerCapture(event.pointerId); } catch { /* ignore */ }
    const move = (moveEvent) => {
      if (moveEvent.cancelable) moveEvent.preventDefault();
      const next = startRatio + ((moveEvent.clientX - startX) / rect.width) * 100;
      apply(next, false);
    };
    const finish = () => {
      if (finished) return;
      finished = true;
      window.removeEventListener('pointermove', move);
      apply(ratio, true);
      try { detailResize.releasePointerCapture(event.pointerId); } catch { /* ignore */ }
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', finish, { once: true });
    window.addEventListener('pointercancel', finish, { once: true });
  });
  detailResize.addEventListener('dblclick', () => apply(58));
}

function exportDetailMarkdown() {
  if (!detail.item || !detail.cues.length) {
    toast('还没有可导出的字幕', 'err', 2400);
    return;
  }
  const esc = (value) => String(value || '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
  const title = detail.item.title || 'YouTube video';
  const lines = [
    `# ${esc(title)}`,
    '',
    `- 频道：${esc(detail.item.channel || '—')}`,
    `- 视频：https://www.youtube.com/watch?v=${detail.item.id}`,
    `- 时长：${detail.item.duration || '—'}`,
    `- 导出：${new Date().toISOString().slice(0, 10)} · EnOS`,
    '',
    '## 中英字幕',
    '',
    '| 时间 | English | 中文 |',
    '| --- | --- | --- |',
    ...detail.cues.map((cue) => `| ${formatTimestamp(cue.start)} | ${esc(cue.en)} | ${esc(cue.zh || '—')} |`),
    '',
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const safe = title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || detail.item.id;
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${safe}-bilingual.md`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  toast('Markdown 已导出', 'ok', 2400);
}

detailBack.addEventListener('click', () => closeVideoDetail());
bookBack.addEventListener('click', () => closeBookReader());
detailTranslate.addEventListener('click', translateDetail);
detailExport.addEventListener('click', exportDetailMarkdown);
detailChatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  sendDetailChat(detailChatInput.value);
});
detailChatInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    detailChatForm.requestSubmit();
  }
});
bindDetailResize();

function renderLoading() {
  treeCount.textContent = '正在解析频道…';
  channelList.replaceChildren(h('div', { class: 'tree-empty' }, '正在加载频道树…'));
  previewTitle.textContent = '正在搜索';
  previewSubtitle.textContent = '读取 YouTube 结果、缩略图与频道信息';
  previewSource.textContent = '';
  results.replaceChildren(h('div', { class: 'preview-skeleton-grid' },
    Array.from({ length: 4 }, () => h('div', { class: 'skeleton preview-skeleton' })),
  ));
}

function renderError(error, query) {
  previewTitle.textContent = '搜索没有完成';
  previewSubtitle.textContent = error.message || '无法连接 YouTube';
  previewSource.textContent = '';
  treeCount.textContent = '频道暂时不可用';
  channelList.replaceChildren(h('div', { class: 'tree-empty' }, '搜索失败，频道列表暂时为空。'));
  results.replaceChildren(h('div', { class: 'preview-empty' },
    h('div', {},
      h('h2', {}, '搜索没有完成'),
      h('p', {}, error.message || '无法连接 YouTube。'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => runSearch(query) }, '重试'),
        h('a', { class: 'btn btn-ghost btn-sm', href: '/videos.html?view=settings', onclick: (event) => {
          event.preventDefault();
          setView('settings');
        } }, '去设置'),
      ),
    ),
  ));
}

async function runSearch(rawQuery, { updateUrl = true } = {}) {
  const query = String(rawQuery || input.value || '').trim();
  if (query.length < 2) {
    toast('请输入至少 2 个字符的关键词。', 'err');
    input.focus();
    return;
  }
  input.value = query;
  state.query = query;
  state.loading = true;
  if (updateUrl) setQueryInUrl(query);
  renderLoading();
  try {
    const data = await searchVideos(query, { settings: getSettings(), maxResults: 24 });
    state.meta = data;
    state.items = Array.isArray(data.items) ? data.items : [];
    state.channels = groupChannels(state.items);
    state.selectedChannel = 'all';
    state.expanded.clear();
    state.loading = false;
    renderChannels();
    renderPreviews();
    document.title = `${query} · 视频工作台 · EnOS`;
  } catch (error) {
    state.loading = false;
    state.items = [];
    state.channels = [];
    state.meta = { source: '' };
    renderError(error, query);
    toast(error.message || '搜索失败', 'err', 4200);
  }
}

function bookInitials(book) {
  const words = String(book.short || book.magazine || 'BOOKS').split(/\s+/).filter((word) => word && !/^THE$/i.test(word));
  return words.slice(0, 2).map((word) => word[0]).join('').toUpperCase() || 'BK';
}

function renderBooksTree() {
  if (state.tab !== 'books' || state.view !== 'videos') return;
  channelList.replaceChildren();
  const total = bookState.books.length;
  treeCount.textContent = total ? `${bookState.channels.length} 本外刊 · ${total} 期` : '正在读取目录';

  channelList.append(h('div', { class: 'tree-node' },
    h('div', { class: 'tree-row' },
      h('button', {
        class: `tree-main${bookState.selectedCategory === 'all' ? ' active' : ''}`,
        type: 'button',
        onclick: () => selectBookCategory('all'),
      },
      h('span', { class: 'tree-avatar' }, '全'),
      h('span', { class: 'tree-name' }, '全部外刊'),
      h('span', { class: 'tree-count' }, String(total))),
    ),
  ));

  for (const channel of bookState.channels) {
    channelList.append(h('div', { class: 'tree-node' },
      h('div', { class: 'tree-row' },
        h('button', {
          class: `tree-main${bookState.selectedCategory === channel.id ? ' active' : ''}`,
          type: 'button',
          onclick: () => selectBookCategory(channel.id),
        },
        h('span', { class: 'tree-avatar', style: `background:${channel.accent};color:#fff` }, bookInitials(channel)),
        h('span', { class: 'tree-name' }, channel.name),
        h('span', { class: 'tree-count' }, String(channel.count || 0))),
      ),
    ));
  }
}

function selectBookCategory(id) {
  bookState.selectedCategory = id;
  if (bookState.readerOpen) closeBookReader({ restore: false });
  renderTabState();
}

function renderBooksGrid() {
  if (state.tab !== 'books' && !bookState.readerOpen) return;
  const all = bookState.books;
  const items = bookState.selectedCategory === 'all'
    ? all
    : all.filter((book) => book.category === bookState.selectedCategory);
  const label = bookState.selectedCategory === 'all'
    ? '全部外刊'
    : bookState.channels.find((channel) => channel.id === bookState.selectedCategory)?.name || '外刊';
  booksSubtitle.textContent = bookState.loading
    ? '正在读取 GitHub 图书目录…'
    : bookState.error
      ? bookState.error
      : `${label} · ${items.length} 期 · 按最新日期排序`;
  booksGrid.replaceChildren();
  if (bookState.loading && !all.length) {
    booksGrid.append(h('div', { class: 'books-empty' }, '正在读取 GitHub 目录…'));
    return;
  }
  if (bookState.error && !all.length) {
    booksGrid.append(h('div', { class: 'books-empty' }, bookState.error));
    return;
  }
  if (!items.length) {
    booksGrid.append(h('div', { class: 'books-empty' }, '这个分类下暂时没有可读的书。'));
    return;
  }
  for (const book of items) {
    const cover = h('div', {
      class: 'book-cover',
      style: `background:linear-gradient(145deg, ${book.accent} 0%, #171411 135%)`,
    },
    h('span', { class: 'book-mag' }, book.short),
    h('span', { class: 'book-initial' }, bookInitials(book)),
    h('span', { class: 'book-date' }, book.date));
    const formats = book.formats.map((format) => h('span', { class: `book-format ${format.format}` }, `${format.format.toUpperCase()}${format.sizeLabel ? ` · ${format.sizeLabel}` : ''}`));
    booksGrid.append(h('button', {
      class: 'book-card',
      type: 'button',
      title: book.title,
      onclick: () => openBook(book),
    },
    cover,
    h('div', { class: 'book-card-body' },
      h('h2', {}, book.title),
      h('p', { class: 'book-sub' }, `${book.magazine} · ${book.formats.length} 种格式`),
      h('div', { class: 'book-formats' }, formats),
      h('span', { class: 'book-read' }, book.readable ? '阅读 EPUB →' : '下载 →'),
    )));
  }
}

async function ensureBooks() {
  if (bookState.initialized) return;
  if (bookState.loading) return;
  bookState.loading = true;
  bookState.error = '';
  renderBooksGrid();
  try {
    const data = await getBooks();
    bookState.data = data;
    bookState.books = Array.isArray(data.books) ? data.books : [];
    bookState.channels = Array.isArray(data.channels) ? data.channels : [];
    bookState.initialized = true;
    bookState.error = '';
  } catch (error) {
    bookState.error = error.message || '图书目录加载失败';
    toast(bookState.error, 'err', 4200);
  } finally {
    bookState.loading = false;
    if (state.tab === 'books') {
      renderBooksTree();
      renderBooksGrid();
    }
  }
}

function bookDownloadLink(book, format) {
  return h('a', {
    href: bookFileUrl(book.category, book.date, format.format),
    download: `${book.magazine.replace(/[^\w.-]+/g, '_')}_${book.date}.${format.format}`,
    title: `下载 ${format.format.toUpperCase()}${format.sizeLabel ? ` · ${format.sizeLabel}` : ''}`,
  }, format.format.toUpperCase());
}

function renderBookActions(book) {
  bookActions.replaceChildren(
    ...book.formats.map((format) => bookDownloadLink(book, format)),
    h('a', { href: book.sourceUrl, target: '_blank', rel: 'noopener noreferrer' }, 'GitHub ↗'),
  );
}

function renderBookToc() {
  bookToc.replaceChildren();
  bookState.chapters.forEach((chapter, index) => {
    bookToc.append(h('button', {
      class: `book-toc-item${index === bookState.active ? ' active' : ''}`,
      type: 'button',
      onclick: () => showBookChapter(index),
    },
    chapter.title,
    h('small', {}, `${chapter.wordCount.toLocaleString()} words`)));
  });
}

function showBookChapter(index) {
  if (!bookState.chapters.length) return;
  const next = Math.min(bookState.chapters.length - 1, Math.max(0, index));
  bookState.active = next;
  const chapter = bookState.chapters[next];
  const article = h('div', { class: 'book-article' },
    h('p', { class: 'book-chapter-kicker' }, `CHAPTER ${next + 1} / ${bookState.chapters.length} · ${bookState.item?.magazine || ''}`),
    h('h1', { class: 'book-chapter-title' }, chapter.title),
    ...chapter.blocks.map((block) => {
      if (block.type === 'heading') return h('h2', { class: 'book-block heading' }, block.text);
      if (block.type === 'bullet') return h('p', { class: 'book-block bullet' }, block.text);
      return h('p', { class: 'book-block' }, block.text);
    }),
    h('div', { class: 'book-chapter-nav' },
      h('button', {
        type: 'button',
        disabled: next === 0,
        onclick: () => showBookChapter(next - 1),
      }, '← 上一章'),
      h('button', {
        type: 'button',
        disabled: next === bookState.chapters.length - 1,
        onclick: () => showBookChapter(next + 1),
      }, '下一章 →'),
    ),
  );
  bookContent.replaceChildren(article);
  bookContent.scrollTop = 0;
  renderBookToc();
  requestAnimationFrame(() => {
    bookToc.querySelector('.book-toc-item.active')?.scrollIntoView({ block: 'nearest' });
  });
}

async function openBook(book) {
  if (!book.readable) {
    window.location.href = bookFileUrl(book.category, book.date, book.primaryFormat);
    return;
  }
  bookState.readerOpen = true;
  bookState.item = book;
  bookState.chapters = [];
  bookState.active = 0;
  bookState.loadingBook = true;
  bookState.requestSeq += 1;
  const request = bookState.requestSeq;
  bookTitle.textContent = book.title;
  bookMeta.textContent = `${book.magazine} · ${book.date} · 正在下载 EPUB${book.epub?.sizeLabel ? ` (${book.epub.sizeLabel})` : ''}…`;
  renderBookActions(book);
  bookToc.replaceChildren(h('div', { class: 'books-empty' }, '读取目录…'));
  bookContent.replaceChildren(h('div', { class: 'book-loading' },
    h('strong', {}, '正在打开这本外刊'),
    h('p', {}, '首次阅读会从 GitHub 下载 EPUB 并解析章节；大文件可能需要 30–60 秒，之后会使用缓存。'),
  ));
  renderTabState();
  try {
    const data = await readBook(book.category, book.date);
    if (request !== bookState.requestSeq) return;
    const parsed = data.book || {};
    bookState.chapters = Array.isArray(data.chapters) ? data.chapters : [];
    bookState.active = 0;
    bookTitle.textContent = parsed.title || book.title;
    bookMeta.textContent = `${parsed.magazine || book.magazine} · ${parsed.date || book.date} · ${bookState.chapters.length} 章 · ${(parsed.wordCount || 0).toLocaleString()} words`;
    renderBookActions(book);
    if (!bookState.chapters.length) throw new Error('这本书没有可阅读章节');
    showBookChapter(0);
  } catch (error) {
    if (request !== bookState.requestSeq) return;
    bookMeta.textContent = `${book.magazine} · ${book.date}`;
    bookToc.replaceChildren();
    bookContent.replaceChildren(h('div', { class: 'book-error' },
      h('strong', {}, '这本外刊暂时打不开'),
      h('p', {}, error.message || 'EPUB 解析失败，可以先下载到本地阅读。'),
    ));
  } finally {
    if (request === bookState.requestSeq) bookState.loadingBook = false;
  }
}

function closeBookReader({ restore = true } = {}) {
  bookState.readerOpen = false;
  bookState.requestSeq += 1;
  bookState.item = null;
  bookState.chapters = [];
  bookState.active = 0;
  if (restore) renderTabState();
}

function setTreeCollapsed(value) {
  state.treeCollapsed = Boolean(value);
  workspace.classList.toggle('tree-collapsed', state.treeCollapsed);
  document.getElementById('channel-tree').inert = state.treeCollapsed;
  treeOpen.setAttribute('aria-expanded', String(!state.treeCollapsed));
  updateTreeOpen();
  try { localStorage.setItem(TREE_KEY, state.treeCollapsed ? '1' : '0'); } catch { /* ignore */ }
}

function updateTreeOpen() {
  const mediaTab = state.tab === 'youtube' || state.tab === 'podcast' || state.tab === 'books';
  treeOpen.classList.toggle('hidden', !(state.treeCollapsed && state.view === 'videos' && mediaTab));
}

function renderTabState() {
  const youtube = state.tab === 'youtube';
  const podcastTab = state.tab === 'podcast';
  const booksTab = state.tab === 'books';
  const showMedia = state.view === 'videos' && (youtube || podcastTab || booksTab);
  const showDetail = showMedia && youtube && state.detailOpen;
  const showBookReader = showMedia && booksTab && bookState.readerOpen;
  mediaView.classList.toggle('hidden', !showMedia);
  youtubePane.classList.toggle('hidden', !(showMedia && youtube && !showDetail));
  videoDetail.classList.toggle('hidden', !showDetail);
  podcastPane.classList.toggle('hidden', !(showMedia && podcastTab));
  booksPane.classList.toggle('hidden', !(showMedia && booksTab && !showBookReader));
  bookReader.classList.toggle('hidden', !showBookReader);
  tabEmpty.classList.add('hidden');
  if (showMedia) {
    treeEyebrow.textContent = youtube ? 'CHANNELS' : booksTab ? 'LIBRARY' : 'PODCAST CHANNELS';
    treeTitle.textContent = youtube ? '频道' : booksTab ? '外刊' : '播客频道';
    if (youtube) renderChannels();
    else if (booksTab) renderBooksTree();
    else renderPodcastTree();
  }
  updateTreeOpen();
  if (podcastTab) ensurePodcast();
  if (booksTab) {
    if (!bookState.readerOpen) renderBooksGrid();
    ensureBooks();
  }
}

async function ensureStudioSettings() {
  if (settingsReady) return;
  settingsReady = true;
  settingsView.replaceChildren(h('p', { class: 'settings-loading' }, '正在加载设置…'));
  try {
    await getHealth().catch(() => null);
    const settings = await renderSettings({
      navigate: () => setView('videos'),
      updateStatusPill: () => { chat.initialized = false; },
    });
    settingsView.replaceChildren(settings.el);
  } catch (error) {
    settingsReady = false;
    settingsView.replaceChildren(h('div', { class: 'settings-loading' },
      h('p', {}, error.message || '设置加载失败'),
      h('button', { class: 'btn btn-soft', type: 'button', onclick: ensureStudioSettings }, '重试'),
    ));
  }
}

function updateRailSelection() {
  const choices = [
    ...[...document.querySelectorAll('.studio-tab')].map((button) => [button, state.view === 'videos' && button.dataset.tab === state.tab]),
    [railChat, state.view === 'chat'],
    [railSettings, state.view === 'settings'],
  ];
  for (const [button, active] of choices) {
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
    if (button.dataset.tab) {
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = button.dataset.tab === state.tab ? 0 : -1;
    }
  }
}

function setView(view) {
  state.view = view;
  const videos = view === 'videos';
  const chatting = view === 'chat';
  const configuring = view === 'settings';
  updateRailSelection();
  chatView.classList.toggle('hidden', !chatting);
  settingsView.classList.toggle('hidden', !configuring);
  const url = new URL(window.location.href);
  if (videos) url.searchParams.delete('view');
  else url.searchParams.set('view', view);
  window.history.replaceState(null, '', url);
  if (!videos) {
    mediaView.classList.add('hidden');
    tabEmpty.classList.add('hidden');
    podcastAudio.pause();
    if (state.detailOpen) closeVideoDetail({ restore: false });
    if (bookState.readerOpen) closeBookReader({ restore: false });
    if (chatting) {
      chat.initialized = false;
      ensureChat();
    } else if (configuring) ensureStudioSettings();
    updateTreeOpen();
    return;
  }
  renderTabState();
}

function setTab(tab) {
  if (state.tab === 'podcast' && tab !== 'podcast') podcastAudio.pause();
  if (state.tab === 'youtube' && tab !== 'youtube' && state.detailOpen) closeVideoDetail({ restore: false });
  if (state.tab === 'books' && tab !== 'books' && bookState.readerOpen) closeBookReader({ restore: false });
  state.tab = tab;
  updateRailSelection();
  const url = new URL(window.location.href);
  if (tab === 'youtube') url.searchParams.delete('tab');
  else url.searchParams.set('tab', tab);
  window.history.replaceState(null, '', url);
  if (state.view !== 'videos') setView('videos');
  else renderTabState();
}

/* ---------- conversation view ---------- */

const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatSend = document.getElementById('chat-send');
const chat = { initialized: false, available: false, busy: false, history: [] };

function chatScroll() {
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function chatEmptyNode() {
  return h('div', { class: 'chat-empty' },
    h('strong', {}, chat.available ? '开始一段对话' : '配置 API Key 后开始对话'),
    h('p', {}, chat.available
      ? '可以问语法、词汇、写作，或让 Agent 解释一段英文。'
      : '尚未配置模型 Key。'),
    chat.available ? null : h('p', {}, h('a', { href: '/videos.html?view=settings', onclick: (event) => {
      event.preventDefault();
      setView('settings');
    } }, '去设置 →')),
  );
}

function renderChatEmpty() {
  if (chat.history.length) return;
  chatMessages.replaceChildren(chatEmptyNode());
}

function addChat(role, text, options = {}) {
  const bubble = h('div', { class: `chat-msg ${role}${options.pending ? ' pending' : ''}${options.error ? ' error' : ''}` }, text);
  chatMessages.append(bubble);
  chatScroll();
  return bubble;
}

async function ensureChat() {
  if (chat.initialized) {
    if (chat.available) chatInput.focus();
    return;
  }
  chat.initialized = true;
  await getHealth(true).catch(() => null);
  chat.available = aiReady(getSettings());
  chatInput.disabled = !chat.available;
  chatSend.disabled = !chat.available;
  chatInput.placeholder = chat.available ? '问 Agent：帮我解释这段英文…' : '配置 API Key 后与 Agent 对话';
  renderChatEmpty();
  if (chat.available) chatInput.focus();
}

async function sendChat(text) {
  const question = String(text || '').trim();
  if (!question || chat.busy || !chat.available) return;
  chat.busy = true;
  chatSend.disabled = true;
  chatInput.value = '';
  chatMessages.querySelector('.chat-empty')?.remove();
  addChat('user', question);
  chat.history.push({ role: 'user', content: question });
  const bubble = addChat('assistant', '', { pending: true });

  try {
    const full = await chatStream({
      messages: [
        { role: 'system', content: 'You are EnOS, a concise bilingual study assistant for IELTS learners. Answer in Simplified Chinese unless asked otherwise. Explain grammar or vocabulary with short examples; do not invent sources.' },
        ...chat.history.slice(-10),
      ],
      maxTokens: 900,
      temperature: 0.5,
      onDelta: (partial) => {
        bubble.classList.remove('pending');
        bubble.textContent = partial;
        chatScroll();
      },
    });
    bubble.classList.remove('pending');
    bubble.textContent = full || '（Agent 没有返回内容）';
    if (full) chat.history.push({ role: 'assistant', content: full });
    chatScroll();
  } catch (error) {
    bubble.classList.remove('pending');
    bubble.classList.add('error');
    bubble.textContent = `请求失败：${error.message || '请稍后重试'}`;
  } finally {
    chat.busy = false;
    chatSend.disabled = false;
    chatInput.focus();
  }
}

/* ---------- events + boot ---------- */

form.addEventListener('submit', (event) => {
  event.preventDefault();
  runSearch();
});

railChat.addEventListener('click', () => setView('chat'));
railSettings.addEventListener('click', () => setView('settings'));
treeCollapse.addEventListener('click', () => setTreeCollapsed(true));
treeOpen.addEventListener('click', () => setTreeCollapsed(false));

for (const button of document.querySelectorAll('.studio-tab')) {
  button.addEventListener('click', () => setTab(button.dataset.tab));
  button.addEventListener('keydown', (event) => {
    const tabs = [...document.querySelectorAll('.studio-tab')];
    const index = tabs.indexOf(button);
    const next = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? (index - 1 + tabs.length) % tabs.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    tabs[next].focus();
    setTab(tabs[next].dataset.tab);
  });
}
document.getElementById('channel-scrim').addEventListener('click', () => setTreeCollapsed(true));
channelList.addEventListener('click', (event) => {
  if (compactViewport.matches && event.target.closest('.tree-main, .tree-video')) setTreeCollapsed(true);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    document.getElementById('podcast-sync-settings').open = false;
    if (compactViewport.matches && !state.treeCollapsed) {
      setTreeCollapsed(true);
      treeOpen.focus();
    }
  }
});
compactViewport.addEventListener('change', (event) => setTreeCollapsed(event.matches));

chatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  sendChat(chatInput.value);
});
chatInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});
chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = `${Math.min(110, chatInput.scrollHeight)}px`;
});

try { state.treeCollapsed = localStorage.getItem(TREE_KEY) === '1'; } catch { /* ignore */ }
setTreeCollapsed(compactViewport.matches || state.treeCollapsed);

if (params.get('debug') === '1') {
  window.__VIDEOS_DEBUG__ = {
    render(items, meta = {}) {
      state.items = items;
      state.meta = { source: meta.source || 'youtube-web', warning: meta.warning || '', cached: false };
      state.query = meta.query || input.value || 'debug';
      state.channels = groupChannels(items);
      state.selectedChannel = 'all';
      state.expanded.clear();
      setTab('youtube');
      setView('videos');
      renderChannels();
      renderPreviews();
    },
    setPodcastData(data) {
      const { channel, episode } = data;
      podcast.initialized = true;
      podcast.channels = [channel];
      podcast.episodes.set(channel.id, [episode]);
      podcast.expanded.add(channel.id);
      podcast.selectedChannel = channel.id;
      podcast.selectedEpisode = episode;
      podcastAudio.pause();
      podcastAudio.dataset.episode = episode.id;
      podcastAudio.src = data.audio;
      setPodcastInfo(channel, episode);
      podcastAudio.load();
      podcast.cues = normalizeCues(data.cues || []);
      setTab('podcast');
      renderPodcastSubtitles();
      podcastStatus.textContent = `共 ${podcast.cues.length} 句 · 双语字幕`;
    },
    get podcastState() {
      return { activeCue: podcast.activeCue, activeWord: podcast.activeWord, offset: podcast.offset, follow: podcast.follow };
    },
    get state() { return { items: state.items, meta: state.meta, channels: state.channels }; },
  };
  renderChannels();
  renderPreviews();
} else if (!['settings', 'chat'].includes(params.get('view'))) {
  const initial = params.get('q') || '';
  const initialTab = params.get('tab');
  if (initialTab === 'podcast' || initialTab === 'books') {
    setTab(initialTab);
  } else if (initial) {
    input.value = initial;
    runSearch(initial, { updateUrl: false });
  } else {
    runSearch('IELTS listening', { updateUrl: false });
  }
}

if (['settings', 'chat'].includes(params.get('view'))) setView(params.get('view'));

window.addEventListener('error', (event) => {
  if (event.error?.name === 'AbortError') return;
  console.error(event.error || event.message);
});

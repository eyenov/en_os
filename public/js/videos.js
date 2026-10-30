import { searchVideos } from './api.js';
import { getSettings } from './store.js';
import { h, icon, toast } from './ui.js';

const form = document.getElementById('video-search');
const input = document.getElementById('video-q');
const results = document.getElementById('video-results');
const examples = document.getElementById('video-examples');
const params = new URLSearchParams(window.location.search);
let currentItems = [];
let currentMeta = null;

const SUGGESTIONS = [
  'TED-Ed',
  'BBC Learning English',
  'IELTS listening practice',
  'National Geographic',
  'Science explainer',
  'The Economist',
];

function setQueryInUrl(query) {
  const url = new URL(window.location.href);
  if (query) url.searchParams.set('q', query);
  else url.searchParams.delete('q');
  window.history.replaceState(null, '', url);
}

function sourceLabel(source) {
  return source === 'youtube-api' ? 'YouTube Data API' : 'YouTube 网页检索';
}

function card(item, query) {
  const href = `/watch.html?v=${encodeURIComponent(item.id)}${query ? `&q=${encodeURIComponent(query)}` : ''}`;
  const meta = [item.views, item.published].filter(Boolean).join(' · ');
  const image = h('img', {
    src: item.thumbnail || `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`,
    alt: '',
    loading: 'lazy',
    decoding: 'async',
    referrerpolicy: 'no-referrer',
  });
  image.addEventListener('error', () => { image.style.display = 'none'; });
  return h('a', { class: 'video-card', href, title: item.title },
    h('div', { class: 'video-thumb' },
      image,
      item.duration ? h('span', { class: 'video-duration' }, item.duration) : null,
      item.hasCaptions ? h('span', { class: 'video-cc' }, 'CC') : null,
      h('span', { class: 'video-play' }, h('span', { html: icon('play', 18) })),
    ),
    h('div', { class: 'video-body' },
      h('div', { class: 'video-title' }, item.title),
      h('div', { class: 'video-channel' }, item.channel || 'YouTube'),
      h('div', { class: 'video-meta' }, meta || '打开视频查看字幕'),
    ),
  );
}

function renderResults(data, query) {
  currentMeta = data;
  currentItems = data.items || [];
  results.replaceChildren();
  const head = h('div', { class: 'video-results-head' },
    h('div', {},
      h('h2', {}, `“${query}” 的结果`),
      h('p', {}, `${currentItems.length} 个视频 · 来源：${sourceLabel(data.source)}${data.cached ? ' · 缓存' : ''}`),
    ),
    h('span', { class: 'video-source' }, h('i'), data.source === 'youtube-api' ? 'API 检索' : '网页解析'),
  );
  results.append(head);
  if (data.warning) {
    results.append(h('div', { class: 'callout warn', style: 'margin-bottom:14px' },
      h('span', { html: icon('info', 16) }),
      h('span', {}, data.warning),
    ));
  }
  if (!currentItems.length) {
    results.append(h('div', { class: 'video-empty' },
      h('h2', {}, '没有找到视频'),
      h('p', {}, '换一个更具体的关键词；也可以试试搜索 “IELTS listening” 或 “TED-Ed”。'),
      h('div', { class: 'video-examples' }, SUGGESTIONS.slice(0, 3).map((text) => h('button', {
        class: 'chip', type: 'button', onclick: () => runSearch(text),
      }, text))),
    ));
    return;
  }
  results.append(h('div', { class: 'video-grid' }, currentItems.map((item) => card(item, query))));
  if (!currentItems.some((item) => item.hasCaptions)) {
    results.append(h('p', { class: 'small faint', style: 'margin-top:14px' },
      '提示：网页检索能识别部分视频的 CC 标记；打开后如果没有字幕，可以回到结果换一个，或在设置里配置 YouTube Data API Key。'));
  }
}

function renderLanding() {
  results.replaceChildren(h('div', { class: 'video-empty' },
    h('h2', {}, '先找一个你愿意听完的视频'),
    h('p', {}, '搜索英文讲座、新闻、科普或雅思听力材料。打开后，EnOS 会读取视频的公开字幕，按播放进度逐词高亮英文，并尽量提供官方中文翻译。'),
    h('div', { class: 'video-examples' }, SUGGESTIONS.map((text) => h('button', {
      class: 'chip', type: 'button', onclick: () => runSearch(text),
    }, text))),
    h('p', { class: 'tiny faint', style: 'margin-top:4px' }, '提示：搜索结果中的 CC 标记表示该视频可能带字幕。'),
  ));
}

function renderLoading() {
  results.replaceChildren(h('div', { class: 'video-skeleton-grid' },
    Array.from({ length: 6 }, () => h('div', { class: 'skeleton video-skeleton' })),
  ));
}

function renderError(error, query) {
  results.replaceChildren(h('div', { class: 'video-error' },
    h('h2', {}, '搜索没有完成'),
    h('p', {}, error.message || '无法连接 YouTube。'),
    h('div', { class: 'callout warn', style: 'margin-top:4px', html: `${icon('info', 16)}<span>本机 Node 服务需要能访问 YouTube；如果网络受限，可以在设置中配置 YouTube Data API Key，或换一个网络环境再试。</span>` }),
    h('div', { class: 'btn-row', style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:6px' },
      h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => runSearch(query) }, '重试'),
      h('a', { class: 'btn btn-ghost btn-sm', href: '/#/settings' }, '去设置 Key'),
      h('a', { class: 'btn btn-ghost btn-sm', href: 'https://www.youtube.com/results?search_query=' + encodeURIComponent(query), target: '_blank', rel: 'noreferrer' }, '在 YouTube 搜索 ↗'),
    ),
  ));
}

async function runSearch(rawQuery) {
  const query = String(rawQuery || input.value || '').trim();
  if (query.length < 2) {
    toast('请输入至少 2 个字符的关键词。', 'err');
    input.focus();
    return;
  }
  input.value = query;
  setQueryInUrl(query);
  renderLoading();
  const started = performance.now();
  try {
    const data = await searchVideos(query, { settings: getSettings(), maxResults: 24 });
    if (data.items?.length && performance.now() - started < 400) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    renderResults(data, query);
    document.title = `${query} · 视频精听 · EnOS`;
  } catch (error) {
    renderError(error, query);
    toast(error.message || '搜索失败', 'err', 4200);
  }
}

examples.replaceChildren(...SUGGESTIONS.map((text) => h('button', {
  class: 'chip', type: 'button', onclick: () => runSearch(text),
}, text)));

form.addEventListener('submit', (event) => {
  event.preventDefault();
  runSearch();
});

const initial = params.get('q') || '';
if (initial) {
  input.value = initial;
  runSearch(initial);
} else {
  renderLanding();
}

if (params.get('debug') === '1') {
  window.__VIDEOS_DEBUG__ = {
    render(items, meta = {}) {
      renderResults({ items, source: meta.source || 'youtube-web', warning: meta.warning || '' }, meta.query || input.value || 'debug');
    },
    get state() { return { items: currentItems, meta: currentMeta }; },
  };
}

window.addEventListener('error', (event) => {
  if (event.error?.name === 'AbortError') return;
  console.error(event.error || event.message);
});

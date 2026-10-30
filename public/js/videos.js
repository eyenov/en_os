import { aiReady, chatStream, getHealth, searchVideos } from './api.js';
import { getSettings } from './store.js';
import { h, icon, toast } from './ui.js';

const form = document.getElementById('video-search');
const input = document.getElementById('video-q');
const results = document.getElementById('video-results');
const channelList = document.getElementById('channel-list');
const treeCount = document.getElementById('tree-count');
const previewTitle = document.getElementById('preview-title');
const previewSubtitle = document.getElementById('preview-subtitle');
const previewSource = document.getElementById('preview-source');
const videosView = document.getElementById('videos-view');
const chatView = document.getElementById('chat-view');
const tabEmpty = document.getElementById('tab-empty');
const workspace = document.querySelector('.studio-workspace');
const treeOpen = document.getElementById('tree-open');
const treeCollapse = document.getElementById('tree-collapse');
const railVideos = document.getElementById('rail-videos');
const railChat = document.getElementById('rail-chat');
const params = new URLSearchParams(window.location.search);

const SUGGESTIONS = ['TED-Ed', 'BBC Learning English', 'IELTS listening', 'National Geographic', 'Science explainer'];
const TREE_KEY = 'enos.videos.treeCollapsed.v1';

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

  return h('a', { class: 'preview-card', href: watchHref(item), title: item.title },
    h('div', { class: 'preview-thumb' },
      image,
      item.duration ? h('span', { class: 'preview-duration' }, item.duration) : null,
      item.hasCaptions ? h('span', { class: 'preview-cc' }, 'CC') : null,
      h('span', { class: 'preview-play' }, h('span', {}, h('span', { html: icon('play', 14) }))),
    ),
    h('div', { class: 'preview-body' },
      h('div', { class: 'preview-title' }, item.title),
      h('div', { class: 'preview-channel' }, item.channel || 'YouTube'),
      h('div', { class: 'preview-desc' }, item.description || '打开视频后读取字幕、中文翻译与逐词时间轴。'),
      h('div', { class: 'preview-meta' },
        meta.map((text) => h('span', { class: 'preview-chip' }, text)),
        item.hasCaptions ? h('span', { class: 'preview-chip cc' }, '带字幕') : h('span', { class: 'preview-chip' }, '字幕待检测'),
      ),
      h('span', { class: 'preview-open' }, '打开逐词字幕 ↗'),
    ),
  );
}

function renderChannels() {
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
        onclick: () => { window.location.href = watchHref(item); },
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
        h('h2', {}, '从一个频道开始'),
        h('p', {}, '搜索英文讲座、新闻、科普或雅思听力材料。左侧会按频道生成导航树，右侧展示视频预览。'),
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
        h('a', { class: 'btn btn-ghost btn-sm', href: '/#/settings' }, '去设置'),
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

function setTreeCollapsed(value) {
  state.treeCollapsed = Boolean(value);
  workspace.classList.toggle('tree-collapsed', state.treeCollapsed);
  treeOpen.classList.toggle('hidden', !(state.treeCollapsed && state.view === 'videos' && state.tab === 'youtube'));
  try { localStorage.setItem(TREE_KEY, state.treeCollapsed ? '1' : '0'); } catch { /* ignore */ }
}

function updateTreeOpen() {
  treeOpen.classList.toggle('hidden', !(state.treeCollapsed && state.view === 'videos' && state.tab === 'youtube'));
}

function renderTabEmpty() {
  const podcast = state.tab === 'podcast';
  document.getElementById('tab-empty-eyebrow').textContent = 'COMING SOON';
  document.getElementById('tab-empty-title').textContent = podcast ? '播客暂未接入' : '图书暂未接入';
  document.getElementById('tab-empty-text').textContent = podcast
    ? '入口先保留在这里，后续可以接入播客频道与逐句字幕。'
    : '入口先保留在这里，后续可以接入英文图书与章节精读。';
}

function renderTabState() {
  const youtube = state.tab === 'youtube';
  const showVideos = state.view === 'videos' && youtube;
  const showEmpty = state.view === 'videos' && !youtube;
  videosView.classList.toggle('hidden', !showVideos);
  tabEmpty.classList.toggle('hidden', !showEmpty);
  if (showEmpty) renderTabEmpty();
  updateTreeOpen();
}

function setView(view) {
  state.view = view;
  const videos = view === 'videos';
  railVideos.classList.toggle('active', videos);
  railChat.classList.toggle('active', !videos);
  railVideos.setAttribute('aria-current', videos ? 'page' : 'false');
  chatView.classList.toggle('hidden', videos);
  if (!videos) {
    videosView.classList.add('hidden');
    tabEmpty.classList.add('hidden');
    ensureChat();
    updateTreeOpen();
    return;
  }
  renderTabState();
}

function setTab(tab) {
  state.tab = tab;
  for (const button of document.querySelectorAll('.studio-tab')) {
    const active = button.dataset.tab === tab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  }
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
      : '在设置页填入模型 Key，然后刷新页面。'),
    chat.available ? null : h('p', {}, h('a', { href: '/#/settings' }, '去设置 →')),
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

railVideos.addEventListener('click', () => setView('videos'));
railChat.addEventListener('click', () => setView('chat'));
treeCollapse.addEventListener('click', () => setTreeCollapsed(true));
treeOpen.addEventListener('click', () => setTreeCollapsed(false));

for (const button of document.querySelectorAll('.studio-tab')) {
  button.addEventListener('click', () => setTab(button.dataset.tab));
}

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
workspace.classList.toggle('tree-collapsed', state.treeCollapsed);
updateTreeOpen();

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
    get state() { return { items: state.items, meta: state.meta, channels: state.channels }; },
  };
  renderChannels();
  renderPreviews();
} else {
  const initial = params.get('q') || '';
  if (initial) {
    input.value = initial;
    runSearch(initial, { updateUrl: false });
  } else {
    runSearch('IELTS listening', { updateUrl: false });
  }
}

window.addEventListener('error', (event) => {
  if (event.error?.name === 'AbortError') return;
  console.error(event.error || event.message);
});

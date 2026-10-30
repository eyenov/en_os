import { aiReady, fetchVideoCaptions, getHealth, translateVideoCaptions, translateVideoCaptionsFree } from './api.js';
import { getSettings } from './store.js';
import { activeCharCount, cueProgress, findCueIndex, findWordIndex, formatTimestamp, normalizeCues } from './subtitle-sync.js';
import { h, icon, toast } from './ui.js';
import { mountAgent } from './watch-agent.js';

const params = new URLSearchParams(window.location.search);
const videoId = String(params.get('v') || '').trim();
const query = String(params.get('q') || '').trim();
const debug = params.get('debug') === '1';

const head = document.getElementById('watch-head');
const playerMount = document.getElementById('yt-player');
const fallback = document.getElementById('player-fallback');
const timeEl = document.getElementById('player-time');
const syncEl = document.getElementById('player-sync');
const statusEl = document.getElementById('subtitle-status');
const hintEl = document.getElementById('subtitle-hint');
const nowLine = document.getElementById('now-line');
const nowEn = document.getElementById('now-en');
const nowZh = document.getElementById('now-zh');
const subEn = document.getElementById('sub-en');
const columns = document.getElementById('subtitle-columns');
const translateBtn = document.getElementById('translate-btn');
const exportBtn = document.getElementById('export-md');
const autoScrollInput = document.getElementById('auto-scroll');
const openYoutube = document.getElementById('open-youtube');
const backLink = document.getElementById('back-to-search');

let captions = null;
let cues = [];
let player = null;
let playerReady = false;
let duration = 0;
let activeCue = -1;
let activeWord = -1;
let activeChars = -1;
let ticker = null;
let cueEls = [];
let wordEls = [];
let charEls = [];
let translating = false;
let zhState = 'idle';
let currentTime = 0;
let autoScroll = true;

if (backLink) backLink.href = query ? `/videos.html?q=${encodeURIComponent(query)}` : '/videos.html';
if (openYoutube) openYoutube.href = `https://www.youtube.com/watch?v=${videoId}`;

function isValidId(value) {
  return /^[A-Za-z0-9_-]{11}$/.test(value);
}

function wordsOf(cue) {
  if (cue.words?.length) return cue.words;
  const tokens = cue.en.split(/\s+/).filter(Boolean);
  const span = Math.max(0.2, cue.end - cue.start);
  return tokens.map((text, index) => ({
    text,
    start: cue.start + (span * index) / Math.max(1, tokens.length),
    end: cue.start + (span * (index + 1)) / Math.max(1, tokens.length),
  }));
}

function renderHead(data) {
  const title = data?.title || 'YouTube video';
  head.replaceChildren(h('h1', {}, title));
  document.title = `${title} · 逐词字幕 · EnOS`;
  if (data?.thumbnail) {
    const safeThumb = String(data.thumbnail).replace(/["\\\n\r]/g, '');
    fallback.style.backgroundImage = `linear-gradient(rgba(14,13,11,0.82), rgba(14,13,11,0.9)), url("${safeThumb}")`;
  }
  if (data?.durationSeconds) duration = data.durationSeconds;
}

function renderFatal(message) {
  head.replaceChildren(
    h('p', { class: 'eyebrow' }, 'Video'),
    h('h1', {}, '这个视频打不开'),
    h('p', { class: 'lede' }, message),
  );
  columns.replaceChildren(h('div', { class: 'subtitle-empty', style: 'flex:1' },
    h('strong', {}, '没有可显示的字幕'),
    h('p', {}, '回到搜索页重新选择一个视频。'),
    h('a', { class: 'btn btn-primary btn-sm', href: '/videos.html', style: 'margin-top:10px' }, '去搜索视频'),
  ));
  statusEl.textContent = '视频 ID 无效';
  fallback.classList.remove('hidden');
  fallback.replaceChildren(h('p', {}, message));
}

function showEmpty(reason) {
  const messages = {
    NO_CAPTIONS: '上传者没有提供字幕，YouTube 也没有自动识别字幕。',
    CAPTION_FETCH_FAILED: '字幕轨存在，但 YouTube 返回空内容；可能是 PoToken 失效或字幕接口受限。',
    EMPTY_CAPTIONS: '字幕轨为空，暂时无法逐词高亮。',
    LOGIN_REQUIRED: 'YouTube 要求登录 / 机器人验证，通常是当前代理出口或服务器 IP 被标记。',
    VIDEO_UNAVAILABLE: '这个视频当前不可用，可能已删除或受地区限制。',
  };
  statusEl.textContent = messages[reason] || '这个视频没有可用字幕。';
  hintEl.textContent = reason === 'LOGIN_REQUIRED' || reason === 'CAPTION_FETCH_FAILED'
    ? '换一个未被标记的代理出口，或换一个能正常播放的视频'
    : '换一个带 CC 标记的视频试试';
  translateBtn.classList.add('hidden');
  subEn.replaceChildren(h('div', { class: 'subtitle-empty' },
    h('strong', {}, '没有可用字幕'),
    h('p', {}, messages[reason] || '这个视频没有提供字幕。'),
    h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-top:10px' },
      h('button', {
        class: 'btn btn-soft btn-sm',
        type: 'button',
        onclick: () => {
          statusEl.textContent = '重新读取字幕…';
          hintEl.textContent = 'YouTube 的登录验证是瞬时的，稍等几秒可以重试';
          loadCaptions();
        },
      }, '重新读取字幕'),
      h('a', { class: 'btn btn-ghost btn-sm', href: query ? `/videos.html?q=${encodeURIComponent(query)}` : '/videos.html' }, '返回结果换一个'),
    ),
  ));
}

function showCaptionError(error) {
  statusEl.textContent = '字幕加载失败';
  hintEl.textContent = '视频仍可播放，但无法逐词高亮';
  subEn.replaceChildren(h('div', { class: 'subtitle-empty' },
    h('strong', {}, '读取字幕后失败'),
    h('p', {}, error.message || '请稍后重试。'),
    h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => loadCaptions(), style: 'margin-top:10px' }, '重试'),
  ));
}

function renderSubtitles() {
  subEn.replaceChildren();
  cueEls = [];
  wordEls = [];
  charEls = [];
  activeCue = -1;
  activeWord = -1;
  activeChars = -1;
  const hasZh = cues.some((cue) => cue.zh);

  if (!hasZh) {
    const loading = zhState === 'loading';
    const failed = zhState === 'failed';
    subEn.append(h('div', { class: 'subtitle-note' },
      h('strong', {}, loading ? '正在自动翻译中文字幕…' : failed ? '中文自动翻译失败' : '暂无中文字幕'),
      h('span', {}, loading
        ? '英文已经可以逐词高亮，中文稍后补上；不配置 Key 也会用免费翻译。'
        : failed
          ? '可以点「重试翻译」，或到设置页配置模型 Key 后刷新。'
          : '这个视频没有官方中文轨，正在准备自动翻译。'),
    ));
  }

  cues.forEach((cue, index) => {
    const words = wordsOf(cue);
    const wordNodes = [];
    const enLine = h('span', { class: 'cue-en' });
    words.forEach((word, wordIndex) => {
      const node = h('span', {
        class: 'word',
        'data-start': String(word.start),
        title: '跳到这个词',
        onclick: (event) => {
          event.stopPropagation();
          seek(word.start);
        },
      }, word.text);
      wordNodes.push(node);
      enLine.append(node);
      if (wordIndex < words.length - 1) enLine.append(document.createTextNode(' '));
    });

    const zhText = h('span', { class: 'zh-text' });
    const chars = [];
    if (cue.zh) {
      for (const char of Array.from(cue.zh)) {
        const span = h('span', { class: 'zh-char' }, char === ' ' ? '\u00a0' : char);
        chars.push(span);
        zhText.append(span);
      }
    } else {
      zhText.append(document.createTextNode(zhState === 'loading' ? '…' : '—'));
    }

    const row = h('button', {
      class: 'cue',
      type: 'button',
      onclick: () => seek(cue.start),
      'data-index': String(index),
    },
    h('span', { class: 'cue-time' }, formatTimestamp(cue.start)),
    enLine,
    zhText);

    cueEls.push(row);
    wordEls.push(wordNodes);
    charEls.push(chars);
    subEn.append(row);
  });

  syncTime(currentTime);
}

function scrollToCue(index) {
  if (!autoScroll || index < 0) return;
  const container = subEn;
  const element = cueEls[index];
  if (!container || !element) return;
  const containerRect = container.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  const top = elementRect.top - containerRect.top + container.scrollTop;
  if (top < container.scrollTop + 8 || top + elementRect.height > container.scrollTop + container.clientHeight - 8) {
    container.scrollTo({ top: Math.max(0, top - container.clientHeight * 0.3), behavior: 'smooth' });
  }
}

function updateNowLine(index) {
  if (!nowLine || !nowEn || !nowZh) return;
  if (index >= 0 && cues[index]) {
    nowEn.textContent = cues[index].en;
    nowZh.textContent = cues[index].zh || '中文待生成';
    nowLine.classList.add('on');
  } else {
    nowEn.textContent = '播放后，这里会显示当前英文句子。';
    nowZh.textContent = '中文字幕会同步出现。';
    nowLine.classList.remove('on');
  }
}

function setActiveCue(index) {
  if (index === activeCue) return;
  if (activeCue >= 0) {
    cueEls[activeCue]?.classList.remove('active');
    wordEls[activeCue]?.forEach((word) => word.classList.remove('active'));
    charEls[activeCue]?.forEach((char) => char.classList.remove('active'));
  }
  cueEls.forEach((element, cueIndex) => element.classList.toggle('past', cueIndex < index));
  activeCue = index;
  activeWord = -1;
  activeChars = -1;
  if (index >= 0) {
    cueEls[index]?.classList.add('active');
    scrollToCue(index);
  }
  updateNowLine(index);
}

function syncTime(time) {
  currentTime = time;
  const index = findCueIndex(cues, time);
  if (index !== activeCue) setActiveCue(index);
  if (index < 0) return;

  const cue = cues[index];
  const words = wordsOf(cue);
  const wordIndex = findWordIndex(words, time);
  if (wordIndex !== activeWord) {
    if (activeWord >= 0) wordEls[index]?.[activeWord]?.classList.remove('active');
    activeWord = wordIndex;
    if (wordIndex >= 0) wordEls[index]?.[wordIndex]?.classList.add('active');
  }

  const chars = charEls[index];
  if (chars?.length) {
    const count = activeCharCount(cue.zh, cueProgress(cue, time));
    if (count !== activeChars) {
      activeChars = count;
      chars.forEach((char, charIndex) => char.classList.toggle('active', charIndex < count));
    }
  }
}

function paintTime(seconds) {
  if (!timeEl) return;
  const total = duration || captions?.durationSeconds || 0;
  timeEl.textContent = `${formatTimestamp(seconds)} / ${formatTimestamp(total)}`;
}

function startTicker() {
  if (ticker) return;
  ticker = setInterval(() => {
    if (!playerReady || !player?.getCurrentTime) return;
    const time = player.getCurrentTime();
    paintTime(time);
    syncTime(time);
  }, 90);
}

function stopTicker() {
  if (ticker) clearInterval(ticker);
  ticker = null;
}

function markPlaying(playing) {
  if (syncEl) {
    syncEl.classList.toggle('on', playing);
    const label = syncEl.querySelector('span');
    if (label) label.textContent = playing ? '字幕同步中' : '已暂停';
  }
  if (playing) startTicker();
  else {
    stopTicker();
    if (playerReady) {
      const time = player.getCurrentTime();
      paintTime(time);
      syncTime(time);
    }
  }
}

function seek(seconds) {
  if (Number.isFinite(seconds)) {
    if (playerReady && player?.seekTo) {
      player.seekTo(seconds, true);
      player.playVideo?.();
    }
    syncTime(seconds);
    paintTime(seconds);
  }
}

function showPlayerLoading() {
  fallback.classList.remove('hidden');
  fallback.replaceChildren(
    h('div', { style: 'display:grid;gap:10px;justify-items:center' },
      h('span', { class: 'spinner' }),
      h('p', {}, '正在连接 YouTube 播放器…'),
    ),
  );
}

function showPlayerFallback(message) {
  fallback.classList.remove('hidden');
  fallback.replaceChildren(
    h('div', { style: 'display:grid;gap:8px;justify-items:center' },
      h('span', { html: icon('play', 26) }),
      h('strong', { style: 'font-size:15px' }, message || '播放器没有加载成功'),
      h('p', {}, '字幕仍会尝试加载。你也可以在 YouTube 里观看同一个视频，对照这里的字幕。'),
      h('a', { class: 'btn btn-primary btn-sm', href: `https://www.youtube.com/watch?v=${videoId}`, target: '_blank', rel: 'noreferrer' }, '在 YouTube 观看 ↗'),
    ),
  );
}

function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('YouTube 播放器加载超时')), 12_000);
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
      reject(new Error('无法加载 YouTube 播放器脚本'));
    };
    document.head.append(script);
  });
}

function mountPlayer() {
  if (!isValidId(videoId)) return;
  showPlayerLoading();
  loadYouTubeApi().then((YT) => {
    player = new YT.Player('yt-player', {
      videoId,
      playerVars: {
        autoplay: 0,
        rel: 0,
        modestbranding: 1,
        cc_load_policy: 0,
        playsinline: 1,
        hl: 'en',
        origin: window.location.origin,
        enablejsapi: 1,
      },
      events: {
        onReady: (event) => {
          playerReady = true;
          fallback.classList.add('hidden');
          duration = Math.round(event.target.getDuration?.() || duration);
          try {
            event.target.setOption?.('captions', 'track', {});
            event.target.unloadModule?.('captions');
            event.target.unloadModule?.('cc');
          } catch { /* native CC may not be loaded */ }
          paintTime(0);
          syncEl?.classList.remove('on');
        },
        onStateChange: (event) => {
          if (event.data === 1) markPlaying(true);
          else if (event.data === 2) markPlaying(false);
          else if (event.data === 0) {
            markPlaying(false);
            syncTime(duration);
            paintTime(duration);
          }
        },
        onError: (event) => {
          const blocked = event?.data === 101 || event?.data === 150;
          showPlayerFallback(blocked ? '上传者不允许嵌入播放' : '播放器没有加载成功');
        },
      },
    });
  }).catch((error) => showPlayerFallback(error.message));
}

async function loadCaptions() {
  try {
    const data = await fetchVideoCaptions(videoId);
    captions = { ...data, zhSource: data.hasChinese ? 'official' : null };
    cues = normalizeCues(data.cues || []);
    renderHead(captions);
    fitWatchViewport();
    if (!cues.length) {
      exportBtn.classList.add('hidden');
      showEmpty(data.reason);
      return;
    }

    zhState = data.hasChinese ? 'done' : 'loading';
    renderSubtitles();
    exportBtn.classList.remove('hidden');
    exportBtn.disabled = !data.hasChinese;
    translateBtn.classList.add('hidden');
    statusEl.textContent = data.hasChinese
      ? `共 ${cues.length} 句 · 英文逐词高亮 · 官方中文字幕`
      : `共 ${cues.length} 句 · 英文逐词高亮 · 正在自动翻译中文…`;
    hintEl.textContent = '点击任意一句跳转 · 单词逐个高亮';

    if (data.hasChinese) {
      exportBtn.disabled = false;
      return;
    }

    await getHealth().catch(() => null);
    translate();
  } catch (error) {
    showCaptionError(error);
  }
}

async function translateWith(engine, chunkSize = 200) {
  const zh = [];
  const totalChunks = Math.ceil(cues.length / chunkSize);
  for (let index = 0; index < cues.length; index += chunkSize) {
    const part = cues.slice(index, index + chunkSize);
    const current = Math.floor(index / chunkSize) + 1;
    statusEl.textContent = `正在自动翻译中文字幕 ${current}/${totalChunks}…`;
    const data = engine === 'ai'
      ? await translateVideoCaptions(videoId, part, { settings: getSettings() })
      : await translateVideoCaptionsFree(videoId, part);
    const lines = Array.isArray(data.zh) ? data.zh : [];
    if (lines.length !== part.length) throw new Error('翻译结果条数不一致，请重试。');
    zh.push(...lines.map((line) => String(line || '')));
  }
  return zh;
}

async function translate() {
  if (translating || !cues.length) return;
  translating = true;
  zhState = 'loading';
  translateBtn.classList.add('hidden');
  translateBtn.disabled = true;
  exportBtn.disabled = true;
  renderSubtitles();
  statusEl.textContent = '正在根据英文字幕自动翻译中文…';

  try {
    const settings = getSettings();
    const wantsAI = aiReady(settings);
    let engine = wantsAI ? 'ai' : 'google';
    let zh;
    if (wantsAI) {
      try {
        zh = await translateWith('ai');
      } catch (aiError) {
        statusEl.textContent = '模型翻译失败，改用免费翻译…';
        zh = await translateWith('free');
        engine = 'google';
      }
    } else {
      zh = await translateWith('free');
    }

    if (!zh.some(Boolean)) throw new Error('翻译结果为空，请重试。');
    cues.forEach((cue, index) => { cue.zh = zh[index] || ''; });
    captions = { ...captions, hasChinese: true, zhSource: engine === 'ai' ? 'ai' : 'google' };
    zhState = 'done';
    renderSubtitles();
    exportBtn.disabled = false;
    statusEl.textContent = `共 ${cues.length} 句 · 英文逐词高亮 · ${engine === 'ai' ? 'AI 中文字幕' : '自动中文字幕'}`;
    hintEl.textContent = '中英字幕已同步 · 可导出 Markdown';
    renderHead(captions);
    toast(engine === 'ai' ? '中文字幕已生成' : '免费翻译已补全中文字幕', 'ok', 2400);
  } catch (error) {
    zhState = 'failed';
    renderSubtitles();
    translateBtn.classList.remove('hidden');
    translateBtn.textContent = '重试翻译';
    statusEl.textContent = '中文自动翻译失败';
    hintEl.textContent = '可以重试，或到设置页配置模型 Key';
    toast(error.message || '自动翻译失败', 'err', 4200);
  } finally {
    translating = false;
    translateBtn.disabled = false;
    exportBtn.disabled = false;
  }
}

function exportMarkdown() {
  if (!cues.length) {
    toast('还没有可导出的字幕', 'err', 2400);
    return;
  }
  const escape = (value) => String(value || '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
  const title = captions?.title || 'YouTube video';
  const lines = [
    `# ${escape(title)}`,
    '',
    `- 频道：${escape(captions?.channel || '—')}`,
    `- 视频：https://www.youtube.com/watch?v=${videoId}`,
    `- 时长：${captions?.duration || formatTimestamp(captions?.durationSeconds || duration)}`,
    `- 导出：${new Date().toISOString().slice(0, 10)} · EnOS 逐词字幕`,
    '',
    '## 中英字幕',
    '',
    '| 时间 | English | 中文 |',
    '| --- | --- | --- |',
    ...cues.map((cue) => `| ${formatTimestamp(cue.start)} | ${escape(cue.en)} | ${escape(cue.zh || '—')} |`),
    '',
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const safeTitle = title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || videoId;
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${safeTitle}-bilingual.md`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  toast('Markdown 已导出', 'ok', 2400);
}

function fitWatchViewport() {
  const layout = document.querySelector('.watch-layout');
  const agent = document.getElementById('agent-panel');
  const subtitle = document.querySelector('.subtitle-panel');
  if (!layout || !agent || !subtitle) return;
  if (window.innerWidth <= 860) {
    agent.style.height = '';
    subtitle.style.height = '';
    subtitle.style.maxHeight = '';
    return;
  }
  const viewport = window.innerHeight;
  const scrollY = window.scrollY || 0;
  const layoutTop = layout.getBoundingClientRect().top + scrollY;
  const agentTop = agent.getBoundingClientRect().top + scrollY;
  agent.style.height = `${Math.max(280, Math.floor(viewport - agentTop))}px`;
  subtitle.style.maxHeight = 'none';
  subtitle.style.height = `${Math.max(420, Math.floor(viewport - layoutTop))}px`;
}

function initPlayerResize() {
  const layout = document.querySelector('.watch-layout');
  const handle = document.getElementById('player-resize');
  const main = document.querySelector('.watch-main');
  if (!layout || !handle || !main) return;

  const KEY = 'enos.watch.playerRatio.v1';
  const DEFAULT_RATIO = 1.38;
  let ratio = DEFAULT_RATIO;
  try { ratio = Number(localStorage.getItem(KEY)) || DEFAULT_RATIO; } catch { /* private mode */ }

  const apply = (value, save = true) => {
    ratio = Math.min(2.8, Math.max(0.4, value));
    layout.style.setProperty('--watch-player', `${ratio.toFixed(3)}fr`);
    handle.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
    if (save) {
      try { localStorage.setItem(KEY, String(ratio.toFixed(3))); } catch { /* private mode */ }
    }
    requestAnimationFrame(fitWatchViewport);
  };
  apply(ratio, false);

  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || window.innerWidth <= 860) return;
    event.preventDefault();
    const rect = layout.getBoundingClientRect();
    const gap = Number.parseFloat(getComputedStyle(layout).columnGap) || 12;
    const startWidth = main.getBoundingClientRect().width;
    const minWidth = 320;
    const maxWidth = Math.max(minWidth, rect.width - gap - 420);
    const startX = event.clientX;
    let finished = false;
    try { handle.setPointerCapture(event.pointerId); } catch { /* ignore */ }
    document.body.classList.add('resizing-player');

    const move = (moveEvent) => {
      if (moveEvent.cancelable) moveEvent.preventDefault();
      const width = Math.max(minWidth, Math.min(maxWidth, startWidth + moveEvent.clientX - startX));
      const subtitle = Math.max(320, rect.width - gap - width);
      apply(width / subtitle, false);
    };
    const finish = () => {
      if (finished) return;
      finished = true;
      window.removeEventListener('pointermove', move);
      document.body.classList.remove('resizing-player');
      apply(ratio, true);
      try { handle.releasePointerCapture(event.pointerId); } catch { /* ignore */ }
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', finish, { once: true });
    window.addEventListener('pointercancel', finish, { once: true });
  });

  handle.addEventListener('dblclick', () => apply(DEFAULT_RATIO));
  handle.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      apply(ratio + (event.key === 'ArrowRight' ? 0.08 : -0.08));
    } else if (event.key === 'Home') {
      event.preventDefault();
      apply(DEFAULT_RATIO);
    }
  });
}

function boot() {
  if (!isValidId(videoId)) {
    renderFatal('链接里没有合法的 YouTube 视频 ID（应为 11 位）。');
    statusEl.textContent = '缺少视频 ID';
    return;
  }
  renderHead(null);
  if (!debug) {
    mountPlayer();
    loadCaptions();
  }
  mountAgent({
    videoId,
    getState: () => ({ captions, cues, currentTime }),
  });
  translateBtn?.addEventListener('click', translate);
  exportBtn?.addEventListener('click', exportMarkdown);
  initPlayerResize();
  autoScrollInput?.addEventListener('change', () => {
    autoScroll = autoScrollInput.checked;
    if (autoScroll && activeCue >= 0) scrollToCue(activeCue);
  });
  paintTime(0);
  fitWatchViewport();
  setTimeout(fitWatchViewport, 120);
  document.fonts?.ready.then(() => fitWatchViewport()).catch(() => {});
  window.addEventListener('resize', fitWatchViewport);
}

if (debug) {
  window.__WATCH_DEBUG__ = {
    setData(data) {
      captions = data;
      cues = normalizeCues(data.cues || []);
      renderHead(data);
      renderSubtitles();
      if (!cues.length) showEmpty(data.reason || 'NO_CAPTIONS');
      else statusEl.textContent = `共 ${cues.length} 句 · 调试字幕`;
    },
    sync(time) {
      paintTime(time);
      syncTime(time);
    },
    get state() {
      return { cues, activeCue, activeWord, activeChars, captions };
    },
  };
}

boot();

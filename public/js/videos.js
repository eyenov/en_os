import {
  aiReady,
  bookFileUrl,
  chatStream,
  errorMessage,
  fetchVideoCaptions,
  getBooks,
  getHealth,
  getPodcastChannels,
  getPodcastEpisode,
  getPodcastEpisodes,
  getWordPronunciation,
  readBook,
  searchVideos,
  translateVideoCaptions,
  translateVideoCaptionsFree,
} from './api.js';
import { getSettings, getShadowingReviews, saveShadowingReviews } from './store.js';
import { ShadowingReviewLog, ShadowingTracker, SilentMediaFollower, SpeechSession } from './shadowing.js';
import { PronunciationPlayer } from './pronunciation.js';
import { defaultVideoLayout, VIDEO_LAYOUT_KEY, VIDEO_VISIBILITY_KEY, VideoWindowLayout } from './video-layout.js';
import { activeCharCount, cueProgress, findCueIndex, findWordIndex, formatTimestamp, normalizeCues, serializeSrt } from './subtitle-sync.js';
import { bindFullscreen, h, icon, toast } from './ui.js';
import { renderSettings } from './views/settings.js';
import { getLocale, msg, setI18nAttribute, setText, t } from './i18n.js';

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
const treeOpen = document.getElementById('tree-open');
const treeCollapse = document.getElementById('tree-collapse');
const railSettings = document.getElementById('rail-settings');
const settingsView = document.getElementById('settings-view');
let settingsReady = false;
let practice = null;
let speechSession = null;
let pronunciationPlayer = null;
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
const detailLayoutMenu = document.getElementById('detail-layout-menu');
const detailLayoutOptions = document.getElementById('detail-layout-options');
const detailLayoutControls = new Map();
let detailWindows = null;
const detailBack = document.getElementById('detail-back');
let detailCueEls = [];
let detailWordEls = [];
let detailCharEls = [];

const detail = {
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
  books: [],
  channels: [],
  selectedCategory: 'all',
  readerOpen: false,
  item: null,
  chapters: [],
  active: 0,
  requestSeq: 0,
  error: '',
};

const practicePanels = { detail: createPracticePanel('detail'), podcast: createPracticePanel('podcast') };

function practiceFor(kind) {
  return practice?.kind === kind ? practice : null;
}

function createPracticePanel(kind) {
  const root = document.getElementById(`${kind}-shadowing-bar`);
  const status = h('span', { class: 'shadowing-status-text', role: 'status' });
  const stats = h('span', { class: 'shadowing-stats' });
  const next = h('strong');
  const ipa = h('span', { class: 'shadowing-ipa', lang: 'en' });
  const transcript = h('span', { class: 'shadowing-transcript', translate: 'no' });
  const progress = h('progress', { max: 1, value: 0, 'aria-label': '跟读进度' });
  const command = (name, label, handler) => h('button', {
    class: 'studio-icon-button', type: 'button', title: label, 'aria-label': label, onclick: handler,
  }, h('span', { html: icon(name, 17) }));
  const repeat = command('refresh', '重读当前句', () => seekPracticeCue(practice?.position.cueIndex || 0));
  const skip = command('arrowRight', '下一句', () => seekPracticeCue((practice?.position.cueIndex || 0) + 1));
  const listen = command('pause', '暂停麦克风', togglePracticeListening);
  const close = command('close', '结束跟读', () => stopPractice());
  const pronounce = command('volume', '播放下一词发音', () => playPracticePronunciation(kind));
  pronounce.classList.add('shadowing-pronounce');
  root.replaceChildren(
    h('div', { class: 'shadowing-top' },
      h('div', { class: 'shadowing-status' }, h('span', { class: 'shadowing-signal', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), status),
      stats,
      h('div', { class: 'shadowing-commands' }, repeat, skip, listen, close),
    ),
    h('div', { class: 'shadowing-bottom' }, h('div', { class: 'shadowing-prompt' }, h('small', {}, '下一词'), next, ipa, pronounce), transcript),
    progress,
  );
  return { root, status, stats, next, ipa, pronounce, transcript, progress, listen, skip, repeat };
}

function createPracticeReview(cueIndex) {
  const meta = h('small', { class: 'shadowing-review-meta' });
  const summary = h('strong', { class: 'shadowing-review-summary' }, '待跟读');
  const advice = h('p', { class: 'shadowing-review-advice' });
  const historyLabel = h('span');
  const list = h('ol', { class: 'shadowing-review-list' });
  const history = h('details', { class: 'shadowing-review-history' },
    h('summary', { title: '查看每次跟读记录', 'aria-label': msg('查看第 {{number}} 句跟读记录', { number: cueIndex + 1 }) }, h('span', { html: icon('clock', 13) }), historyLabel), list);
  const root = h('aside', {
    class: 'shadowing-review is-empty', 'aria-label': msg('第 {{number}} 句跟读点评', { number: cueIndex + 1 }), onclick: (event) => event.stopPropagation(),
  }, meta, summary, advice, history);
  return { root, meta, summary, advice, history, historyLabel, list };
}

function renderPracticeReviews(reading) {
  const pairs = reading.kind === 'detail' ? detailCueEls : podcastCueEls;
  const words = reading.kind === 'detail' ? detailWordEls : podcastWordEls;
  for (const cueIndex of new Set([reading.position.cueIndex, ...reading.reviews.history.keys()])) {
    const view = pairs[cueIndex]?.review;
    if (!view) continue;
    const reviews = reading.reviews.reviews(cueIndex);
    const signature = `${getLocale()}|${JSON.stringify(reviews)}`;
    if (signature === view.signature) continue;
    view.signature = signature;
    view.root.dataset.count = String(reviews.length);
    view.root.classList.toggle('is-empty', !reviews.length);
    const latest = reviews.at(-1);
    if (!latest) continue;
    view.root.dataset.status = latest.status;
    view.root.classList.toggle('needs-work', latest.missingWords.length > 0);
    view.meta.replaceChildren(h('span', {}, msg('第 {{number}} 遍', { number: latest.number })), h('span', {}, msg('{{percent}}% 对齐', { percent: Math.round(latest.coverage * 100) })));
    setText(view.summary, latest.summaryMessage);
    setText(view.advice, latest.adviceMessage);
    setText(view.historyLabel, '{{count}}次记录', { count: reviews.length });
    view.list.replaceChildren(...[...reviews].reverse().map((review) => h('li', {
      class: 'shadowing-review-record', dataset: { number: review.number, status: review.status },
    }, h('small', {}, msg('第 {{number}} 遍 · {{status}}', { number: review.number, status: msg(review.status === 'complete' ? '已读完' : review.status === 'active' ? '跟读中' : '已结束') })),
    h('strong', {}, review.summaryMessage), h('p', {}, review.adviceMessage))));
    for (const word of words[cueIndex] || []) word.classList.remove('shadow-missed');
    for (const wordIndex of latest.missingWordIndexes) words[cueIndex]?.[wordIndex]?.classList.add('shadow-missed');
  }
}

function persistPracticeReviews(reading, delayed = false) {
  clearTimeout(reading.saveTimer);
  if (delayed) { reading.saveTimer = setTimeout(() => persistPracticeReviews(reading), 400); return; }
  const records = reading.reviews.export();
  if (!records.length) return;
  if (!saveShadowingReviews(reading.mediaId, records) && !reading.storageWarning) {
    reading.storageWarning = true;
    toast('点评暂时只保留在当前页面，浏览器存储不可用。', 'err');
  }
}

function cancelPracticePronunciation(reading, { resume = false } = {}) {
  const shouldResume = reading.exampleResume;
  reading.exampleRun += 1;
  reading.exampleActive = false;
  reading.exampleResume = false;
  pronunciationPlayer?.cancel();
  if (practice !== reading) return;
  if (resume && shouldResume && !document.hidden && !reading.position.done) reading.speech.start();
  renderPractice(reading);
}

async function playPracticePronunciation(kind) {
  const reading = practiceFor(kind);
  if (!reading || reading.position.done) return;
  if (reading.exampleActive) { cancelPracticePronunciation(reading, { resume: true }); return; }
  pronunciationPlayer ??= new PronunciationPlayer();
  const word = reading.position.nextWord.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, '');
  if (!word || !pronunciationPlayer.supported) return;
  const run = ++reading.exampleRun;
  reading.exampleResume = reading.speech.requested;
  reading.exampleActive = true;
  reading.speech.pause();
  reading.follower.hold();
  renderPractice(reading);
  try {
    const released = await reading.speech.whenReleased();
    if (practice !== reading || run !== reading.exampleRun) return;
    if (!released) {
      reading.exampleResume = false;
      toast('麦克风未能释放，请结束跟读后重试。', 'err');
      return;
    }
    await pronunciationPlayer.play(word);
  } catch {
    if (practice === reading && run === reading.exampleRun) toast('英语发音暂不可用，请检查浏览器或系统语音设置。', 'err');
  } finally {
    if (practice === reading && run === reading.exampleRun) {
      const resume = reading.exampleResume;
      reading.exampleActive = false;
      reading.exampleResume = false;
      renderPractice(reading);
      if (resume && !document.hidden && !reading.position.done) reading.speech.start();
    }
  }
}

function updatePracticePronunciation(reading) {
  const word = reading.position.nextWord;
  const view = practicePanels[reading.kind];
  if (reading.pronunciationWord !== word) {
    reading.pronunciationWord = word;
    reading.ipa = [];
    reading.ipaLoading = Boolean(word);
    if (word) getWordPronunciation(word).then((data) => {
      if (practice !== reading || reading.pronunciationWord !== word) return;
      reading.ipa = (Array.isArray(data.ipa) ? data.ipa : []).filter((value) => typeof value === 'string').slice(0, 4);
      reading.ipaLoading = false;
      renderPractice(reading);
    }).catch(() => {
      if (practice !== reading || reading.pronunciationWord !== word) return;
      reading.ipaLoading = false;
      renderPractice(reading);
    });
  }
  setText(view.ipa, !word ? '' : reading.ipaLoading ? '查音标…' : reading.ipa.length ? '{{ipa}}' : '音标暂缺', { ipa: reading.ipa.join(' · ') });
  setI18nAttribute(view.ipa, 'title', reading.ipa.length ? msg('美式词典读音：{{ipa}}', { ipa: reading.ipa.join('，') }) : '词典未收录音标时仍可播放英语发音');
  view.pronounce.disabled = !word || !window.SpeechSynthesisUtterance || !window.speechSynthesis;
  const label = reading.exampleActive ? '停止发音示例' : msg('播放 {{word}} 的发音示例', { word });
  setI18nAttribute(view.pronounce, 'title', label);
  setI18nAttribute(view.pronounce, 'aria-label', label);
  view.pronounce.classList.toggle('is-playing', reading.exampleActive);
  view.pronounce.innerHTML = icon(reading.exampleActive ? 'stop' : 'volume', 17);
}

function updatePracticeControls() {
  const supported = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition) && window.isSecureContext;
  for (const kind of ['detail', 'podcast']) {
    const button = document.getElementById(`${kind}-shadowing`);
    const ready = kind === 'detail' ? detail.playerReady && detail.cues.length > 0 : Boolean(podcast.selectedEpisode && podcast.cues.length);
    const active = Boolean(practiceFor(kind));
    button.disabled = !supported || !ready;
    button.setAttribute('aria-pressed', String(active));
    setI18nAttribute(button, 'title', !supported ? '语音识别需要支持此功能的浏览器与安全连接' : !ready ? '字幕与播放器尚未准备好' : active ? '结束跟读并恢复原播放设置' : '开始语音跟读，原声静音');
  }
}

function practiceAdapter(kind) {
  if (kind === 'podcast') return {
    static: true,
    time: podcastPlaybackTime,
    getMuted: () => podcastAudio.muted,
    getRate: () => podcastAudio.playbackRate,
    isPlaying: () => !podcastAudio.paused,
    setMuted: (value) => { podcastAudio.muted = value; },
    setRate: (rate) => { podcastAudio.playbackRate = rate; },
    seek: (time) => {
      podcastAudio.currentTime = Math.max(0, Math.min(podcastDurationValue() || Infinity, time + podcast.offset + podcastOutputLatency()));
      updatePodcastTimes();
      drawPodcastWave();
    },
    pause: () => podcastAudio.pause(),
    play: () => podcastAudio.play(),
  };
  const player = detail.player;
  return {
    time: () => Number(player.getCurrentTime?.()) || 0,
    getMuted: () => Boolean(player.isMuted?.()),
    getRate: () => Number(player.getPlaybackRate?.()) || 1,
    isPlaying: () => player.getPlayerState?.() === 1,
    setMuted: (value) => value ? player.mute?.() : player.unMute?.(),
    setRate: (rate) => {
      const available = player.getAvailablePlaybackRates?.() || [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
      const closest = available.reduce((best, value) => Math.abs(value - rate) < Math.abs(best - rate) ? value : best, available[0] || 1);
      player.setPlaybackRate?.(closest);
    },
    seek: (time) => player.seekTo?.(time, true),
    pause: () => player.pauseVideo?.(),
    play: () => player.playVideo?.(),
  };
}

function renderPractice(reading) {
  if (practice !== reading) return;
  const view = practicePanels[reading.kind];
  const position = reading.position;
  const states = { starting: '开启麦克风…', listening: reading.mismatch ? '等待语音对齐' : position.matchedWords ? '跟读中' : '等待朗读', paused: '麦克风已暂停', reconnecting: '重新连接…', error: reading.error || '识别已中断' };
  const status = reading.exampleActive ? '示范发音 · 麦克风暂停' : position.done ? '本段已读完' : states[reading.speech.state] || '等待朗读';
  setText(view.status, status);
  setI18nAttribute(view.status, 'title', status);
  view.root.classList.toggle('has-error', reading.speech.state === 'error');
  view.root.classList.toggle('is-speaking', reading.speaking && reading.speech.requested);
  setText(view.stats, position.pace && !window.matchMedia('(max-width: 600px)').matches ? '{{percent}}% · {{pace}}词/分' : '{{percent}}%', { percent: Math.round(position.progress * 100), pace: position.pace });
  setI18nAttribute(view.stats, 'title', msg('已匹配 {{count}} 词', { count: position.matchedWords }));
  setText(view.next, position.done ? '完成' : '{{word}}', { word: position.nextWord });
  view.next.title = position.nextWord;
  view.transcript.textContent = position.transcript || '…';
  view.transcript.title = position.transcript;
  view.progress.value = position.progress;
  const label = position.done ? '重读当前句' : reading.speech.requested ? '暂停麦克风' : '继续跟读';
  setI18nAttribute(view.listen, 'title', label);
  setI18nAttribute(view.listen, 'aria-label', label);
  view.listen.innerHTML = icon(reading.speech.requested ? 'pause' : 'mic', 17);
  view.listen.disabled = reading.exampleActive;
  view.repeat.disabled = reading.exampleActive;
  view.skip.disabled = reading.exampleActive || position.cueIndex >= reading.tracker.cues.length - 1;
  const words = reading.kind === 'detail' ? detailWordEls : podcastWordEls;
  for (const key of reading.tracker.matched) {
    if (reading.painted.has(key)) continue;
    const [cueIndex, wordIndex] = key.split(':').map(Number);
    words[cueIndex]?.[wordIndex]?.classList.add('shadow-spoken');
    reading.painted.add(key);
  }
  const nextNode = words[position.nextCueIndex]?.[position.nextWordIndex];
  if (reading.nextNode !== nextNode) {
    reading.nextNode?.classList.remove('shadow-next');
    reading.nextNode?.removeAttribute('data-ipa');
    reading.nextNode?.removeAttribute('title');
    reading.nextNode = nextNode;
  }
  reading.nextNode?.classList.add('shadow-next');
  updatePracticePronunciation(reading);
  renderPracticeReviews(reading);
  scrollPracticeWord(reading);
}

function scrollPracticeWord(reading) {
  const { cueIndex, wordIndex, nextWordIndex } = reading.position;
  const video = reading.kind === 'detail';
  const words = video ? detailWordEls : podcastWordEls;
  const chars = video ? detailCharEls : podcastCharEls;
  const activeChars = video ? detail.activeChars : podcast.activeChars;
  const targets = [
    [video ? detailEn : podcastEn, words[cueIndex]?.[wordIndex >= 0 ? wordIndex : nextWordIndex]],
    [video ? detailZh : podcastZh, chars[cueIndex]?.[activeChars - 1]],
  ];
  for (const [container, element] of targets) {
    if (!element || container.clientHeight <= 0) continue;
    const bounds = container.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    if (rect.top < bounds.top + 12 || rect.bottom > bounds.bottom - 14) {
      const top = rect.top - bounds.top + container.scrollTop;
      container.scrollTo({ top: Math.max(0, top - container.clientHeight * 0.4), behavior: 'auto' });
    }
  }
}

function syncPractice(reading) {
  if (practice !== reading) return;
  if (reading.kind === 'detail') syncDetail();
  else { syncPodcast(); updatePodcastPlayButton(); updatePodcastTimes(); drawPodcastWave(); }
  renderPractice(reading);
}

function refreshPractice(kind) {
  updatePracticeControls();
  const reading = practiceFor(kind);
  if (!reading) return;
  reading.painted.clear();
  reading.nextNode = null;
  renderPractice(reading);
}

function startPractice(kind) {
  if (practiceFor(kind)) { stopPractice(); return; }
  if (document.getElementById(`${kind}-shadowing`).disabled) return;
  stopPractice({ resume: false });
  const cues = kind === 'detail' ? detail.cues : podcast.cues;
  const tracker = new ShadowingTracker(cues);
  if (!tracker.tokens.length) { toast('没有可跟读的英文字幕', 'err'); return; }
  const time = kind === 'detail' ? Number(detail.player.getCurrentTime?.()) || 0 : podcastPlaybackTime();
  let cueIndex = findCueIndex(cues, time);
  if (cueIndex < 0) cueIndex = Math.max(0, cues.findIndex((cue) => cue.end > time));
  const wordIndex = Math.max(0, findWordIndex(tracker.cues[cueIndex].words, time));
  const mediaId = kind === 'detail' ? `youtube:${detail.item.id}` : `podcast:${podcast.selectedChannel}:${podcast.selectedEpisode.id}`;
  const reviews = new ShadowingReviewLog(tracker.cues, getShadowingReviews(mediaId));
  reviews.begin(cueIndex, wordIndex);
  const reading = { kind, mediaId, tracker, reviews, position: tracker.seek(cueIndex, wordIndex), painted: new Set(), speaking: false, error: '', ipa: [], exampleRun: 0, exampleActive: false, exampleResume: false };
  reading.follower = new SilentMediaFollower(practiceAdapter(kind));
  if (!speechSession) speechSession = new SpeechSession();
  reading.speech = speechSession;
  Object.assign(reading.speech, {
    onResult: (alternatives, options) => {
      if (practice !== reading) return;
      const previousTranscript = reading.position.transcript;
      reading.position = tracker.consume(alternatives, options);
      reviews.record(reading.position, tracker.alignedWords);
      persistPracticeReviews(reading, true);
      reading.mismatch = Boolean(reading.position.transcript && reading.position.transcript !== previousTranscript && !reading.position.advanced && !reading.position.done);
      if (reading.position.advanced) reading.follower.follow(reading.position.time);
      syncPractice(reading);
      if (reading.position.done) reading.speech.pause();
    },
    onSpeech: (speaking) => {
      if (practice !== reading) return;
      reading.speaking = speaking;
      if (!speaking) reading.follower.hold();
      renderPractice(reading);
    },
    onState: (state, details) => {
      if (practice !== reading) return;
      reading.error = details.message || '';
      if (details.fatal) {
        stopPractice({ resume: false });
        toast(details.message, 'err', 5000);
        return;
      }
      if (state === 'listening') reading.follower.lastInput = performance.now();
      else reading.follower.hold();
      syncPractice(reading);
    },
  });
  practice = reading;
  reading.follower.begin();
  reading.follower.jump(reading.position.time);
  const pane = kind === 'detail' ? videoDetail : podcastPane;
  pane.classList.add('shadowing-active');
  practicePanels[kind].root.classList.remove('hidden');
  if (kind === 'detail') {
    stopDetailTicker();
    detailPlayerMount.inert = true;
    detailWindows?.setShadowing(true);
    detail.cues = tracker.cues;
    renderDetailSubtitles();
  } else {
    stopPodcastTicker();
    podcast.cues = tracker.cues;
    for (const id of ['podcast-speed', 'podcast-follow', 'podcast-offset', 'podcast-offset-reset']) document.getElementById(id).disabled = true;
    renderPodcastSubtitles();
  }
  updatePracticeControls();
  syncPractice(reading);
  reading.speech.start();
}

function stopPractice({ resume = true } = {}) {
  const reading = practice;
  if (!reading) return;
  practice = null;
  cancelPracticePronunciation(reading);
  reading.reviews.finish();
  persistPracticeReviews(reading);
  reading.speech.pause();
  reading.speech.onResult = () => {};
  reading.speech.onState = () => {};
  reading.speech.onSpeech = () => {};
  reading.follower.restore({ resume });
  const pane = reading.kind === 'detail' ? videoDetail : podcastPane;
  pane.classList.remove('shadowing-active');
  pane.querySelectorAll('.shadow-spoken, .shadow-next, .shadow-missed').forEach((word) => {
    word.classList.remove('shadow-spoken', 'shadow-next', 'shadow-missed');
    word.removeAttribute('data-ipa');
    word.removeAttribute('title');
  });
  practicePanels[reading.kind].root.classList.add('hidden');
  if (reading.kind === 'detail') { detailPlayerMount.inert = false; detailWindows?.setShadowing(false); syncDetail(); }
  else {
    for (const id of ['podcast-speed', 'podcast-follow', 'podcast-offset', 'podcast-offset-reset']) document.getElementById(id).disabled = false;
    updatePodcastPlayButton();
    alignPodcastSubtitleRows();
    syncPodcast();
  }
  updatePracticeControls();
  if (resume) document.getElementById(`${reading.kind}-shadowing`).focus({ preventScroll: true });
}

function seekPracticeCue(cueIndex, wordIndex = 0) {
  if (!practice) return;
  const reading = practice;
  const index = Math.max(0, Math.min(reading.tracker.cues.length - 1, cueIndex));
  const listening = reading.speech.requested || reading.exampleResume;
  cancelPracticePronunciation(reading);
  reading.speech.pause();
  reading.position = reading.tracker.seek(index, wordIndex);
  reading.reviews.begin(index, wordIndex);
  persistPracticeReviews(reading, true);
  reading.mismatch = false;
  const pane = reading.kind === 'detail' ? videoDetail : podcastPane;
  pane.querySelectorAll('.shadow-spoken, .shadow-next').forEach((word) => {
    word.classList.remove('shadow-spoken', 'shadow-next');
    word.removeAttribute('data-ipa');
    word.removeAttribute('title');
  });
  reading.painted.clear();
  reading.follower.jump(reading.position.time);
  syncPractice(reading);
  if (listening) reading.speech.start();
}

function togglePracticeListening() {
  if (!practice) return;
  const reading = practice;
  if (reading.position.done) seekPracticeCue(reading.position.cueIndex);
  if (reading.speech.requested) reading.speech.pause();
  else reading.speech.start();
}

for (const kind of ['detail', 'podcast']) document.getElementById(`${kind}-shadowing`).addEventListener('click', () => startPractice(kind));
updatePracticeControls();

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
    title: msg('{{title}}', { title: item.title }),
    onclick: () => openVideoDetail(item),
  },
    h('div', { class: 'preview-thumb' },
      image,
      item.duration ? h('span', { class: 'preview-duration' }, item.duration) : null,
      item.hasCaptions ? h('span', { class: 'preview-cc' }, 'CC') : null,
      h('span', { class: 'preview-play' }, h('span', {}, h('span', { html: icon('play', 14) }))),
    ),
    h('div', { class: 'preview-body' },
      h('div', { class: 'preview-title', translate: 'no' }, item.title),
      h('div', { class: 'preview-channel', translate: 'no' }, item.channel || 'YouTube'),
      item.description ? h('div', { class: 'preview-desc', translate: 'no' }, item.description) : null,
      h('div', { class: 'preview-meta' },
        meta.map((text) => h('span', { class: 'preview-chip', translate: 'no' }, text)),
        item.hasCaptions ? h('span', { class: 'preview-chip cc' }, '带字幕') : h('span', { class: 'preview-chip' }, '字幕待检测'),
      ),
      h('span', { class: 'preview-open' }, h('span', { html: icon('play', 12) }), '播放'),
    ),
  );
}

function renderChannels() {
  if (state.tab !== 'youtube' || state.view !== 'videos') return;
  channelList.replaceChildren();
  setText(treeCount, state.items.length ? '{{channels}} 个频道 · {{videos}} 个视频' : '搜索后显示频道', { channels: state.channels.length, videos: state.items.length });

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
    h('span', { class: 'tree-avatar', translate: 'no' }, initialOf(channel.name)),
    h('span', { class: 'tree-name', translate: 'no' }, channel.name),
    h('span', { class: 'tree-count' }, String(channel.videos.length)));
    row.append(caret, main);
    node.append(row);
    if (expanded) {
      node.append(h('div', { class: 'tree-sub' }, channel.videos.map((item) => h('button', {
        class: 'tree-video',
        type: 'button',
        translate: 'no',
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
  setText(previewTitle, state.selectedChannel === 'all' ? '全部频道' : '{{channel}}', { channel: state.selectedChannel });
  setText(previewSubtitle, state.items.length ? '{{count}} 个视频 · 搜索“{{query}}”{{cached}}' : '输入关键词后展示视频预览', { count: items.length, query: state.query, cached: state.meta?.cached ? msg(' · 缓存') : '' });
  setText(previewSource, state.meta?.source ? sourceLabel(state.meta.source) : '');

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
    results.append(h('div', { class: 'callout warn', style: 'margin-bottom:12px' }, h('span', { html: icon('info', 16) }), h('span', {}, 'YouTube Data API 不可用，已自动改用网页检索。')));
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
  if (!image) return h('span', { class: 'podcast-avatar', translate: 'no' }, initialOf(channel.name));
  return h('span', { class: 'podcast-avatar', translate: 'no' },
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
    toast(msg('开始下载：{{title}}', { title: latest.title }), 'ok', 2800);
  } catch (error) {
    toast(errorMessage(error, '播客下载失败'), 'err', 3600);
  }
}

function renderPodcastTree() {
  if (state.tab !== 'podcast' || state.view !== 'videos') return;
  channelList.replaceChildren();
  setText(treeEyebrow, '播客频道');
  setText(treeTitle, '播客列表');
  const loadedEpisodes = [...podcast.episodes.values()].reduce((total, items) => total + items.length, 0);
  setText(treeCount, podcast.channels.length ? '{{channels}} 个频道 · {{episodes}} 集' : podcast.loading ? '正在读取播客频道…' : '暂无播客频道', { channels: podcast.channels.length, episodes: loadedEpisodes || '…' });
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
    h('span', { class: 'tree-name', translate: 'no' }, channel.name),
    h('span', { class: 'tree-count podcast-count' }, episodes.length ? String(episodes.length) : '…')));
    row.append(h('button', {
      class: 'tree-download',
      type: 'button',
      title: '下载最新一期',
      'aria-label': msg('下载 {{channel}} 最新一期', { channel: channel.name }),
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
        translate: 'no',
        title: msg('{{title}}', { title: episode.title }),
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
    setText(treeCount, '播客源暂时不可用');
    channelList.replaceChildren(h('div', { class: 'tree-empty' }, errorMessage(error, '无法读取播客频道。')));
    toast(errorMessage(error, '播客源加载失败'), 'err', 4200);
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
    setText(treeCount, '正在读取 {{channel}}…', { channel: channel.name });
    try {
      await loadPodcastEpisodes(channel);
    } catch (error) {
      toast(errorMessage(error, '播客单集加载失败'), 'err', 4200);
    }
  }
  renderPodcastTree();
}

async function openPodcastChannel(channel, { selectLatest = false } = {}) {
  podcast.selectedChannel = channel.id;
  if (!podcast.episodes.has(channel.id)) {
    podcast.loading = true;
    setText(treeCount, '正在读取 {{channel}}…', { channel: channel.name });
    try {
      await loadPodcastEpisodes(channel);
    } catch (error) {
      podcast.loading = false;
      toast(errorMessage(error, '播客单集加载失败'), 'err', 4200);
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
  setText(podcastTitle, '{{title}}', { title: episode.title });
  setI18nAttribute(podcastTitle, 'title', msg('{{title}}', { title: episode.title }));
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
  setText(document.getElementById('podcast-details-title'), '{{title}}', { title: episode.title });
  document.getElementById('podcast-details-content').replaceChildren(
    h('div', { class: 'podcast-detail-summary' },
      episode.image ? h('img', { class: 'podcast-detail-cover', src: episode.image, alt: msg('{{channel}} 封面', { channel: channel.name }), onerror: (event) => { event.target.hidden = true; } }) : null,
      h('dl', { class: 'podcast-detail-meta' }, metadata.filter(([, value]) => value).map(([label, value]) => h('div', {}, h('dt', {}, label), h('dd', { translate: 'no' }, value)))),
    ),
    episode.subtitle ? h('p', { class: 'podcast-detail-subtitle', translate: 'no' }, episode.subtitle) : null,
    episode.description ? h('p', { class: 'podcast-detail-description', translate: 'no' }, episode.description) : null,
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
  stopPractice({ resume: false });
  podcast.selectedChannel = channel.id;
  podcast.selectedEpisode = episode;
  podcast.translateSeq += 1;
  podcast.translating = false;
  renderPodcastTree();
  setPodcastInfo(channel, episode);
  if (compactViewport.matches) setTreeCollapsed(true);
  podcast.cues = [];
  updatePracticeControls();
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
  setText(podcastStatus, '正在加载播客字幕…');
  podcastTranslate.classList.add('hidden');
  const request = ++podcast.requestSeq;
  try {
    const data = await getPodcastEpisode(channel.id, episode.id);
    if (request !== podcast.requestSeq) return;
    podcast.cues = normalizeCues(data.cues || []);
    if (!podcast.cues.length) {
      setText(podcastStatus, '这一集没有可用字幕');
      podcastEn.replaceChildren(h('div', { class: 'podcast-empty' }, '没有读到可用的字幕。'));
      podcastZh.replaceChildren(h('div', { class: 'podcast-empty' }, '换一集试试。'));
      return;
    }
    renderPodcastSubtitles();
    setText(podcastStatus, '共 {{count}} 句 · 正在自动翻译中文…', { count: podcast.cues.length });
    await translatePodcast();
  } catch (error) {
    if (request !== podcast.requestSeq) return;
    setText(podcastStatus, '播客字幕加载失败');
    podcastEn.replaceChildren(h('div', { class: 'podcast-empty' }, errorMessage(error, '无法加载字幕。')));
    podcastZh.replaceChildren(h('div', { class: 'podcast-empty' }, '字幕暂时不可用。'));
    toast(errorMessage(error, '播客字幕加载失败'), 'err', 4200);
  }
}

function podcastScrollToCue(index) {
  if (index < 0 || (!podcast.follow && !practiceFor('podcast'))) return;
  const pair = podcastCueEls[index];
  if (!pair) return;
  for (const [container, element] of [[podcastEn, pair.en], [podcastZh, pair.zh]]) {
    if (!container || !element) continue;
    const containerRect = container.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const top = elementRect.top - containerRect.top + container.scrollTop;
    if (top < container.scrollTop + 8 || top + elementRect.height > container.scrollTop + container.clientHeight - 8) {
      container.scrollTo({ top: Math.max(0, top - container.clientHeight * 0.3), behavior: practiceFor('podcast') ? 'auto' : 'smooth' });
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
  const position = practiceFor('podcast')?.position;
  const time = position?.time ?? podcastPlaybackTime();
  const index = position?.cueIndex ?? findCueIndex(podcast.cues, time);
  if (index !== podcast.activeCue) setPodcastActiveCue(index);
  if (index < 0) return;
  const cue = podcast.cues[index];
  const words = cue.words?.length ? cue.words : [];
  const wordIndex = position?.wordIndex ?? findWordIndex(words, time);
  if (wordIndex !== podcast.activeWord) {
    if (podcast.activeWord >= 0) podcastWordEls[index]?.[podcast.activeWord]?.classList.remove('active');
    podcast.activeWord = wordIndex;
    if (wordIndex >= 0) podcastWordEls[index]?.[wordIndex]?.classList.add('active');
  }
  const chars = podcastCharEls[index];
  if (chars?.length) {
    const count = activeCharCount(cue.zh, position && words.length ? (wordIndex + 1) / words.length : cueProgress(cue, time));
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
  if (practiceFor('podcast') || window.matchMedia('(max-width: 600px)').matches) return;
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
    const enRow = h('div', { class: 'podcast-cue', onclick: () => playPodcastCue(index) });
    const content = h('button', {
      class: 'subtitle-cue-main',
      type: 'button',
      onclick: (event) => { event.stopPropagation(); playPodcastCue(index); },
    }, h('span', { class: 'podcast-time' }, formatTimestamp(cue.start)));
    const enLine = h('span', { class: 'podcast-en' });
    const wordNodes = [];
    const words = cue.words?.length ? cue.words : [];
    words.forEach((word, wordIndex) => {
      const node = h('span', { class: 'word', translate: 'no', onclick: (event) => { event.stopPropagation(); playPodcastCue(index, wordIndex); } }, word.text);
      wordNodes.push(node);
      enLine.append(node);
      if (wordIndex < words.length - 1) enLine.append(document.createTextNode(' '));
    });
    if (!words.length) enLine.textContent = cue.en;
    content.append(enLine);
    if (cue.zh) content.append(h('span', { class: 'podcast-inline-zh', lang: 'zh-CN', translate: 'no' }, cue.zh));
    const review = createPracticeReview(index);
    enRow.append(content, review.root);

    const zhRow = h('button', {
      class: 'podcast-cue',
      type: 'button',
      onclick: () => playPodcastCue(index),
    }, h('span', { class: 'podcast-time' }, formatTimestamp(cue.start)));
    const zhLine = h('span', { class: 'podcast-zh' });
    const chars = [];
    if (cue.zh) {
      for (const char of Array.from(cue.zh)) {
        const span = h('span', { class: 'zh-char', translate: 'no' }, char === ' ' ? '\u00a0' : char);
        chars.push(span);
        zhLine.append(span);
      }
    } else {
      zhLine.textContent = podcast.translating ? '…' : '—';
    }
    zhRow.append(zhLine);

    podcastCueEls.push({ en: enRow, zh: zhRow, review });
    podcastWordEls.push(wordNodes);
    podcastCharEls.push(chars);
    podcastEn.append(enRow);
    podcastZh.append(zhRow);
  });
  alignPodcastSubtitleRows();
  syncPodcast();
  refreshPractice('podcast');
}

async function translatePodcast() {
  if (podcast.translating || !podcast.cues.length) return;
  podcast.translating = true;
  podcastTranslate.classList.add('hidden');
  setText(podcastStatus, '正在自动翻译中文字幕…');
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
          setText(podcastStatus, '正在翻译中文字幕 {{part}}/{{total}}…', { part: Math.floor(index / 200) + 1, total: totalChunks });
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
        setText(podcastStatus, '正在翻译中文字幕 {{part}}/{{total}}…', { part: Math.floor(index / 200) + 1, total: totalChunks });
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
    setText(podcastStatus, '共 {{count}} 句 · 英文逐词 · {{engine}}', { count: podcast.cues.length, engine: msg(engine === 'ai' ? 'AI 中文字幕' : '自动中文字幕') });
    podcastTranslate.classList.add('hidden');
  } catch (error) {
    if (request !== podcast.translateSeq) return;
    setText(podcastStatus, '中文自动翻译失败');
    podcastTranslate.classList.remove('hidden');
    setText(podcastTranslate, '重试翻译');
    toast(errorMessage(error, '播客字幕翻译失败'), 'err', 3600);
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
  if (practiceFor('podcast')) { podcastAudio.muted = true; podcastAudio.pause(); return; }
  updatePodcastPlayButton();
  startPodcastTicker();
  startPodcastVisual();
});
podcastAudio.addEventListener('playing', updatePodcastPlayButton);
podcastAudio.addEventListener('waiting', () => { setText(podcastAudioState, '缓冲中'); });
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
  setText(podcastStatus, '音频无法播放，请检查网络或代理');
  setText(podcastAudioState, '播放失败');
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
  const reading = practiceFor('podcast');
  const paused = reading ? !reading.speech.requested : podcastAudio.paused;
  const label = reading ? paused ? '继续跟读' : '暂停麦克风' : paused ? '播放' : '暂停';
  podcastPlay.innerHTML = icon(paused ? 'play' : 'pause', 18);
  setI18nAttribute(podcastPlay, 'aria-label', label);
  setI18nAttribute(podcastPlay, 'title', label);
  podcastPane.classList.toggle('is-playing', !podcastAudio.paused);
  setText(podcastAudioState, !podcast.selectedEpisode ? '尚未选择单集'
    : podcastAudio.ended ? '播放结束'
      : podcastAudio.paused ? podcastAudio.currentTime > 0 ? '已暂停' : '待播放' : '正在播放');
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
  if (practiceFor('podcast')) { togglePracticeListening(); return; }
  if (!podcastAudio.src) return;
  if (podcastAudio.paused) {
    try {
      ensurePodcastAudioGraph();
      await podcast.audioCtx?.resume?.();
      await podcastAudio.play();
    } catch (error) {
      setText(podcastStatus, errorMessage(error, '音频无法播放'));
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

function playPodcastCue(index, wordIndex = 0) {
  const cue = podcast.cues[index];
  if (!cue) return;
  if (practiceFor('podcast')) { seekPracticeCue(index, wordIndex); return; }
  podcastAudio.currentTime = Math.max(0, (cue.words[wordIndex]?.start ?? cue.start) + podcast.offset + podcastOutputLatency());
  updatePodcastTimes();
  syncPodcast();
  if (podcastAudio.paused) togglePodcastPlay();
}

function navigatePodcastCue(direction) {
  if (!podcast.cues.length) return;
  if (practiceFor('podcast')) { seekPracticeCue(Math.max(0, podcast.activeCue) + direction); return; }
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
  if (practiceFor('podcast')) {
    const time = Math.max(0, ratio * duration - podcast.offset - podcastOutputLatency());
    const index = Math.max(0, podcast.cues.findLastIndex((cue) => cue.start <= time));
    seekPracticeCue(index, Math.max(0, findWordIndex(podcast.cues[index].words, time)));
    return;
  }
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
    seekPodcastRatio((podcastAudio.currentTime + (event.key === 'ArrowRight' ? 5 : -5)) / duration);
  } else if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault();
    seekPodcastRatio(event.key === 'Home' ? 0 : 1);
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
  if (practiceFor('detail')) stopPractice({ resume: false });
  stopDetailTicker();
  try { detail.player?.destroy?.(); } catch { /* ignore */ }
  detail.player = null;
  detail.playerReady = false;
  updatePracticeControls();
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
          updatePracticeControls();
          detailFallback.classList.add('hidden');
          try {
            event.target.setOption?.('captions', 'track', {});
            event.target.unloadModule?.('captions');
            event.target.unloadModule?.('cc');
          } catch { /* native CC */ }
        },
        onStateChange: (event) => {
          const reading = practiceFor('detail');
          if (reading) {
            event.target.mute?.();
            if (event.data === 1 && !reading.follower.following) event.target.pauseVideo?.();
            syncDetail();
            return;
          }
          if (event.data === 1) startDetailTicker();
          else if (event.data === 2 || event.data === 0) {
            stopDetailTicker();
            syncDetail();
          }
        },
        onError: (event) => {
          if (practiceFor('detail')) stopPractice({ resume: false });
          detail.playerReady = false;
          updatePracticeControls();
          const blocked = event?.data === 101 || event?.data === 150;
          detailFallbackShow(blocked ? '上传者不允许嵌入播放' : '播放器没有加载成功');
        },
      },
    });
  }).catch((error) => detailFallbackShow(errorMessage(error)));
}

function openVideoDetail(item) {
  stopPractice({ resume: false });
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
  setText(detailTitle, '{{title}}', { title: item.title });
  setI18nAttribute(detailTitle, 'title', msg('{{title}}', { title: item.title }));
  const metadata = [item.channel, item.duration, item.views, item.published].filter(Boolean).join(' · ');
  setText(detailMeta, '{{meta}}', { meta: metadata });
  setI18nAttribute(detailMeta, 'title', msg('{{meta}}', { meta: metadata }));
  setText(detailStatus, '正在加载字幕…');
  detailTranslate.classList.add('hidden');
  detailEn.replaceChildren();
  detailZh.replaceChildren();
  detail.chat = [];
  detail.chatBusy = false;
  renderTabState();
  detailWindows ??= new VideoWindowLayout({
    host: detailBody, element: document.getElementById('detail-window-grid'), status: document.getElementById('detail-layout-status'),
    onChange: () => {
      renderDetailLayoutMenu();
      if (practiceFor('detail')) requestAnimationFrame(() => { if (practiceFor('detail')) scrollPracticeWord(practice); });
    },
  });
  detailWindows.refresh();
  mountDetailPlayer(item);
  loadDetailCaptions(item);
  setupDetailChat(item);
}

function closeVideoDetail({ restore = true } = {}) {
  detailLayoutMenu.open = false;
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
      setText(detailStatus, '这一集视频没有可用字幕');
      detailEn.replaceChildren(h('div', { class: 'podcast-empty' }, data.reason === 'CAPTION_FETCH_FAILED' ? '字幕接口返回空内容。' : '没有读到可用字幕。'));
      detailZh.replaceChildren(h('div', { class: 'podcast-empty' }, '换一个带字幕的视频试试。'));
      return;
    }
    renderDetailSubtitles();
    setText(detailStatus, '共 {{count}} 句 · 正在自动翻译中文…', { count: detail.cues.length });
    translateDetail();
  } catch (error) {
    if (request !== detail.requestSeq) return;
    detail.loading = false;
    setText(detailStatus, '字幕加载失败');
    detailEn.replaceChildren(h('div', { class: 'podcast-empty' }, errorMessage(error, '无法加载字幕。')));
    detailZh.replaceChildren(h('div', { class: 'podcast-empty' }, '字幕暂时不可用。'));
    toast(errorMessage(error, '视频字幕加载失败'), 'err', 3600);
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
      container.scrollTo({ top: Math.max(0, top - container.clientHeight * 0.3), behavior: practiceFor('detail') ? 'auto' : 'smooth' });
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
  const position = practiceFor('detail')?.position;
  const time = position?.time ?? (Number(detail.player?.getCurrentTime?.()) || 0);
  const index = position?.cueIndex ?? findCueIndex(detail.cues, time);
  if (index !== detail.activeCue) setDetailActiveCue(index);
  if (index < 0) return;
  const cue = detail.cues[index];
  const words = cue.words || [];
  const wordIndex = position?.wordIndex ?? findWordIndex(words, time);
  if (wordIndex !== detail.activeWord) {
    if (detail.activeWord >= 0) detailWordEls[index]?.[detail.activeWord]?.classList.remove('active');
    detail.activeWord = wordIndex;
    if (wordIndex >= 0) detailWordEls[index]?.[wordIndex]?.classList.add('active');
  }
  const chars = detailCharEls[index];
  if (chars?.length) {
    const count = activeCharCount(cue.zh, position && words.length ? (wordIndex + 1) / words.length : cueProgress(cue, time));
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

function seekDetail(cue, wordIndex = 0) {
  const index = detail.cues.indexOf(cue);
  if (practiceFor('detail')) { seekPracticeCue(index, wordIndex); return; }
  if (index >= 0) setDetailActiveCue(index);
  if (detail.playerReady && detail.player?.seekTo) {
    detail.player.seekTo(cue.words[wordIndex]?.start ?? cue.start, true);
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

  detail.cues.forEach((cue, index) => {
    const enRow = h('div', { class: 'detail-cue', onclick: () => seekDetail(cue) });
    const content = h('button', { class: 'subtitle-cue-main', type: 'button', onclick: (event) => { event.stopPropagation(); seekDetail(cue); } },
      h('span', { class: 'detail-time' }, formatTimestamp(cue.start)));
    const enLine = h('span', { class: 'detail-en' });
    const wordNodes = [];
    for (const [wordIndex, word] of (cue.words || []).entries()) {
      const node = h('span', { class: 'word', translate: 'no', onclick: (event) => { event.stopPropagation(); seekDetail(cue, wordIndex); } }, word.text);
      wordNodes.push(node);
      enLine.append(node);
      if (wordIndex < cue.words.length - 1) enLine.append(document.createTextNode(' '));
    }
    if (!wordNodes.length) enLine.textContent = cue.en;
    content.append(enLine);
    if (cue.zh) content.append(h('span', { class: 'detail-inline-zh', lang: 'zh-CN', translate: 'no' }, cue.zh));
    const review = createPracticeReview(index);
    enRow.append(content, review.root);

    const zhRow = h('button', { class: 'detail-cue', type: 'button', onclick: () => seekDetail(cue) },
      h('span', { class: 'detail-time' }, formatTimestamp(cue.start)));
    const zhLine = h('span', { class: 'detail-zh' });
    const chars = [];
    if (cue.zh) {
      for (const char of Array.from(cue.zh)) {
        const span = h('span', { class: 'zh-char', translate: 'no' }, char === ' ' ? '\u00a0' : char);
        chars.push(span);
        zhLine.append(span);
      }
    } else {
      zhLine.textContent = detail.translating ? '…' : '—';
    }
    zhRow.append(zhLine);
    detailCueEls.push({ en: enRow, zh: zhRow, review });
    detailWordEls.push(wordNodes);
    detailCharEls.push(chars);
    detailEn.append(enRow);
    detailZh.append(zhRow);
  });
  syncDetail();
  refreshPractice('detail');
}

async function translateDetail() {
  if (detail.translating || !detail.cues.length || !detail.item) return;
  detail.translating = true;
  detailTranslate.classList.add('hidden');
  setText(detailStatus, '正在自动翻译中文字幕…');
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
          setText(detailStatus, '正在翻译中文字幕 {{part}}/{{total}}…', { part: Math.floor(index / 200) + 1, total: totalChunks });
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
        setText(detailStatus, '正在翻译中文字幕 {{part}}/{{total}}…', { part: Math.floor(index / 200) + 1, total: totalChunks });
        const data = await translateVideoCaptionsFree(detail.item.id, part);
        const lines = Array.isArray(data.zh) ? data.zh : [];
        if (lines.length !== part.length) throw new Error('翻译条数不一致');
        zh.push(...lines);
      }
    }
    if (request !== detail.translateSeq) return;
    detail.cues.forEach((cue, index) => { cue.zh = zh[index] || ''; });
    renderDetailSubtitles();
    setText(detailStatus, '共 {{count}} 句 · 英文逐词 · {{engine}}', { count: detail.cues.length, engine: msg(engine === 'ai' ? 'AI 中文字幕' : '自动中文字幕') });
  } catch (error) {
    if (request !== detail.translateSeq) return;
    setText(detailStatus, '中文自动翻译失败');
    detailTranslate.classList.remove('hidden');
    setText(detailTranslate, '重试翻译');
    toast(errorMessage(error, '视频字幕翻译失败'), 'err', 3600);
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
  const bubble = h('div', { class: `detail-msg ${role}${options.pending ? ' pending' : ''}${options.error ? ' error' : ''}`, translate: 'no' }, text);
  detailMessages.append(bubble);
  detailMessages.scrollTop = detailMessages.scrollHeight;
  return bubble;
}

async function setupDetailChat(item) {
  detail.chat = [];
  detail.chatAvailable = false;
  detailChatInput.disabled = true;
  detailChatSend.disabled = true;
  setI18nAttribute(detailChatInput, 'placeholder', '读取 Agent 状态…');
  detailMessages.replaceChildren(h('div', { class: 'detail-empty' }, '正在检查模型配置…'));
  await getHealth(true).catch(() => null);
  if (!state.detailOpen || detail.item?.id !== item.id) return;
  detail.chatAvailable = aiReady(getSettings());
  detailChatInput.disabled = !detail.chatAvailable;
  detailChatSend.disabled = !detail.chatAvailable;
  setI18nAttribute(detailChatInput, 'placeholder', detail.chatAvailable ? '问 Agent：解释当前句 / 总结这段视频' : '配置 API Key 后与 Agent 对话');
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
    if (full) bubble.textContent = full;
    else { bubble.removeAttribute('translate'); setText(bubble, '（Agent 没有返回内容）'); }
    if (full) detail.chat.push({ role: 'assistant', content: full });
  } catch (error) {
    bubble.classList.remove('pending');
    bubble.classList.add('error');
    bubble.removeAttribute('translate');
    setText(bubble, '请求失败：{{error}}', { error: errorMessage(error, '请稍后重试') });
  } finally {
    detail.chatBusy = false;
    detailChatSend.disabled = false;
    detailChatInput.focus();
  }
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
    `- ${t('频道')}：${esc(detail.item.channel || '—')}`,
    `- ${t('视频')}：https://www.youtube.com/watch?v=${detail.item.id}`,
    `- ${t('时长')}：${detail.item.duration || '—'}`,
    `- ${t('导出')}：${new Date().toISOString().slice(0, 10)} · EnOS`,
    '',
    `## ${t('中英字幕')}`,
    '',
    `| ${t('时间')} | English | ${t('中文')} |`,
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

function renderDetailLayoutMenu() {
  const names = { video: '视频', agent: 'Agent', en: '英文字幕', zh: '中文字幕' };
  const layout = detailWindows?.preview() || {
    columns: 12, rows: 12, panels: defaultVideoLayout().map((item) => ({ ...item, visible: true, enabled: true })),
  };
  for (const panel of layout.panels) {
    if (!detailLayoutControls.has(panel.id)) {
      const input = h('input', {
        type: 'checkbox', 'data-video-panel': panel.id, 'aria-label': names[panel.id],
        onchange: (event) => detailWindows?.setVisible(panel.id, event.target.checked),
      });
      const thumbnail = h('span', { class: 'detail-layout-thumbnail', 'aria-hidden': 'true' });
      detailLayoutOptions.append(h('label', { class: 'detail-layout-option' }, thumbnail,
        h('span', { class: 'detail-layout-label' }, input, h('span', {}, names[panel.id]))));
      detailLayoutControls.set(panel.id, { input, thumbnail });
    }
    const { input, thumbnail } = detailLayoutControls.get(panel.id);
    input.checked = panel.visible;
    input.disabled = !panel.enabled;
    setI18nAttribute(input, 'title', !panel.enabled ? '跟读时此窗口自动收起'
      : msg(panel.visible ? '隐藏 {{window}}' : '显示 {{window}}', { window: msg(names[panel.id]) }));
    thumbnail.style.setProperty('--layout-columns', String(layout.columns));
    thumbnail.style.setProperty('--layout-rows', String(layout.rows));
    thumbnail.replaceChildren(...layout.panels.filter((item) => item.visible || item.id === panel.id).map((item) => h('span', {
      class: `detail-layout-cell${item.id === panel.id ? ' is-target' : ''}${item.visible ? '' : ' is-hidden'}`,
      style: `grid-column:${item.x + 1} / span ${item.w};grid-row:${item.y + 1} / span ${item.h}`,
    })));
  }
}

detailLayoutMenu.addEventListener('toggle', () => { if (detailLayoutMenu.open) renderDetailLayoutMenu(); });
document.addEventListener('pointerdown', (event) => {
  if (detailLayoutMenu.open && !detailLayoutMenu.contains(event.target)) detailLayoutMenu.open = false;
});
document.getElementById('detail-layout-reset').addEventListener('click', () => detailWindows?.reset());

function renderLoading() {
  setText(treeCount, '正在解析频道…');
  channelList.replaceChildren(h('div', { class: 'tree-empty' }, '正在加载频道树…'));
  setText(previewTitle, '正在搜索');
  setText(previewSubtitle, '读取 YouTube 结果、缩略图与频道信息');
  previewSource.textContent = '';
  results.replaceChildren(h('div', { class: 'preview-skeleton-grid' },
    Array.from({ length: 4 }, () => h('div', { class: 'skeleton preview-skeleton' })),
  ));
}

function renderError(error, query) {
  setText(previewTitle, '搜索没有完成');
  setText(previewSubtitle, errorMessage(error, '无法连接 YouTube'));
  previewSource.textContent = '';
  setText(treeCount, '频道暂时不可用');
  channelList.replaceChildren(h('div', { class: 'tree-empty' }, '搜索失败，频道列表暂时为空。'));
  results.replaceChildren(h('div', { class: 'preview-empty' },
    h('div', {},
      h('h2', {}, '搜索没有完成'),
      h('p', {}, errorMessage(error, '无法连接 YouTube。')),
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
    setText(document.querySelector('title'), '{{query}} · 视频工作台 · EnOS', { query });
  } catch (error) {
    state.loading = false;
    state.items = [];
    state.channels = [];
    state.meta = { source: '' };
    renderError(error, query);
    toast(errorMessage(error, '搜索失败'), 'err', 4200);
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
  setText(treeCount, total ? '{{channels}} 本外刊 · {{issues}} 期' : '正在读取目录', { channels: bookState.channels.length, issues: total });

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
        h('span', { class: 'tree-name', translate: 'no' }, channel.name),
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
  setText(booksSubtitle, bookState.loading
    ? '正在读取 GitHub 图书目录…'
    : bookState.error
      ? bookState.error
      : msg('{{label}} · {{count}} 期 · 按最新日期排序', { label: msg(label), count: items.length }));
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
    h('span', { class: 'book-mag', translate: 'no' }, book.short),
    h('span', { class: 'book-initial', translate: 'no' }, bookInitials(book)),
    h('span', { class: 'book-date' }, book.date));
    const formats = book.formats.map((format) => h('span', { class: `book-format ${format.format}` }, `${format.format.toUpperCase()}${format.sizeLabel ? ` · ${format.sizeLabel}` : ''}`));
    booksGrid.append(h('button', {
      class: 'book-card',
      type: 'button',
      title: msg('{{title}}', { title: book.title }),
      onclick: () => openBook(book),
    },
    cover,
    h('div', { class: 'book-card-body' },
      h('h2', { translate: 'no' }, book.title),
      h('p', { class: 'book-sub' }, msg('{{magazine}} · {{count}} 种格式', { magazine: book.magazine, count: book.formats.length })),
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
    bookState.books = Array.isArray(data.books) ? data.books : [];
    bookState.channels = Array.isArray(data.channels) ? data.channels : [];
    bookState.initialized = true;
    bookState.error = '';
  } catch (error) {
    bookState.error = errorMessage(error, '图书目录加载失败');
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
    title: msg('下载 {{format}}{{size}}', { format: format.format.toUpperCase(), size: format.sizeLabel ? ` · ${format.sizeLabel}` : '' }),
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
    h('span', { translate: 'no' }, chapter.title),
    h('small', {}, msg('{{count}} 词', { count: chapter.wordCount.toLocaleString() }))));
  });
}

function showBookChapter(index) {
  if (!bookState.chapters.length) return;
  const next = Math.min(bookState.chapters.length - 1, Math.max(0, index));
  bookState.active = next;
  const chapter = bookState.chapters[next];
  const article = h('div', { class: 'book-article' },
    h('p', { class: 'book-chapter-kicker' }, msg('第 {{number}} 章 / {{total}} · {{magazine}}', { number: next + 1, total: bookState.chapters.length, magazine: bookState.item?.magazine || '' })),
    h('h1', { class: 'book-chapter-title', translate: 'no' }, chapter.title),
    ...chapter.blocks.map((block) => {
      if (block.type === 'heading') return h('h2', { class: 'book-block heading', translate: 'no' }, block.text);
      if (block.type === 'bullet') return h('p', { class: 'book-block bullet', translate: 'no' }, block.text);
      return h('p', { class: 'book-block', translate: 'no' }, block.text);
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
  bookState.requestSeq += 1;
  const request = bookState.requestSeq;
  setText(bookTitle, '{{title}}', { title: book.title });
  setText(bookMeta, '{{magazine}} · {{date}} · 正在下载 EPUB{{size}}…', { magazine: book.magazine, date: book.date, size: book.epub?.sizeLabel ? ` (${book.epub.sizeLabel})` : '' });
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
    setText(bookTitle, '{{title}}', { title: parsed.title || book.title });
    setText(bookMeta, '{{magazine}} · {{date}} · {{chapters}} 章 · {{words}} 词', { magazine: parsed.magazine || book.magazine, date: parsed.date || book.date, chapters: bookState.chapters.length, words: new Intl.NumberFormat(getLocale()).format(parsed.wordCount || 0) });
    renderBookActions(book);
    if (!bookState.chapters.length) throw new Error('这本书没有可阅读章节');
    showBookChapter(0);
  } catch (error) {
    if (request !== bookState.requestSeq) return;
    bookMeta.textContent = `${book.magazine} · ${book.date}`;
    bookToc.replaceChildren();
    bookContent.replaceChildren(h('div', { class: 'book-error' },
      h('strong', {}, '这本外刊暂时打不开'),
      h('p', {}, errorMessage(error, 'EPUB 解析失败，可以先下载到本地阅读。')),
    ));
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
  mediaView.classList.toggle('tree-collapsed', state.treeCollapsed);
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
  if (showMedia) {
    setText(treeEyebrow, youtube ? '频道' : booksTab ? '图书列表' : '播客频道');
    setText(treeTitle, youtube ? '频道' : booksTab ? '外刊' : '播客频道');
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
    });
    settingsView.replaceChildren(settings.el);
  } catch (error) {
    settingsReady = false;
    settingsView.replaceChildren(h('div', { class: 'settings-loading' },
      h('p', {}, errorMessage(error, '设置加载失败')),
      h('button', { class: 'btn btn-soft', type: 'button', onclick: ensureStudioSettings }, '重试'),
    ));
  }
}

function updateRailSelection() {
  const choices = [
    ...[...document.querySelectorAll('.studio-tab')].map((button) => [button, state.view === 'videos' && button.dataset.tab === state.tab]),
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
  if (view !== 'videos') stopPractice({ resume: false });
  state.view = view;
  const videos = view === 'videos';
  const configuring = view === 'settings';
  updateRailSelection();
  settingsView.classList.toggle('hidden', !configuring);
  const url = new URL(window.location.href);
  if (videos) url.searchParams.delete('view');
  else url.searchParams.set('view', view);
  window.history.replaceState(null, '', url);
  if (!videos) {
    mediaView.classList.add('hidden');
    podcastAudio.pause();
    if (state.detailOpen) closeVideoDetail({ restore: false });
    if (bookState.readerOpen) closeBookReader({ restore: false });
    if (configuring) ensureStudioSettings();
    updateTreeOpen();
    return;
  }
  renderTabState();
}

function setTab(tab) {
  if (tab !== state.tab) stopPractice({ resume: false });
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

/* ---------- events + boot ---------- */

bindFullscreen(document.getElementById('studio-fullscreen'), document.documentElement, () => {
  toast('浏览器未能切换全屏，请重试。', 'err');
});

window.addEventListener('enos:locale', () => {
  updatePodcastPlayButton();
  updatePracticeControls();
  if (practice) renderPractice(practice);
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  runSearch();
});

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
    if (detailLayoutMenu.open) {
      detailLayoutMenu.open = false;
      detailLayoutMenu.querySelector('summary').focus();
    }
    document.getElementById('studio-language-menu').open = false;
    document.getElementById('podcast-sync-settings').open = false;
    if (compactViewport.matches && !state.treeCollapsed) {
      setTreeCollapsed(true);
      treeOpen.focus();
    }
  }
});
compactViewport.addEventListener('change', (event) => setTreeCollapsed(event.matches));
if ('ResizeObserver' in window) {
  const practiceResize = new ResizeObserver(() => { if (practice) scrollPracticeWord(practice); });
  practiceResize.observe(detailEn);
  practiceResize.observe(podcastEn);
}
window.addEventListener('pagehide', () => stopPractice({ resume: false }));
document.addEventListener('visibilitychange', () => {
  if (document.hidden && practice) {
    cancelPracticePronunciation(practice);
    practice.speech.pause();
  }
});
podcastAudio.addEventListener('volumechange', () => { if (practiceFor('podcast') && !podcastAudio.muted) podcastAudio.muted = true; });

if (params.get('reset') === '1') {
  try {
    localStorage.removeItem(TREE_KEY);
    localStorage.removeItem(VIDEO_LAYOUT_KEY);
    localStorage.removeItem(VIDEO_VISIBILITY_KEY);
    localStorage.removeItem('enos.detail.left.v1');
  } catch { /* ignore */ }
  params.delete('reset');
  const query = params.toString();
  history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`);
}
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
      setText(podcastStatus, '共 {{count}} 句 · 双语字幕', { count: podcast.cues.length });
    },
    get podcastState() {
      return { activeCue: podcast.activeCue, activeWord: podcast.activeWord, offset: podcast.offset, follow: podcast.follow };
    },
    get state() { return { items: state.items, meta: state.meta, channels: state.channels }; },
  };
  renderChannels();
  renderPreviews();
} else if (params.get('view') !== 'settings') {
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

if (params.get('view') === 'settings') setView('settings');

window.addEventListener('error', (event) => {
  if (event.error?.name === 'AbortError') return;
  console.error(event.error || event.message);
});

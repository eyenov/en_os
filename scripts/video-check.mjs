/**
 * Browser smoke test for the video pages.
 * Run: node scripts/video-check.mjs  (server on 8787, Chrome/Edge installed)
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const CHROME = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].find((candidate) => candidate && existsSync(candidate));
const PORT = 9336;
const BASE = process.env.ENOS_URL || 'http://127.0.0.1:8787';
const SHOTS = path.resolve('.shots');
const PROFILE = path.resolve('.chrome-video-profile');
const MOBILE = process.env.ENOS_MOBILE === '1';
const VIEWPORT = MOBILE
  ? { width: 390, height: 844, screenWidth: 390, screenHeight: 844, deviceScaleFactor: 1, mobile: true }
  : { width: 1440, height: 1000, screenWidth: 1440, screenHeight: 1000, deviceScaleFactor: 1, mobile: false };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.logs = [];
    this.exceptions = [];
  }
  async connect() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        this.logs.push(message.params.args.map((arg) => arg.value || arg.description).join(' '));
      }
      if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
        this.logs.push(`${message.params.entry.text} ${message.params.entry.url || ''}`);
      }
      if (message.method === 'Runtime.exceptionThrown') {
        this.exceptions.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
      }
    });
  }
  send(method, params = {}) {
    const id = (this.id += 1);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  async waitFor(expression, timeout = 20_000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      try { if (await this.evaluate(`Boolean(${expression})`)) return; } catch { /* navigating */ }
      await sleep(150);
    }
    throw new Error(`Timed out waiting for ${expression}`);
  }
  async screenshot(name, full = false) {
    if (full) {
      const metrics = await this.send('Page.getLayoutMetrics');
      await this.send('Emulation.setDeviceMetricsOverride', { ...VIEWPORT, height: Math.min(6000, Math.ceil(metrics.contentSize.height)) });
      await sleep(200);
    }
    const data = await this.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    await writeFile(path.join(SHOTS, name), Buffer.from(data.data, 'base64'));
    if (full) {
      await this.send('Emulation.clearDeviceMetricsOverride');
      await this.send('Emulation.setDeviceMetricsOverride', VIEWPORT);
    }
    console.log('  screenshot', name);
  }
}

const POSTER = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#20263b"/><stop offset="1" stop-color="#4f46e5"/></linearGradient></defs><rect width="640" height="360" fill="url(#g)"/><circle cx="500" cy="90" r="92" fill="#c9f27c" opacity=".25"/><circle cx="140" cy="300" r="120" fill="#fff" opacity=".06"/><text x="42" y="170" fill="#fffdf7" font-family="Segoe UI, sans-serif" font-size="30" font-weight="700">How cities stay cool</text><text x="42" y="205" fill="#c9f27c" font-family="Segoe UI, sans-serif" font-size="15">EnOS · YouTube listening</text></svg>`)}`;

function posterFor(index) {
  const palettes = [
    ['#20263b', '#4f46e5'],
    ['#0e3a38', '#14b8a6'],
    ['#3b1d2e', '#db2777'],
    ['#3a2a12', '#d97706'],
    ['#1e293b', '#3b82f6'],
    ['#2f1b3a', '#8b5cf6'],
  ];
  const [from, to] = palettes[index % palettes.length];
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="640" height="360" fill="url(#g)"/><circle cx="${490 - index * 18}" cy="90" r="92" fill="#c9f27c" opacity=".2"/><circle cx="${120 + index * 15}" cy="310" r="120" fill="#fff" opacity=".07"/><text x="40" y="190" fill="#fffdf7" font-family="Segoe UI, sans-serif" font-size="26" font-weight="700" opacity=".9">ENOS · VIDEO</text><text x="42" y="224" fill="#c9f27c" font-family="Segoe UI, sans-serif" font-size="14">Listening practice</text></svg>`)}`;
}

const SEARCH_ITEMS = [
  ['dQw4w9WgXcQ', 'IELTS Listening: How cities stay cool', 'EnOS Demo', '12:34', '1.2M views', '2 years ago', true],
  ['abc12345678', 'TED-Ed: Why do cities need trees?', 'TED-Ed', '4:12', '860K views', '1 year ago', true],
  ['xyz98765432', 'BBC Learning English: 6 Minute Vocabulary', 'BBC Learning English', '6:08', '420K views', '3 weeks ago', true],
  ['lmn45678901', 'A calm walk through a shaded neighbourhood', 'Slow Travel', '18:20', '92K views', '5 months ago', false],
  ['pqr23456789', 'IELTS Speaking Band 7: full mock test', 'IELTS Advantage', '22:41', '2.4M views', '1 year ago', true],
  ['stu34567890', 'National Geographic: How forests cool the planet', 'National Geographic', '9:15', '3.1M views', '2 years ago', true],
].map(([id, title, channel, duration, views, published, cc], index) => ({
  id, title, channel, duration, durationSeconds: 0, views, published,
  thumbnail: posterFor(index), hasCaptions: cc, description: '', badges: cc ? 'CC' : '',
}));

const CUES = (() => {
  const rows = [
    ['Cities should abandon the idea of building wider roads.', '城市应该放弃修建更宽道路的想法。'],
    ['Instead, they invest in shade, trees and reliable public transport.', '相反，他们投资于阴凉、树木和可靠的公共交通。'],
    ['A street with trees is used more often, even when the distance is the same.', '即使距离相同，有树木的街道也更常被人使用。'],
    ['That is why small changes can reshape the way a neighbourhood feels.', '这就是为什么小改变可以重塑一个街区的感受。'],
  ];
  let cursor = 0;
  return rows.map(([en, zh]) => {
    const tokens = en.split(' ');
    const step = 3.4 / tokens.length;
    const start = cursor;
    const end = start + 3.4;
    cursor = end + 0.2;
    return {
      start, end, en, zh,
      words: tokens.map((text, index) => ({ text, start: start + index * step, end: start + (index + 1) * step })),
    };
  });
})();

const PODCAST_CUES = Array.from({ length: 12 }, (_, index) => {
  const source = CUES[index % CUES.length];
  const start = index * 4 + 0.5;
  const end = start + 3.2;
  const tokens = source.en.split(' ');
  const step = 3.2 / tokens.length;
  return {
    start, end, en: source.en, zh: source.zh,
    words: tokens.map((text, wordIndex) => ({
      text,
      start: start + wordIndex * step,
      end: start + (wordIndex + 1) * step - (wordIndex === 0 ? 0.12 : 0),
    })),
  };
});

function audioFixture(seconds = 52) {
  const sampleRate = 8000;
  const samples = sampleRate * seconds;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let sample = 0; sample < samples; sample += 1) {
    buffer.writeInt16LE(Math.round(Math.sin(sample * 2 * Math.PI * 220 / sampleRate) * 1200), 44 + sample * 2);
  }
  return `data:audio/wav;base64,${buffer.toString('base64')}`;
}

async function main() {
  if (!CHROME) throw new Error('Chrome/Edge not found; set CHROME_PATH.');
  await mkdir(SHOTS, { recursive: true });
  await rm(PROFILE, { recursive: true, force: true }).catch(() => {});
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--no-first-run', '--disable-gpu', '--hide-scrollbars', '--window-size=1440,1000', 'about:blank',
  ], { stdio: 'ignore' });
  try {
    for (let index = 0; index < 60; index += 1) {
      try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch { /* retry */ }
      await sleep(200);
    }
    const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const page = targets.find((target) => target.type === 'page');
    const cdp = new CDP(page.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', VIEWPORT);

    console.log('1. search workspace');
    await cdp.send('Page.navigate', { url: `${BASE}/videos.html?debug=1` });
    await cdp.waitFor(`document.querySelector('.studio-shell')`);
    await sleep(500);
    await cdp.screenshot('video-search.png');

    console.log('2. search results fixture');
    await cdp.evaluate(`window.__VIDEOS_DEBUG__.render(${JSON.stringify(SEARCH_ITEMS)}, { query: 'IELTS listening', source: 'youtube-web' })`);
    await sleep(400);
    await cdp.screenshot('video-results.png', true);

    console.log('3. podcast audio clock and controls');
    await cdp.evaluate(`localStorage.removeItem('enos.podcast.offset.v1.clock-fixture.clock-episode')`);
    await cdp.evaluate(`(() => {
      const fixture = ${JSON.stringify({
      channel: { id: 'clock-fixture', name: 'The English Edit', image: POSTER },
      episode: { id: 'clock-episode', channelId: 'clock-fixture', title: 'Small changes, a different perspective', date: '2026-10-30', duration: '0:52', durationSeconds: 52, image: POSTER, description: 'Cities, everyday choices, and the ideas that change how we see the world.' },
      cues: PODCAST_CUES,
      audio: audioFixture(),
    })};
      const binary = atob(fixture.audio.split(',')[1]);
      const samples = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      fixture.audio = URL.createObjectURL(new Blob([samples], { type: 'audio/wav' }));
      window.__VIDEOS_DEBUG__.setPodcastData(fixture);
    })()`);
    await cdp.waitFor(`document.getElementById('podcast-audio').readyState >= 2`);
    await cdp.evaluate(`document.getElementById('podcast-play').click()`);
    await cdp.waitFor(`document.getElementById('podcast-audio').currentTime > 0.55 && !document.getElementById('podcast-audio').paused`);
    const playing = await cdp.evaluate(`!document.getElementById('podcast-audio').paused && window.__VIDEOS_DEBUG__.podcastState.activeCue === 0`);
    await cdp.evaluate(`document.getElementById('podcast-audio').pause()`);
    const wordTime = (PODCAST_CUES[0].words[1].start + PODCAST_CUES[0].words[1].end) / 2;
    await cdp.evaluate(`document.getElementById('podcast-audio').currentTime = ${wordTime}`);
    await cdp.waitFor(`window.__VIDEOS_DEBUG__.podcastState.activeWord === 1`);
    const seeking = await cdp.evaluate(`document.querySelector('#podcast-en .word.active')?.textContent === ${JSON.stringify(PODCAST_CUES[0].words[1].text)}`);
    const gapTime = PODCAST_CUES[0].words[0].end + 0.06;
    await cdp.evaluate(`document.getElementById('podcast-audio').currentTime = ${gapTime}`);
    await cdp.waitFor(`window.__VIDEOS_DEBUG__.podcastState.activeWord === -1`);
    const silence = await cdp.evaluate(`document.querySelectorAll('#podcast-en .word.active').length === 0`);
    await cdp.evaluate(`(() => {
      const speed = document.getElementById('podcast-speed');
      speed.value = '1.5';
      speed.dispatchEvent(new Event('change', { bubbles: true }));
      const offset = document.getElementById('podcast-offset');
      offset.value = '1';
      offset.dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('podcast-audio').currentTime = ${wordTime + 1};
    })()`);
    await cdp.waitFor(`window.__VIDEOS_DEBUG__.podcastState.activeWord === 1 && window.__VIDEOS_DEBUG__.podcastState.offset === 1`);
    const calibration = await cdp.evaluate(`document.getElementById('podcast-audio').playbackRate === 1.5 && window.__VIDEOS_DEBUG__.podcastState.activeCue === 0`);
    await cdp.evaluate(`document.getElementById('podcast-next').click()`);
    await cdp.waitFor(`window.__VIDEOS_DEBUG__.podcastState.activeCue === 1`);
    await cdp.evaluate(`document.getElementById('podcast-audio').pause()`);
    const navigation = await cdp.evaluate(`Math.abs(document.getElementById('podcast-audio').currentTime - ${PODCAST_CUES[1].start + 1}) < 0.5`);
    await cdp.evaluate(`(() => {
      const follow = document.getElementById('podcast-follow');
      follow.checked = false;
      follow.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    const follow = await cdp.evaluate(`window.__VIDEOS_DEBUG__.podcastState.follow === false`);
    let drawer = true;
    let smallScreen = true;
    if (MOBILE) {
      await cdp.evaluate(`document.getElementById('tree-open').click()`);
      drawer = await cdp.evaluate(`!document.getElementById('media-view').classList.contains('tree-collapsed') && !document.getElementById('channel-tree').inert`);
      await cdp.evaluate(`document.getElementById('channel-scrim').click()`);
      drawer = drawer && await cdp.evaluate(`document.getElementById('media-view').classList.contains('tree-collapsed')`);
      const previousTitle = await cdp.evaluate(`document.getElementById('podcast-title').textContent`);
      await cdp.evaluate(`document.getElementById('podcast-title').textContent = 'A different perspective: the surprisingly powerful everyday choices that change how we see our cities and the wider world'`);
      await cdp.send('Emulation.setDeviceMetricsOverride', { ...VIEWPORT, width: 320, height: 568, screenWidth: 320, screenHeight: 568 });
      await cdp.waitFor(`document.getElementById('podcast-en').clientHeight > 120`);
      smallScreen = await cdp.evaluate(`(() => {
        const pane = document.getElementById('podcast-pane').getBoundingClientRect();
        const subtitles = document.getElementById('podcast-en').getBoundingClientRect();
        const visibleHeight = Math.min(pane.bottom, subtitles.bottom) - Math.max(pane.top, subtitles.top);
        return document.documentElement.scrollWidth <= 321 && visibleHeight > 100;
      })()`);
      await cdp.screenshot('podcast-small.png');
      await cdp.evaluate(`document.getElementById('podcast-title').textContent = ${JSON.stringify(previousTitle)}`);
      await cdp.send('Emulation.setDeviceMetricsOverride', VIEWPORT);
    }
    const podcastLayout = await cdp.evaluate(`(() => {
      const canvas = document.getElementById('podcast-wave');
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      return {
        noOverflow: document.documentElement.scrollWidth <= innerWidth + 1,
        readable: document.getElementById('podcast-en').clientHeight > 120,
        translated: ${MOBILE} ? getComputedStyle(document.querySelector('.podcast-inline-zh')).display !== 'none' : true,
        aligned: ${MOBILE} ? true : [...document.querySelectorAll('#podcast-en .podcast-cue')].every((row, index) => Math.abs(row.getBoundingClientRect().height - document.querySelectorAll('#podcast-zh .podcast-cue')[index].getBoundingClientRect().height) < 1),
        waveform: pixels.some((value, index) => index % 4 === 3 && value > 0),
        title: document.getElementById('podcast-title').textContent,
      };
    })()`);
    const podcastChecks = { playing, seeking, silence, calibration, navigation, follow, drawer, smallScreen, ...podcastLayout };
    console.log('  podcast', JSON.stringify(podcastChecks));
    await cdp.screenshot(MOBILE ? 'podcast-mobile.png' : 'podcast.png');
    await cdp.evaluate(`document.getElementById('podcast-offset-reset').click()`);

    console.log('4. watch fixture');
    await cdp.send('Page.navigate', { url: `${BASE}/watch.html?v=abc12345678&debug=1` });
    await cdp.waitFor(`window.__WATCH_DEBUG__`);
    await sleep(300);
    await cdp.evaluate(`window.__WATCH_DEBUG__.setData(${JSON.stringify({
      videoId: 'abc12345678',
      title: 'How cities stay cool',
      channel: 'EnOS Demo · TED-Ed',
      duration: '4:12',
      durationSeconds: 252,
      viewCount: '1.2M views',
      thumbnail: POSTER,
      hasCaptions: true,
      hasChinese: true,
      source: 'youtube',
      cues: CUES,
    })})`);
    await cdp.evaluate(`(() => {
      const mount = document.getElementById('yt-player');
      mount.style.background = 'linear-gradient(rgba(10,12,20,.15), rgba(10,12,20,.15)), url("${POSTER}") center/cover';
      document.getElementById('player-fallback').classList.add('hidden');
    })()`);
    await cdp.evaluate(`window.__WATCH_DEBUG__.sync(1.2)`);
    await sleep(500);
    await cdp.screenshot('watch.png');

    const state = await cdp.evaluate(`(() => {
      const debug = window.__WATCH_DEBUG__.state;
      return {
        cues: debug.cues.length,
        activeCue: debug.activeCue,
        activeWord: debug.activeWord,
        activeChars: debug.activeChars,
        activeWordText: document.querySelector('.word.active')?.textContent || '',
        activeZhChars: document.querySelectorAll('.zh-char.active').length,
        enCues: document.querySelectorAll('#sub-en .cue').length,
        zhCues: document.querySelectorAll('#sub-en .cue .zh-text').length,
        title: document.querySelector('.watch-head h1')?.textContent,
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      };
    })()`);
    console.log('  state', JSON.stringify(state));

    if (MOBILE) {
      await cdp.evaluate(`document.querySelectorAll('.cue')[1]?.scrollIntoView({ block: 'center' })`);
      await cdp.screenshot('watch-mobile.png');
    }

    const checks = {
      ok: state.cues === 4 && state.activeCue === 0 && state.activeWord >= 0
        && state.activeWordText && state.activeZhChars > 0
        && state.enCues === 4 && state.zhCues === 4
        && state.scrollWidth <= state.innerWidth + 1
        && Object.entries(podcastChecks).every(([key, value]) => key === 'title' || value === true),
      podcast: podcastChecks,
      state,
      consoleErrors: cdp.logs,
      exceptions: cdp.exceptions,
    };
    await writeFile(path.join(SHOTS, 'video-smoke.json'), JSON.stringify(checks, null, 2));
    console.log(JSON.stringify(checks, null, 2));
    if (!checks.ok || cdp.exceptions.length) process.exitCode = 2;
  } finally {
    chrome.kill();
    await sleep(300);
  }
}

main().catch((error) => {
  console.error('VIDEO SMOKE FAILED:', error.message);
  process.exitCode = 1;
});

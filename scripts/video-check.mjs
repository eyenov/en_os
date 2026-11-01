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
const MOBILE = process.argv.includes('--mobile') || process.env.ENOS_MOBILE === '1';
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

async function settleVideoLayout(cdp) {
  await cdp.evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  await cdp.waitFor(`!document.getElementById('detail-window-grid').getAnimations({ subtree: true }).some(animation => animation.playState === 'running')`);
}

async function switchLocale(cdp, locale) {
  await cdp.evaluate(`(() => {
    document.getElementById('studio-language-menu').open = true;
    const select = document.getElementById('studio-language');
    select.value = ${JSON.stringify(locale)};
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await cdp.waitFor(`document.documentElement.lang === ${JSON.stringify(locale)} && !document.getElementById('studio-language-menu').open`);
}

async function englishSurface(cdp, selector) {
  const issues = await cdp.evaluate(`(() => {
    const roots = [document.querySelector(${JSON.stringify(selector)}), document.querySelector('.studio-rail')].filter(Boolean);
    const visible = element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden';
    const leftovers = [];
    for (const root of roots) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (visible(node.parentElement) && !node.parentElement.closest('[translate="no"], script, style') && /[\\u3400-\\u9fff]/.test(node.data)) leftovers.push(node.data.trim());
      }
      for (const element of root.querySelectorAll('[title], [aria-label], [placeholder], [alt]')) {
        if (!visible(element) || element.closest('[translate="no"]')) continue;
        for (const name of ['title', 'aria-label', 'placeholder', 'alt']) {
          const value = element.getAttribute(name);
          if (value && /[\\u3400-\\u9fff]/.test(value)) leftovers.push(name + ': ' + value);
        }
      }
      if (root.scrollWidth > root.clientWidth + 1) leftovers.push('overflow: ' + root.id);
    }
    if (document.documentElement.scrollWidth > innerWidth + 1) leftovers.push('page overflow');
    return leftovers;
  })()`);
  if (issues.length) console.log('  English UI issues', selector, JSON.stringify(issues));
  return issues.length === 0;
}

async function checkFullscreen(cdp, name, preserved) {
  await cdp.evaluate(`document.getElementById('studio-fullscreen').click()`);
  await cdp.waitFor(`document.fullscreenElement === document.documentElement && document.getElementById('studio-fullscreen').getAttribute('aria-pressed') === 'true'`);
  await settleVideoLayout(cdp);
  let passed = await cdp.evaluate(`(() => {
    const button = document.getElementById('studio-fullscreen');
    const rect = button.getBoundingClientRect();
    return document.documentElement.matches(':fullscreen') && button.title === '退出全屏' && !button.disabled
      && rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth
      && document.documentElement.scrollWidth <= innerWidth + 1 && (${preserved});
  })()`);
  await cdp.screenshot(`${name}-fullscreen${MOBILE ? '-mobile' : ''}.png`);
  await cdp.evaluate(`document.getElementById('studio-fullscreen').click()`);
  await cdp.waitFor(`!document.fullscreenElement && document.getElementById('studio-fullscreen').getAttribute('aria-pressed') === 'false' && !document.getElementById('studio-fullscreen').disabled`);
  passed = passed && await cdp.evaluate(preserved);
  await cdp.evaluate(`document.getElementById('studio-fullscreen').click()`);
  await cdp.waitFor(`document.fullscreenElement === document.documentElement && !document.getElementById('studio-fullscreen').disabled`);
  await cdp.evaluate(`document.exitFullscreen()`);
  await cdp.waitFor(`!document.fullscreenElement && document.getElementById('studio-fullscreen').title === '进入全屏'`);
  await settleVideoLayout(cdp);
  return passed && await cdp.evaluate(preserved);
}

async function dragWindow(cdp, selector, deltaX, deltaY, touch = false) {
  if (selector.includes('ui-resizable')) {
    const hover = await cdp.evaluate(`(() => {
      const panel = document.querySelector(${JSON.stringify(selector)}).closest('[data-panel]');
      panel.scrollIntoView({ block: 'end', inline: 'nearest' });
      const rect = panel.getBoundingClientRect();
      return { x: Math.round(rect.right - 12), y: Math.round(rect.bottom - 12) };
    })()`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...hover });
    await cdp.waitFor(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().width > 0`);
  }
  const origin = await cdp.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    element.scrollIntoView({ block: ${JSON.stringify(touch ? deltaY < 0 ? 'end' : 'start' : 'center')}, inline: 'nearest' });
    const rect = element.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  })()`);
  if (touch) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...origin, id: 1 }] });
    if (!selector.includes('ui-resizable')) await cdp.waitFor(`document.querySelector(${JSON.stringify(selector)}).closest('[data-panel]').classList.contains('ui-draggable-armed')`);
  } else {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...origin });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...origin, button: 'left', buttons: 1, clickCount: 1 });
  }
  for (let step = 1; step <= 12; step += 1) {
    const point = { x: Math.round(origin.x + deltaX * step / 12), y: Math.round(origin.y + deltaY * step / 12) };
    if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...point, id: 1 }] });
    else await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point, button: 'left', buttons: 1 });
  }
  if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  else await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: origin.x + deltaX, y: origin.y + deltaY, button: 'left', buttons: 0, clickCount: 1 });
  await cdp.waitFor(`!document.getElementById('detail-window-grid').classList.contains('is-layout-dragging') && !document.getElementById('detail-window-grid').getAnimations({ subtree: true }).some(animation => animation.playState === 'running')`);
}

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

const DETAIL_CUES = Array.from({ length: 3 }, (_, cycle) => CUES.map((cue) => ({
  ...cue, start: cue.start + cycle * 14.4, end: cue.end + cycle * 14.4,
  words: cue.words.map((word) => ({ ...word, start: word.start + cycle * 14.4, end: word.end + cycle * 14.4 })),
}))).flat();

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
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: MOBILE });

    console.log('1. search workspace');
    await cdp.send('Page.navigate', { url: `${BASE}/videos.html?debug=1` });
    await cdp.waitFor(`document.querySelector('.studio-shell')`);
    await sleep(500);
    await cdp.screenshot('video-search.png');
    const i18nChecks = {
      defaultChinese: await cdp.evaluate(`document.documentElement.lang === 'zh-CN' && document.getElementById('studio-language').value === 'zh-CN' && document.getElementById('rail-settings').title === '设置'`),
    };

    console.log('2. workspace navigation and settings');
    await cdp.evaluate(`(async () => {
      const { saveSettings } = await import('/js/store.js');
      saveSettings({ provider: 'custom', keys: { custom: 'fixture-key-not-secret' }, baseUrls: { custom: 'https://fixture.invalid/v1' }, models: { custom: 'fixture-model' }, youtubeKey: 'fixture-youtube-key', aiMode: 'off' });
      localStorage.setItem('fixture.untouched', 'keep');
    })()`);
    await cdp.evaluate(`document.getElementById('rail-settings').click()`);
    await cdp.waitFor(`document.querySelector('#settings-view .provider-tab')`);
    const workspaceChecks = await cdp.evaluate(`(() => {
      const rail = document.querySelector('.studio-rail').getBoundingClientRect();
      const settings = document.getElementById('rail-settings').getBoundingClientRect();
      const view = document.getElementById('settings-view');
      return {
        tabsInRail: [...document.querySelectorAll('.studio-tab')].length === 3 && [...document.querySelectorAll('.studio-tab')].every((button) => button.closest('.studio-rail')),
        libraryRemoved: !document.getElementById('rail-videos') && !document.querySelector('.studio-main > .studio-tabs'),
        standaloneChatRemoved: !document.getElementById('rail-chat') && !document.getElementById('chat-view'),
        legacySettingsRemoved: !view.querySelector('input[type="range"], select:not(#interface-language)') && !/学习报告|模型与语音|本地引擎/.test(view.textContent),
        leftRail: rail.left === 0 && rail.height === innerHeight,
        settingsAtBottom: settings.bottom > innerHeight - 80 && settings.right <= rail.right,
        cleanChrome: !document.querySelector('.studio-topbar, .studio-brand, .studio-wordmark, .rail-home, #nav'),
        settingsLoaded: !view.classList.contains('hidden') && document.querySelectorAll('#settings-view .provider-tab').length > 0,
        mediaSelectionClears: [...document.querySelectorAll('.studio-tab')].every((button) => !button.classList.contains('active') && button.getAttribute('aria-selected') === 'false'),
        noOverflow: document.documentElement.scrollWidth <= innerWidth + 1 && view.scrollWidth <= view.clientWidth + 1,
      };
    })()`);
    await cdp.screenshot(MOBILE ? 'workspace-settings-mobile.png' : 'workspace-settings.png');
    await cdp.evaluate(`(() => {
      window.__I18N_SETTINGS_INPUTS__ = [...document.querySelectorAll('#settings-view input')].map(input => ({ input, value: input.value, type: input.type }));
      const select = document.getElementById('interface-language');
      select.value = 'en';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    i18nChecks.settingsEnglish = await englishSurface(cdp, '#settings-view');
    i18nChecks.settingsDraftsPreserved = await cdp.evaluate(`document.getElementById('studio-language').value === 'en' && document.querySelector('#settings-view h1').textContent === 'Settings' && window.__I18N_SETTINGS_INPUTS__.every(({ input, value, type }) => input.isConnected && input.value === value && input.type === type)`);
    await cdp.evaluate(`(() => {
      const originalFetch = window.fetch;
      window.fetch = (resource, options) => {
        if (resource !== '/api/chat') return originalFetch.call(window, resource, options);
        window.fetch = originalFetch;
        return Promise.resolve(new Response(JSON.stringify({ error: { code: 'BAD_KEY', message: '上游返回 401：fixture-key-rejected' } }), { status: 401, headers: { 'Content-Type': 'application/json' } }));
      };
      [...document.querySelectorAll('#settings-view button')].find(button => button.textContent === 'Test connection').click();
    })()`);
    await cdp.waitFor(`document.querySelector('#settings-view .test-result.err')`);
    i18nChecks.connectionErrorEnglish = await cdp.evaluate(`document.querySelector('#settings-view .test-result').textContent.includes('The provider rejected the API key')`);
    await cdp.screenshot(MOBILE ? 'settings-english-mobile.png' : 'settings-english.png');
    if (MOBILE) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { ...VIEWPORT, width: 320, height: 568, screenWidth: 320, screenHeight: 568 });
      i18nChecks.settingsSmallEnglish = await englishSurface(cdp, '#settings-view');
      await cdp.screenshot('settings-english-320.png');
      await cdp.send('Emulation.setDeviceMetricsOverride', VIEWPORT);
    }
    await switchLocale(cdp, 'zh-CN');
    i18nChecks.connectionErrorSwitchesBack = await cdp.evaluate(`document.querySelector('#settings-view .test-result').textContent.includes('上游服务拒绝了 API Key') && document.getElementById('interface-language').value === 'zh-CN'`);
    await cdp.evaluate(`(() => {
      window.__settingsResetButton = [...document.querySelectorAll('#settings-view button')].find((button) => button.textContent === '恢复默认设置');
      window.__settingsResetButton.focus();
      window.__settingsResetButton.click();
    })()`);
    await cdp.waitFor(`document.querySelector('#modal-root dialog[open]')`);
    workspaceChecks.confirmationIsModal = await cdp.evaluate(`document.querySelector('#modal-root dialog').matches(':modal') && document.querySelector('#modal-root dialog').contains(document.activeElement)`);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await cdp.waitFor(`!document.querySelector('#modal-root dialog')`);
    workspaceChecks.cancelKeepsSettings = await cdp.evaluate(`(async () => {
      const { getSettings } = await import('/js/store.js');
      const settings = getSettings();
      return settings.provider === 'custom' && settings.models.custom === 'fixture-model' && document.activeElement === window.__settingsResetButton;
    })()`);
    await cdp.evaluate(`window.__settingsResetButton.click()`);
    await cdp.waitFor(`document.querySelector('#modal-root dialog[open]')`);
    await cdp.evaluate(`document.querySelector('#modal-root .btn-primary').click()`);
    await cdp.waitFor(`!document.querySelector('#modal-root dialog')`);
    workspaceChecks.restorePreservesKeys = await cdp.evaluate(`(async () => {
      const { getSettings } = await import('/js/store.js');
      const settings = getSettings();
      [...document.querySelectorAll('#settings-view .provider-tab')].find((button) => button.textContent.includes('自定义')).click();
      const inputs = [...document.querySelectorAll('#settings-view input')];
      return settings.provider === 'deepseek' && settings.aiMode === 'auto' && settings.keys.custom === 'fixture-key-not-secret' && settings.youtubeKey === 'fixture-youtube-key'
        && Object.keys(settings.baseUrls).length === 0 && Object.keys(settings.models).length === 0
        && inputs.some((input) => input.value === 'fixture-key-not-secret') && inputs.some((input) => input.value === 'fixture-youtube-key')
        && !inputs.some((input) => ['fixture-model', 'https://fixture.invalid/v1'].includes(input.value));
    })()`);
    await cdp.evaluate(`(() => {
      window.__settingsClearButton = [...document.querySelectorAll('#settings-view button')].find((button) => button.textContent === '清空全部数据');
      window.__settingsClearButton.focus();
      window.__settingsClearButton.click();
    })()`);
    await cdp.waitFor(`document.querySelector('#modal-root dialog[open]')`);
    await cdp.evaluate(`document.querySelector('#modal-root .btn-ghost').click()`);
    workspaceChecks.clearCancelRestoresFocus = await cdp.evaluate(`!document.querySelector('#modal-root dialog') && document.activeElement === window.__settingsClearButton`);
    await cdp.evaluate(`window.__settingsClearButton.click()`);
    await cdp.waitFor(`document.querySelector('#modal-root dialog[open]')`);
    await cdp.evaluate(`document.querySelector('#modal-root .btn-primary').click()`);
    await cdp.waitFor(`document.getElementById('settings-view').classList.contains('hidden')`);
    workspaceChecks.clearIsScoped = await cdp.evaluate(`(() => {
      const ok = !Object.keys(localStorage).some((key) => key.startsWith('enos.')) && localStorage.getItem('fixture.untouched') === 'keep';
      localStorage.removeItem('fixture.untouched');
      return ok;
    })()`);
    await cdp.send('Page.navigate', { url: `${BASE}/?debug=1#/settings` });
    await cdp.waitFor(`window.__VIDEOS_DEBUG__ && document.querySelector('#settings-view .provider-tab')`);
    workspaceChecks.legacySettings = await cdp.evaluate(`new URL(location.href).searchParams.get('view') === 'settings' && !document.querySelector('#nav')`);
    await cdp.send('Page.reload');
    await cdp.waitFor(`window.__VIDEOS_DEBUG__ && document.querySelector('#settings-view .provider-tab')`);
    workspaceChecks.settingsReloads = await cdp.evaluate(`!document.getElementById('settings-view').classList.contains('hidden')`);
    await cdp.evaluate(`document.getElementById('tab-youtube').click()`);
    workspaceChecks.returnsToContent = await cdp.evaluate(`document.getElementById('settings-view').classList.contains('hidden') && !document.getElementById('youtube-pane').classList.contains('hidden')`);
    console.log('  workspace', JSON.stringify(workspaceChecks));

    console.log('3. search results fixture');
    await cdp.evaluate(`window.__VIDEOS_DEBUG__.render(${JSON.stringify(SEARCH_ITEMS)}, { query: 'IELTS listening', source: 'youtube-web', warning: 'YouTube Data API 不可用（fixture failure），已自动改用网页检索。' })`);
    await sleep(400);
    await cdp.screenshot('video-results.png', true);
    await switchLocale(cdp, 'en');
    i18nChecks.videoSearchEnglish = await englishSurface(cdp, '#youtube-pane');
    await switchLocale(cdp, 'zh-CN');

    console.log('3a. compact in-pane video detail');
    const shadowingChecks = {};
    const fullscreenChecks = {};
    await cdp.evaluate(`(() => {
      const originalFetch = window.fetch;
      window.fetch = (resource, options) => {
        if (resource !== '/api/youtube/captions') return originalFetch.call(window, resource, options);
        window.fetch = originalFetch;
        return Promise.resolve(new Response(JSON.stringify({ cues: ${JSON.stringify(DETAIL_CUES)} }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      };
      window.__SPEECH_INSTANCES__ = [];
      window.__PRONUNCIATION_EXAMPLES__ = [];
      Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: class {
        constructor(text) { this.text = text; }
      } });
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
        speaking: false,
        getVoices() { return [{ lang: 'en-US', name: 'Fixture English' }]; },
        speak(utterance) { this.speaking = true; window.__PRONUNCIATION_EXAMPLES__.push(utterance); },
        cancel() { this.speaking = false; },
        finish() { this.speaking = false; window.__PRONUNCIATION_EXAMPLES__.at(-1).onend?.(); },
      } });
      window.SpeechRecognition = class {
        constructor() { this.results = []; window.__SPEECH_INSTANCES__.push(this); }
        start() { this.running = true; this.onstart?.(); if (window.__SPEECH_FAILURE__) { const error = window.__SPEECH_FAILURE__; window.__SPEECH_FAILURE__ = null; this.onerror?.({ error }); } }
        abort() { this.running = false; this.aborted = true; this.onend?.(); }
        emit(text, final = false) {
          const index = this.results.length && !this.results.at(-1).isFinal ? this.results.length - 1 : this.results.length;
          this.results[index] = Object.assign([{ transcript: text }], { isFinal: final });
          this.onspeechstart?.();
          this.onresult?.({ resultIndex: index, results: this.results });
        }
      };
      window.YT = { Player: class {
        constructor(mount, options) {
          this.time = 0;
          this.muted = false;
          this.rate = 1;
          this.playing = false;
          window.__VIDEO_PLAYER__ = this;
          this.events = options.events;
          mount.style.cssText = 'width:100%;height:100%';
          const image = document.createElement('img');
          image.src = ${JSON.stringify(POSTER)};
          image.alt = 'Video fixture';
          image.style.cssText = 'width:100%;height:100%;display:block;object-fit:cover';
          mount.replaceChildren(image);
          const frame = document.createElement('iframe');
          frame.hidden = true;
          frame.title = 'Player identity fixture';
          mount.append(frame);
          window.__PLAYER_FRAME__ = frame;
          queueMicrotask(() => this.events.onReady({ target: this }));
        }
        getCurrentTime() { return this.time; }
        getPlayerState() { return this.playing ? 1 : 2; }
        isMuted() { return this.muted; }
        mute() { this.muted = true; }
        unMute() { this.muted = false; }
        getPlaybackRate() { return this.rate; }
        getAvailablePlaybackRates() { return [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]; }
        setPlaybackRate(rate) { this.rate = rate; }
        seekTo(time) { this.time = time; }
        playVideo() { this.playing = true; this.events.onStateChange({ data: 1, target: this }); }
        pauseVideo() { this.playing = false; this.events.onStateChange({ data: 2, target: this }); }
        destroy() {}
      } };
      localStorage.removeItem('enos.detail.left.v1');
      document.querySelector('#video-results .preview-title').click();
    })()`);
    await cdp.waitFor(`!document.getElementById('video-detail').classList.contains('hidden') && document.querySelectorAll('#detail-en .detail-cue').length === ${DETAIL_CUES.length}`);
    await cdp.waitFor(`document.querySelector('#detail-player img')?.naturalWidth > 0`);
    await settleVideoLayout(cdp);
    const detailChecks = await cdp.evaluate(`(() => {
      const bounds = (selector) => document.querySelector(selector).getBoundingClientRect();
      const header = bounds('.detail-head');
      const title = bounds('#detail-title');
      const meta = bounds('#detail-meta');
      const player = bounds('.detail-player-shell');
      const subtitles = bounds('[data-panel="en"] .detail-panel-surface');
      const detail = bounds('#video-detail');
      const body = document.getElementById('detail-body');
      return {
        compactHeader: header.height <= 46,
        inlineMetadata: meta.width > 0 && meta.left >= title.right && Math.abs(meta.bottom - title.bottom) <= 4 && parseFloat(getComputedStyle(document.getElementById('detail-meta')).fontSize) < parseFloat(getComputedStyle(document.getElementById('detail-title')).fontSize),
        tightMargins: bounds('[data-panel="video"] .detail-panel-surface').top - header.bottom <= 10 && player.left - detail.left <= 11,
        labelsRemoved: !document.querySelector('.detail-col-title'),
        subtitleAlignment: ${MOBILE} ? true : Math.abs(bounds('[data-panel="video"] .detail-panel-surface').top - subtitles.top) <= 1,
        playerRatio: Math.abs(player.width / player.height - 16 / 9) < 0.02,
        noOverflow: document.documentElement.scrollWidth <= innerWidth + 1 && body.scrollWidth <= body.clientWidth + 1,
      };
    })()`);
    await cdp.screenshot(MOBILE ? 'video-detail-mobile.png' : 'video-detail.png');
    const originalDetailTitle = await cdp.evaluate(`document.getElementById('detail-title').textContent`);
    await cdp.evaluate(`document.getElementById('detail-title').textContent = 'How everyday choices transform our cities: an extended conversation about trees, public transport and the future of neighbourhoods'`);
    const detailSizes = MOBILE
      ? [{ width: 320, height: 568 }]
      : [{ width: 1024, height: 768 }, { width: 768, height: 1024 }];
    detailChecks.responsiveLayout = true;
    for (const size of detailSizes) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { ...VIEWPORT, ...size, screenWidth: size.width, screenHeight: size.height });
      await settleVideoLayout(cdp);
      const fits = await cdp.evaluate(`(() => {
        const header = document.querySelector('.detail-head').getBoundingClientRect();
        const title = document.getElementById('detail-title');
        const meta = document.getElementById('detail-meta').getBoundingClientRect();
        const player = document.querySelector('.detail-player-shell').getBoundingClientRect();
        const subtitles = document.querySelector('[data-panel="en"] .detail-panel-surface').getBoundingClientRect();
        const body = document.getElementById('detail-body');
        const videoPanel = document.querySelector('[data-panel="video"] .detail-panel-surface').getBoundingClientRect();
        return header.height <= 46 && title.scrollHeight <= title.clientHeight + 1 && meta.width > 0 && meta.left >= title.getBoundingClientRect().right && document.documentElement.scrollWidth <= innerWidth + 1 && body.scrollWidth <= body.clientWidth + 1 && (document.getElementById('detail-window-grid').gridstack.getColumn() === 1 || Math.abs(videoPanel.top - subtitles.top) <= 1);
      })()`);
      detailChecks.responsiveLayout = detailChecks.responsiveLayout && fits;
      await cdp.screenshot('video-detail-' + size.width + '.png');
    }
    await cdp.evaluate(`document.getElementById('detail-title').textContent = ${JSON.stringify(originalDetailTitle)}`);
    await cdp.send('Emulation.setDeviceMetricsOverride', VIEWPORT);
    await settleVideoLayout(cdp);
    await cdp.evaluate(`document.querySelectorAll('#detail-en .detail-cue')[1].click()`);
    await cdp.waitFor(`document.querySelectorAll('#detail-en .detail-cue')[1].classList.contains('active') && document.querySelectorAll('#detail-en .word.active').length > 0`);
    detailChecks.subtitleSeeking = await cdp.evaluate(`document.querySelectorAll('#detail-zh .detail-cue')[1].classList.contains('active') && document.querySelectorAll('#detail-en .word.active').length > 0`);

    console.log('3a1. independent window drag, resize and persistence');
    const layoutChecks = {};
    const gridMetrics = await cdp.evaluate(`(() => {
      const grid = document.getElementById('detail-window-grid').gridstack;
      const layout = grid.save(false, false, undefined, grid.getColumn());
      window.__WINDOW_PLAYER__ = window.__VIDEO_PLAYER__;
      window.__WINDOW_FRAME__ = window.__PLAYER_FRAME__;
      window.__WINDOW_FRAME_CONTEXT__ = window.__PLAYER_FRAME__.contentWindow;
      window.__WINDOW_FRAME_PARENT__ = window.__PLAYER_FRAME__.parentElement;
      window.__WINDOW_TIME__ = window.__VIDEO_PLAYER__.time;
      window.__WINDOW_PLAYING__ = window.__VIDEO_PLAYER__.playing;
      window.__WINDOW_EN__ = { ...layout.find(item => item.id === 'en') };
      document.getElementById('detail-chat-input').value = 'A draft that must survive rearranging';
      return { width: grid.cellWidth(), height: grid.getCellHeight() };
    })()`);
    layoutChecks.fourIndependentWindows = await cdp.evaluate(`document.querySelectorAll('#detail-window-grid > .detail-panel').length === 4 && document.querySelectorAll('#detail-window-grid .detail-panel-handle').length === 4 && !document.getElementById('detail-resize')`);
    await dragWindow(cdp, '[data-panel="en"] .detail-panel-handle', MOBILE ? 0 : -gridMetrics.width * 6, MOBILE ? -gridMetrics.height * 6 : 0, MOBILE);
    layoutChecks.dragMovesOnlySelectedWindow = await cdp.evaluate(`(() => {
      const node = document.querySelector('[data-panel="en"]').gridstackNode;
      return node.x !== window.__WINDOW_EN__.x || node.y !== window.__WINDOW_EN__.y;
    })()`);
    layoutChecks.everyWindowCanMove = true;
    for (const id of ['video', 'agent', 'zh']) {
      const previous = await cdp.evaluate(`(() => {
        const grid = document.getElementById('detail-window-grid').gridstack;
        const node = document.querySelector('[data-panel="${id}"]').gridstackNode;
        const sorted = grid.engine.nodes.slice().sort((left, right) => left.y - right.y);
        const index = sorted.indexOf(node);
        const neighbor = sorted[index > 0 ? index - 1 : index + 1];
        return { x: node.x, y: node.y, deltaY: ${MOBILE} ? (neighbor.y - node.y) * grid.getCellHeight() : grid.getCellHeight() };
      })()`);
      await dragWindow(cdp, `[data-panel="${id}"] .detail-panel-handle`, 0, previous.deltaY, MOBILE);
      const moved = await cdp.evaluate(`(() => { const node = document.querySelector('[data-panel="${id}"]').gridstackNode; return node.x !== ${previous.x} || node.y !== ${previous.y}; })()`);
      layoutChecks.everyWindowCanMove = layoutChecks.everyWindowCanMove && moved;
    }
    layoutChecks.playerAndDraftSurviveDrag = await cdp.evaluate(`window.__VIDEO_PLAYER__ === window.__WINDOW_PLAYER__ && window.__PLAYER_FRAME__ === window.__WINDOW_FRAME__ && window.__PLAYER_FRAME__.contentWindow === window.__WINDOW_FRAME_CONTEXT__ && window.__PLAYER_FRAME__.parentElement === window.__WINDOW_FRAME_PARENT__ && window.__VIDEO_PLAYER__.time === window.__WINDOW_TIME__ && window.__VIDEO_PLAYER__.playing === window.__WINDOW_PLAYING__ && document.getElementById('detail-chat-input').value === 'A draft that must survive rearranging' && document.querySelectorAll('#detail-en .detail-cue')[1].classList.contains('active')`);
    await cdp.evaluate(`window.__VIDEO_PLAYER__.playVideo()`);
    fullscreenChecks.youtube = await checkFullscreen(cdp, 'youtube', `window.__VIDEO_PLAYER__ === window.__WINDOW_PLAYER__ && window.__PLAYER_FRAME__ === window.__WINDOW_FRAME__ && window.__PLAYER_FRAME__.contentWindow === window.__WINDOW_FRAME_CONTEXT__ && window.__VIDEO_PLAYER__.time === window.__WINDOW_TIME__ && window.__VIDEO_PLAYER__.playing && document.getElementById('detail-chat-input').value === 'A draft that must survive rearranging' && !document.getElementById('video-detail').classList.contains('hidden')`);
    await cdp.evaluate(`window.__VIDEO_PLAYER__.pauseVideo()`);
    await cdp.evaluate(`window.__BEFORE_WINDOW_RESIZE__ = { w: document.querySelector('[data-panel="agent"]').gridstackNode.w, h: document.querySelector('[data-panel="agent"]').gridstackNode.h }`);
    await dragWindow(cdp, '[data-panel="agent"] .ui-resizable-se', MOBILE ? 0 : gridMetrics.width, gridMetrics.height);
    layoutChecks.pointerResizesIndependentWindow = await cdp.evaluate(`(() => { const node = document.querySelector('[data-panel="agent"]').gridstackNode; return node.w !== window.__BEFORE_WINDOW_RESIZE__.w || node.h !== window.__BEFORE_WINDOW_RESIZE__.h; })()`);
    await cdp.evaluate(`(() => {
      const panel = document.querySelector('[data-panel="zh"]');
      window.__BEFORE_KEYBOARD_SIZE__ = panel.gridstackNode.h;
      panel.querySelector('button').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true }));
    })()`);
    layoutChecks.keyboardResizesWindow = await cdp.evaluate(`document.querySelector('[data-panel="zh"]').gridstackNode.h === window.__BEFORE_KEYBOARD_SIZE__ + 1`);
    await settleVideoLayout(cdp);
    layoutChecks.windowsAvoidOverlap = await cdp.evaluate(`(() => {
      const grid = document.getElementById('detail-window-grid').gridstack;
      const items = grid.getGridItems().map(panel => panel.querySelector('.detail-panel-surface').getBoundingClientRect());
      return items.every((item, index) => items.slice(index + 1).every(other => item.right <= other.left + 1 || other.right <= item.left + 1 || item.bottom <= other.top + 1 || other.bottom <= item.top + 1));
    })()`);
    layoutChecks.positionsSavedWithoutContent = await cdp.evaluate(`(() => {
      const stored = JSON.parse(localStorage.getItem(${JSON.stringify(MOBILE ? 'enos.youtube.layout.v1.mobile' : 'enos.youtube.layout.v1')}));
      return stored.length === 4 && stored.every(item => Object.keys(item).sort().join(',') === 'h,id,w,x,y');
    })()`);
    layoutChecks.freshControllerRestoresSavedLayout = await cdp.evaluate(`(async () => {
      const { VideoWindowLayout } = await import('/js/video-layout.js');
      const source = document.getElementById('detail-window-grid').gridstack;
      const snapshot = grid => JSON.stringify(grid.getGridItems().map(panel => {
        const { id, x, y, w, h } = panel.gridstackNode;
        return { id, x, y, w, h };
      }).sort((left, right) => left.id.localeCompare(right.id)));
      const expected = snapshot(source);
      const host = document.createElement('div');
      host.className = 'detail-body';
      host.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;width:' + document.getElementById('detail-body').clientWidth + 'px;height:600px';
      const element = document.createElement('div');
      element.className = 'grid-stack detail-window-grid';
      for (const panel of source.getGridItems()) {
        const copy = panel.cloneNode(false);
        const handle = document.createElement('button');
        handle.className = 'detail-panel-handle';
        copy.append(handle);
        element.append(copy);
      }
      host.append(element);
      document.body.append(host);
      let controller;
      try {
        controller = new VideoWindowLayout({ host, element, status: document.createElement('span') });
        return snapshot(controller.grid) === expected;
      } finally {
        controller?.observer.disconnect();
        controller?.grid.destroy(false);
        host.remove();
      }
    })()`);
    await cdp.evaluate(`(() => {
      const grid = document.getElementById('detail-window-grid').gridstack;
      window.__SAVED_WINDOW_POSITIONS__ = JSON.stringify(grid.save(false, false, undefined, grid.getColumn()).map(({ id, x, y, w, h }) => ({ id, x, y, w, h })).sort((left, right) => left.id.localeCompare(right.id)));
      document.getElementById('detail-back').click();
      const originalFetch = window.fetch;
      window.fetch = (resource, options) => {
        if (resource !== '/api/youtube/captions') return originalFetch.call(window, resource, options);
        window.fetch = originalFetch;
        return Promise.resolve(new Response(JSON.stringify({ cues: ${JSON.stringify(DETAIL_CUES)} }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      };
      document.querySelector('#video-results .preview-title').click();
    })()`);
    await cdp.waitFor(`document.querySelectorAll('#detail-en .detail-cue').length === ${DETAIL_CUES.length} && window.__VIDEO_PLAYER__ !== window.__WINDOW_PLAYER__`);
    layoutChecks.reopeningKeepsPositions = await cdp.evaluate(`(() => {
      const grid = document.getElementById('detail-window-grid').gridstack;
      return JSON.stringify(grid.save(false, false, undefined, grid.getColumn()).map(({ id, x, y, w, h }) => ({ id, x, y, w, h })).sort((left, right) => left.id.localeCompare(right.id))) === window.__SAVED_WINDOW_POSITIONS__;
    })()`);
    await cdp.evaluate(`document.getElementById('detail-layout-reset').click()`);
    layoutChecks.resetRestoresDefault = await cdp.evaluate(`(() => {
      const grid = document.getElementById('detail-window-grid').gridstack;
      const video = document.querySelector('[data-panel="video"]').gridstackNode;
      const english = document.querySelector('[data-panel="en"]').gridstackNode;
      return grid.engine.nodes.length === 4 && video.x === 0 && video.y === 0 && (${MOBILE} ? video.w === 1 && english.y > video.y : video.w === 6 && english.x === 6 && english.w === 3);
    })()`);
    await settleVideoLayout(cdp);
    await cdp.screenshot(MOBILE ? 'video-layout-mobile.png' : 'video-layout.png');
    await cdp.evaluate(`(() => {
      document.querySelector('[data-panel="agent"] .detail-panel-handle').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true }));
      const grid = document.getElementById('detail-window-grid').gridstack;
      window.__NORMAL_WINDOWS__ = JSON.stringify(grid.save(false, false, undefined, grid.getColumn()).map(({ id, x, y, w, h }) => ({ id, x, y, w, h })).sort((left, right) => left.id.localeCompare(right.id)));
    })()`);
    console.log('  layout', JSON.stringify(layoutChecks));
    await cdp.evaluate(`(() => {
      window.__I18N_PLAYER__ = window.__VIDEO_PLAYER__;
      window.__I18N_FRAME__ = window.__PLAYER_FRAME__;
      window.__I18N_VIDEO_TIME__ = window.__VIDEO_PLAYER__.time;
      window.__I18N_DRAFT__ = document.getElementById('detail-chat-input').value;
      window.__I18N_EN_CUE__ = [...document.querySelectorAll('#detail-en .detail-cue .word')].map(node => node.textContent).join(' ');
      window.__I18N_ZH_CUE__ = document.getElementById('detail-zh').textContent;
    })()`);
    await switchLocale(cdp, 'en');
    i18nChecks.videoDetailEnglish = await englishSurface(cdp, '#video-detail');
    i18nChecks.videoStatePreserved = await cdp.evaluate(`window.__VIDEO_PLAYER__ === window.__I18N_PLAYER__ && window.__PLAYER_FRAME__ === window.__I18N_FRAME__ && window.__VIDEO_PLAYER__.time === window.__I18N_VIDEO_TIME__ && document.getElementById('detail-chat-input').value === window.__I18N_DRAFT__ && [...document.querySelectorAll('#detail-en .detail-cue .word')].map(node => node.textContent).join(' ') === window.__I18N_EN_CUE__ && document.getElementById('detail-zh').textContent === window.__I18N_ZH_CUE__ && document.getElementById('studio-fullscreen').title === 'Enter fullscreen'`);
    await cdp.screenshot(MOBILE ? 'video-english-mobile.png' : 'video-english.png');
    await switchLocale(cdp, 'zh-CN');

    console.log('3b. speech-driven video practice');
    await cdp.evaluate(`(() => {
      window.__VIDEO_PLAYER__.pauseVideo();
      window.__VIDEO_PLAYER__.seekTo(0);
      window.__VIDEO_PLAYER__.setPlaybackRate(1.25);
      document.getElementById('detail-shadowing').click();
    })()`);
    await cdp.waitFor(`document.getElementById('video-detail').classList.contains('shadowing-active') && window.__SPEECH_INSTANCES__.at(-1).running`);
    shadowingChecks.videoStartsSilent = await cdp.evaluate(`window.__VIDEO_PLAYER__.muted && !window.__VIDEO_PLAYER__.playing && document.getElementById('detail-player').inert && !document.getElementById('detail-shadowing-bar').classList.contains('hidden')`);
    await cdp.waitFor(`document.querySelector('#detail-shadowing-bar .shadowing-ipa').textContent.includes('/')`);
    shadowingChecks.videoNextWordHasIpa = await cdp.evaluate(`document.querySelector('#detail-en .word.shadow-next').dataset.ipa.includes('/') && !document.querySelector('#detail-shadowing-bar .shadowing-pronounce').disabled`);
    shadowingChecks.pronunciationButtonStaysNearWord = await cdp.evaluate(`(() => {
      const prompt = document.querySelector('#detail-shadowing-bar .shadowing-prompt');
      const textRight = (element) => { const range = document.createRange(); range.selectNodeContents(element); return range.getBoundingClientRect().right; };
      const right = Math.max(textRight(prompt.querySelector('strong')), textRight(prompt.querySelector('.shadowing-ipa')));
      const left = prompt.querySelector('button').getBoundingClientRect().left;
      const labelGap = prompt.querySelector('strong').getBoundingClientRect().left - textRight(prompt.querySelector('small'));
      return left >= right && left - right <= 10 && labelGap >= 0 && labelGap <= 10;
    })()`);
    await cdp.evaluate(`window.__SPEECH_INSTANCES__.at(-1).emit('banana clouds')`);
    shadowingChecks.unrelatedVoiceDoesNotAdvance = await cdp.evaluate(`document.querySelector('#detail-shadowing-bar progress').value === 0 && !document.querySelector('#detail-en .word.active')`);
    await cdp.evaluate(`window.__SPEECH_INSTANCES__.at(-1).emit('Cities')`);
    await cdp.waitFor(`window.__VIDEO_PLAYER__.time > 0.1 && !window.__VIDEO_PLAYER__.playing`);
    shadowingChecks.videoVoiceHighlights = await cdp.evaluate(`document.querySelector('#detail-en .word.active')?.textContent === 'Cities' && document.querySelector('#detail-en .word.shadow-next')?.textContent === 'should'`);
    shadowingChecks.videoWaitsForVoice = await cdp.evaluate(`(async () => {
      const time = window.__VIDEO_PLAYER__.time;
      await new Promise((resolve) => setTimeout(resolve, 180));
      return window.__VIDEO_PLAYER__.time === time && !window.__VIDEO_PLAYER__.playing;
    })()`);
    await cdp.waitFor(`document.querySelector('#detail-en .word.shadow-next').dataset.ipa.includes('/')`);
    await cdp.evaluate(`(() => {
      window.__EXAMPLE_PROGRESS__ = document.querySelector('#detail-shadowing-bar progress').value;
      window.__EXAMPLE_TIME__ = window.__VIDEO_PLAYER__.time;
      document.querySelector('#detail-shadowing-bar .shadowing-pronounce').click();
    })()`);
    await cdp.waitFor(`window.speechSynthesis.speaking`);
    shadowingChecks.videoExamplePausesRecognition = await cdp.evaluate(`window.__SPEECH_INSTANCES__.at(-1).aborted && window.__PRONUNCIATION_EXAMPLES__.at(-1).text === 'should' && window.__PRONUNCIATION_EXAMPLES__.at(-1).lang === 'en-US' && window.__VIDEO_PLAYER__.muted && !window.__VIDEO_PLAYER__.playing && window.__VIDEO_PLAYER__.time === window.__EXAMPLE_TIME__ && document.querySelector('#detail-shadowing-bar progress').value === window.__EXAMPLE_PROGRESS__`);
    await cdp.evaluate(`window.speechSynthesis.finish()`);
    await cdp.waitFor(`window.__SPEECH_INSTANCES__.at(-1).running`);
    shadowingChecks.videoExampleResumesWithoutScoring = await cdp.evaluate(`document.querySelector('#detail-shadowing-bar progress').value === window.__EXAMPLE_PROGRESS__ && document.querySelector('#detail-en .shadowing-review').dataset.count === '1'`);
    await cdp.evaluate(`window.__SPEECH_INSTANCES__.at(-1).emit('should abandon idea', true)`);
    shadowingChecks.liveReviewNamesSkippedWord = await cdp.evaluate(`document.querySelector('#detail-en .shadowing-review-advice').textContent.includes('the') && document.querySelectorAll('#detail-en .detail-cue')[0].querySelectorAll('.word')[3].classList.contains('shadow-missed') && !document.querySelectorAll('#detail-en .detail-cue')[0].querySelectorAll('.word')[5].classList.contains('shadow-missed')`);
    await cdp.evaluate(`document.querySelector('#detail-shadowing-bar .shadowing-commands button:first-child').click(); window.__SPEECH_INSTANCES__.at(-1).emit('Cities')`);
    shadowingChecks.videoRepeatKeepsEachReview = await cdp.evaluate(`document.querySelector('#detail-en .shadowing-review').dataset.count === '2' && document.querySelectorAll('#detail-en .shadowing-review-record').length === 2 && document.querySelector('#detail-en .shadowing-review-meta').textContent.includes('2')`);
    await cdp.evaluate(`window.__HISTORY_PROGRESS__ = document.querySelector('#detail-shadowing-bar progress').value; document.querySelector('#detail-en .shadowing-review-history summary').click()`);
    shadowingChecks.historyDoesNotSeek = await cdp.evaluate(`document.querySelector('#detail-en .shadowing-review-history').open && document.querySelector('#detail-shadowing-bar progress').value === window.__HISTORY_PROGRESS__`);
    await cdp.evaluate(`window.__I18N_SPEECH_COUNT__ = window.__SPEECH_INSTANCES__.length; window.__I18N_PROGRESS__ = document.querySelector('#detail-shadowing-bar progress').value`);
    await switchLocale(cdp, 'en');
    i18nChecks.videoPracticeEnglish = await englishSurface(cdp, '#video-detail');
    i18nChecks.reviewsEnglish = await cdp.evaluate(`document.querySelector('#detail-shadowing-bar .shadowing-prompt small').textContent === 'Next word' && [...document.querySelectorAll('#detail-en .shadowing-review-record small')].every(node => node.textContent.startsWith('Attempt ')) && [...document.querySelectorAll('#detail-en .shadowing-review-record p')].some(node => node.textContent.includes('Read them clearly'))`);
    i18nChecks.microphonePreserved = await cdp.evaluate(`window.__SPEECH_INSTANCES__.length === window.__I18N_SPEECH_COUNT__ && window.__SPEECH_INSTANCES__.at(-1).running && document.querySelector('#detail-shadowing-bar progress').value === window.__I18N_PROGRESS__ && document.querySelector('#detail-en .shadowing-review').dataset.count === '2'`);
    await cdp.screenshot(MOBILE ? 'shadowing-english-mobile.png' : 'shadowing-english.png');
    if (MOBILE) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { ...VIEWPORT, width: 320, height: 568, screenWidth: 320, screenHeight: 568 });
      await settleVideoLayout(cdp);
      i18nChecks.practiceSmallEnglish = await englishSurface(cdp, '#video-detail');
      await cdp.screenshot('shadowing-english-320.png');
      await cdp.send('Emulation.setDeviceMetricsOverride', VIEWPORT);
      await settleVideoLayout(cdp);
    }
    await switchLocale(cdp, 'zh-CN');
    await cdp.evaluate(`document.querySelector('#detail-en .shadowing-review-history summary').click()`);
    await cdp.evaluate(`(() => {
      const realNow = performance.now.bind(performance);
      let time = realNow() + 1500;
      performance.now = () => time;
      try {
        window.__SPEECH_INSTANCES__.at(-1).emit('Cities should');
        window.__SLOW_RATE__ = window.__VIDEO_PLAYER__.rate;
        time += 180;
        window.__SPEECH_INSTANCES__.at(-1).emit('Cities should abandon the idea');
      } finally { performance.now = realNow; }
    })()`);
    shadowingChecks.videoAdaptsSpeechSpeed = await cdp.evaluate(`window.__VIDEO_PLAYER__.rate > window.__SLOW_RATE__ && window.__VIDEO_PLAYER__.muted && document.querySelector('#detail-en .word.active')?.textContent === 'idea'`);
    await cdp.evaluate(`(() => {
      window.__STALE_SPEECH__ = window.__SPEECH_INSTANCES__.at(-1).onresult;
      window.__SPEECH_PROGRESS__ = document.querySelector('#detail-shadowing-bar progress').value;
      document.querySelector('#detail-shadowing-bar .shadowing-commands button:nth-child(3)').click();
      window.__STALE_SPEECH__({ resultIndex: 0, results: [Object.assign([{ transcript: 'Cities should abandon the idea of building wider roads' }], { isFinal: true })] });
    })()`);
    shadowingChecks.videoPauseStopsMicrophone = await cdp.evaluate(`window.__SPEECH_INSTANCES__.at(-1).aborted && !window.__VIDEO_PLAYER__.playing && document.querySelector('#detail-shadowing-bar progress').value === window.__SPEECH_PROGRESS__`);
    await cdp.evaluate(`window.__PAUSED_EXAMPLE_INSTANCES__ = window.__SPEECH_INSTANCES__.length; document.querySelector('#detail-shadowing-bar .shadowing-pronounce').click()`);
    await cdp.waitFor(`window.speechSynthesis.speaking`);
    await cdp.evaluate(`window.speechSynthesis.finish()`);
    await cdp.waitFor(`!document.querySelector('#detail-shadowing-bar .shadowing-pronounce').classList.contains('is-playing')`);
    shadowingChecks.examplePreservesPausedMicrophone = await cdp.evaluate(`window.__SPEECH_INSTANCES__.length === window.__PAUSED_EXAMPLE_INSTANCES__ && !window.__SPEECH_INSTANCES__.at(-1).running && document.querySelector('#detail-shadowing-bar progress').value === window.__SPEECH_PROGRESS__`);
    await cdp.evaluate(`document.querySelector('#detail-shadowing-bar .shadowing-commands button:nth-child(3)').click()`);
    await cdp.evaluate(`document.querySelectorAll('#detail-en .detail-cue')[2].querySelectorAll('.word')[1].click()`);
    shadowingChecks.videoWordSeekRestartsListening = await cdp.evaluate(`document.querySelector('#detail-en .word.shadow-next')?.textContent === 'street' && window.__SPEECH_INSTANCES__.at(-1).running && window.__SPEECH_INSTANCES__.at(-2).aborted && !window.__VIDEO_PLAYER__.playing`);
    await cdp.evaluate(`window.__SPEECH_INSTANCES__.at(-1).emit(${JSON.stringify(DETAIL_CUES[2].en.split(' ').slice(1).join(' '))}, true)`);
    await cdp.evaluate(`(() => { for (const cue of ${JSON.stringify(DETAIL_CUES.slice(3, 11))}) window.__SPEECH_INSTANCES__.at(-1).emit(cue.en, true); })()`);
    await cdp.waitFor(`(() => { const word = document.querySelector('#detail-en .word.active'); if (!word) return false; const rect = word.getBoundingClientRect(); const bounds = document.getElementById('detail-en').getBoundingClientRect(); return rect.top >= bounds.top && rect.bottom <= bounds.bottom + 1; })()`);
    shadowingChecks.videoVoiceScrollsSubtitles = await cdp.evaluate(`document.querySelectorAll('#detail-en .detail-cue')[10].classList.contains('active') && document.getElementById('detail-en').scrollTop > 0`);
    shadowingChecks.videoPracticeLayout = await cdp.evaluate(`(() => {
      const bar = document.getElementById('detail-shadowing-bar');
      const player = document.querySelector('.detail-player-shell').getBoundingClientRect();
      const subtitles = document.querySelector('[data-panel="en"] .detail-panel-surface').getBoundingClientRect();
      return document.documentElement.scrollWidth <= innerWidth + 1 && bar.scrollWidth <= bar.clientWidth + 1
        && (${MOBILE} ? player.bottom <= subtitles.top && subtitles.height > 150 && subtitles.bottom <= innerHeight + 1 && getComputedStyle(document.querySelector('[data-panel="agent"]')).display === 'none' : Math.abs(document.querySelector('[data-panel="video"] .detail-panel-surface').getBoundingClientRect().top - subtitles.top) <= 1);
    })()`);
    shadowingChecks.videoChineseBelowAndReviewRight = await cdp.evaluate(`(() => {
      const row = document.querySelector('#detail-en .detail-cue.active');
      const english = row.querySelector('.detail-en');
      const chinese = row.querySelector('.detail-inline-zh');
      const content = row.querySelector('.subtitle-cue-main').getBoundingClientRect();
      const review = row.querySelector('.shadowing-review').getBoundingClientRect();
      return getComputedStyle(chinese).display !== 'none' && chinese.getBoundingClientRect().top >= english.getBoundingClientRect().bottom - 1 && parseFloat(getComputedStyle(chinese).fontSize) < parseFloat(getComputedStyle(english).fontSize) && review.left >= content.right + 5 && row.querySelector('.shadowing-review').dataset.status === 'complete' && getComputedStyle(document.querySelector('[data-panel="zh"]')).display === 'none';
    })()`);
    await cdp.screenshot(MOBILE ? 'video-shadowing-mobile.png' : 'video-shadowing.png');
    if (MOBILE) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { ...VIEWPORT, width: 320, height: 568, screenWidth: 320, screenHeight: 568 });
      await settleVideoLayout(cdp);
      await cdp.waitFor(`(() => { const word = document.querySelector('#detail-en .word.active'); if (!word) return false; const rect = word.getBoundingClientRect(); const bounds = document.getElementById('detail-en').getBoundingClientRect(); return rect.top >= bounds.top && rect.bottom <= bounds.bottom + 1; })()`);
      shadowingChecks.smallVideoPracticeFits = await cdp.evaluate(`document.documentElement.scrollWidth <= innerWidth + 1 && document.getElementById('detail-shadowing-bar').scrollWidth <= document.getElementById('detail-shadowing-bar').clientWidth + 1 && document.querySelector('[data-panel="en"] .detail-panel-surface').getBoundingClientRect().bottom <= innerHeight + 1`);
      await cdp.screenshot('video-shadowing-320.png');
      await cdp.send('Emulation.setDeviceMetricsOverride', VIEWPORT);
      await settleVideoLayout(cdp);
    } else shadowingChecks.smallVideoPracticeFits = true;
    await cdp.evaluate(`document.querySelector('#detail-shadowing-bar .shadowing-pronounce').click()`);
    await cdp.waitFor(`window.speechSynthesis.speaking`);
    await cdp.evaluate(`window.__LATE_EXAMPLE_END__ = window.__PRONUNCIATION_EXAMPLES__.at(-1).onend`);
    await cdp.evaluate(`document.getElementById('detail-shadowing').click()`);
    shadowingChecks.videoExitRestoresSettings = await cdp.evaluate(`!window.__VIDEO_PLAYER__.muted && window.__VIDEO_PLAYER__.rate === 1.25 && !document.getElementById('detail-player').inert && !document.getElementById('video-detail').classList.contains('shadowing-active') && window.__SPEECH_INSTANCES__.at(-1).aborted && document.activeElement === document.getElementById('detail-shadowing')`);
    layoutChecks.practiceExitRestoresFourWindowLayout = await cdp.evaluate(`(() => {
      const grid = document.getElementById('detail-window-grid').gridstack;
      return grid.engine.nodes.length === 4 && !document.querySelector('[data-panel="zh"]').classList.contains('hidden') && JSON.stringify(grid.save(false, false, undefined, grid.getColumn()).map(({ id, x, y, w, h }) => ({ id, x, y, w, h })).sort((left, right) => left.id.localeCompare(right.id))) === window.__NORMAL_WINDOWS__;
    })()`);
    await cdp.evaluate(`window.__LATE_EXAMPLE_END__()`);
    shadowingChecks.exitCancelsExampleWithoutRestart = await cdp.evaluate(`!window.speechSynthesis.speaking && !window.__SPEECH_INSTANCES__.at(-1).running`);
    await switchLocale(cdp, 'en');
    i18nChecks.stoppedReviewsSwitch = await cdp.evaluate(`document.querySelector('#detail-en .shadowing-review-summary').textContent.includes('aligned') && [...document.querySelectorAll('#detail-en .shadowing-review-record small')].every(node => node.textContent.startsWith('Attempt '))`);
    await switchLocale(cdp, 'zh-CN');
    await cdp.evaluate(`window.__VIDEO_PLAYER__.seekTo(0); document.getElementById('detail-shadowing').click()`);
    await cdp.waitFor(`window.__SPEECH_INSTANCES__.at(-1).running`);
    shadowingChecks.videoReentryRestoresReviews = await cdp.evaluate(`document.querySelector('#detail-en .shadowing-review').dataset.count === '2' && document.querySelectorAll('#detail-en .shadowing-review-record').length >= 2 && JSON.parse(localStorage.getItem('enos.shadowing.reviews.v1')).every(entry => entry.records.every(record => !('transcript' in record)))`);
    await cdp.evaluate(`document.getElementById('detail-shadowing').click()`);
    await cdp.evaluate(`document.getElementById('detail-back').click()`);
    detailChecks.returnsToList = await cdp.evaluate(`document.getElementById('video-detail').classList.contains('hidden') && !document.getElementById('youtube-pane').classList.contains('hidden')`);
    console.log('  detail', JSON.stringify(detailChecks));

    console.log('4. podcast audio clock and controls');
    await cdp.evaluate(`localStorage.removeItem('enos.podcast.offset.v1.clock-fixture.clock-episode')`);
    await cdp.evaluate(`(() => {
      const fixture = ${JSON.stringify({
      channel: { id: 'clock-fixture', name: 'The English Edit', image: POSTER, site: 'https://example.com/podcasts/the-english-edit' },
      episode: { id: 'clock-episode', channelId: 'clock-fixture', title: 'Small changes, a different perspective', subtitle: 'Everyday choices and new perspectives', date: '2026-10-30', duration: '0:52', durationSeconds: 52, image: POSTER, audio: 'https://example.com/podcasts/clock-episode.mp3', description: 'Cities, everyday choices, and the ideas that change how we see the world.' },
      cues: PODCAST_CUES,
      audio: audioFixture(),
    })};
      const binary = atob(fixture.audio.split(',')[1]);
      const samples = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      fixture.audio = URL.createObjectURL(new Blob([samples], { type: 'audio/wav' }));
      window.__VIDEOS_DEBUG__.setPodcastData(fixture);
    })()`);
    await cdp.waitFor(`document.getElementById('podcast-audio').readyState >= 2`);
    await cdp.evaluate(`document.getElementById('tab-youtube').focus()`);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
    const verticalTabs = await cdp.evaluate(`document.activeElement.id === 'tab-podcast' && document.getElementById('tab-podcast').getAttribute('aria-selected') === 'true' && document.getElementById('tab-podcast').getAttribute('aria-current') === 'page'`);
    await cdp.evaluate(`document.getElementById('podcast-details').focus(); document.getElementById('podcast-details').click()`);
    const details = await cdp.evaluate(`(() => {
      const dialog = document.getElementById('podcast-details-dialog');
      const content = dialog.textContent;
      const rect = dialog.getBoundingClientRect();
      return dialog.open && dialog.matches(':modal') && content.includes('Everyday choices and new perspectives') && content.includes('2026-10-30') && content.includes('Cities, everyday choices') && content.includes('https://example.com/podcasts/clock-episode.mp3') && dialog.querySelector('a[href*="download=1"]') !== null && rect.width <= innerWidth - 24 && rect.height <= innerHeight - 24 && dialog.scrollWidth <= dialog.clientWidth + 1;
    })()`);
    await cdp.screenshot(MOBILE ? 'podcast-details-mobile.png' : 'podcast-details.png');
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    const detailsEscape = await cdp.evaluate(`!document.getElementById('podcast-details-dialog').open && document.activeElement.id === 'podcast-details'`);
    await cdp.evaluate(`document.getElementById('podcast-details').click(); document.getElementById('podcast-details-close').click()`);
    const detailsClose = await cdp.evaluate(`!document.getElementById('podcast-details-dialog').open`);
    const subtitleDownload = await cdp.evaluate(`(async () => {
      const create = URL.createObjectURL;
      const click = HTMLAnchorElement.prototype.click;
      let blob;
      let filename = '';
      URL.createObjectURL = (value) => { blob = value; return create.call(URL, value); };
      HTMLAnchorElement.prototype.click = function () { filename = this.download; };
      try {
        document.getElementById('podcast-download').click();
        const content = await blob.text();
        return filename === 'Small changes, a different perspective.srt' && (content.match(/ --> /g) || []).length === ${PODCAST_CUES.length} && content.includes(${JSON.stringify(PODCAST_CUES[0].en)}) && content.includes(${JSON.stringify(PODCAST_CUES[0].zh)}) && content.includes('00:00:00,500 --> 00:00:03,700');
      } finally {
        URL.createObjectURL = create;
        HTMLAnchorElement.prototype.click = click;
      }
    })()`);
    await cdp.evaluate(`document.getElementById('podcast-play').click()`);
    await cdp.waitFor(`document.getElementById('podcast-audio').currentTime > 0.55 && !document.getElementById('podcast-audio').paused && window.__VIDEOS_DEBUG__.podcastState.activeCue === 0`);
    const playing = await cdp.evaluate(`!document.getElementById('podcast-audio').paused && window.__VIDEOS_DEBUG__.podcastState.activeCue === 0`);
    await cdp.evaluate(`window.__I18N_AUDIO__ = document.getElementById('podcast-audio'); window.__I18N_AUDIO_TIME__ = window.__I18N_AUDIO__.currentTime`);
    await switchLocale(cdp, 'en');
    i18nChecks.podcastEnglish = await englishSurface(cdp, '#podcast-pane');
    i18nChecks.audioPreserved = await cdp.evaluate(`document.getElementById('podcast-audio') === window.__I18N_AUDIO__ && !window.__I18N_AUDIO__.paused && window.__I18N_AUDIO__.currentTime >= window.__I18N_AUDIO_TIME__ && document.getElementById('podcast-play').title === 'Pause' && document.getElementById('podcast-title').textContent === 'Small changes, a different perspective'`);
    await cdp.evaluate(`document.getElementById('podcast-details').click()`);
    i18nChecks.podcastDetailsEnglish = await englishSurface(cdp, '#podcast-details-dialog');
    await cdp.screenshot(MOBILE ? 'podcast-details-english-mobile.png' : 'podcast-details-english.png');
    await cdp.evaluate(`document.getElementById('podcast-details-close').click(); document.querySelector('#podcast-sync-settings summary').click()`);
    i18nChecks.podcastSettingsEnglish = await englishSurface(cdp, '#podcast-pane');
    await cdp.screenshot(MOBILE ? 'podcast-english-mobile.png' : 'podcast-english.png');
    await cdp.evaluate(`document.getElementById('podcast-sync-settings').open = false`);
    await switchLocale(cdp, 'zh-CN');
    await cdp.evaluate(`window.__FULLSCREEN_AUDIO__ = document.getElementById('podcast-audio'); window.__FULLSCREEN_AUDIO_TIME__ = window.__FULLSCREEN_AUDIO__.currentTime`);
    fullscreenChecks.podcast = await checkFullscreen(cdp, 'podcast', `document.getElementById('podcast-audio') === window.__FULLSCREEN_AUDIO__ && !window.__FULLSCREEN_AUDIO__.paused && window.__FULLSCREEN_AUDIO__.currentTime >= window.__FULLSCREEN_AUDIO_TIME__ && !document.getElementById('podcast-pane').classList.contains('hidden') && document.querySelectorAll('#podcast-en .podcast-cue').length === ${PODCAST_CUES.length}`);
    const waveformAnimated = await cdp.evaluate(`(async () => {
      const canvas = document.getElementById('podcast-wave');
      const context = canvas.getContext('2d');
      const left = Math.floor(canvas.width * 0.25);
      const width = Math.floor(canvas.width * 0.65);
      const first = context.getImageData(left, 0, width, canvas.height).data;
      await new Promise((resolve) => setTimeout(resolve, 220));
      const second = context.getImageData(left, 0, width, canvas.height).data;
      let changed = 0;
      for (let index = 3; index < first.length; index += 4) {
        if (Math.abs(first[index] - second[index]) > 12) changed += 1;
      }
      return changed > width * canvas.height * 0.03;
    })()`);
    const waveformAmplitude = await cdp.evaluate(`(() => {
      const canvas = document.getElementById('podcast-wave');
      const width = Math.floor(canvas.width * 0.65);
      const pixels = canvas.getContext('2d').getImageData(Math.floor(canvas.width * 0.25), 0, width, canvas.height).data;
      let filled = 0;
      for (let index = 3; index < pixels.length; index += 4) {
        if (pixels[index] > 24) filled += 1;
      }
      return filled > width * canvas.height * 0.3;
    })()`);
    await cdp.screenshot(MOBILE ? 'podcast-wave-playing-mobile.png' : 'podcast-wave-playing.png');
    await cdp.evaluate(`document.getElementById('podcast-audio').pause()`);
    const waveformPauses = await cdp.evaluate(`(async () => {
      const canvas = document.getElementById('podcast-wave');
      await new Promise(requestAnimationFrame);
      const first = canvas.toDataURL();
      await new Promise((resolve) => setTimeout(resolve, 120));
      return canvas.toDataURL() === first;
    })()`);
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
    const playbackSettings = await cdp.evaluate(`(() => {
      const settings = document.getElementById('podcast-sync-settings');
      const summary = settings.querySelector('summary');
      summary.click();
      const popover = settings.querySelector('.sync-popover').getBoundingClientRect();
      const offset = document.getElementById('podcast-offset');
      const input = offset.getBoundingClientRect();
      const follow = document.getElementById('podcast-follow');
      follow.click();
      return settings.open && summary.closest('.podcast-title-actions') !== null && popover.left >= 0 && popover.right <= innerWidth && popover.bottom <= innerHeight && document.elementFromPoint(input.left + input.width / 2, input.top + input.height / 2) === offset;
    })()`);
    const follow = await cdp.evaluate(`window.__VIDEOS_DEBUG__.podcastState.follow === false`);
    await cdp.screenshot(MOBILE ? 'podcast-settings-mobile.png' : 'podcast-settings.png');
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    const playbackSettingsEscape = await cdp.evaluate(`!document.getElementById('podcast-sync-settings').open`);
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
        return document.documentElement.scrollWidth <= 321 && visibleHeight > 250;
      })()`);
      await cdp.screenshot('podcast-small.png');
      await cdp.evaluate(`document.getElementById('podcast-title').textContent = ${JSON.stringify(previousTitle)}`);
      await cdp.send('Emulation.setDeviceMetricsOverride', VIEWPORT);
    }
    const podcastLayout = await cdp.evaluate(`(() => {
      const canvas = document.getElementById('podcast-wave');
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      const pane = document.getElementById('podcast-pane').getBoundingClientRect();
      const header = document.querySelector('.podcast-top').getBoundingClientRect();
      const player = document.getElementById('podcast-player').getBoundingClientRect();
      const download = document.getElementById('podcast-download').getBoundingClientRect();
      return {
        noOverflow: document.documentElement.scrollWidth <= innerWidth + 1,
        compactHeader: header.top === pane.top && header.height <= 56 && player.bottom - pane.top <= ${MOBILE ? 135 : 112} && !document.querySelector('.podcast-top img, .podcast-top p'),
        subtitleToolbarRemoved: !document.querySelector('.podcast-sub-head') && Math.abs(document.querySelector('.podcast-sub-columns').getBoundingClientRect().top - player.bottom) < 2,
        subtitleLabelsRemoved: !document.querySelector('.podcast-col-title, .podcast-col-note') && Math.abs(document.getElementById('podcast-en').getBoundingClientRect().top - document.querySelector('.podcast-sub-columns').getBoundingClientRect().top) <= 1,
        downloadAtRight: download.width > 0 && download.right >= header.right - 22 && download.top >= header.top && download.bottom <= header.bottom,
        readable: document.getElementById('podcast-en').clientHeight > 120,
        translated: ${MOBILE} ? getComputedStyle(document.querySelector('.podcast-inline-zh')).display !== 'none' : true,
        aligned: ${MOBILE} ? true : [...document.querySelectorAll('#podcast-en .podcast-cue')].every((row, index) => Math.abs(row.getBoundingClientRect().height - document.querySelectorAll('#podcast-zh .podcast-cue')[index].getBoundingClientRect().height) < 1),
        waveform: pixels.some((value, index) => index % 4 === 3 && value > 0),
        title: document.getElementById('podcast-title').textContent,
      };
    })()`);
    const podcastChecks = { verticalTabs, details, detailsEscape, detailsClose, subtitleDownload, playbackSettings, playbackSettingsEscape, playing, waveformAnimated, waveformAmplitude, waveformPauses, seeking, silence, calibration, navigation, follow, drawer, smallScreen, ...podcastLayout };
    console.log('  podcast', JSON.stringify(podcastChecks));
    await cdp.screenshot(MOBILE ? 'podcast-mobile.png' : 'podcast.png');
    await cdp.evaluate(`document.getElementById('podcast-offset-reset').click()`);

    console.log('4b. speech-driven podcast practice');
    await cdp.evaluate(`(() => {
      const audio = document.getElementById('podcast-audio');
      audio.pause(); audio.currentTime = 0.5; audio.muted = false;
      const speed = document.getElementById('podcast-speed'); speed.value = '1.25'; speed.dispatchEvent(new Event('change'));
      document.getElementById('podcast-shadowing').click();
    })()`);
    await cdp.waitFor(`document.getElementById('podcast-pane').classList.contains('shadowing-active') && window.__SPEECH_INSTANCES__.at(-1).running`);
    shadowingChecks.podcastStartsSilent = await cdp.evaluate(`document.getElementById('podcast-audio').muted && document.getElementById('podcast-audio').paused && document.getElementById('podcast-speed').disabled`);
    await cdp.evaluate(`window.__SPEECH_INSTANCES__.at(-1).emit('Cities should abandon')`);
    shadowingChecks.podcastVoiceHighlights = await cdp.evaluate(`document.querySelector('#podcast-en .word.active')?.textContent === 'abandon' && document.getElementById('podcast-audio').currentTime > 1 && document.getElementById('podcast-audio').paused`);
    await cdp.waitFor(`document.querySelector('#podcast-en .word.shadow-next').dataset.ipa.includes('/')`);
    shadowingChecks.podcastNextWordHasIpa = await cdp.evaluate(`document.querySelector('#podcast-shadowing-bar .shadowing-ipa').textContent.includes('/') && !document.querySelector('#podcast-shadowing-bar .shadowing-pronounce').disabled`);
    await cdp.evaluate(`(() => {
      window.__PODCAST_EXAMPLE_TIME__ = document.getElementById('podcast-audio').currentTime;
      window.__PODCAST_EXAMPLE_PROGRESS__ = document.querySelector('#podcast-shadowing-bar progress').value;
      document.querySelector('#podcast-shadowing-bar .shadowing-pronounce').click();
    })()`);
    await cdp.waitFor(`window.speechSynthesis.speaking`);
    shadowingChecks.podcastExampleKeepsOriginalSilent = await cdp.evaluate(`window.__SPEECH_INSTANCES__.at(-1).aborted && document.getElementById('podcast-audio').paused && document.getElementById('podcast-audio').muted && document.getElementById('podcast-audio').currentTime === window.__PODCAST_EXAMPLE_TIME__ && window.__PRONUNCIATION_EXAMPLES__.at(-1).text === 'the'`);
    await cdp.evaluate(`window.speechSynthesis.finish()`);
    await cdp.waitFor(`window.__SPEECH_INSTANCES__.at(-1).running`);
    shadowingChecks.podcastExampleResumesWithoutScoring = await cdp.evaluate(`document.querySelector('#podcast-shadowing-bar progress').value === window.__PODCAST_EXAMPLE_PROGRESS__ && document.querySelector('#podcast-en .shadowing-review').dataset.count === '1'`);
    shadowingChecks.podcastWaitsForVoice = await cdp.evaluate(`(async () => {
      const audio = document.getElementById('podcast-audio'); const time = audio.currentTime;
      await new Promise((resolve) => setTimeout(resolve, 180));
      return audio.currentTime === time && audio.paused;
    })()`);
    await cdp.evaluate(`document.getElementById('podcast-audio').muted = false`);
    await cdp.waitFor(`document.getElementById('podcast-audio').muted`);
    shadowingChecks.podcastCannotLeakOriginalAudio = await cdp.evaluate(`document.getElementById('podcast-audio').paused && document.getElementById('podcast-audio').muted`);
    await cdp.evaluate(`window.__SPEECH_INSTANCES__.at(-1).onerror({ error: 'network' })`);
    shadowingChecks.networkErrorHoldsProgress = await cdp.evaluate(`document.getElementById('podcast-shadowing-bar').classList.contains('has-error') && document.getElementById('podcast-audio').muted && document.getElementById('podcast-audio').paused && window.__SPEECH_INSTANCES__.at(-1).aborted`);
    await cdp.evaluate(`document.querySelector('#podcast-shadowing-bar .shadowing-commands button:nth-child(3)').click()`);
    shadowingChecks.networkResumePreservesPosition = await cdp.evaluate(`window.__SPEECH_INSTANCES__.at(-1).running && document.querySelector('#podcast-en .word.active')?.textContent === 'abandon' && !document.getElementById('podcast-shadowing-bar').classList.contains('has-error')`);
    await cdp.evaluate(`window.__RECONNECT_OLD__ = window.__SPEECH_INSTANCES__.at(-1); window.__RECONNECT_OLD__.running = false; window.__RECONNECT_OLD__.onend()`);
    await cdp.waitFor(`window.__SPEECH_INSTANCES__.at(-1) !== window.__RECONNECT_OLD__ && window.__SPEECH_INSTANCES__.at(-1).running`);
    shadowingChecks.automaticReconnectKeepsPosition = await cdp.evaluate(`document.querySelector('#podcast-en .word.active')?.textContent === 'abandon' && document.getElementById('podcast-audio').paused && document.getElementById('podcast-audio').muted`);
    await cdp.evaluate(`document.querySelector('#podcast-shadowing-bar .shadowing-commands button:nth-child(3)').click(); document.querySelector('#podcast-shadowing-bar .shadowing-commands button:nth-child(2)').click()`);
    shadowingChecks.podcastSkipWhilePaused = await cdp.evaluate(`window.__VIDEOS_DEBUG__.podcastState.activeCue === 1 && !window.__SPEECH_INSTANCES__.at(-1).running && document.getElementById('podcast-audio').paused`);
    await cdp.evaluate(`document.querySelector('#podcast-shadowing-bar .shadowing-commands button:nth-child(3)').click()`);
    await cdp.evaluate(`(() => { for (const cue of ${JSON.stringify(PODCAST_CUES.slice(1, 11))}) window.__SPEECH_INSTANCES__.at(-1).emit(cue.en, true); })()`);
    await cdp.waitFor(`(() => { const word = document.querySelector('#podcast-en .word.active'); if (!word) return false; const rect = word.getBoundingClientRect(); const bounds = document.getElementById('podcast-en').getBoundingClientRect(); return rect.top >= bounds.top && rect.bottom <= bounds.bottom + 1; })()`);
    shadowingChecks.podcastVoiceScrollsDespiteFollowOff = await cdp.evaluate(`window.__VIDEOS_DEBUG__.podcastState.activeCue === 10 && window.__VIDEOS_DEBUG__.podcastState.follow === false && document.getElementById('podcast-en').scrollTop > 0`);
    shadowingChecks.podcastPracticeFits = await cdp.evaluate(`document.documentElement.scrollWidth <= innerWidth + 1 && document.getElementById('podcast-shadowing-bar').scrollWidth <= document.getElementById('podcast-shadowing-bar').clientWidth + 1`);
    shadowingChecks.podcastChineseBelowAndReviewRight = await cdp.evaluate(`(() => {
      const row = document.querySelector('#podcast-en .podcast-cue.active');
      const english = row.querySelector('.podcast-en');
      const chinese = row.querySelector('.podcast-inline-zh');
      const content = row.querySelector('.subtitle-cue-main').getBoundingClientRect();
      const review = row.querySelector('.shadowing-review').getBoundingClientRect();
      return getComputedStyle(chinese).display !== 'none' && chinese.getBoundingClientRect().top >= english.getBoundingClientRect().bottom - 1 && parseFloat(getComputedStyle(chinese).fontSize) < parseFloat(getComputedStyle(english).fontSize) && review.left >= content.right + 5 && getComputedStyle(document.getElementById('podcast-zh').parentElement).display === 'none';
    })()`);
    await cdp.screenshot(MOBILE ? 'podcast-shadowing-mobile.png' : 'podcast-shadowing.png');
    await cdp.evaluate(`document.querySelector('#podcast-shadowing-bar .shadowing-commands button:first-child').click()`);
    shadowingChecks.repeatStartsCurrentSentence = await cdp.evaluate(`window.__VIDEOS_DEBUG__.podcastState.activeCue === 10 && window.__VIDEOS_DEBUG__.podcastState.activeWord === -1 && document.querySelector('#podcast-shadowing-bar progress').value === 0`);
    await cdp.evaluate(`(() => { for (const cue of ${JSON.stringify(PODCAST_CUES.slice(10))}) window.__SPEECH_INSTANCES__.at(-1).emit(cue.en, true); })()`);
    shadowingChecks.completionClosesMicrophone = await cdp.evaluate(`document.querySelector('#podcast-shadowing-bar progress').value === 1 && window.__SPEECH_INSTANCES__.at(-1).aborted && document.getElementById('podcast-audio').paused && document.getElementById('podcast-audio').muted`);
    shadowingChecks.podcastRepeatKeepsEachReview = await cdp.evaluate(`document.querySelectorAll('#podcast-en .podcast-cue')[10].querySelector('.shadowing-review').dataset.count === '2' && document.querySelectorAll('#podcast-en .podcast-cue')[10].querySelectorAll('.shadowing-review-record').length === 2`);
    await cdp.evaluate(`document.getElementById('podcast-shadowing').click()`);
    shadowingChecks.podcastExitRestoresSettings = await cdp.evaluate(`!document.getElementById('podcast-audio').muted && document.getElementById('podcast-audio').playbackRate === 1.25 && !document.getElementById('podcast-speed').disabled && window.__SPEECH_INSTANCES__.at(-1).aborted`);
    await cdp.evaluate(`(() => {
      document.getElementById('podcast-shadowing').click();
      window.__DELAYED_CLOSE__ = window.__SPEECH_INSTANCES__.at(-1);
      window.__INSTANCE_COUNT__ = window.__SPEECH_INSTANCES__.length;
      window.__DELAYED_CLOSE__.abort = function () { this.running = false; this.aborted = true; };
      document.getElementById('podcast-shadowing').click();
      document.getElementById('podcast-shadowing').click();
    })()`);
    shadowingChecks.quickRestartWaitsForMicrophone = await cdp.evaluate(`window.__SPEECH_INSTANCES__.length === window.__INSTANCE_COUNT__ && document.getElementById('podcast-audio').muted && document.getElementById('podcast-audio').paused`);
    await cdp.evaluate(`window.__DELAYED_CLOSE__.onend()`);
    await cdp.waitFor(`window.__SPEECH_INSTANCES__.length > window.__INSTANCE_COUNT__ && window.__SPEECH_INSTANCES__.at(-1).running`);
    await cdp.evaluate(`document.getElementById('podcast-shadowing').click()`);
    await cdp.evaluate(`window.__SPEECH_FAILURE__ = 'not-allowed'; document.getElementById('podcast-shadowing').click()`);
    shadowingChecks.permissionDenialRestoresMedia = await cdp.evaluate(`!document.getElementById('podcast-pane').classList.contains('shadowing-active') && !document.getElementById('podcast-audio').muted && window.__SPEECH_INSTANCES__.at(-1).aborted`);
    await cdp.evaluate(`document.getElementById('podcast-shadowing').click()`);

    console.log('5. book list fixture');
    await cdp.evaluate(`(() => {
      const originalFetch = window.fetch;
      window.fetch = (resource, options) => {
        if (resource !== '/api/books') return originalFetch.call(window, resource, options);
        window.fetch = originalFetch;
        return Promise.resolve(new Response(JSON.stringify(${JSON.stringify({
      channels: [
        { id: 'economist', name: 'The Economist', short: 'TE', accent: '#b51d23', count: 1 },
        { id: 'new-yorker', name: 'The New Yorker', short: 'NY', accent: '#246b63', count: 1 },
      ],
      books: [
        { id: 'economist-2026-10-24', category: 'economist', magazine: 'The Economist', short: 'TE', accent: '#b51d23', title: 'The Economist · 2026-10-24', date: '2026-10-24', readable: true, sourceUrl: 'https://github.com/hehonghui/awesome-english-ebooks', formats: [{ format: 'epub', sizeLabel: '8 MB' }] },
        { id: 'new-yorker-2026-10-24', category: 'new-yorker', magazine: 'The New Yorker', short: 'NY', accent: '#246b63', title: 'The New Yorker · 2026-10-24', date: '2026-10-24', readable: true, sourceUrl: 'https://github.com/hehonghui/awesome-english-ebooks', formats: [{ format: 'epub', sizeLabel: '6 MB' }, { format: 'pdf', sizeLabel: '12 MB' }] },
      ],
    })}), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      };
      document.getElementById('tab-books').click();
    })()`);
    await cdp.waitFor(`document.querySelectorAll('#books-grid .book-card').length === 2`);
    shadowingChecks.switchingMediaStopsMicrophone = await cdp.evaluate(`window.__SPEECH_INSTANCES__.at(-1).aborted && !document.getElementById('podcast-audio').muted && !document.getElementById('podcast-pane').classList.contains('shadowing-active')`);
    await cdp.waitFor(`document.getElementById('books-grid').getAnimations().every((animation) => animation.playState === 'finished')`);
    const booksChecks = await cdp.evaluate(`(() => {
      const pane = document.getElementById('books-pane');
      const grid = document.getElementById('books-grid');
      return {
        headerRemoved: !pane.querySelector('.books-head, .books-source, h1'),
        listAtTop: Math.abs(grid.getBoundingClientRect().top - pane.getBoundingClientRect().top) < 1,
        cardsVisible: [...grid.querySelectorAll('.book-card')].every((card) => card.getBoundingClientRect().width > 0),
        noOverflow: document.documentElement.scrollWidth <= innerWidth + 1 && grid.scrollWidth <= grid.clientWidth + 1,
      };
    })()`);
    await cdp.evaluate(`document.querySelectorAll('#channel-list .tree-main')[1].click()`);
    booksChecks.categorySwitches = await cdp.evaluate(`document.querySelectorAll('#books-grid .book-card').length === 1 && document.querySelector('#books-grid .book-card h2').textContent.includes('The Economist')`);
    await cdp.evaluate(`document.querySelector('#channel-list .tree-main').click()`);
    booksChecks.allBooksReturn = await cdp.evaluate(`document.querySelectorAll('#books-grid .book-card').length === 2`);
    await switchLocale(cdp, 'en');
    i18nChecks.booksEnglish = await englishSurface(cdp, '#books-pane');
    await cdp.screenshot(MOBILE ? 'books-english-mobile.png' : 'books-english.png');
    await switchLocale(cdp, 'zh-CN');
    await cdp.evaluate(`window.__FULLSCREEN_BOOKS__ = document.getElementById('books-grid')`);
    fullscreenChecks.books = await checkFullscreen(cdp, 'books', `document.getElementById('books-grid') === window.__FULLSCREEN_BOOKS__ && !document.getElementById('books-pane').classList.contains('hidden') && document.querySelectorAll('#books-grid .book-card').length === 2`);
    await cdp.screenshot(MOBILE ? 'books-mobile.png' : 'books.png');
    await cdp.evaluate(`(() => {
      const originalFetch = window.fetch;
      window.fetch = (resource, options) => {
        if (!String(resource).startsWith('/api/books/read?')) return originalFetch.call(window, resource, options);
        window.fetch = originalFetch;
        return Promise.resolve(new Response(JSON.stringify({
          book: { title: 'The Economist · 2026-10-24', magazine: 'The Economist', date: '2026-10-24', wordCount: 1260 },
          chapters: [
            { title: 'The value of shade', wordCount: 620, blocks: [{ type: 'heading', text: 'Cities and trees' }, { type: 'paragraph', text: 'A shaded street invites people to walk. <strong>This stays plain text.</strong>' }] },
            { title: 'A cooler neighbourhood', wordCount: 640, blocks: [{ type: 'paragraph', text: 'Public transport connects communities.' }, { type: 'bullet', text: 'Reliable routes matter.' }] },
          ],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      };
      document.querySelector('#books-grid .book-card').click();
    })()`);
    await cdp.waitFor(`document.querySelectorAll('.book-toc-item').length === 2`);
    booksChecks.readerOpens = await cdp.evaluate(`!document.getElementById('book-reader').classList.contains('hidden') && document.querySelector('.book-chapter-title').textContent === 'The value of shade' && document.querySelector('.book-chapter-nav button').disabled`);
    booksChecks.readerUsesText = await cdp.evaluate(`!document.querySelector('#book-content .book-block strong') && document.getElementById('book-content').textContent.includes('<strong>This stays plain text.</strong>')`);
    booksChecks.downloadLinks = await cdp.evaluate(`document.querySelector('#book-actions a[download]').getAttribute('href') === '/api/books/file?category=economist&date=2026-10-24&format=epub' && document.querySelector('#book-actions a[target="_blank"]').rel.includes('noopener')`);
    await cdp.screenshot(MOBILE ? 'books-reader-mobile.png' : 'books-reader.png');
    await cdp.evaluate(`document.querySelector('.book-chapter-nav button:last-child').click()`);
    booksChecks.nextChapter = await cdp.evaluate(`document.querySelector('.book-chapter-title').textContent === 'A cooler neighbourhood' && document.querySelector('.book-chapter-nav button:last-child').disabled && document.querySelectorAll('.book-toc-item')[1].classList.contains('active')`);
    await cdp.evaluate(`document.querySelector('.book-chapter-nav button').click()`);
    booksChecks.previousChapter = await cdp.evaluate(`document.querySelector('.book-chapter-title').textContent === 'The value of shade'`);
    await cdp.evaluate(`document.querySelectorAll('.book-toc-item')[1].click()`);
    booksChecks.tableOfContents = await cdp.evaluate(`document.querySelector('.book-chapter-title').textContent === 'A cooler neighbourhood'`);
    booksChecks.readerNoOverflow = await cdp.evaluate(`document.documentElement.scrollWidth <= innerWidth + 1 && document.getElementById('book-content').scrollWidth <= document.getElementById('book-content').clientWidth + 1`);
    await cdp.evaluate(`window.__I18N_ARTICLE__ = document.querySelector('.book-article'); window.__I18N_BOOK_SCROLL__ = document.getElementById('book-content').scrollTop`);
    await switchLocale(cdp, 'en');
    i18nChecks.readerEnglish = await englishSurface(cdp, '#book-reader');
    i18nChecks.chapterPreserved = await cdp.evaluate(`document.querySelector('.book-article') === window.__I18N_ARTICLE__ && document.getElementById('book-content').scrollTop === window.__I18N_BOOK_SCROLL__ && document.querySelector('.book-chapter-title').textContent === 'A cooler neighbourhood' && document.querySelector('.book-chapter-kicker').textContent.startsWith('CHAPTER 2') && document.querySelectorAll('.book-toc-item')[1].classList.contains('active')`);
    await cdp.screenshot(MOBILE ? 'reader-english-mobile.png' : 'reader-english.png');
    await switchLocale(cdp, 'zh-CN');
    await cdp.evaluate(`window.__FULLSCREEN_BOOK_CONTENT__ = document.getElementById('book-content'); window.__FULLSCREEN_BOOK_SCROLL__ = window.__FULLSCREEN_BOOK_CONTENT__.scrollTop`);
    fullscreenChecks.bookReader = await checkFullscreen(cdp, 'book-reader', `document.getElementById('book-content') === window.__FULLSCREEN_BOOK_CONTENT__ && window.__FULLSCREEN_BOOK_CONTENT__.scrollTop === window.__FULLSCREEN_BOOK_SCROLL__ && !document.getElementById('book-reader').classList.contains('hidden') && document.querySelector('.book-chapter-title').textContent === 'A cooler neighbourhood' && document.querySelectorAll('.book-toc-item')[1].classList.contains('active')`);
    await cdp.evaluate(`document.getElementById('book-back').click()`);
    booksChecks.readerReturns = await cdp.evaluate(`document.getElementById('book-reader').classList.contains('hidden') && document.querySelectorAll('#books-grid .book-card').length === 2`);
    console.log('  books', JSON.stringify(booksChecks));

    console.log('6. language persistence, errors and 404');
    await switchLocale(cdp, 'en');
    i18nChecks.sourceContentPreserved = await cdp.evaluate(`(() => {
      window.__VIDEOS_DEBUG__.render([{ ...${JSON.stringify(SEARCH_ITEMS[0])}, title: '播放', channel: '全', description: '设置' }]);
      const video = document.querySelector('.preview-title').textContent === '播放' && document.querySelector('.preview-channel').textContent === '全' && document.querySelector('.preview-desc').textContent === '设置';
      window.__VIDEOS_DEBUG__.setPodcastData({
        channel: { id: 'clock-fixture', name: '全', site: 'https://example.com/podcasts' },
        episode: { id: 'clock-episode', channelId: 'clock-fixture', title: '播放', subtitle: '设置', description: '频道', duration: '0:52' },
        cues: [{ start: 0, end: 2, en: 'An unchanged sentence', zh: '全' }], audio: window.__I18N_AUDIO__.src,
      });
      document.getElementById('podcast-details').click();
      const podcast = document.getElementById('podcast-title').textContent === '播放' && document.querySelector('#channel-list .tree-video').textContent === '播放'
        && document.querySelector('.podcast-detail-subtitle').textContent === '设置' && document.querySelector('.podcast-detail-description').textContent === '频道'
        && document.querySelector('.podcast-detail-meta dd').textContent === '全' && document.querySelector('#podcast-en .podcast-inline-zh').textContent === '全';
      document.getElementById('podcast-details-close').click();
      return video && podcast;
    })()`);
    await switchLocale(cdp, 'zh-CN');
    await cdp.evaluate(`document.getElementById('tab-youtube').click()`);
    await cdp.evaluate(`(() => {
      const originalFetch = window.fetch;
      window.fetch = (resource, options) => {
        if (resource !== '/api/youtube/search') return originalFetch.call(window, resource, options);
        window.fetch = originalFetch;
        return Promise.resolve(new Response(JSON.stringify({ error: { code: 'YOUTUBE_SEARCH_FAILED', message: 'YouTube 搜索失败：fixture-network-error' } }), { status: 502, headers: { 'Content-Type': 'application/json' } }));
      };
      document.getElementById('video-q').value = 'fixture network failure';
      document.getElementById('video-search').requestSubmit();
    })()`);
    await cdp.waitFor(`document.querySelector('#video-results h2')?.textContent === '搜索没有完成'`);
    await switchLocale(cdp, 'en');
    i18nChecks.searchErrorSwitches = await cdp.evaluate(`document.querySelector('#video-results h2')?.textContent === 'Search did not complete' && document.getElementById('preview-subtitle').textContent.includes('YouTube search failed')`);
    i18nChecks.errorEnglish = await englishSurface(cdp, '#youtube-pane');
    await cdp.send('Page.reload');
    await cdp.waitFor(`window.__VIDEOS_DEBUG__ && document.documentElement.lang === 'en'`);
    i18nChecks.persistedEnglish = await cdp.evaluate(`document.getElementById('studio-language').value === 'en' && document.title === 'Learning Studio · EnOS'`);
    await cdp.send('Page.navigate', { url: `${BASE}/fixture-missing-page` });
    await cdp.waitFor(`document.getElementById('not-found-language')?.value === 'en'`);
    i18nChecks.notFoundEnglish = await englishSurface(cdp, 'main');
    i18nChecks.notFoundTitleEnglish = await cdp.evaluate(`document.title === 'Page Not Found · EnOS' && document.querySelector('h1').textContent === 'Page not found.'`);
    await cdp.screenshot(MOBILE ? '404-english-mobile.png' : '404-english.png');
    await cdp.evaluate(`(() => { const select = document.getElementById('not-found-language'); select.value = 'zh-CN'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    i18nChecks.notFoundChinese = await cdp.evaluate(`document.documentElement.lang === 'zh-CN' && document.querySelector('h1').textContent === '这一页没有找到。'`);
    await cdp.send('Page.navigate', { url: `${BASE}/videos.html?debug=1` });
    await cdp.waitFor(`window.__VIDEOS_DEBUG__ && document.documentElement.lang === 'zh-CN'`);
    i18nChecks.chinesePersistedBack = await cdp.evaluate(`document.getElementById('studio-language').value === 'zh-CN' && document.getElementById('rail-settings').title === '设置'`);
    console.log('  i18n', JSON.stringify(i18nChecks));

    const checks = {
      ok: Object.entries(podcastChecks).every(([key, value]) => key === 'title' || value === true)
        && Object.values(booksChecks).every((value) => value === true)
        && Object.values(detailChecks).every((value) => value === true)
        && Object.values(shadowingChecks).every((value) => value === true)
        && Object.values(fullscreenChecks).every((value) => value === true)
        && Object.values(layoutChecks).every((value) => value === true)
        && Object.values(workspaceChecks).every((value) => value === true)
        && Object.values(i18nChecks).every((value) => value === true),
      workspace: workspaceChecks,
      detail: detailChecks,
      shadowing: shadowingChecks,
      fullscreen: fullscreenChecks,
      layout: layoutChecks,
      podcast: podcastChecks,
      books: booksChecks,
      i18n: i18nChecks,
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

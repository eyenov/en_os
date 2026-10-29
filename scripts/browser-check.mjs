/**
 * End-to-end smoke test through the Chrome DevTools Protocol.
 * Zero dependencies: uses Node 24's fetch + WebSocket and the installed Chrome.
 *
 * Run with the server on http://127.0.0.1:8787 (npm start), then: npm run smoke
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
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((candidate) => candidate && existsSync(candidate));
const PORT = 9333;
const BASE = process.env.ENOS_URL || 'http://127.0.0.1:8787';
const SHOTS = path.resolve('.shots');
const PROFILE = path.resolve('.chrome-profile');
const MOBILE = process.env.ENOS_MOBILE === '1';
const VIEWPORT = MOBILE
  ? { width: 390, height: 844, screenWidth: 390, screenHeight: 844, deviceScaleFactor: 1, mobile: true }
  : { width: 1440, height: 1100, screenWidth: 1440, screenHeight: 1100, deviceScaleFactor: 1, mobile: false };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForDebugger() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (response.ok) return response.json();
    } catch { /* retry */ }
    await sleep(250);
  }
  throw new Error('Chrome DevTools did not start');
}

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
        if (message.error) pending.reject(new Error(`${message.error.message} (${message.error.code})`));
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
        const details = message.params.exceptionDetails;
        this.exceptions.push(`${details.text} ${details.exception?.description || ''}`);
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
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(`evaluate failed: ${result.exceptionDetails.exception?.description || result.exceptionDetails.text}`);
    }
    return result.result.value;
  }

  async waitFor(expression, timeout = 20_000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      try {
        if (await this.evaluate(`Boolean(${expression})`)) return true;
      } catch { /* page navigating */ }
      await sleep(150);
    }
    throw new Error(`Timed out waiting for: ${expression}`);
  }

  async screenshot(name, { full = false } = {}) {
    let reset = false;
    if (full) {
      const metrics = await this.send('Page.getLayoutMetrics');
      const height = Math.min(6000, Math.ceil(metrics.contentSize.height));
      await this.send('Emulation.setDeviceMetricsOverride', {
        ...VIEWPORT, height,
      });
      reset = true;
      await sleep(300);
    }
    const data = await this.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
    await writeFile(path.join(SHOTS, name), Buffer.from(data.data, 'base64'));
    if (reset) {
      await this.send('Emulation.clearDeviceMetricsOverride');
      await this.send('Emulation.setDeviceMetricsOverride', VIEWPORT);
      await sleep(300);
    }
    console.log(`  screenshot: ${name}`);
  }
}

const SAMPLE = `Urban planners increasingly argue that cities should abandon the idea of building wider roads.
Instead, they advocate investing in public transport and shaded walking routes.
A recent study found that streets with trees are used more often, even when the distance is the same.`;

const LONG_TEXT = (word) => `Many people meet "${word}" in ordinary places rather than in textbooks. On my street, the idea shows up when neighbours decide how to share a narrow pavement. In my opinion, this matters because small choices shape daily life. However, change is not always welcome. For example, a new bus lane can annoy drivers while helping students get to school on time. I think ${word} is worth the effort, since the long-term benefit is greater than the short-term cost.`;

async function clickText(cdp, text) {
  const clicked = await cdp.evaluate(`(() => {
    const node = [...document.querySelectorAll('button')].find((button) => button.textContent.includes(${JSON.stringify(text)}) && !button.disabled);
    if (!node) return false;
    node.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Button not found: ${text}`);
}

async function setInput(cdp, selector, value) {
  const ok = await cdp.evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) return false;
    const proto = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(node, ${JSON.stringify(value)});
    node.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  if (!ok) throw new Error(`Input not found: ${selector}`);
}

async function completeStep(cdp, step) {
  const { kind } = step;
  if (kind === 'listen_pick' || kind === 'read_synonym' || kind === 'read_inference') {
    const answerIndex = step.payload.answerIndex;
    await cdp.evaluate(`(() => {
      const options = document.querySelectorAll('.option-list .option');
      const target = options[${Number(answerIndex)}];
      if (!target) throw new Error('option missing');
      target.click();
    })()`);
    await sleep(250);
    return;
  }

  if (kind === 'listen_dictation') {
    await setInput(cdp, 'input[aria-label="听写答案"]', step.payload.answer);
    await clickText(cdp, '检查');
    await sleep(250);
    return;
  }

  if (kind === 'speak_shadow') {
    const details = await cdp.evaluate(`(() => {
      const node = document.querySelector('details.model-box');
      if (node) node.open = true;
      return Boolean(node);
    })()`);
    if (!details) throw new Error('shadow manual input missing');
    await setInput(cdp, 'input[aria-label="跟读文本"]', step.payload.sentence);
    await clickText(cdp, '比对');
    await sleep(400);
    return;
  }

  if (kind === 'speak_dialog') {
    const word = step.word;
    const messages = [
      `I think ${word} is important because it changes how people behave in this place.`,
      `For example, ${word} helped me notice a small problem and talk about it with my neighbours.`,
    ];
    for (const message of messages) {
      await setInput(cdp, '.chat-input-row .input', message);
      await cdp.evaluate(`document.querySelector('.chat-input-row .icon-round:last-child').click()`);
      await sleep(1600);
    }
    await cdp.waitFor(`document.querySelectorAll('.bubble.user').length >= 2`, 10_000);
    return;
  }

  if (kind === 'write_frame') {
    const text = `${step.wordData.example} ${step.grammarPoints[0].example} However, this small choice matters.`;
    await setInput(cdp, '.type-area', text);
    await clickText(cdp, '提交这一版');
    await sleep(250);
    return;
  }

  if (kind === 'write_paragraph') {
    await setInput(cdp, '.type-area', LONG_TEXT(step.word));
    await clickText(cdp, '提交并评分');
    await sleep(500);
    return;
  }

  throw new Error(`Unknown step kind: ${kind}`);
}

async function main() {
  if (!CHROME) throw new Error('未找到 Chrome / Edge，请设置 CHROME_PATH 环境变量。');
  await mkdir(SHOTS, { recursive: true });
  await rm(PROFILE, { recursive: true, force: true }).catch(() => {});
  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--hide-scrollbars',
    '--window-size=1440,1100',
    '--force-device-scale-factor=1',
    'about:blank',
  ], { stdio: 'ignore' });

  try {
    await waitForDebugger();
    const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const page = targets.find((target) => target.type === 'page');
    if (!page) throw new Error('No page target');
    const cdp = new CDP(page.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', VIEWPORT);

    console.log('1. home');
    await cdp.send('Page.navigate', { url: `${BASE}/?debug=1#/home` });
    await cdp.waitFor(`document.querySelector('.hero')`, 20_000);
    await sleep(700);

    if (process.env.ENOS_AI === '1') {
      await cdp.evaluate(`localStorage.setItem('enos.settings.v1', JSON.stringify({
        provider: 'custom',
        keys: { custom: 'sk-mock' },
        baseUrls: { custom: 'http://127.0.0.1:9999/v1' },
        models: { custom: 'mock' },
        aiMode: 'auto',
        scene: 'music',
        band: 6.5
      }))`);
      await cdp.send('Page.reload');
      await cdp.waitFor(`document.querySelector('.hero')`, 20_000);
      await sleep(700);
    }
    await cdp.screenshot('01-home.png');

    console.log('2. start session');
    await setInput(cdp, '#learning-input', SAMPLE);
    await sleep(200);
    const started = await cdp.evaluate(`(() => {
      const button = document.querySelector('#start-learning');
      if (!button || button.disabled) return false;
      button.click();
      return true;
    })()`);
    if (!started) throw new Error('Start button disabled');
    await sleep(1200);
    console.log('after-click:', await cdp.evaluate(`({
      href: location.href,
      button: document.querySelector('#start-learning')?.outerHTML,
      toast: document.querySelector('.toast')?.textContent || '',
    })`));
    try {
      await cdp.waitFor(`document.querySelector('.step-title')`, 20_000);
    } catch (error) {
      const state = await cdp.evaluate(`({
        href: location.href,
        app: document.querySelector('#app')?.innerText?.slice(0, 900),
        toast: document.querySelector('.toast')?.textContent || '',
        storage: Object.keys(localStorage),
        current: localStorage.getItem('enos.session.current.v1')?.slice(0, 120),
      })`);
      console.log('STATE', JSON.stringify(state, null, 2));
      console.log('LOGS', cdp.logs, cdp.exceptions);
      throw error;
    }
    await cdp.waitFor(`window.__ENOS_DEBUG__`, 20_000);
    await sleep(600);

    if (process.env.ENOS_AI === '1') {
      try {
        await cdp.waitFor(`window.__ENOS_DEBUG__.step.source === 'ai'`, 10_000);
        console.log('   AI step rewrite applied');
      } catch {
        console.log('   AI step rewrite not applied:', await cdp.evaluate(`document.querySelector('#ai-badge')?.textContent`));
      }
    }

    for (let index = 0; index < 8; index += 1) {
      const step = await cdp.evaluate(`(() => {
        const debug = window.__ENOS_DEBUG__;
        if (!debug) return null;
        const s = debug.step;
        return {
          kind: s.kind,
          title: s.title,
          word: s.word.word,
          module: s.module,
          payload: s.payload,
          grammarPoints: s.grammarPoints.map((point) => ({ name: point.name, pattern: point.pattern, example: point.example })),
          wordData: { example: s.word.example },
        };
      })()`);
      if (!step) throw new Error('debug state missing');
      console.log(`3.${index + 1} ${step.module} / ${step.kind} / ${step.word}`);
      if ([0, 4, 7].includes(index)) await cdp.screenshot(`02-step-${index + 1}.png`);

      await completeStep(cdp, step);
      await sleep(350);
      try {
        await cdp.waitFor(`!document.querySelector('.next-btn').disabled`, 8000);
      } catch {
        const state = await cdp.evaluate(`({
          remaining: window.__ENOS_DEBUG__.evaluation.remaining,
          checks: window.__ENOS_DEBUG__.progress.checks,
          toast: document.querySelector('.toast')?.textContent || '',
        })`);
        throw new Error(`Step ${index + 1} not complete: ${JSON.stringify(state)}`);
      }

      const meta = await cdp.evaluate(`window.__ENOS_DEBUG__.evaluation.score`);
      console.log(`     score ${meta} · next`);
      await cdp.evaluate(`document.querySelector('.next-btn').click()`);
      await sleep(500);

      if (index === 7) {
        await cdp.waitFor(`document.querySelector('.report-hero')`, 20_000);
      } else {
        await cdp.waitFor(`window.__ENOS_DEBUG__ && window.__ENOS_DEBUG__.step.index === ${index + 1}`, 15_000);
      }
    }

    console.log('4. report');
    await sleep(900);
    if (process.env.ENOS_AI === '1') {
      try {
        await cdp.waitFor(`document.querySelector('.ai-narrative h3') && !document.querySelector('.ai-narrative h3').textContent.includes('AI 教练总结')`, 10_000);
        console.log('   AI narrative applied:', await cdp.evaluate(`document.querySelector('.ai-narrative h3').textContent`));
      } catch {
        console.log('   AI narrative not applied');
      }
    }
    const reportInfo = await cdp.evaluate(`({
      title: document.querySelector('.report-hero h1')?.textContent,
      score: document.querySelector('.rh-stat strong')?.textContent,
      sections: document.querySelectorAll('.report-section').length,
      vocab: document.querySelectorAll('.vocab-item').length,
      timeline: document.querySelectorAll('.timeline-item').length,
      steps: document.querySelectorAll('.module-report').length,
    })`);
    console.log('   report:', JSON.stringify(reportInfo));
    await cdp.screenshot('03-report.png', { full: true });

    console.log('5. reports list');
    await cdp.send('Page.navigate', { url: `${BASE}/?debug=1#/reports` });
    await cdp.waitFor(`document.querySelector('.report-row')`, 15_000);
    await sleep(500);
    await cdp.screenshot('04-reports.png');
    const listInfo = await cdp.evaluate(`({
      rows: document.querySelectorAll('.report-row').length,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      titleWidth: document.querySelector('.rr-title')?.getBoundingClientRect().width,
      rowWidth: document.querySelector('.report-row')?.getBoundingClientRect().width,
    })`);
    console.log('   list:', JSON.stringify(listInfo));

    const result = {
      ok: true,
      report: reportInfo,
      consoleErrors: cdp.logs,
      exceptions: cdp.exceptions,
    };
    await writeFile(path.join(SHOTS, 'smoke.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
    if (cdp.exceptions.length || cdp.logs.length) process.exitCode = 2;
  } finally {
    chrome.kill();
    await sleep(300);
  }
}

main().catch((error) => {
  console.error('SMOKE FAILED:', error.message);
  process.exitCode = 1;
});

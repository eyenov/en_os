import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9357;
const PROFILE = path.resolve('.chrome-diag-nohead');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await mkdir('.shots', { recursive: true });
await rm(PROFILE, { recursive: true, force: true }).catch(() => {});
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--proxy-server=http://127.0.0.1:13480', '--disable-gpu', '--no-first-run', '--window-size=1440,1000', 'about:blank',
], { stdio: 'ignore' });
try {
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch { /* retry */ }
    await sleep(200);
  }
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = targets.find((target) => target.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id);
    if (message.error) item.reject(new Error(message.error.message));
    else item.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    seq += 1;
    pending.set(seq, { resolve, reject });
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, screenWidth: 1440, screenHeight: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://127.0.0.1:8787/videos.html?q=BBC%20Learning%20English' });
  await sleep(6000);
  await evaluate(`[...document.querySelectorAll('.preview-card')].find((n)=>n.textContent.includes('Is aircon'))?.click()`);
  await sleep(18000);
  const state = await evaluate(`({
    head: Boolean(document.querySelector('.detail-sub-head')),
    colsTop: Math.round(document.querySelector('.detail-sub-columns').getBoundingClientRect().top),
    playerTop: Math.round(document.querySelector('.detail-player-shell').getBoundingClientRect().top),
    en: document.querySelectorAll('#detail-en .detail-cue').length,
    zh: document.querySelectorAll('#detail-zh .detail-cue').length,
    statusHidden: getComputedStyle(document.getElementById('detail-status')).position,
    translateVisible: !document.getElementById('detail-translate').classList.contains('hidden'),
    exportText: document.getElementById('detail-export').textContent,
  })`);
  console.log(state);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile('.shots/detail-nohead.png', Buffer.from(shot.data, 'base64'));
} finally {
  chrome.kill();
  await sleep(300);
}

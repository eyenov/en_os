/** Report elements that overflow the mobile viewport. Dev utility. */
import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9334;
const BASE = process.env.ENOS_URL || 'http://127.0.0.1:8787';
const PROFILE = path.resolve(process.env.ENOS_PROFILE || '.chrome-profile-audit');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const target = process.argv[2] || `${BASE}/?debug=1#/home`;
const width = Number(process.argv[3] || 390);

async function main() {
  if (!process.env.ENOS_PROFILE) await rm(PROFILE, { recursive: true, force: true }).catch(() => {});
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--no-first-run', '--disable-gpu', '--hide-scrollbars', '--window-size=1440,1100', 'about:blank',
  ], { stdio: 'ignore' });
  try {
    for (let i = 0; i < 50; i += 1) {
      try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch { /* retry */ }
      await sleep(200);
    }
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const page = list.find((item) => item.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      pending.get(message.id)?.(message.result);
      pending.delete(message.id);
    });
    const send = (method, params = {}) => new Promise((resolve) => {
      id += 1;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression) => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      return result.result.value;
    };
    console.log('requested width', width);
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: target });
    await sleep(2500);
    const report = await evaluate(`(() => {
      const wide = [...document.querySelectorAll('body *')]
        .map((el) => ({ el, rect: el.getBoundingClientRect() }))
        .filter(({ rect }) => rect.width > 0 && rect.right > window.innerWidth + 1)
        .slice(0, 30)
        .map(({ el, rect }) => ({
          tag: el.tagName.toLowerCase(),
          cls: String(el.className).slice(0, 60),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          text: (el.textContent || '').trim().slice(0, 30),
        }));
      return {
        innerWidth: window.innerWidth,
        devicePixelRatio: window.devicePixelRatio,
        screenWidth: screen.width,
        visualScale: window.visualViewport?.scale,
        scrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        links: [...document.querySelectorAll('a')].map((a) => a.getAttribute('href')).filter((href) => href && href.includes('report')),
        sessionIds: (() => {
          try { return JSON.parse(localStorage.getItem('enos.sessions.v1') || '[]').map((item) => item.id); } catch { return []; }
        })(),
        chain: (() => {
          const nodes = ['.app', '.report-list', '.report-row', '.rr-main'];
          return nodes.map((selector) => {
            const el = document.querySelector(selector);
            if (!el) return null;
            const rect = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return { selector, width: Math.round(rect.width), left: Math.round(rect.left), maxWidth: style.maxWidth, minWidth: style.minWidth, display: style.display, grid: style.gridTemplateColumns };
          });
        })(),
        hero: (() => {
          const hero = document.querySelector('.report-hero');
          const stats = document.querySelector('.rh-stats');
          if (!hero) return null;
          return {
            hero: hero.getBoundingClientRect().toJSON(),
            stats: stats?.getBoundingClientRect().toJSON(),
            children: [...(stats?.children || [])].map((child) => child.getBoundingClientRect().toJSON()),
          };
        })(),
        wide,
      };
    })()`);
    console.log(JSON.stringify(report, null, 2));
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path.resolve('.shots', 'mobile-audit.png'), Buffer.from(shot.data, 'base64'));
  } finally {
    chrome.kill();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

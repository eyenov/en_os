import { aiReady, getHealth } from './api.js';
import { getSettings } from './store.js';
import { toast } from './ui.js';
import { renderHome } from './views/home.js';
import { renderListening } from './views/listening.js';
import { renderSession } from './views/session.js';
import { renderSettings } from './views/settings.js';
import { renderReports } from './views/reports.js';

const ROUTES = {
  home: renderHome,
  listening: renderListening,
  session: renderSession,
  settings: renderSettings,
  reports: renderReports,
};

let cleanup = null;
let currentRoute = 'home';

function parseRoute() {
  const hash = window.location.hash.replace(/^#\/?/, '');
  const [path] = hash.split('?');
  const route = path || 'home';
  return ROUTES[route] ? route : 'home';
}

export function navigate(path, { replace = false } = {}) {
  const target = `#/${path.replace(/^#?\//, '')}`;
  if (replace) window.location.replace(target);
  else window.location.hash = target;
}

export function updateStatusPill() {
  const settings = getSettings();
  const pill = document.getElementById('status-pill');
  const text = document.getElementById('status-text');
  if (!pill || !text) return;
  pill.classList.remove('ai', 'off');
  if (aiReady(settings)) {
    pill.classList.add('ai');
    text.textContent = 'AI 增强';
    pill.title = '每一步都会按你的场景做 AI 改写';
  } else if (settings.aiMode === 'off') {
    pill.classList.add('off');
    text.textContent = '本地引擎';
    pill.title = '已在设置中关闭 AI 增强';
  } else {
    pill.classList.add('off');
    text.textContent = '本地引擎';
    pill.title = '配置 API Key 后可启用 AI 场景改写、对话与评分';
  }
}

function markNav(route) {
  document.querySelectorAll('#nav a').forEach((link) => {
    const active = link.dataset.route === route;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

async function render() {
  const app = document.getElementById('app');
  if (!app) return;
  const route = parseRoute();
  currentRoute = route;
  cleanup?.();
  cleanup = null;
  markNav(route);
  updateStatusPill();

  app.innerHTML = '';
  app.classList.remove('fade-in');
  const ctx = { navigate, route, updateStatusPill };
  try {
    const view = await ROUTES[route](ctx);
    const element = view?.el || view;
    if (view?.title) document.title = view.title;
    else document.title = route === 'home' ? 'EnOS · 一句英文，走完雅思四项' : 'EnOS · 雅思语境学习';
    if (element) app.append(element);
    cleanup = view?.cleanup || null;
    requestAnimationFrame(() => app.classList.add('fade-in'));
  } catch (error) {
    console.error(error);
    app.append(
      Object.assign(document.createElement('div'), {
        className: 'empty-page',
        innerHTML: `<p class="eyebrow">出错了</p><h1>页面没有加载成功。</h1><p class="lede">${String(error.message || error)}</p><p><a class="btn btn-primary" href="#/home">回到首页</a></p>`,
      }),
    );
  }
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'auto' : 'auto' });
}

window.addEventListener('hashchange', render);
window.addEventListener('error', (event) => {
  if (event.error?.name === 'NotAllowedError') return;
  console.error(event.error || event.message);
});
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  if (reason?.name === 'AbortError') return;
  console.error(reason);
});

document.getElementById('status-pill')?.addEventListener('click', () => navigate('settings'));

(async () => {
  const health = await Promise.race([
    getHealth(),
    new Promise((resolve) => setTimeout(() => resolve(null), 1800)),
  ]);
  if (!health) console.warn('health check unavailable, using local defaults');
  updateStatusPill();
  if (!window.location.hash) window.location.replace('#/home');
  await render();
})();

export { currentRoute, toast };

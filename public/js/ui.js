/* Tiny DOM helpers, icons, toasts and modal. */

import { localizedText, localize, setI18nAttribute, t } from './i18n.js';

export function h(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class' || key === 'className') element.className = value;
    else if (key === 'html') { element.innerHTML = value; localize(element); }
    else if (key === 'text') element.replaceChildren(localizedText(value));
    else if (key === 'dataset') Object.assign(element.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') element.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'value') element.value = value;
    else if (key === 'checked' || key === 'disabled' || key === 'selected') element[key] = Boolean(value);
    else if (['title', 'aria-label', 'placeholder', 'alt'].includes(key)) setI18nAttribute(element, key, value);
    else element.setAttribute(key, value === true ? '' : value);
  }
  append(element, children);
  return element;
}

export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : parent.getAttribute('translate') === 'no' ? document.createTextNode(String(child)) : localizedText(child));
  }
}

const ICONS = {
  headphones: '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><path d="M4 14a2 2 0 0 1 2-2h1v6H6a2 2 0 0 1-2-2z"/><path d="M20 14a2 2 0 0 0-2-2h-1v6h1a2 2 0 0 0 2-2z"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15.5H6.5A2.5 2.5 0 0 0 4 21z"/><path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H20"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a17 17 0 0 1 0 20 17 17 0 0 1 0-20"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/>',
  play: '<path d="M8 5l11 7-11 7z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M8 5h3v14H8z"/><path d="M13 5h3v14h-3z"/>',
  volume: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 8.5a5 5 0 0 1 0 7"/><path d="M19.5 6a9 9 0 0 1 0 12"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
  arrowRight: '<path d="M4 12h15"/><path d="M13 6l6 6-6 6"/>',
  arrowLeft: '<path d="M20 12H5"/><path d="M11 18l-6-6 6-6"/>',
  maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m13-5v3a2 2 0 0 1-2 2h-3"/>',
  minimize: '<path d="M8 3v3a2 2 0 0 1-2 2H3m13-5v3a2 2 0 0 0 2 2h3M3 16h3a2 2 0 0 1 2 2v3m8 0v-3a2 2 0 0 1 2-2h3"/>',
  check: '<path d="M4 12.5l5 5L20 6.5"/>',
  sparkles: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M18.5 15l.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8z"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  chart: '<path d="M4 20V4"/><path d="M4 20h16"/><path d="M8 16v-4"/><path d="M13 16V8"/><path d="M18 16v-6"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  settings: '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.08a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.08a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9"/><path d="M17 6l2 2"/><path d="M14 9l2 2"/>',
  lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
  download: '<path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/>',
  printer: '<path d="M7 9V3h10v6"/><rect x="4" y="9" width="16" height="7" rx="2"/><path d="M7 16h10v5H7z"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.9-3M4 5v6h6"/><path d="M4 13a8 8 0 0 0 14.9 3M20 19v-6h-6"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 14h10l1-14"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  close: '<path d="M6 6l12 12"/><path d="M18 6L6 18"/>',
  chevronDown: '<path d="M6 9l6 6 6-6"/>',
  chevronRight: '<path d="M9 6l6 6-6 6"/>',
  wave: '<path d="M2 12h3"/><path d="M6 8v8"/><path d="M10 5v14"/><path d="M14 8v8"/><path d="M18 10v4"/><path d="M22 12h-1"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  send: '<path d="M4 12l16-8-6 16-3-6z"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="2"/>',
  bulb: '<path d="M9 18h6"/><path d="M10 21h4"/><path d="M8 14a6 6 0 1 1 8 0c-.8.7-1 1.4-1 2H9c0-.6-.2-1.3-1-2z"/>',
};

export function icon(name, size = 18, stroke = 1.7) {
  const path = ICONS[name] || ICONS.info;
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

export function bindFullscreen(button, element, onError = () => {}) {
  const root = element.ownerDocument;
  const enter = element.requestFullscreen || element.webkitRequestFullscreen;
  const exit = root.exitFullscreen || root.webkitExitFullscreen;
  const supported = Boolean(enter && exit && (root.fullscreenEnabled ?? root.webkitFullscreenEnabled ?? true));
  let pending = false;
  let errorReported = false;

  const active = () => Boolean(root.fullscreenElement || root.webkitFullscreenElement);
  const sync = () => {
    const entered = active();
    button.disabled = pending || !(entered ? exit : supported);
    const label = entered ? '退出全屏' : supported ? '进入全屏' : '当前浏览器不支持页面全屏';
    setI18nAttribute(button, 'title', label);
    setI18nAttribute(button, 'aria-label', label);
    button.setAttribute('aria-pressed', String(entered));
    button.innerHTML = icon(entered ? 'minimize' : 'maximize', 18);
  };
  const reportError = (error) => {
    if (errorReported) return;
    errorReported = true;
    onError(error);
  };
  const toggle = async () => {
    if (pending || button.disabled) return;
    pending = true;
    errorReported = false;
    sync();
    try {
      if (active()) await exit.call(root);
      else await enter.call(element);
    } catch (error) {
      reportError(error);
    } finally {
      pending = false;
      sync();
    }
  };
  const click = () => { void toggle(); };
  button.addEventListener('click', click);
  for (const event of ['fullscreenchange', 'webkitfullscreenchange']) root.addEventListener(event, sync);
  for (const event of ['fullscreenerror', 'webkitfullscreenerror']) root.addEventListener(event, reportError);
  sync();
  return {
    toggle,
    destroy() {
      button.removeEventListener('click', click);
      for (const event of ['fullscreenchange', 'webkitfullscreenchange']) root.removeEventListener(event, sync);
      for (const event of ['fullscreenerror', 'webkitfullscreenerror']) root.removeEventListener(event, reportError);
    },
  };
}

export function toast(message, type = 'info', timeout = 3400) {
  const root = document.getElementById('toasts');
  if (!root) return;
  const identity = typeof message === 'object' ? JSON.stringify(message) : message;
  if ([...root.children].some((child) => child.dataset.message === identity)) return;
  const node = h('div', { class: `toast ${type}`, 'data-message': identity }, h('span', { class: 'toast-icon' }, type === 'ok' ? '✓' : type === 'err' ? '!' : '·'), h('span', {}, message));
  root.append(node);
  setTimeout(() => {
    node.classList.add('fade-out');
    setTimeout(() => node.remove(), 260);
  }, timeout);
}

export function modal({ title, body, actions = [{ label: '知道了', value: true, primary: true }] }) {
  const root = document.getElementById('modal-root');
  const opener = document.activeElement;
  return new Promise((resolve) => {
    const close = (value) => {
      overlay.close();
      overlay.remove();
      if (opener?.isConnected) opener.focus();
      resolve(value);
    };
    const overlay = h('dialog', { class: 'modal', 'aria-label': title },
      h('div', { class: 'modal-card' },
        h('h3', {}, title),
        h('div', { class: 'modal-body' }, body),
        h('div', { class: 'modal-actions' }, actions.map((action) => h('button', {
          class: `btn ${action.primary ? 'btn-primary' : 'btn-ghost'}`,
          type: 'button',
          onclick: () => close(action.value),
        }, action.label)))));
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(null); });
    overlay.addEventListener('cancel', (event) => {
      event.preventDefault();
      close(null);
    });
    root.append(overlay);
    overlay.showModal();
  });
}

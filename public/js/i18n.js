import i18next from './i18next.js';
import english from './locales/en.js';
import { getSettings, saveSettings } from './store.js';

const textSources = new WeakMap();
const attributeSources = new WeakMap();
const attributes = ['title', 'aria-label', 'placeholder', 'alt'];
const instance = i18next.createInstance();
let currentLocale = getSettings().locale;

await instance.init({
  lng: currentLocale, fallbackLng: 'zh-CN', initAsync: false,
  keySeparator: false, nsSeparator: false, interpolation: { escapeValue: false },
  resources: {
    en: { translation: english },
    'zh-CN': { translation: Object.fromEntries(Object.keys(english).filter((key) => !/_(?:one|other)$/.test(key)).map((key) => [key, key])) },
  },
});

export function getLocale() { return getSettings().locale; }
export function t(key, values = {}) {
  const resolved = Object.fromEntries(Object.entries(values).map(([name, value]) => [name,
    value && typeof value === 'object' && typeof value.i18nKey === 'string' ? t(value.i18nKey, value.values) : value]));
  return instance.t(key, { ...resolved, lng: getLocale() });
}
export function msg(key, values = {}) { return { i18nKey: key, values }; }

function source(value) {
  if (value && typeof value === 'object' && typeof value.i18nKey === 'string') return value;
  return typeof value === 'string' && Object.hasOwn(english, value) ? msg(value) : null;
}

export function localizedText(value, root = globalThis.document) {
  const binding = source(value);
  const node = root.createTextNode(binding ? t(binding.i18nKey, binding.values) : String(value));
  if (binding) textSources.set(node, binding);
  return node;
}

export function setText(element, key, values = {}) {
  element.replaceChildren(localizedText(typeof key === 'object' ? key : msg(key, values), element.ownerDocument));
}

export function setI18nAttribute(element, name, value) {
  const binding = source(value);
  let saved = attributeSources.get(element);
  if (!saved) { saved = new Map(); attributeSources.set(element, saved); }
  if (binding) saved.set(name, binding);
  else saved.delete(name);
  element.setAttribute(name, binding ? t(binding.i18nKey, binding.values) : String(value));
}

export function localize(root = globalThis.document) {
  if (!root?.querySelectorAll) return;
  const document = root.ownerDocument || root;
  if (document.documentElement) document.documentElement.lang = getLocale();
  const walker = document.createTreeWalker(root, 4);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest('[translate="no"], script, style, textarea, pre, code')) continue;
    let binding = textSources.get(node);
    if (!binding) {
      const trimmed = node.data.trim();
      binding = source(trimmed);
      if (binding) {
        binding = { ...binding, before: node.data.slice(0, node.data.indexOf(trimmed)), after: node.data.slice(node.data.indexOf(trimmed) + trimmed.length) };
        textSources.set(node, binding);
      }
    }
    if (binding) node.data = `${binding.before || ''}${t(binding.i18nKey, binding.values)}${binding.after || ''}`;
  }
  const elements = [...root.querySelectorAll(attributes.map((name) => `[${name}]`).join(','))];
  if (root.nodeType === 1) elements.unshift(root);
  for (const element of elements) {
    if (element.closest('[translate="no"]')) continue;
    for (const name of attributes) {
      const value = element.getAttribute(name);
      if (value === null) continue;
      const binding = attributeSources.get(element)?.get(name) || source(value);
      if (binding) setI18nAttribute(element, name, binding);
    }
  }
  for (const select of root.querySelectorAll('[data-locale-select]')) select.value = getLocale();
}

export function setLocale(locale) {
  saveSettings({ locale });
  syncLocale();
}

function syncLocale() {
  const next = getLocale();
  if (next === currentLocale) return;
  currentLocale = next;
  void instance.changeLanguage(next);
  localize();
  globalThis.window?.dispatchEvent(new CustomEvent('enos:locale', { detail: { locale: next } }));
}

export function initI18n() {
  localize();
  for (const select of globalThis.document?.querySelectorAll('[data-locale-select]') || []) {
    select.addEventListener('change', () => {
      setLocale(select.value);
      const menu = select.closest('details');
      if (menu) { menu.open = false; menu.querySelector('summary').focus(); }
    });
  }
}
globalThis.window?.addEventListener?.('enos:settings', syncLocale);
initI18n();
import { msg, setText } from './i18n.js';

export const VIDEO_LAYOUT_KEY = 'enos.youtube.layout.v1';
export const VIDEO_PANEL_IDS = ['video', 'agent', 'en', 'zh'];

export function defaultVideoLayout(leftColumns = 6) {
  const left = Math.max(4, Math.min(8, Math.round(Number(leftColumns) || 6)));
  const english = Math.ceil((12 - left) / 2);
  return [
    { id: 'video', x: 0, y: 0, w: left, h: 5 },
    { id: 'agent', x: 0, y: 5, w: left, h: 7 },
    { id: 'en', x: left, y: 0, w: english, h: 12 },
    { id: 'zh', x: left + english, y: 0, w: 12 - left - english, h: 12 },
  ];
}

export function normalizeVideoLayout(value) {
  if (!Array.isArray(value) || value.length !== VIDEO_PANEL_IDS.length) return defaultVideoLayout();
  const items = new Map();
  for (const item of value) {
    if (!item || !VIDEO_PANEL_IDS.includes(item.id) || items.has(item.id)) return defaultVideoLayout();
    if (!['x', 'y', 'w', 'h'].every((key) => Number.isInteger(item[key]))) return defaultVideoLayout();
    if (item.x < 0 || item.y < 0 || item.w < 2 || item.h < 3 || item.x + item.w > 12 || item.y + item.h > 48) return defaultVideoLayout();
    items.set(item.id, { id: item.id, x: item.x, y: item.y, w: item.w, h: item.h });
  }
  return VIDEO_PANEL_IDS.map((id) => items.get(id));
}

export class VideoWindowLayout {
  constructor({ host, element, status, onChange = () => {} }) {
    this.host = host;
    this.element = element;
    this.status = status;
    this.onChange = onChange;
    this.panels = new Map(Array.from(element.querySelectorAll('[data-panel]')).map((panel) => [panel.dataset.panel, panel]));
    this.mode = 'normal';
    this.mobile = null;
    this.applying = false;
    this.gesture = false;
    this.layouts = { normal: { desktop: this.readDesktop(), mobile: this.readMobile() }, shadowing: { desktop: null, mobile: null } };
    this.grid = window.GridStack.init({
      column: 12, cellHeight: 48, margin: 4, minRow: 12, maxRow: 48,
      mode: 'float', handle: '.detail-panel-handle', animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      alwaysShowResizeHandle: 'mobile', draggable: { appendTo: 'parent' }, resizable: { handles: 'e,s,se' },
      acceptWidgets: false, removable: false,
    }, element);
    this.grid.on('dragstart resizestart', () => {
      this.gesture = true;
      element.classList.add('is-layout-dragging');
    });
    this.grid.on('dragstop resizestop', () => {
      this.gesture = false;
      element.classList.remove('is-layout-dragging');
      this.remember();
      setText(status, '窗口布局已更新');
      onChange();
    });
    this.grid.on('change', () => {
      this.remember();
      onChange();
    });
    for (const panel of this.panels.values()) panel.querySelector('.detail-panel-handle').addEventListener('keydown', (event) => this.moveWithKeyboard(event, panel));
    this.observer = new ResizeObserver(() => this.refresh());
    this.observer.observe(host);
    this.refresh();
  }

  readDesktop() {
    try {
      const saved = localStorage.getItem(VIDEO_LAYOUT_KEY);
      if (saved) return normalizeVideoLayout(JSON.parse(saved));
      const legacy = Number(localStorage.getItem('enos.detail.left.v1'));
      if (legacy >= 36 && legacy <= 72) return defaultVideoLayout(legacy * 12 / 100);
    } catch {}
    return defaultVideoLayout();
  }

  readMobile() {
    try {
      const saved = JSON.parse(localStorage.getItem(`${VIDEO_LAYOUT_KEY}.mobile`));
      if (Array.isArray(saved) && saved.length === 4 && new Set(saved.map((item) => item?.id)).size === 4
        && saved.every((item) => VIDEO_PANEL_IDS.includes(item.id) && item.x === 0 && item.w === 1
          && Number.isInteger(item.y) && item.y >= 0 && Number.isInteger(item.h) && item.h >= 3 && item.y + item.h <= 48)) {
        return saved.map(({ id, x, y, w, h }) => ({ id, x, y, w, h }));
      }
    } catch {}
    return null;
  }

  visibleIds() {
    return this.mode === 'normal' ? VIDEO_PANEL_IDS : this.mobile ? ['video', 'en'] : ['video', 'agent', 'en'];
  }

  defaults() {
    if (this.mobile) {
      const cellHeight = this.grid.getCellHeight();
      const videoHeight = Math.max(3, Math.min(7, Math.ceil(((this.host.clientWidth - 12) * 9 / 16 + 32) / cellHeight)));
      let row = 0;
      return this.visibleIds().map((id) => {
        const height = id === 'video' ? videoHeight : this.mode === 'shadowing' ? 12 - videoHeight : id === 'agent' ? 6 : 10;
        const item = { id, x: 0, y: row, w: 1, h: height };
        row += height;
        return item;
      });
    }
    if (this.mode === 'normal') return defaultVideoLayout();
    const normal = this.layouts.normal.desktop;
    const english = normal.find((item) => item.id === 'en');
    const chinese = normal.find((item) => item.id === 'zh');
    return normal.filter((item) => item.id !== 'zh').map((item) => {
      if (item.id === 'en' && english.y === chinese.y && english.h === chinese.h
        && (english.x + english.w === chinese.x || chinese.x + chinese.w === english.x)) {
        return { ...item, x: Math.min(english.x, chinese.x), w: english.w + chinese.w };
      }
      return { ...item };
    });
  }

  remember() {
    if (this.applying || this.gesture || this.mobile === null) return;
    const layout = this.grid.getGridItems().map((panel) => panel.gridstackNode)
      .filter((item) => item && this.visibleIds().includes(item.id)).map(({ id, x, y, w, h }) => ({ id, x, y, w, h }));
    this.layouts[this.mode][this.mobile ? 'mobile' : 'desktop'] = layout;
    if (this.mode !== 'normal') return;
    try {
      localStorage.setItem(VIDEO_LAYOUT_KEY, JSON.stringify(this.layouts.normal.desktop));
      if (this.layouts.normal.mobile) localStorage.setItem(`${VIDEO_LAYOUT_KEY}.mobile`, JSON.stringify(this.layouts.normal.mobile));
    } catch {
      setText(this.status, '布局已调整，浏览器未能保存位置');
    }
  }

  apply() {
    this.applying = true;
    const columns = this.mobile ? 1 : 12;
    const ids = this.visibleIds();
    const layout = this.layouts[this.mode][this.mobile ? 'mobile' : 'desktop'] || this.defaults();
    this.grid.batchUpdate();
    this.grid.column(columns);
    for (const [id, panel] of this.panels) {
      const visible = ids.includes(id);
      if (!visible && panel.gridstackNode) this.grid.removeWidget(panel, false, false);
      panel.classList.toggle('hidden', !visible);
      if (visible && !panel.gridstackNode) this.grid.makeWidget(panel, { id });
      if (visible) this.grid.update(panel, { minW: this.mobile ? 1 : 2, minH: 3, maxH: 24 });
    }
    this.grid.load(layout.map((item) => ({ ...item })), false);
    this.grid.batchUpdate(false);
    this.applying = false;
    this.element.dataset.layoutMode = this.mode;
    this.element.dataset.layoutColumns = String(columns);
    this.onChange();
  }

  updateCellHeight() {
    const style = window.getComputedStyle(this.host);
    const height = this.host.clientHeight - Number.parseFloat(style.paddingTop) - Number.parseFloat(style.paddingBottom);
    this.grid.cellHeight(this.mobile && this.mode === 'normal' ? 48 : Math.max(20, Math.floor(height / 12)));
  }

  refresh() {
    if (!this.host.clientWidth || !this.host.clientHeight || this.applying || this.gesture) return;
    const mobile = this.host.clientWidth <= 600;
    const changed = mobile !== this.mobile;
    if (changed) this.remember();
    this.mobile = mobile;
    this.updateCellHeight();
    if (changed) this.apply();
    else if (this.mode === 'shadowing' && this.mobile) {
      this.layouts.shadowing.mobile = null;
      this.apply();
    }
    this.onChange();
  }

  setShadowing(active) {
    const mode = active ? 'shadowing' : 'normal';
    if (mode === this.mode) return;
    this.remember();
    this.mode = mode;
    this.updateCellHeight();
    this.apply();
    this.host.scrollTop = 0;
  }

  reset() {
    this.layouts[this.mode] = { desktop: this.mode === 'normal' ? defaultVideoLayout() : null, mobile: null };
    if (this.mode === 'normal') {
      try {
        localStorage.removeItem('enos.detail.left.v1');
        localStorage.removeItem(`${VIDEO_LAYOUT_KEY}.mobile`);
      } catch {}
    }
    this.apply();
    this.remember();
    this.host.scrollTop = 0;
    setText(this.status, '已恢复默认窗口布局');
  }

  moveWithKeyboard(event, panel) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) || this.gesture) return;
    const node = panel.gridstackNode;
    if (!node) return;
    event.preventDefault();
    const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
    const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
    const property = event.shiftKey ? horizontal ? 'w' : 'h' : horizontal ? 'x' : 'y';
    const minimum = property === 'w' ? this.mobile ? 1 : 2 : property === 'h' ? 3 : 0;
    this.grid.update(panel, { [property]: Math.max(minimum, node[property] + direction) });
    this.remember();
    const label = { video: '视频窗口', agent: 'Agent 对话窗口', en: '英文字幕窗口', zh: '中文字幕窗口' }[panel.dataset.panel];
    setText(this.status, '{{window}}位置已更新', { window: msg(label || panel.getAttribute('aria-label')) });
    this.onChange();
  }
}
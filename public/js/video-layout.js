import { msg, setText } from './i18n.js';

export const VIDEO_LAYOUT_KEY = 'enos.youtube.layout.v1';
export const VIDEO_VISIBILITY_KEY = 'enos.youtube.visibility.v1';
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

export function fitVideoLayout(layout, rows = 12) {
  const overlaps = (left, right) => left.x < right.x + right.w && right.x < left.x + left.w;
  return layout.map(({ id, x, y, w, h }) => {
    const panel = { id, x, y, w, h };
    const above = layout.some((other) => other.id !== id && other.y < y && overlaps(panel, other));
    const below = layout.filter((other) => other.id !== id && other.y > y && overlaps(panel, other)).length;
    const height = above && !below ? Math.max(3, rows - y) : below ? Math.min(h, Math.max(3, rows - y - below * 3)) : h;
    return { ...panel, h: height };
  });
}

export function alignVideoColumns(layout, columns = 12, resizedId = null, edge = 'e') {
  if (!layout.length) return [];
  const groups = new Map();
  for (const { id, x, y, w, h } of layout) {
    const key = columns === 1 ? 0 : x;
    if (!groups.has(key)) groups.set(key, { x: key, panels: [] });
    groups.get(key).panels.push({ id, x, y, w, h });
  }
  const ordered = [...groups.values()].sort((left, right) => left.x - right.x);
  for (const group of ordered) group.panels.sort((left, right) => left.y - right.y);
  const minimum = columns === 1 ? 1 : 2;
  const resized = ordered.find((group) => group.panels.some((item) => item.id === resizedId));
  const fixedWidth = resized ? Math.max(minimum, Math.min(columns - minimum * (ordered.length - 1), resized.panels.find((item) => item.id === resizedId).w)) : 0;
  const flexible = ordered.filter((group) => group !== resized);
  const remaining = columns - fixedWidth - flexible.length * minimum;
  const weights = flexible.map((group) => Math.max(0, group.panels[0].w - minimum));
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  const widths = flexible.map((group, index) => {
    const extra = resized ? 0 : remaining * (weightSum ? weights[index] / weightSum : 1 / flexible.length);
    return { group, width: resized ? Math.max(minimum, group.panels[0].w) : minimum + Math.floor(extra), fraction: extra - Math.floor(extra) };
  });
  let unused = columns - fixedWidth - widths.reduce((sum, item) => sum + item.width, 0);
  if (resized) {
    const index = ordered.indexOf(resized);
    const left = ordered.slice(0, index).reverse();
    const right = ordered.slice(index + 1);
    for (const group of edge === 'w' ? [...left, ...right] : [...right, ...left]) {
      if (!unused) break;
      const item = widths.find((entry) => entry.group === group);
      const adjustment = unused > 0 ? unused : Math.max(unused, minimum - item.width);
      item.width += adjustment;
      unused -= adjustment;
    }
  } else {
    for (const item of widths.slice().sort((left, right) => right.fraction - left.fraction)) {
      if (unused <= 0) break;
      item.width += 1;
      unused -= 1;
    }
  }
  let nextColumn = 0;
  const result = new Map();
  for (const group of ordered) {
    const width = group === resized ? fixedWidth : widths.find((item) => item.group === group).width;
    let nextRow = 0;
    for (const panel of group.panels) {
      result.set(panel.id, { ...panel, x: nextColumn, y: nextRow, w: width });
      nextRow += panel.h;
    }
    nextColumn += width;
  }
  return layout.map((item) => result.get(item.id));
}

export function moveVideoWindow(layout, id, column, beforeId = null) {
  const source = layout.find((item) => item.id === id);
  if (!source) return layout.map((item) => ({ ...item }));
  const target = layout.filter((item) => item.id !== id && item.x === column).sort((left, right) => left.y - right.y);
  const before = target.find((item) => item.id === beforeId);
  const last = target.at(-1);
  return layout.map((item) => item.id === id
    ? { ...item, x: column, w: target[0]?.w || source.w, y: before ? before.y - 0.5 : last ? last.y + last.h : 0 }
    : { ...item });
}

export function normalizeVideoVisibility(value) {
  if (!Array.isArray(value) || new Set(value).size !== value.length || value.some((id) => !VIDEO_PANEL_IDS.includes(id))) return [...VIDEO_PANEL_IDS];
  return VIDEO_PANEL_IDS.filter((id) => value.includes(id));
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
    this.shown = this.readVisibility();
    this.layouts = { normal: { desktop: this.readDesktop(), mobile: this.readMobile() }, shadowing: { desktop: null, mobile: null } };
    this.grid = window.GridStack.init({
      column: 12, cellHeight: 48, margin: 4, minRow: 12, maxRow: 48,
      mode: 'top', handle: '.detail-panel-handle', animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      alwaysShowResizeHandle: 'mobile', draggable: { appendTo: 'parent' }, resizable: { handles: 'w,e,s,se,sw' },
      acceptWidgets: false, removable: false,
    }, element);
    const trackPress = (event) => {
      const panel = event.target.closest?.('[data-panel]');
      const point = this.pointer(event);
      if (!panel || !point || !this.element.contains(panel)) return;
      const rect = panel.getBoundingClientRect();
      this.press = { id: panel.dataset.panel, offsetColumn: (point.x - rect.left) / this.grid.cellWidth(), offsetRow: (point.y - rect.top) / this.grid.getCellHeight() };
    };
    document.addEventListener('pointerdown', trackPress, { capture: true, passive: true });
    document.addEventListener('touchstart', trackPress, { capture: true, passive: true });
    const trackPointer = (event) => {
      const point = this.pointer(event);
      if (this.action && point) {
        this.action.point = point;
        this.action.rawPoint = true;
      }
    };
    document.addEventListener('pointermove', trackPointer, { capture: true, passive: true });
    document.addEventListener('touchmove', trackPointer, { capture: true, passive: true });
    this.grid.on('dragstart resizestart', (event, panel) => this.startGesture(event, panel));
    this.grid.on('drag resize', (event, panel) => {
      const point = this.pointer(event);
      if (this.action && point && !this.action.rawPoint) this.action.point = point;
      if (this.action && event.type === 'resize') {
        this.action.edge = event.hasMovedX ? 'w' : 'e';
        this.action.size = { w: panel.gridstackNode.w, h: panel.gridstackNode.h };
        this.resizeGesture(this.action, panel);
      }
    });
    this.grid.on('dragstop resizestop', (event, panel) => this.finishGesture(event, panel));
    this.grid.on('change', () => {
      if (this.applying || this.gesture) return;
      this.fit();
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

  readVisibility() {
    try { return normalizeVideoVisibility(JSON.parse(localStorage.getItem(VIDEO_VISIBILITY_KEY))); }
    catch { return [...VIDEO_PANEL_IDS]; }
  }

  eligibleIds() {
    return this.mode === 'normal' ? VIDEO_PANEL_IDS : this.mobile ? ['video', 'en'] : ['video', 'agent', 'en'];
  }

  visibleIds() {
    return this.eligibleIds().filter((id) => (this.shown || VIDEO_PANEL_IDS).includes(id));
  }

  setVisible(id, visible) {
    if (!this.eligibleIds().includes(id)) return false;
    this.remember();
    const shown = this.shown || VIDEO_PANEL_IDS;
    this.shown = VIDEO_PANEL_IDS.filter((panelId) => panelId === id ? visible : shown.includes(panelId));
    this.apply();
    this.remember();
    try { localStorage.setItem(VIDEO_VISIBILITY_KEY, JSON.stringify(this.shown)); }
    catch { setText(this.status, '窗口显示已调整，浏览器未能保存设置'); }
    return true;
  }

  preview() {
    const key = this.mobile ? 'mobile' : 'desktop';
    const saved = this.layouts.normal[key] || this.defaults();
    const visible = this.visibleIds();
    const eligible = this.eligibleIds();
    const panels = VIDEO_PANEL_IDS.map((id) => {
      const node = this.panels.get(id)?.gridstackNode || saved.find((item) => item.id === id) || defaultVideoLayout().find((item) => item.id === id);
      const { x, y, w, h } = node;
      return { id, x, y, w, h, visible: visible.includes(id), enabled: eligible.includes(id) };
    });
    return { columns: this.mobile ? 1 : 12, rows: Math.max(12, ...panels.map((item) => item.y + item.h)), panels };
  }

  fit() {
    if (this.applying || this.gesture) return;
    const saved = this.layouts[this.mode][this.mobile ? 'mobile' : 'desktop'] || this.defaults();
    const ids = this.visibleIds();
    const layout = this.arrange(saved.filter((item) => ids.includes(item.id)));
    const actual = this.currentLayout();
    if (actual.length !== layout.length || layout.some((item) => {
      const node = actual.find((other) => other.id === item.id);
      return !node || ['x', 'y', 'w', 'h'].some((key) => item[key] !== node[key]);
    })) this.apply();
  }

  currentLayout() {
    return this.grid.getGridItems().map((panel) => panel.gridstackNode)
      .filter((item) => item && this.visibleIds().includes(item.id)).map(({ id, x, y, w, h }) => ({ id, x, y, w, h }));
  }

  arrange(layout, resizedId = null, edge = 'e') {
    const columns = this.mobile ? 1 : 12;
    const aligned = alignVideoColumns(layout, columns, resizedId, edge);
    return this.mobile && this.mode === 'normal' ? aligned : alignVideoColumns(fitVideoLayout(aligned), columns);
  }

  pointer(event) {
    const pointer = event.touches?.[0] || event.changedTouches?.[0] || event;
    return Number.isFinite(pointer.clientX) && Number.isFinite(pointer.clientY) ? { x: pointer.clientX, y: pointer.clientY } : null;
  }

  startGesture(event, panel) {
    const point = this.pointer(event);
    const rect = panel.getBoundingClientRect();
    const press = this.press?.id === panel.dataset.panel ? this.press : null;
    this.action = {
      id: panel.dataset.panel, layout: this.currentLayout(), point,
      saved: this.layouts[this.mode][this.mobile ? 'mobile' : 'desktop'].map((item) => ({ ...item })),
      offsetColumn: press?.offsetColumn ?? (point ? (point.x - rect.left) / this.grid.cellWidth() : 0),
      offsetRow: press?.offsetRow ?? (point ? (point.y - rect.top) / this.grid.getCellHeight() : 0),
    };
    this.press = null;
    this.gesture = true;
    this.element.classList.add('is-layout-dragging');
  }

  resizeGesture(action, panel, preview = true) {
    const size = action.size || panel.gridstackNode;
    const original = action.saved.find((item) => item.id === action.id);
    const displayed = action.layout.find((item) => item.id === action.id);
    const width = this.mobile ? 1 : Math.round(size.w * original.w / displayed.w);
    const resized = action.saved.map((item) => item.id === action.id ? { ...item, w: width, h: size.h } : { ...item });
    this.commit(resized, size.w === displayed.w ? null : action.id, action.edge);
    if (preview) {
      const node = panel.gridstackNode;
      Object.assign(panel.style, {
        left: `${node.x * this.grid.cellWidth()}px`, top: `${node.y * this.grid.getCellHeight()}px`,
        width: `${node.w * this.grid.cellWidth()}px`, height: `${node.h * this.grid.getCellHeight()}px`,
      });
    }
  }

  finishGesture(event, panel) {
    const action = this.action;
    const node = panel.gridstackNode;
    this.action = null;
    this.gesture = false;
    this.element.classList.remove('is-layout-dragging');
    if (!action || !node) return;
    const saved = action.saved;
    if (event.type === 'resizestop') {
      this.resizeGesture(action, panel, false);
    } else {
      const rect = this.element.getBoundingClientRect();
      const position = action.point ? Math.round((action.point.x - rect.left) / this.grid.cellWidth() - action.offsetColumn) : node.x;
      const columns = [...new Map(action.layout.map((item) => [item.x, item])).values()].sort((left, right) => left.x - right.x);
      const target = this.mobile ? columns[0] : columns.find((item) => position >= item.x && position < item.x + item.w);
      const column = target ? saved.find((item) => item.id === target.id).x : position < 0 ? -1 : 12;
      const row = action.point ? (action.point.y - rect.top) / this.grid.getCellHeight() - action.offsetRow : node.y;
      let nextRow = 0;
      const before = target && action.layout.filter((item) => item.x === target.x && item.id !== action.id)
        .sort((left, right) => left.y - right.y).find((item) => {
          const midpoint = nextRow + item.h / 2;
          nextRow += item.h;
          return row < midpoint;
        });
      this.commit(moveVideoWindow(saved, action.id, column, before?.id));
    }
    setText(this.status, '窗口布局已更新');
  }

  commit(layout, resizedId = null, edge = 'e') {
    this.layouts[this.mode][this.mobile ? 'mobile' : 'desktop'] = this.arrange(layout, resizedId, edge);
    this.apply();
    this.remember();
  }

  defaults() {
    if (this.mobile) {
      const cellHeight = this.grid.getCellHeight();
      const videoHeight = Math.max(3, Math.min(7, Math.ceil(((this.host.clientWidth - 12) * 9 / 16 + 32) / cellHeight)));
      let row = 0;
      return (this.mode === 'normal' ? VIDEO_PANEL_IDS : this.eligibleIds()).map((id) => {
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
    const layout = this.currentLayout();
    const key = this.mobile ? 'mobile' : 'desktop';
    const previous = this.layouts[this.mode][key] || (this.mode === 'normal' && layout.length !== VIDEO_PANEL_IDS.length ? this.defaults() : layout);
    if (!this.appliedLayout) this.layouts[this.mode][key] = this.mode === 'normal'
      ? previous.map((item) => layout.find((current) => current.id === item.id) || item) : layout;
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
    const key = this.mobile ? 'mobile' : 'desktop';
    const saved = this.arrange(this.layouts[this.mode][key] || this.defaults());
    this.layouts[this.mode][key] = saved;
    const layout = this.arrange(saved.filter((item) => ids.includes(item.id)));
    const maxWidth = columns - (this.mobile ? 1 : 2) * Math.max(0, new Set(layout.map((item) => item.x)).size - 1);
    this.grid.batchUpdate();
    this.grid.column(columns);
    for (const [id, panel] of this.panels) {
      const visible = ids.includes(id);
      if (!visible && panel.gridstackNode) this.grid.removeWidget(panel, false, false);
      panel.classList.toggle('hidden', !visible);
      panel.inert = !visible;
      if (visible && !panel.gridstackNode) this.grid.makeWidget(panel, { id });
      if (visible) this.grid.update(panel, { minW: this.mobile ? 1 : 2, maxW: maxWidth, minH: 3, maxH: 24 });
    }
    this.grid.load(layout, false);
    this.grid.batchUpdate(false);
    this.appliedLayout = this.currentLayout();
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
      this.shown = [...VIDEO_PANEL_IDS];
      try {
        localStorage.removeItem('enos.detail.left.v1');
        localStorage.removeItem(`${VIDEO_LAYOUT_KEY}.mobile`);
        localStorage.removeItem(VIDEO_VISIBILITY_KEY);
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
    const saved = this.layouts[this.mode][this.mobile ? 'mobile' : 'desktop'];
    const original = saved.find((item) => item.id === node.id);
    const visible = this.currentLayout();
    if (event.shiftKey) {
      const width = this.mobile ? 1 : Math.max(2, Math.round((node.w + direction) * original.w / node.w));
      this.commit(saved.map((item) => item.id === node.id ? { ...item, ...(horizontal ? { w: width } : { h: Math.max(3, node.h + direction) }) } : { ...item }), horizontal ? node.id : null);
    } else if (horizontal && !this.mobile) {
      const columns = [...new Map(visible.map((item) => [item.x, item])).values()].sort((left, right) => left.x - right.x);
      const target = columns[columns.findIndex((item) => item.x === node.x) + direction];
      const column = target ? saved.find((item) => item.id === target.id).x : direction < 0 ? -1 : 12;
      this.commit(moveVideoWindow(saved, node.id, column));
    } else if (!horizontal) {
      const stack = visible.filter((item) => item.x === node.x).sort((left, right) => left.y - right.y);
      const index = stack.findIndex((item) => item.id === node.id);
      if (!stack[index + direction]) return;
      const before = direction < 0 ? stack[index - 1].id : stack[index + 2]?.id;
      this.commit(moveVideoWindow(saved, node.id, original.x, before));
    }
    const label = { video: '视频窗口', agent: 'Agent 对话窗口', en: '英文字幕窗口', zh: '中文字幕窗口' }[panel.dataset.panel];
    setText(this.status, '{{window}}位置已更新', { window: msg(label || panel.getAttribute('aria-label')) });
    this.onChange();
  }
}
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultVideoLayout, normalizeVideoLayout, VIDEO_LAYOUT_KEY, VIDEO_PANEL_IDS, VideoWindowLayout } from '../public/js/video-layout.js';

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
};
globalThis.window = { getComputedStyle: (host) => host.style };
beforeEach(() => storage.clear());

test('video layout contains four independently positioned nonoverlapping panels', () => {
  const layout = defaultVideoLayout();
  assert.deepEqual(layout.map((item) => item.id), VIDEO_PANEL_IDS);
  for (const [index, item] of layout.entries()) {
    for (const other of layout.slice(index + 1)) {
      assert.ok(item.x + item.w <= other.x || other.x + other.w <= item.x
        || item.y + item.h <= other.y || other.y + other.h <= item.y);
    }
  }
});

test('valid layouts retain each panel position and discard unrelated fields', () => {
  const layout = defaultVideoLayout().reverse().map((item) => ({ ...item, content: '<script>invalid</script>' }));
  layout.find((item) => item.id === 'agent').y = 16;
  const restored = normalizeVideoLayout(layout);
  assert.equal(restored.find((item) => item.id === 'agent').y, 16);
  assert.deepEqual(restored.map((item) => item.id), VIDEO_PANEL_IDS);
  assert.ok(restored.every((item) => !('content' in item)));
});

test('layout restore rejects missing, duplicate and unknown panels', () => {
  const layout = defaultVideoLayout();
  for (const value of [null, {}, layout.slice(0, 3), [layout[0], layout[0], layout[2], layout[3]], layout.map((item) => ({ ...item, id: 'unknown' }))]) {
    assert.deepEqual(normalizeVideoLayout(value), layout);
  }
});

test('layout restore bounds coordinates and dimensions', () => {
  const layout = defaultVideoLayout();
  for (const invalid of [{ x: -1 }, { y: 100 }, { w: 13 }, { h: 0 }, { x: 1.5 }, { h: Infinity }]) {
    assert.deepEqual(normalizeVideoLayout(layout.map((item, index) => index === 0 ? { ...item, ...invalid } : item)), layout);
  }
});

test('legacy video widths can migrate without collapsing subtitle panels', () => {
  const layout = defaultVideoLayout(7);
  assert.equal(layout[0].w, 7);
  assert.equal(layout[1].w, 7);
  assert.equal(layout[2].w + layout[3].w, 5);
  assert.deepEqual(normalizeVideoLayout(layout), layout);
});

test('mobile layout keeps full coordinates and ignores hidden panels without overwriting normal positions during practice', () => {
  const desktop = defaultVideoLayout();
  const mobile = VIDEO_PANEL_IDS.map((id, index) => ({ id, x: 0, y: index * 6, w: 1, h: 6 }));
  const controller = Object.assign(Object.create(VideoWindowLayout.prototype), {
    applying: false, gesture: false, mobile: true, mode: 'normal',
    grid: { getGridItems: () => [...mobile.map((item) => ({ gridstackNode: { ...item, content: 'not saved' } })), {}] },
    layouts: { normal: { desktop, mobile: null }, shadowing: { desktop: null, mobile: null } },
  });
  controller.remember();
  assert.deepEqual(controller.readMobile(), mobile);
  assert.deepEqual(controller.readDesktop(), desktop);
  assert.deepEqual(JSON.parse(storage.get(`${VIDEO_LAYOUT_KEY}.mobile`)), mobile);

  controller.mode = 'shadowing';
  controller.grid.getGridItems = () => [{ gridstackNode: { ...mobile[0], h: 4 } }, {}, { gridstackNode: { ...mobile[2], y: 4, h: 8 } }];
  controller.remember();
  assert.deepEqual(controller.layouts.shadowing.mobile.map((item) => item.id), ['video', 'en']);
  assert.deepEqual(controller.readMobile(), mobile);
  assert.deepEqual(controller.readDesktop(), desktop);
});

test('window rows exclude host padding and keep normal mobile rows independently scrollable', () => {
  let rowHeight;
  const controller = Object.assign(Object.create(VideoWindowLayout.prototype), {
    host: { clientHeight: 415, style: { paddingTop: '4px', paddingBottom: '6px' } },
    grid: { cellHeight: (value) => { rowHeight = value; } }, mobile: false, mode: 'normal',
  });
  controller.updateCellHeight();
  assert.equal(rowHeight, 33);
  controller.mobile = true;
  controller.updateCellHeight();
  assert.equal(rowHeight, 48);
  controller.mode = 'shadowing';
  controller.updateCellHeight();
  assert.equal(rowHeight, 33);
});
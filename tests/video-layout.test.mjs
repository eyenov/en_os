import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultVideoLayout, fitVideoLayout, normalizeVideoLayout, normalizeVideoVisibility, VIDEO_LAYOUT_KEY, VIDEO_PANEL_IDS, VIDEO_VISIBILITY_KEY, VideoWindowLayout } from '../public/js/video-layout.js';

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

test('lower windows follow the resized upper window and fill the remaining height', () => {
  const layout = defaultVideoLayout();
  layout[0].h = 7;
  layout[1].y = 7;
  const fitted = fitVideoLayout(layout);
  assert.equal(fitted[0].h, 7);
  assert.equal(fitted[1].y, 7);
  assert.equal(fitted[1].h, 5);
  assert.equal(layout[1].h, 7);
  assert.deepEqual(fitted.slice(2), layout.slice(2));
  layout[0].h = 3;
  layout[1].y = 3;
  assert.equal(fitVideoLayout(layout)[1].h, 9);
});

test('height fitting keeps standalone windows independent and respects the minimum height', () => {
  assert.deepEqual(fitVideoLayout(defaultVideoLayout().filter((item) => item.id !== 'agent')),
    defaultVideoLayout().filter((item) => item.id !== 'agent'));
  const layout = defaultVideoLayout();
  layout[1].y = 11;
  assert.equal(fitVideoLayout(layout)[1].h, 3);
  assert.deepEqual(fitVideoLayout([]), []);
});

test('window visibility accepts only supported IDs, including intentionally hiding all windows', () => {
  assert.deepEqual(normalizeVideoVisibility(['zh', 'video']), ['video', 'zh']);
  assert.deepEqual(normalizeVideoVisibility([]), []);
  for (const value of [null, {}, ['video', 'video'], ['unknown'], [false]]) assert.deepEqual(normalizeVideoVisibility(value), VIDEO_PANEL_IDS);
  const controller = Object.create(VideoWindowLayout.prototype);
  storage.set(VIDEO_VISIBILITY_KEY, JSON.stringify(['en', 'agent']));
  assert.deepEqual(controller.readVisibility(), ['agent', 'en']);
});

test('hidden windows keep their saved coordinates while visible windows change', () => {
  const desktop = defaultVideoLayout();
  const controller = Object.assign(Object.create(VideoWindowLayout.prototype), {
    applying: false, gesture: false, mobile: false, mode: 'normal', shown: ['en', 'zh'],
    grid: { getGridItems: () => [{ gridstackNode: { ...desktop[2], y: 2 } }, { gridstackNode: desktop[3] }, {}] },
    layouts: { normal: { desktop, mobile: null } },
  });
  controller.remember();
  const saved = controller.readDesktop();
  assert.deepEqual(saved.slice(0, 2), desktop.slice(0, 2));
  assert.equal(saved[2].y, 2);
  assert.equal(saved.length, 4);
});

test('temporary shadowing layouts respect visibility without overwriting normal preferences', () => {
  const controller = Object.assign(Object.create(VideoWindowLayout.prototype), { mode: 'normal', mobile: false, shown: ['agent', 'en', 'zh'] });
  assert.deepEqual(controller.visibleIds(), ['agent', 'en', 'zh']);
  controller.mode = 'shadowing';
  assert.deepEqual(controller.visibleIds(), ['agent', 'en']);
  controller.mobile = true;
  assert.deepEqual(controller.visibleIds(), ['en']);
  assert.deepEqual(controller.shown, ['agent', 'en', 'zh']);
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
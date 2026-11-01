import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { alignVideoColumns, defaultVideoLayout, findColumnGap, fitVideoLayout, moveVideoWindow, normalizeVideoLayout, normalizeVideoVisibility, LEGACY_VIDEO_LAYOUT_KEY, VIDEO_GRID_SCALE, VIDEO_LAYOUT_KEY, VIDEO_PANEL_IDS, VIDEO_VISIBILITY_KEY, VideoWindowLayout } from '../public/js/video-layout.js';

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

test('height fitting stretches a lone window over the full column and respects the minimum height', () => {
  const fitted = fitVideoLayout(defaultVideoLayout().filter((item) => item.id !== 'agent'));
  assert.deepEqual(fitted.map((item) => item.h), [12, 12, 12]);
  const layout = defaultVideoLayout();
  layout[1].y = 11;
  assert.equal(fitVideoLayout(layout)[1].h, 3);
  assert.deepEqual(fitVideoLayout([]), []);
});

test('columns share widths, tile horizontally and pack each stack from the top', () => {
  const layout = defaultVideoLayout().map((item) => ({ ...item, y: item.y + 4 }));
  layout[1].w = 4;
  layout[1].y = 15;
  const original = structuredClone(layout);
  assert.deepEqual(alignVideoColumns(layout), defaultVideoLayout());
  assert.deepEqual(layout, original);
});

test('resizing a lower window changes its whole column and retains minimum neighbor widths', () => {
  const layout = defaultVideoLayout();
  layout[1].w = 8;
  const aligned = alignVideoColumns(layout, 12, 'agent');
  assert.deepEqual(aligned.map(({ x, w }) => ({ x, w })), [{ x: 0, w: 8 }, { x: 0, w: 8 }, { x: 8, w: 2 }, { x: 10, w: 2 }]);
  layout[1].w = 12;
  assert.deepEqual(alignVideoColumns(layout, 12, 'agent'), aligned);
  layout[1].w = 2;
  assert.deepEqual(alignVideoColumns(layout, 12, 'agent').map((item) => item.w), [2, 2, 7, 3]);
});

test('column resizing compensates at the selected boundary without moving the opposite edge', () => {
  const layout = defaultVideoLayout();
  layout[2].w = 4;
  const east = alignVideoColumns(layout, 12, 'en', 'e');
  assert.deepEqual(east.map(({ x, w }) => ({ x, w })), [{ x: 0, w: 6 }, { x: 0, w: 6 }, { x: 6, w: 4 }, { x: 10, w: 2 }]);
  const west = alignVideoColumns(layout, 12, 'en', 'w');
  assert.deepEqual(west.map(({ x, w }) => ({ x, w })), [{ x: 0, w: 5 }, { x: 0, w: 5 }, { x: 5, w: 4 }, { x: 9, w: 3 }]);
  layout[3].w = 4;
  layout[2].w = 3;
  const last = alignVideoColumns(layout, 12, 'zh', 'w');
  assert.equal(last[3].x + last[3].w, 12);
  assert.equal(last[0].w, 6);
});

test('remaining columns fill the width without gaps after hiding a whole column', () => {
  const layout = defaultVideoLayout().slice(2);
  assert.deepEqual(alignVideoColumns(layout).map(({ x, w, y }) => ({ x, w, y })), [{ x: 0, w: 6, y: 0 }, { x: 6, w: 6, y: 0 }]);
  assert.deepEqual(alignVideoColumns([]), []);
});

test('single-column layouts retain width while compacting vertical gaps', () => {
  const layout = [{ id: 'video', x: 0, y: 0, w: 1, h: 4 }, { id: 'en', x: 0, y: 9, w: 1, h: 10 }];
  assert.deepEqual(alignVideoColumns(layout, 1), [{ ...layout[0] }, { ...layout[1], y: 4 }]);
});

test('same-column reordering keeps every window at its original column width', () => {
  const layout = defaultVideoLayout();
  const moved = alignVideoColumns(moveVideoWindow(layout, 'agent', 0, 'video'));
  assert.deepEqual(moved.slice(0, 2), [{ ...layout[0], y: 7 }, { ...layout[1], y: 0 }]);
  assert.deepEqual(moved.map((item) => item.w), layout.map((item) => item.w));
  assert.deepEqual(layout, defaultVideoLayout());
});

test('moving across columns adopts the destination width without creating an extra column', () => {
  const layout = defaultVideoLayout();
  const moved = alignVideoColumns(moveVideoWindow(layout, 'agent', 6));
  assert.deepEqual(moved[1], { ...layout[1], x: 6, y: 12, w: 3 });
  assert.equal(moved[2].w, 3);
  assert.equal(moved[0].w, 6);
  assert.equal(new Set(moved.map((item) => item.x)).size, 3);
  assert.deepEqual(layout, defaultVideoLayout());
});

test('dropping outside the outer edge can split a stack into a new tiled column', () => {
  const moved = alignVideoColumns(moveVideoWindow(defaultVideoLayout(), 'agent', -1));
  const columns = [...new Map(moved.map((item) => [item.x, item.w])).entries()].sort((left, right) => left[0] - right[0]);
  assert.equal(columns.length, 4);
  assert.equal(moved[1].x, 0);
  assert.equal(columns.reduce((sum, item) => sum + item[1], 0), 12);
  assert.ok(columns.every((item, index) => index === 0 || item[0] === columns[index - 1][0] + columns[index - 1][1]));
});

test('dropping between two columns inserts a new tiled column there', () => {
  const layout = defaultVideoLayout();
  const gap = findColumnGap(layout, 6.2, 0.5);
  assert.deepEqual({ index: gap.index, edge: gap.edge, before: gap.before.x, after: gap.after.x }, { index: 1, edge: 6, before: 6, after: 0 });
  assert.equal(findColumnGap(layout, 7.5, 0.5), null);
  assert.equal(findColumnGap(layout, 12, 0.5).before, null);
  const moved = alignVideoColumns(fitVideoLayout(alignVideoColumns(moveVideoWindow(layout, 'agent', 5.5))));
  const columns = [...new Map(moved.map((item) => [item.x, item.w])).entries()].sort((left, right) => left[0] - right[0]);
  assert.equal(columns.length, 4);
  assert.ok(moved[1].x > moved[0].x && moved[1].x < moved[2].x);
  assert.deepEqual([moved[0].h, moved[1].h], [12, 12]);
  assert.equal(columns.reduce((sum, item) => sum + item[1], 0), 12);
});

test('stacking tall windows reserves the minimum height for every lower window', () => {
  const layout = alignVideoColumns(moveVideoWindow(defaultVideoLayout(), 'en', 0, 'agent'));
  const fitted = alignVideoColumns(fitVideoLayout(layout));
  const stack = fitted.filter((item) => item.x === 0).sort((left, right) => left.y - right.y);
  assert.equal(stack.at(-1).y + stack.at(-1).h, 12);
  assert.ok(stack.every((item) => item.h >= 3));
  assert.equal(stack[0].y, 0);
  assert.ok(stack.slice(1).every((item, index) => item.y === stack[index].y + stack[index].h));
});

test('saving a displayed projection does not replace hidden column ownership', () => {
  const desktop = defaultVideoLayout(6, VIDEO_GRID_SCALE);
  const controller = Object.assign(Object.create(VideoWindowLayout.prototype), {
    applying: false, gesture: false, mobile: false, mode: 'normal', shown: ['en', 'zh'], appliedLayout: alignVideoColumns(desktop.slice(2)),
    grid: { getGridItems: () => alignVideoColumns(desktop.slice(2)).map((item) => ({ gridstackNode: item })) },
    layouts: { normal: { desktop, mobile: null } },
  });
  controller.remember();
  assert.deepEqual(controller.readDesktop(), desktop);
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
  const desktop = defaultVideoLayout(6, VIDEO_GRID_SCALE);
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
  const desktop = defaultVideoLayout(6, VIDEO_GRID_SCALE);
  const mobile = VIDEO_PANEL_IDS.map((id, index) => ({ id, x: 0, y: index * 6 * VIDEO_GRID_SCALE, w: 1, h: 6 * VIDEO_GRID_SCALE }));
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
  assert.equal(rowHeight, 33.75 / VIDEO_GRID_SCALE);
  controller.mobile = true;
  controller.updateCellHeight();
  assert.equal(rowHeight, 48 / VIDEO_GRID_SCALE);
  controller.mode = 'shadowing';
  controller.updateCellHeight();
  assert.equal(rowHeight, 33.75 / VIDEO_GRID_SCALE);
});

test('layouts saved on the coarse 12-unit grid migrate to the fine resize grid', () => {
  const coarse = defaultVideoLayout(7);
  storage.set(LEGACY_VIDEO_LAYOUT_KEY, JSON.stringify(coarse));
  storage.set(`${LEGACY_VIDEO_LAYOUT_KEY}.mobile`, JSON.stringify(VIDEO_PANEL_IDS.map((id, index) => ({ id, x: 0, y: index * 5, w: 1, h: 5 }))));
  const controller = Object.create(VideoWindowLayout.prototype);
  assert.deepEqual(controller.readDesktop(), defaultVideoLayout(7, VIDEO_GRID_SCALE));
  assert.deepEqual(controller.readMobile()[1], { id: 'agent', x: 0, y: 5 * VIDEO_GRID_SCALE, w: 1, h: 5 * VIDEO_GRID_SCALE });
  assert.deepEqual(normalizeVideoLayout(coarse, VIDEO_GRID_SCALE), defaultVideoLayout(6, VIDEO_GRID_SCALE));
});
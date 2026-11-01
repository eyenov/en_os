import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bindFullscreen } from '../public/js/ui.js';

function fixture(prefixed = false) {
  const root = Object.assign(new EventTarget(), { fullscreenEnabled: true });
  const attributes = new Map();
  const button = Object.assign(new EventTarget(), {
    setAttribute: (name, value) => {
      attributes.set(name, value);
      if (name === 'title') button.title = value;
    },
    getAttribute: (name) => attributes.get(name),
  });
  const element = { ownerDocument: root };
  const property = prefixed ? 'webkitFullscreenElement' : 'fullscreenElement';
  const change = prefixed ? 'webkitfullscreenchange' : 'fullscreenchange';
  element[prefixed ? 'webkitRequestFullscreen' : 'requestFullscreen'] = async function () {
    assert.equal(this, element);
    root[property] = element;
    root.dispatchEvent(new Event(change));
  };
  root[prefixed ? 'webkitExitFullscreen' : 'exitFullscreen'] = async function () {
    assert.equal(this, root);
    root[property] = null;
    root.dispatchEvent(new Event(change));
  };
  return { root, button, element };
}

test('fullscreen button enters and exits while tracking real browser state', async () => {
  const { root, button, element } = fixture();
  const control = bindFullscreen(button, element);
  assert.equal(button.title, '进入全屏');
  await control.toggle();
  assert.equal(root.fullscreenElement, element);
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  assert.equal(button.title, '退出全屏');
  await control.toggle();
  assert.equal(root.fullscreenElement, null);
  assert.equal(button.getAttribute('aria-pressed'), 'false');
  control.destroy();
});

test('Escape or an external fullscreen exit restores the button state', async () => {
  const { root, button, element } = fixture();
  const control = bindFullscreen(button, element);
  await control.toggle();
  root.fullscreenElement = null;
  root.dispatchEvent(new Event('fullscreenchange'));
  assert.equal(button.title, '进入全屏');
  assert.equal(button.getAttribute('aria-pressed'), 'false');
  assert.equal(button.disabled, false);
  control.destroy();
});

test('rejected fullscreen requests report once and leave a usable entry button', async () => {
  const { root, button, element } = fixture();
  const errors = [];
  element.requestFullscreen = async () => {
    root.dispatchEvent(new Event('fullscreenerror'));
    throw new Error('Denied');
  };
  const control = bindFullscreen(button, element, (error) => errors.push(error));
  await control.toggle();
  assert.equal(errors.length, 1);
  assert.equal(button.disabled, false);
  assert.equal(button.getAttribute('aria-pressed'), 'false');
  control.destroy();
});

test('a pending fullscreen request cannot be started again', async () => {
  const { root, button, element } = fixture();
  let finish;
  let calls = 0;
  element.requestFullscreen = () => {
    calls += 1;
    return new Promise((resolve) => { finish = resolve; });
  };
  const control = bindFullscreen(button, element);
  const first = control.toggle();
  assert.equal(button.disabled, true);
  await control.toggle();
  assert.equal(calls, 1);
  root.fullscreenElement = element;
  root.dispatchEvent(new Event('fullscreenchange'));
  finish();
  await first;
  assert.equal(button.disabled, false);
  control.destroy();
});

test('WebKit fullscreen uses its matching methods and state events', async () => {
  const { root, button, element } = fixture(true);
  const control = bindFullscreen(button, element);
  await control.toggle();
  assert.equal(root.webkitFullscreenElement, element);
  assert.equal(button.title, '退出全屏');
  await control.toggle();
  assert.equal(root.webkitFullscreenElement, null);
  assert.equal(button.title, '进入全屏');
  control.destroy();
});

test('unavailable fullscreen is disabled instead of claiming success', async () => {
  const { root, button, element } = fixture();
  root.fullscreenEnabled = false;
  const control = bindFullscreen(button, element);
  await control.toggle();
  assert.equal(button.disabled, true);
  assert.equal(root.fullscreenElement, undefined);
  assert.equal(button.title, '当前浏览器不支持页面全屏');
  control.destroy();
});
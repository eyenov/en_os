import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const markPath = path.join(publicDir, 'icon-mark.png');
const input = process.argv[2] ? path.resolve(process.argv[2]) : markPath;
const bytes = await readFile(input);
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
let mark = bytes;
if (path.extname(input).toLowerCase() === '.ico') {
  assert.equal(bytes.readUInt16LE(2), 1, 'Expected an ICO file');
  const frames = Array.from({ length: bytes.readUInt16LE(4) }, (_, index) => {
    const entry = 6 + index * 16;
    const offset = bytes.readUInt32LE(entry + 12);
    const length = bytes.readUInt32LE(entry + 8);
    return { width: bytes[entry] || 256, data: bytes.subarray(offset, offset + length) };
  });
  const largest = frames.filter((frame) => frame.data.subarray(0, 8).equals(pngSignature))
    .sort((first, second) => second.width - first.width)[0];
  assert.ok(largest, 'The reference ICO must contain a PNG frame');
  mark = largest.data;
}
assert.ok(mark.subarray(0, 8).equals(pngSignature), 'Expected a PNG source mark');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img" aria-label="EnOS K knowledge mark">
  <defs>
    <linearGradient id="bg" x1="70" y1="40" x2="440" y2="480" gradientUnits="userSpaceOnUse">
      <stop stop-color="#FFFEFA"/><stop offset="0.55" stop-color="#FFFDF7"/><stop offset="1" stop-color="#F8F0E2"/>
    </linearGradient>
    <linearGradient id="letter" x1="88" y1="250" x2="220" y2="84" gradientUnits="userSpaceOnUse">
      <stop stop-color="#087E6C"/><stop offset="1" stop-color="#18B69B"/>
    </linearGradient>
    <filter id="soft" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#7D6A46" flood-opacity="0.12"/>
    </filter>
  </defs>
  <rect x="18" y="18" width="476" height="476" rx="116" fill="url(#bg)" filter="url(#soft)"/>
  <rect x="18.5" y="18.5" width="475" height="475" rx="115.5" fill="none" stroke="#E9E0CF" stroke-opacity="0.85"/>
  <g id="knowledge-k" fill="none" stroke="url(#letter)" stroke-width="32" stroke-linecap="round" stroke-linejoin="round">
    <path d="M98 88 V248"/>
    <path d="M218 88 L100 168 L226 248"/>
  </g>
  <image id="knowledge-flow" x="174" y="160" width="320" height="320" href="data:image/png;base64,${mark.toString('base64')}"/>
</svg>
`;

const browserPath = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].find((candidate) => candidate && existsSync(candidate));
assert.ok(browserPath, 'Chrome/Edge is required; set CHROME_PATH');
const profile = await mkdtemp(path.join(tmpdir(), 'enos-icons-'));
const browser = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
const exited = new Promise((resolve) => browser.once('exit', resolve));
let socket;
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Browser startup timed out')), 15000);
    let output = '';
    browser.stderr.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
    browser.once('error', (error) => { clearTimeout(timeout); reject(error); });
    browser.once('exit', () => { clearTimeout(timeout); reject(new Error('Browser exited before rendering')); });
  });
  const debugUrl = new URL(endpoint);
  const targets = await (await fetch(`http://${debugUrl.host}/json/list`)).json();
  const target = targets.find((entry) => entry.type === 'page');
  assert.ok(target, 'Browser page not found');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let commandId = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const command = pending.get(message.id);
    if (!command) return;
    pending.delete(message.id);
    if (message.error) command.reject(new Error(message.error.message));
    else command.resolve(message.result);
  });
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = ++commandId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const sizes = [16, 32, 48, 64, 128, 180, 192, 256, 512];
  const result = await send('Runtime.evaluate', {
    expression: `(async () => {
      const image = new Image();
      image.src = ${JSON.stringify(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`)};
      await image.decode();
      return ${JSON.stringify(sizes)}.map((size) => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const context = canvas.getContext('2d');
        context.imageSmoothingQuality = 'high';
        context.drawImage(image, 0, 0, size, size);
        const pixels = context.getImageData(0, 0, size, size).data;
        let letterPixels = 0;
        for (let row = Math.floor(size * .12); row < size * .52; row++) {
          for (let column = Math.floor(size * .12); column < size * .48; column++) {
            const offset = (row * size + column) * 4;
            if (pixels[offset + 1] > pixels[offset] * 1.4 && pixels[offset + 3] > 150) letterPixels++;
          }
        }
        return { size, letterPixels, cornerAlpha: pixels[3], png: canvas.toDataURL('image/png').split(',')[1] };
      });
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  assert.ok(!result.exceptionDetails, result.exceptionDetails?.text);
  const rendered = new Map();
  for (const frame of result.result.value) {
    assert.ok(frame.letterPixels > frame.size * frame.size * .015, `K is not legible at ${frame.size}px`);
    assert.ok(frame.cornerAlpha < 40, `Expected transparent corners at ${frame.size}px`);
    const png = Buffer.from(frame.png, 'base64');
    assert.equal(png.readUInt32BE(16), frame.size);
    assert.equal(png.readUInt32BE(20), frame.size);
    rendered.set(frame.size, png);
  }

  await writeFile(markPath, mark);
  for (const name of ['icon.svg', 'favicon.svg']) await writeFile(path.join(publicDir, name), svg);
  for (const size of [32, 192, 512]) await writeFile(path.join(publicDir, `icon-${size}.png`), rendered.get(size));
  await writeFile(path.join(publicDir, 'apple-touch-icon.png'), rendered.get(180));
  const icoSizes = [16, 32, 48, 64, 128, 256];
  const directory = Buffer.alloc(6 + icoSizes.length * 16);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(icoSizes.length, 4);
  let offset = directory.length;
  icoSizes.forEach((size, index) => {
    const entry = 6 + index * 16;
    directory[entry] = directory[entry + 1] = size === 256 ? 0 : size;
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(rendered.get(size).length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += rendered.get(size).length;
  });
  await writeFile(path.join(publicDir, 'favicon.ico'), Buffer.concat([directory, ...icoSizes.map((size) => rendered.get(size))]));
  console.log('Generated SVG, PNG (32/180/192/512) and ICO (16/32/48/64/128/256).');
  console.log('Reference contours retained unchanged; K and transparency checks passed at 9 sizes.');
} finally {
  socket?.close();
  browser.kill();
  await exited;
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
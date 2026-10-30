import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { _clearBookCaches, parseBooksFromTree, readBook } from '../server/books.mjs';
import { readLimitedBody } from '../server/remote.mjs';

test('groups GitHub book files into magazine issues', () => {
  const books = parseBooksFromTree([
    { type: 'blob', path: '01_economist/te_2026.10.31/TheEconomist.2026.10.31.epub', size: 100 },
    { type: 'blob', path: '01_economist/te_2026.10.31/TheEconomist.2026.10.31.mobi', size: 200 },
    { type: 'blob', path: '02_new_yorker/2026.10.26/new_yorker.2026.10.26.epub', size: 300 },
    { type: 'blob', path: '02_new_yorker/2026.10.26/new_yorker.2026.10.26.pdf', size: 400 },
    { type: 'blob', path: '02_new_yorker/README.md', size: 10 },
    { type: 'blob', path: '05_wired/not-a-date/wired.epub', size: 50 },
    { type: 'tree', path: '01_economist/te_2026.10.31', size: 0 },
  ]);
  assert.equal(books.length, 2);
  assert.equal(books[0].id, '01_economist/te_2026.10.31');
  assert.equal(books[0].date, '2026.10.31');
  assert.deepEqual(books[0].formats.map((entry) => entry.format), ['epub', 'mobi']);
  assert.equal(books[0].readable, true);
  assert.equal(books[1].id, '02_new_yorker/2026.10.26');
  assert.deepEqual(books[1].formats.map((entry) => entry.format), ['epub', 'pdf']);
  assert.equal(books[1].formats[0].sizeLabel, '300 B');
});

function zipFixture(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [filename, value] of Object.entries(files)) {
    const name = Buffer.from(filename);
    const data = Buffer.from(value);
    const compressed = deflateRawSync(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, compressed);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(compressed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += local.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

async function withBookResponse(context, buffer, options = {}) {
  _clearBookCaches();
  context.mock.method(globalThis, 'fetch', async (url) => String(url).includes('api.github.com')
    ? new Response(JSON.stringify({ tree: [{ type: 'blob', path: '01_economist/te_2026.10.31/issue.epub' }] }))
    : new Response(buffer, options));
  return readBook('01_economist', '2026.10.31');
}

test('reads safe EPUB chapter text without executing embedded markup', async (context) => {
  const buffer = zipFixture({
    'META-INF/container.xml': '<container><rootfile full-path="OEBPS/content.opf"/></container>',
    'OEBPS/content.opf': '<package><manifest><item id="one" href="one.xhtml"/></manifest><spine><itemref idref="one"/></spine></package>',
    'OEBPS/one.xhtml': `<html><head><title>A new chapter</title></head><body><script>doNotExecute()</script><h1>A new chapter</h1><p>${'Trees provide shade and make streets more comfortable. '.repeat(8)}</p></body></html>`,
  });
  const result = await withBookResponse(context, buffer);
  assert.equal(result.chapters.length, 1);
  assert.equal(result.chapters[0].title, 'A new chapter');
  assert.ok(result.chapters[0].blocks.every((block) => !/[<>]|doNotExecute/.test(block.text)));
});

test('rejects corrupt ZIP directories and bounded decompression violations', async (context) => {
  const truncated = Buffer.alloc(128);
  truncated.writeUInt32LE(0x06054b50, 106);
  truncated.writeUInt16LE(1, 116);
  truncated.writeUInt32LE(0xffffffff, 122);
  await assert.rejects(withBookResponse(context, truncated), { code: 'BOOK_BAD_EPUB' });

  const bomb = zipFixture({ 'META-INF/container.xml': 'x'.repeat(9 * 1024 * 1024) });
  const central = bomb.readUInt32LE(bomb.length - 6);
  bomb.writeUInt32LE(32, central + 24);
  await assert.rejects(withBookResponse(context, bomb), { code: 'BOOK_BAD_EPUB' });
});

test('rejects oversized EPUB downloads before buffering', async (context) => {
  await assert.rejects(withBookResponse(context, Buffer.alloc(128), {
    headers: { 'Content-Length': String(65 * 1024 * 1024) },
  }), { code: 'RESOURCE_TOO_LARGE' });
});

test('remote body limits apply even without Content-Length and cancel the stream', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(33)); },
    cancel() { cancelled = true; },
  }));
  await assert.rejects(readLimitedBody(response, 32), { code: 'RESOURCE_TOO_LARGE' });
  assert.equal(cancelled, true);
});

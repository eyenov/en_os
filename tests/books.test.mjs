import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBooksFromTree } from '../server/books.mjs';

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

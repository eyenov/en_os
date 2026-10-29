import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildExcerpt,
  countWords,
  extractFromUrl,
  isEnglishText,
  readArticle,
  splitSentences,
} from '../server/extract.mjs';

const PARAGRAPH = 'Urban planners increasingly argue that cities should stop widening roads. '
  + 'Instead, they advocate spending on public transport and shaded walking routes. '
  + 'A street with trees invites people to stay outside longer, and that changes how a neighbourhood feels.';

function prose(paragraphs) {
  return Array.from({ length: paragraphs }, () => PARAGRAPH).join(' ');
}

test('an excerpt stops on a sentence boundary and stays inside the length budget', () => {
  const text = prose(6);
  const { text: excerpt, wordCount } = buildExcerpt(text);
  assert.ok(wordCount >= 120 && wordCount <= 220, `word count ${wordCount}`);
  assert.match(excerpt, /[.!?]$/);
  assert.ok(!excerpt.endsWith(' and'), 'must not cut in the middle of a clause');
  assert.ok(countWords(excerpt) === wordCount);
});

test('a long single sentence is clipped instead of silently overrunning', () => {
  const sentence = `${Array.from({ length: 400 }, (_, index) => `word${index}`).join(' ')}.`;
  const { wordCount, text } = buildExcerpt(sentence);
  assert.equal(wordCount, 220);
  assert.ok(text.endsWith(' …'));
});

test('text without enough prose is rejected', () => {
  assert.equal(buildExcerpt('Short caption. Another line.').text, '');
  assert.equal(buildExcerpt('').text, '');
});

test('Chinese prose never becomes an English excerpt', () => {
  const chinese = '人工智能正在改变很多行业。研究人员指出，大型语言模型需要大量算力。企业开始把这些模型部署到客服和写作场景中。';
  assert.equal(isEnglishText(chinese), false);
  assert.equal(buildExcerpt(chinese).text, '');
});

test('abbreviations do not create fake sentence breaks', () => {
  const sentences = splitSentences('Dr. Smith arrived at 9 a.m. on Monday. He said the U.S. study was small.');
  assert.equal(sentences.length, 2);
  assert.match(sentences[0], /a\.m\./);
});

test('article extraction prefers the article container and drops page chrome', () => {
  const html = `<html><head><title>Shade | Example</title><script>tracker()</script></head>
    <body><nav><p>${prose(2)}</p></nav>
    <article><p>${prose(4)}</p></article>
    <aside><p>Subscribe to our newsletter for more stories about cities and climate. It is free and weekly.</p></aside>
    <footer>© 2026 Example. All rights reserved.</footer></body></html>`;
  const article = readArticle(html, { url: 'https://example.com/shade' });
  assert.equal(article.title, 'Shade | Example');
  assert.ok(article.excerpt.length > 400);
  assert.ok(!article.text.includes('Subscribe'));
  assert.ok(!article.text.includes('tracker'));
});

test('private hosts are blocked unless local fetching is explicitly allowed', async () => {
  await assert.rejects(
    () => extractFromUrl('http://127.0.0.1:9/private'),
    (error) => error.code === 'BLOCKED_URL',
  );
  await assert.rejects(
    () => extractFromUrl('not a url'),
    (error) => error.code === 'BAD_URL',
  );
  await assert.rejects(
    () => extractFromUrl('ftp://example.com/file'),
    (error) => error.code === 'BAD_URL',
  );
});

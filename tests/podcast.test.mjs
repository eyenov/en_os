import test from 'node:test';
import assert from 'node:assert/strict';
import { _clearPodcastCaches, getPodcastEpisode, listPodcastEpisodes, openPodcastAudio, parseVtt } from '../server/podcasts.mjs';
import { findWordIndex, serializeSrt } from '../public/js/subtitle-sync.js';

function feedFixture({ audio = 'https://podnews.net/audio/fixture.mp3', transcript = 'https://podnews.net/fixture.vtt' } = {}) {
  return `<rss><channel><item><title>A safe episode</title><enclosure url="${audio}"/><podcast:transcript type="text/vtt" url="${transcript}"/></item></channel></rss>`;
}

test('podcast audio preserves a single Range and follows trusted redirects', async (context) => {
  _clearPodcastCaches();
  let range;
  context.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(options.redirect, 'manual');
    if (url === 'https://podnews.net/rss') return new Response(feedFixture());
    if (url === 'https://podnews.net/audio/fixture.mp3') {
      return new Response(null, { status: 302, headers: { Location: 'https://storage.buzzsprout.com/fixture.mp3' } });
    }
    range = options.headers.Range;
    return new Response('audio', { status: 206, headers: { 'Content-Type': 'audio/mpeg' } });
  });
  const { episodes } = await listPodcastEpisodes('podnews-daily');
  const { response } = await openPodcastAudio('podnews-daily', episodes[0].id, 'bytes=0-4');
  assert.equal(response.status, 206);
  assert.equal(range, 'bytes=0-4');
});

test('podcast sources cannot fetch private addresses or redirect outside trusted hosts', async (context) => {
  let audio;
  const requests = [];
  context.mock.method(globalThis, 'fetch', async (url) => {
    requests.push(url);
    if (url === 'https://podnews.net/rss') return new Response(feedFixture({ audio }));
    return new Response(null, { status: 302, headers: { Location: 'https://127.0.0.1/private' } });
  });
  for (audio of ['http://localhost/private', 'https://127.0.0.1/private', 'https://podnews.net.evil.example/audio', 'https://podnews.net/audio/fixture.mp3']) {
    _clearPodcastCaches();
    const { episodes } = await listPodcastEpisodes('podnews-daily');
    await assert.rejects(openPodcastAudio('podnews-daily', episodes[0].id), { code: 'PODCAST_BAD_URL' });
  }
  assert.ok(requests.every((url) => url.startsWith('https://podnews.net/')));
});

test('podcast transcripts enforce size limits and audio rejects multiple ranges', async (context) => {
  _clearPodcastCaches();
  context.mock.method(globalThis, 'fetch', async (url) => new Response(
    url === 'https://podnews.net/rss' ? feedFixture() : 'WEBVTT',
    { headers: url === 'https://podnews.net/rss' ? {} : { 'Content-Length': String(5 * 1024 * 1024) } },
  ));
  const { episodes } = await listPodcastEpisodes('podnews-daily');
  await assert.rejects(getPodcastEpisode('podnews-daily', episodes[0].id), { code: 'RESOURCE_TOO_LARGE' });
  await assert.rejects(openPodcastAudio('podnews-daily', episodes[0].id, 'bytes=0-1,4-5'), { code: 'BAD_RANGE' });
});

test('parses podcast VTT cues and distributes word timings', () => {
  const cues = parseVtt(`WEBVTT

00:00:00.520 --> 00:00:04.310
 From our free daily newsletter, the latest from podnews.net with Soundstack.

00:00:04.310 --> 00:00:05.380
 Soundstack.

00:00:07.120 --> 00:00:10.240
 <v Speaker>Goals are good.</v>
`);
  assert.equal(cues.length, 3);
  assert.equal(cues[0].start, 0.52);
  assert.equal(cues[0].end, 4.31);
  assert.match(cues[0].en, /free daily newsletter/);
  assert.ok(cues[0].words.length >= 5);
  assert.equal(cues[0].words[0].text, 'From');
  assert.equal(cues[1].en, 'Soundstack.');
  assert.equal(cues[2].en, 'Goals are good.');
  assert.ok(cues[2].words.at(-1).end <= 10.24);
});

test('podcast VTT keeps a real pause instead of merging across it', () => {
  const cues = parseVtt(`WEBVTT

00:00:01.000 --> 00:00:02.000
Hello there

00:00:02.800 --> 00:00:06.000
this is a much longer sentence.
`);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].words[0].start, 1);
  assert.equal(cues[0].words[1].end, 2);
  assert.equal(cues[1].words[0].start, 2.8);
  assert.equal(cues[1].words.at(-1).text, 'sentence.');
  assert.equal(cues[1].words.at(-1).end, 6);
});

test('podcast VTT retains inline word timestamps instead of redistributing them', () => {
  const [cue] = parseVtt(`WEBVTT

00:00:01.000 --> 00:00:05.000
<v Speaker><c>Hello</c> <00:00:01.400>world, <00:00:04.000>today.</v>
`);
  assert.deepEqual(cue.words, [
    { text: 'Hello', start: 1, end: 1.4 },
    { text: 'world,', start: 1.4, end: 4 },
    { text: 'today.', start: 4, end: 5 },
  ]);
});

test('short podcast cues never allocate words beyond the cue end', () => {
  const [cue] = parseVtt(`WEBVTT

00:00:01.000 --> 00:00:01.100
One two three four.
`);
  assert.equal(cue.words.length, 4);
  assert.ok(cue.words.every((word) => word.start >= cue.start && word.end <= cue.end));
  assert.equal(cue.words.at(-1).end, cue.end);
});

test('word highlighting clears during silence, at the end and after seeking backwards', () => {
  const words = [
    { text: 'Hello', start: 1, end: 2 },
    { text: 'again.', start: 2.8, end: 4 },
  ];
  assert.equal(findWordIndex(words, 0), -1);
  assert.equal(findWordIndex(words, 1.5), 0);
  assert.equal(findWordIndex(words, 2), -1);
  assert.equal(findWordIndex(words, 2.5), -1);
  assert.equal(findWordIndex(words, 2.8), 1);
  assert.equal(findWordIndex(words, 4), -1);
  assert.equal(findWordIndex(words, 1), 0);
  assert.equal(findWordIndex(words, NaN), -1);
});

test('podcast subtitle export preserves bilingual text and millisecond timing', () => {
  assert.equal(serializeSrt([
    { start: 0.52, end: 4.31, en: 'Hello world.', zh: '你好，世界。' },
    { start: 3600, end: 3602.5, en: 'One hour later.' },
  ]), '1\n00:00:00,520 --> 00:00:04,310\nHello world.\n你好，世界。\n\n2\n01:00:00,000 --> 01:00:02,500\nOne hour later.\n');
});

test('podcast subtitle export handles empty data and carries rounded milliseconds', () => {
  assert.equal(serializeSrt([]), '');
  assert.equal(serializeSrt([{ start: 1, end: 0, en: 'Invalid' }]), '');
  assert.equal(serializeSrt([{ start: 59.9996, end: 60.5, en: 'Next minute.' }]), '1\n00:01:00,000 --> 00:01:00,500\nNext minute.\n');
});

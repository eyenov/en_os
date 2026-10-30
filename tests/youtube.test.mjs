import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  _clearCaches,
  alignTranslations,
  chooseCaptionTrack,
  extractJsonObject,
  formatClock,
  getVideoCaptions,
  mergeCues,
  parseClock,
  parseIsoDuration,
  parseLockupRenderer,
  parseSearchData,
  parseTimedText,
  searchYouTube,
  segmentsToCues,
  translateCuesFree,
} from '../server/youtube.mjs';
import { activeCharCount, cueProgress, findCueIndex, findWordIndex, normalizeCues } from '../public/js/subtitle-sync.js';

const VIDEO_ID = 'abc12345678';

function searchFixture() {
  return {
    contents: {
      twoColumnSearchResultsRenderer: {
        primaryContents: {
          sectionListRenderer: {
            contents: [{
              itemSectionRenderer: {
                contents: [{
                  videoRenderer: {
                    videoId: VIDEO_ID,
                    title: { runs: [{ text: 'IELTS Listening: shaded streets' }] },
                    thumbnail: { thumbnails: [{ url: 'https://i.ytimg.com/vi/abc12345678/hqdefault.jpg', width: 480, height: 360 }] },
                    lengthText: { simpleText: '12:34' },
                    viewCountText: { simpleText: '1,234 views' },
                    ownerText: { runs: [{ text: 'BBC Learning English', navigationEndpoint: { browseEndpoint: { browseId: 'UC123' } } }] },
                    publishedTimeText: { simpleText: '2 years ago' },
                    descriptionSnippet: { runs: [{ text: 'A short listening lesson.' }] },
                    badges: [{ metadataBadgeRenderer: { label: 'CC' } }],
                  },
                }],
              },
            }],
          },
        },
      },
    },
  };
}

function englishPayload() {
  return {
    events: [
      { tStartMs: 0, dDurationMs: 1800, segs: [{ utf8: 'Hello ', tOffsetMs: 0 }, { utf8: 'everyone.', tOffsetMs: 700 }] },
      { tStartMs: 1900, dDurationMs: 2200, segs: [{ utf8: 'Welcome to the lesson.' }] },
    ],
  };
}

function chinesePayload() {
  return {
    events: [
      { tStartMs: 0, dDurationMs: 1800, segs: [{ utf8: '大家好。' }] },
      { tStartMs: 1900, dDurationMs: 2200, segs: [{ utf8: '欢迎来到这节课。' }] },
    ],
  };
}

function playerHtml() {
  return `<html><script>var ytInitialPlayerResponse = ${JSON.stringify({
    playabilityStatus: { status: 'OK' },
    videoDetails: {
      title: 'Inside a listening lesson',
      author: 'EnOS Demo Channel',
      lengthSeconds: '245',
      viewCount: '12345',
      thumbnail: { thumbnails: [{ url: 'https://i.ytimg.com/vi/abc12345678/hqdefault.jpg', width: 480, height: 360 }] },
    },
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [{
          baseUrl: `https://www.youtube.com/api/timedtext?v=${VIDEO_ID}&lang=en`,
          languageCode: 'en',
          kind: 'asr',
          name: { simpleText: 'English (auto-generated)' },
        }],
      },
    },
  })};</script></html>`;
}

test('extracts ytInitialData and maps search results', () => {
  const html = `<script>var ytInitialData = ${JSON.stringify(searchFixture())};</script>`;
  const data = extractJsonObject(html, /ytInitialData\s*=\s*/);
  assert.ok(data);
  const items = parseSearchData(data);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, VIDEO_ID);
  assert.equal(items[0].title, 'IELTS Listening: shaded streets');
  assert.equal(items[0].channel, 'BBC Learning English');
  assert.equal(items[0].duration, '12:34');
  assert.equal(items[0].durationSeconds, 754);
  assert.equal(items[0].thumbnail, 'https://i.ytimg.com/vi/abc12345678/hqdefault.jpg');
  assert.equal(items[0].hasCaptions, true);
});

test('parses clocks and ISO durations', () => {
  assert.equal(parseClock('12:34'), 754);
  assert.equal(parseClock('1:02:03'), 3723);
  assert.equal(parseIsoDuration('PT1H2M3S'), 3723);
  assert.equal(parseIsoDuration('PT45S'), 45);
  assert.equal(formatClock(3723), '1:02:03');
  assert.equal(formatClock(75), '1:15');
});

test('new lockupViewModel search markup is parsed too', () => {
  const lockup = {
    contentId: VIDEO_ID,
    contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
    metadata: {
      lockupMetadataViewModel: {
        title: { content: 'Lockup: IELTS listening' },
        metadata: {
          contentMetadataViewModel: {
            metadataRows: [{ metadataParts: [
              { text: { content: 'Channel X' } },
              { text: { content: '2M views' } },
              { text: { content: '1 year ago' } },
            ] }],
          },
        },
      },
    },
    contentImage: {
      thumbnailViewModel: {
        image: { sources: [{ url: 'https://i.ytimg.com/vi/abc12345678/hq720.jpg', width: 720, height: 404 }] },
        overlays: [{
          thumbnailOverlayBadgeViewModel: {
            thumbnailBadges: [
              { thumbnailBadgeViewModel: { text: '5:20' } },
              { thumbnailBadgeViewModel: { text: 'CC' } },
            ],
          },
        }],
      },
    },
  };
  const item = parseLockupRenderer(lockup);
  assert.equal(item.id, VIDEO_ID);
  assert.equal(item.title, 'Lockup: IELTS listening');
  assert.equal(item.channel, 'Channel X');
  assert.equal(item.duration, '5:20');
  assert.equal(item.durationSeconds, 320);
  assert.equal(item.hasCaptions, true);
  const items = parseSearchData({ contents: [{ lockupViewModel: lockup }] });
  assert.equal(items.length, 1);
});

test('timedtext JSON3 becomes word-level cues', () => {
  const cues = parseTimedText(englishPayload());
  assert.equal(cues.length, 2);
  assert.equal(cues[0].text, 'Hello everyone.');
  assert.equal(cues[0].words[0].text, 'Hello');
  assert.equal(cues[0].words[1].start, 0.7);
  assert.ok(cues[0].words[1].end > cues[0].words[1].start);
  const merged = mergeCues(cues);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].words.length, 6);
  assert.ok(merged[0].end >= 4);
});

test('manual captions without offsets still distribute words inside the cue', () => {
  const cues = parseTimedText({
    events: [{ tStartMs: 1000, dDurationMs: 3000, segs: [{ utf8: 'one two three four' }] }],
  });
  assert.equal(cues.length, 1);
  assert.equal(cues[0].words.length, 4);
  assert.ok(cues[0].words[0].start >= 1);
  assert.ok(cues[0].words[3].end <= 4.01);
  for (let index = 1; index < cues[0].words.length; index += 1) {
    assert.ok(cues[0].words[index].start >= cues[0].words[index - 1].start);
  }
});

test('caption track prefers manual English and aligns translations', () => {
  const track = chooseCaptionTrack([
    { languageCode: 'en', kind: 'asr', baseUrl: 'a' },
    { languageCode: 'en', kind: '', baseUrl: 'b' },
    { languageCode: 'fr', kind: '', baseUrl: 'c' },
  ]);
  assert.equal(track.baseUrl, 'b');

  const en = [{ start: 0, end: 2, text: 'Hello' }, { start: 2.1, end: 4, text: 'World' }];
  const zh = [{ start: 0, end: 2.05, text: '你好' }, { start: 2.2, end: 4.1, text: '世界' }];
  assert.deepEqual(alignTranslations(en, zh), ['你好', '世界']);
});

test('searchYouTube scrapes the public results page', async () => {
  _clearCaches();
  const html = `<script>var ytInitialData = ${JSON.stringify(searchFixture())};</script>`;
  const fetchImpl = async () => ({ ok: true, text: async () => html });
  const result = await searchYouTube({ query: 'ielts listening', apiKey: '', fetchImpl });
  assert.equal(result.source, 'youtube-web');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, VIDEO_ID);
});

test('getVideoCaptions builds bilingual cues with word timings', async () => {
  _clearCaches();
  const fetchImpl = async (url) => {
    if (String(url).includes('/watch')) return { ok: true, text: async () => playerHtml() };
    if (String(url).includes('timedtext')) {
      const tlang = new URL(String(url)).searchParams.get('tlang');
      return { ok: true, text: async () => JSON.stringify(tlang ? chinesePayload() : englishPayload()) };
    }
    return { ok: false, status: 404, text: async () => '' };
  };
  const data = await getVideoCaptions({ videoId: VIDEO_ID, fetchImpl });
  assert.equal(data.hasCaptions, true);
  assert.equal(data.hasChinese, true);
  assert.equal(data.title, 'Inside a listening lesson');
  assert.ok(data.cues.length >= 1);
  assert.ok(data.cues[0].words.length >= 2);
  assert.match(data.cues[0].zh, /大家好/);
  assert.equal(data.reason, '');
});

test('missing captions return metadata and a reason', async () => {
  _clearCaches();
  const html = `<script>var ytInitialPlayerResponse = ${JSON.stringify({
    playabilityStatus: { status: 'OK' },
    videoDetails: { title: 'No captions here', author: 'Someone', lengthSeconds: '60' },
  })};</script>`;
  const data = await getVideoCaptions({
    videoId: VIDEO_ID,
    fetchImpl: async () => ({ ok: true, text: async () => html }),
  });
  assert.equal(data.hasCaptions, false);
  assert.equal(data.cues.length, 0);
  assert.equal(data.reason, 'NO_CAPTIONS');
  assert.equal(data.title, 'No captions here');
});

test('a transient LOGIN_REQUIRED is retried and failures are not cached', async () => {
  _clearCaches();
  const loginHtml = `<script>var ytInitialPlayerResponse = ${JSON.stringify({
    playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm you’re not a bot' },
  })};</script>`;
  let watchCalls = 0;
  const fetchImpl = async (url) => {
    if (String(url).includes('/watch')) {
      watchCalls += 1;
      return { ok: true, text: async () => (watchCalls === 1 ? loginHtml : playerHtml()) };
    }
    if (String(url).includes('timedtext')) {
      const tlang = new URL(String(url)).searchParams.get('tlang');
      return { ok: true, text: async () => JSON.stringify(tlang ? chinesePayload() : englishPayload()) };
    }
    return { ok: false, status: 404, text: async () => '' };
  };

  const recovered = await getVideoCaptions({ videoId: VIDEO_ID, fetchImpl });
  assert.equal(recovered.hasCaptions, true);
  assert.equal(watchCalls, 2);

  _clearCaches();
  let failingCalls = 0;
  const failing = async () => {
    failingCalls += 1;
    return { ok: true, text: async () => loginHtml };
  };
  const first = await getVideoCaptions({ videoId: VIDEO_ID, fetchImpl: failing });
  const second = await getVideoCaptions({ videoId: VIDEO_ID, fetchImpl: failing });
  assert.equal(first.reason, 'LOGIN_REQUIRED');
  assert.equal(second.reason, 'LOGIN_REQUIRED');
  assert.equal(failingCalls, 4);
});

test('PoToken helper segments become word-level cues', () => {
  const cues = segmentsToCues([
    { start: 1, duration: 2.4, text: 'Hello world' },
    { start: 4, duration: 2, text: '[Music]' },
    { start: 6.5, duration: 3, text: 'Shaded streets matter.' },
  ]);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].text, 'Hello world');
  assert.equal(cues[0].words.length, 2);
  assert.equal(cues[0].words[0].start, 1);
  assert.ok(cues[0].words[1].end <= 3.41);
  assert.ok(cues[1].start >= 6.5);
});

test('free translator maps numbered batches back to cues', async () => {
  _clearCaches();
  const fetchImpl = async () => ({
    ok: true,
    json: async () => [[
      ['[[1]] 你好世界。\n[[2]] 这是第二句。', '[[1]] Hello world.\n[[2]] This is the second line.'],
    ]],
  });
  const data = await translateCuesFree({
    videoId: VIDEO_ID,
    cues: [{ en: 'Hello world.' }, { en: 'This is the second line.' }],
    fetchImpl,
  });
  assert.equal(data.engine, 'google');
  assert.deepEqual(data.zh, ['你好世界。', '这是第二句。']);
  assert.equal(data.batches, 1);
});

test('client subtitle timing helpers handle gaps, words and Chinese progress', () => {
  const cues = normalizeCues([
    { start: 0, end: 2, en: 'one two', zh: '一二', words: [{ text: 'one', start: 0, end: 1 }, { text: 'two', start: 1, end: 2 }] },
    { start: 3, end: 5, en: 'three', zh: '三', words: [{ text: 'three', start: 3, end: 5 }] },
  ]);
  assert.equal(cues.length, 2);
  assert.equal(findCueIndex(cues, 1.2), 0);
  assert.equal(findCueIndex(cues, 2.5), -1);
  assert.equal(findCueIndex(cues, 4), 1);
  assert.equal(findWordIndex(cues[0].words, 1.4), 1);
  assert.equal(cueProgress(cues[0], 1), 0.5);
  assert.equal(activeCharCount('一二', 0.5), 1);
  assert.equal(activeCharCount('一二', 1), 2);
});

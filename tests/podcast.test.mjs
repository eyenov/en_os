import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVtt } from '../server/podcasts.mjs';

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

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseWav, voicedSegments, alignWords, tokenWeight } = require('../dist/services/WordTiming');

const RATE = 24000;
/** WAV with tone bursts at the given [start, end] seconds and silence elsewhere. */
function wav(seconds, bursts, { bits = 16, channels = 1, float = false } = {}) {
  const n = Math.floor(seconds * RATE), bytes = bits / 8, data = Buffer.alloc(n * bytes * channels);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const on = bursts.some(([a, b]) => t >= a && t < b);
    const v = on ? Math.sin(2 * Math.PI * 180 * t) * 0.4 * (0.75 + 0.25 * Math.sin(2 * Math.PI * 4 * t)) : (Math.random() - 0.5) * 0.0004;
    for (let c = 0; c < channels; c++) {
      const at = (i * channels + c) * bytes;
      if (float) data.writeFloatLE(v, at); else data.writeInt16LE(Math.round(v * 32767), at);
    }
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(float ? 3 : 1, 20); h.writeUInt16LE(channels, 22); h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * bytes * channels, 28);
  h.writeUInt16LE(bytes * channels, 32); h.writeUInt16LE(bits, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

test('parses 16-bit, float and stereo WAV; rejects other data', () => {
  for (const options of [{}, { bits: 32, float: true }, { channels: 2 }]) {
    const audio = parseWav(wav(1, [[0.2, 0.6]], options));
    assert.equal(audio.sampleRate, RATE);
    assert.ok(Math.abs(audio.duration - 1) < 0.01);
    assert.ok(Math.max(...audio.samples.subarray(RATE * 0.3, RATE * 0.31)) > 0.1);
  }
  assert.equal(parseWav(Buffer.from('not a wav file at all, definitely not a wav')), null);
});

test('finds voiced regions separated by pauses', () => {
  const segments = voicedSegments(parseWav(wav(2.4, [[0.1, 0.9], [1.4, 2.2]])));
  assert.equal(segments.length, 2);
  assert.ok(Math.abs(segments[0][0] - 0.1) < 0.05 && Math.abs(segments[0][1] - 0.9) < 0.05);
  assert.ok(Math.abs(segments[1][0] - 1.4) < 0.05 && Math.abs(segments[1][1] - 2.2) < 0.05);
});

test('words never land in silence and the comma snaps to the real pause', () => {
  const words = alignWords('Một hai ba, bốn năm sáu bảy.', wav(2.4, [[0.1, 0.9], [1.4, 2.2]]), 2.4);
  assert.equal(words.length, 7);
  assert.ok(words.slice(0, 3).every((w) => w.start >= 0.05 && w.end <= 0.95), JSON.stringify(words));
  assert.ok(words.slice(3).every((w) => w.start >= 1.35 && w.end <= 2.25), JSON.stringify(words));
  for (let i = 1; i < words.length; i++) assert.ok(words[i].start >= words[i - 1].start);
});

test('numbers take longer to say than one syllable', () => {
  assert.ok(tokenWeight('1964') > 5);
  assert.equal(tokenWeight('nhà'), 1);
  const words = alignWords('Năm 1964 có', wav(2, [[0, 2]]), 2);
  assert.ok(words[1].end - words[1].start > 3 * (words[0].end - words[0].start));
});

test('falls back to an even spread when the audio is unreadable', () => {
  const words = alignWords('một hai ba bốn', null, 2);
  assert.equal(words.length, 4);
  assert.equal(words[0].start, 0);
  assert.ok(words[3].end <= 2 && words[3].start >= 1.4);
});

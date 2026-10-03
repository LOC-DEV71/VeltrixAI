import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { encodeCloneSample, prepareCloneSample, cloneErrorMessage } from '../src/utils/cloneSample.ts';

// Validate browser output with the independent backend WAV parser used on upload.
const require = createRequire(import.meta.url);
const { inspectReferenceAudio } = require('../../backend-api/dist/services/VoiceEnrollmentStorage.js');
function audio(seconds, channels = 2, quiet = false) {
  const sampleRate = 48000, length = Math.round(seconds * sampleRate);
  const samples = Array.from({ length: channels }, (_, c) => Float32Array.from({ length }, (_, i) => quiet ? 0 : Math.sin(i * .06) * (.3 + c * .1)));
  return { sampleRate, length, numberOfChannels: channels, getChannelData: c => samples[c] };
}
test('an exactly 8s stereo float buffer becomes a backend-compatible mono PCM16 WAV', async () => {
  const result = encodeCloneSample(audio(8));
  const wav = Buffer.from(await result.blob.arrayBuffer());
  const info = inspectReferenceAudio(wav);
  assert.equal(info.duration, 8); assert.equal(info.bitsPerSample, 16);
  assert.equal(info.sampleRate, 48000); assert.equal(info.channels, 1);
  assert.equal(wav.readInt16LE(44 + 100 * 2), Math.round(Math.sin(6) * .35 * 32768));
});
test('small export padding is trimmed to 8s; longer, shorter and silent samples are rejected', async () => {
  const padded = encodeCloneSample(audio(8.04));
  assert.equal(inspectReferenceAudio(Buffer.from(await padded.blob.arrayBuffer())).duration, 8);
  for (const seconds of [2.99, 8.06, 20]) assert.throws(() => encodeCloneSample(audio(seconds)), /3 đến 8/);
  assert.throws(() => encodeCloneSample(audio(8, 1, true)), /nhỏ tiếng/);
});
test('renamed non-WAV and oversized files are rejected before decoding', async () => {
  await assert.rejects(prepareCloneSample(new File(['not an audio file'], 'sample.wav')), /WAV hợp lệ/);
  await assert.rejects(prepareCloneSample({ size: 4 * 1024 * 1024 + 1 }), /4 MB/);
});
test('browser decoding closes the audio context on success and corrupt file failure', async () => {
  let closed = 0, corrupt = false;
  const previous = globalThis.AudioContext;
  globalThis.AudioContext = class {
    constructor(options) { assert.equal(options.sampleRate, 48000); }
    async decodeAudioData() { if (corrupt) throw new Error('decoder rejected'); return audio(8); }
    async close() { closed++; }
  };
  try {
    const header = Buffer.alloc(44); header.write('RIFF'); header.write('WAVE', 8);
    const file = new File([header], 'float.wav');
    assert.equal((await prepareCloneSample(file)).duration, 8);
    corrupt = true; await assert.rejects(prepareCloneSample(file), /Không đọc được/);
    assert.equal(closed, 2);
  } finally { if (previous) globalThis.AudioContext = previous; else delete globalThis.AudioContext; }
});
test('backend rejections give distinct user-facing duration, format and consent guidance', () => {
  assert.match(cloneErrorMessage('CLONE_SAMPLE_DURATION_INVALID'), /3 đến 8/);
  assert.match(cloneErrorMessage('CLONE_SAMPLE_FORMAT_INVALID'), /PCM16/);
  assert.match(cloneErrorMessage('CLONE_CONSENT_REQUIRED'), /đồng ý/);
  assert.match(cloneErrorMessage('unknown'), /Không tạo được giọng/);
});

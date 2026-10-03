const { test } = require('node:test'); const assert = require('node:assert/strict');
const { createHash, randomBytes } = require('node:crypto');
const fs = require('node:fs/promises'); const path = require('node:path');
const { getCachedAudio } = require('../dist/services/AudioCache');
test('audio cache coalesces cold requests, survives a subsequent read and repairs corrupt bytes', async () => {
  const wav = Buffer.alloc(2044); wav.write('RIFF'); wav.writeUInt32LE(2036, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(2000, 40); randomBytes(2000).copy(wav, 44);
  const hash = createHash('sha256').update(wav).digest('hex'); const file = path.resolve(__dirname, '../../../services/tts/audio-cache', `${hash}.wav`);
  let calls = 0; const download = async () => { calls++; await new Promise(done => setTimeout(done, 30)); return wav; };
  try {
    const responses = await Promise.all([0, 1, 2, 3].map(() => getCachedAudio(hash, download)));
    assert.equal(calls, 1); responses.forEach(audio => assert.deepEqual(audio, wav));
    assert.deepEqual(await getCachedAudio(hash, async () => { throw new Error('SOURCE_OFFLINE'); }), wav);
    await fs.writeFile(file, 'corrupt'); assert.deepEqual(await getCachedAudio(hash, download), wav); assert.equal(calls, 2);
    await assert.rejects(getCachedAudio('../secret', download), /INVALID_AUDIO_HASH/);
  } finally { await fs.unlink(file).catch(() => {}); }
});

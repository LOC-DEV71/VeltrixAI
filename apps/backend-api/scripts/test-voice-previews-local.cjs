// Real authenticated preview HTTP requests; temporary auth fixtures only.
const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
const mongoose = require('mongoose');
const express = require('express');
const cookieParser = require('cookie-parser');
const { User } = require('../dist/models/User');
const { Session } = require('../dist/models/Session');
const { signAccessToken } = require('../dist/utils/jwt');
const { inspectWave } = require('../dist/providers/AudioValidation');
const output = path.resolve(__dirname, '../../../services/tts/preview-audio');
let owner, session, server;
async function run() {
  const generated = JSON.parse(await fs.readFile(path.join(output, 'acceptance.json'), 'utf8'));
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  owner = await User.create({ email: `voice-preview-${crypto.randomUUID()}@example.invalid`, displayName: 'Temporary preview test', plan: 'FREE' });
  session = await Session.create({ userId: owner._id, tokenFamily: crypto.randomUUID(), refreshTokenHash: crypto.randomBytes(32).toString('hex'), expiresAt: new Date(Date.now() + 60000) });
  const cookie = `accessToken=${signAccessToken({ sessionId: session._id })}`;
  const app = express(); app.use(cookieParser()); app.use('/api/voices', require('../dist/routes/voices').default);
  server = await new Promise(done => { const listener = app.listen(0, '127.0.0.1', () => done(listener)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${origin}/api/voices`)).status, 401);
  const list = await fetch(`${origin}/api/voices`, { headers: { Cookie: cookie } });
  assert.equal(list.status, 200); const voices = (await list.json()).data.systemVoices;
  const checked = [];
  for (const sample of generated.voices) {
    const voice = voices.find(voice => voice.id === sample.voiceId);
    assert.ok(voice); assert.equal(voice.previewText, generated.text);
    assert.equal((await fetch(origin + voice.previewUrl)).status, 401);
    const audioResponse = await fetch(origin + voice.previewUrl, { headers: { Cookie: cookie } });
    assert.equal(audioResponse.status, 200);
    assert.equal(audioResponse.headers.get('content-type').split(';')[0], 'audio/wav');
    const audio = Buffer.from(await audioResponse.arrayBuffer()); const wav = inspectWave(audio);
    assert.equal(crypto.createHash('sha256').update(audio).digest('hex'), sample.sha256);
    checked.push({ name: voice.name, authenticated_http_pass: true, ...wav, sha256: sample.sha256 });
  }
  await fs.writeFile(path.join(output, 'http-acceptance.json'), JSON.stringify({ unauthenticated_rejected: true, voices: checked }, null, 2));
  console.log(JSON.stringify({ preview_http_pass: true, voices: checked.length }));
}
run().catch(() => { console.error('PREVIEW_HTTP_TEST_FAILED'); process.exitCode = 1; }).finally(async () => {
  if (server) await new Promise(done => server.close(done));
  if (session) await Session.deleteOne({ _id: session._id });
  if (owner) await User.deleteOne({ _id: owner._id });
  await mongoose.disconnect();
}).catch(() => { console.error('PREVIEW_TEST_CLEANUP_FAILED'); process.exitCode = 1; });

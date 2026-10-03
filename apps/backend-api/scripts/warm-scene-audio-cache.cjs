// Read-only Mongo lookup of requested content; warms saved audio, never generates/charges TTS.
const path = require('node:path'), assert = require('node:assert/strict');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
const mongoose = require('mongoose'); const { performance } = require('node:perf_hooks');
const { Content } = require('../dist/models/Content'), { Scene } = require('../dist/models/Scene'), { MediaAsset } = require('../dist/models/MediaAsset');
const { CloudinaryAudioProvider, getCloudinaryConfiguration } = require('../dist/providers/CloudinaryAudioProvider');
const { getCachedAudio } = require('../dist/services/AudioCache'); const { playAudio } = require('../dist/controllers/MediaController');
function response() { return { statusCode: 200, headers: {}, setHeader(name, value) { this.headers[name] = value; return this; }, status(code) { this.statusCode = code; return this; }, send(body) { this.body = body; return this; }, json(body) { this.body = body; return this; }, end() { return this; } }; }
(async () => {
  const id = process.argv[2]; if (!mongoose.isObjectIdOrHexString(id)) throw new Error();
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  const content = await Content.findById(id); assert.ok(content);
  const scenes = await Scene.find({ projectId: content.projectId }).sort({ order: 1 }); const measurements = [];
  const provider = new CloudinaryAudioProvider(getCloudinaryConfiguration());
  for (const scene of scenes) {
    if (!scene.ttsAudioId) continue; const asset = await MediaAsset.findById(scene.ttsAudioId); assert.ok(asset);
    let sourceDownloads = 0; const coldStart = performance.now();
    await getCachedAudio(asset.sha256, async () => { sourceDownloads++; return (await provider.download(asset.publicId)).audio; });
    const coldMs = performance.now() - coldStart;
    const req = { params: { id: String(asset._id) }, user: { _id: asset.ownerId }, get: () => 'bytes=0-63' };
    const res = response(); const start = performance.now(); await playAudio(req, res); const cachedMs = performance.now() - start;
    assert.equal(res.statusCode, 206); assert.equal(res.body.length, 64); assert.equal(res.headers['Content-Range'], `bytes 0-63/${asset.bytes}`);
    const denied = response(); await playAudio({ ...req, user: { _id: new mongoose.Types.ObjectId() } }, denied); assert.equal(denied.statusCode, 404);
    const invalidRange = response(); await playAudio({ ...req, get: () => 'bytes=999999999-' }, invalidRange); assert.equal(invalidRange.statusCode, 416);
    measurements.push({ scene: scene.order, bytes: asset.bytes, duration: asset.duration, sourceDownloads, firstMs: Math.round(coldMs), cachedRangeMs: Math.round(cachedMs) });
  }
  console.log(JSON.stringify({ savedSceneAudio: measurements.length, noSynthesis: true, ownershipAndRangeVerified: true, measurements }));
})().catch(() => { console.error('AUDIO_CACHE_BENCHMARK_FAILED'); process.exitCode = 1; }).finally(() => mongoose.disconnect());

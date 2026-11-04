const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const crypto = require('crypto');
const { mkdtempSync, existsSync, writeFileSync, rmSync, readdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { User } = require('../dist/models/User');
const { Workspace } = require('../dist/models/Workspace');
const { Project } = require('../dist/models/Project');
const { Content } = require('../dist/models/Content');
const { Scene } = require('../dist/models/Scene');
const { Job } = require('../dist/models/Job');
const { MediaAsset } = require('../dist/models/MediaAsset');
const { Video } = require('../dist/models/Video');
const { Wallet, CreditLot, CreditLedger, CreditReservation } = require('../dist/models/Credits');
const { savePlan, seedConfig } = require('../dist/services/PlanService');
const { createVideoJob } = require('../dist/services/VideoService');
const { claimVideoJob, processVideoJob, renderWithRemotion } = require('../dist/workers/VideoWorker');

let replica, storageDir, workRoot;
before(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replica.getUri());
  await Promise.all([User, Job, MediaAsset, Video, Wallet, CreditLot, CreditLedger, CreditReservation].map((m) => m.init()));
  for (const tier of ['FREE', 'PRO']) await savePlan(tier, seedConfig(tier), 0, null, 'Video test fixtures', true);
  storageDir = mkdtempSync(join(tmpdir(), 'video-store-'));
  workRoot = mkdtempSync(join(tmpdir(), 'video-work-'));
});
after(async () => { await mongoose.disconnect(); await replica?.stop(); rmSync(storageDir, { recursive: true, force: true }); rmSync(workRoot, { recursive: true, force: true }); });

// 16-bit mono PCM WAV with a quiet tone.
function wav(seconds, frequency = 220) {
  const rate = 24000, samples = Math.floor(seconds * rate), data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * frequency * i) / rate) * 3000), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

async function credits(userId, amount) {
  const wallet = await Wallet.create({ userId, bucket: 'PAID', available: amount, reserved: 0 });
  await CreditLot.create({ walletId: wallet._id, amount, available: amount, source: 'ADMIN', expiresAt: new Date(Date.now() + 86400000) });
}
const balance = async (userId) => (await Wallet.find({ userId })).reduce((n, w) => n + w.available, 0);

/** A content with scenes that each have current TTS audio. */
async function fixture({ tier = 'PRO', credit = 500, narrations = ['Điều gì sẽ xảy ra nếu Trái Đất ngừng quay?', 'Gió sẽ thổi với tốc độ khủng khiếp.'], seconds = 1.2, withAudio = true } = {}) {
  const user = await User.create({ email: crypto.randomUUID() + '@example.invalid', displayName: 'Video test', plan: tier });
  await credits(user._id, credit);
  const workspace = await Workspace.create({ ownerId: user._id, name: 'W' });
  const project = await Project.create({ workspaceId: workspace._id, name: 'P' });
  const content = await Content.create({ projectId: project._id, rawText: '[]', revision: 1 });
  const scenes = [];
  for (const [i, narration] of narrations.entries()) {
    const scene = await Scene.create({ projectId: project._id, order: i + 1, title: `Cảnh ${i + 1}`, narration, visualDescription: 'Trái Đất', imagePrompt: 'Planet earth in space, cinematic --ar 9:16', estimatedDuration: 2, sourceContentRevision: 1 });
    if (withAudio) {
      const tts = await Job.create({ ownerId: user._id, type: 'TTS', status: 'COMPLETED', idempotencyKey: crypto.randomUUID(), payload: { sceneId: scene._id, sceneRevision: scene.revision, narration: narration.trim() } });
      const audio = wav(seconds, 220 + i * 110);
      const asset = await MediaAsset.create({ ownerId: user._id, projectId: project._id, sceneId: scene._id, jobId: tts._id, publicId: `test/${tts._id}`, cloudinaryAssetId: 'a', deliveryType: 'authenticated', resourceType: 'video', format: 'wav', bytes: audio.length, duration: seconds, sampleRate: 24000, channels: 1, sha256: crypto.createHash('sha256').update(audio).digest('hex') });
      scene.ttsAudioId = asset._id; await scene.save();
      audios.set(String(asset.publicId), audio);
    }
    scenes.push(scene);
  }
  return { user, content, scenes };
}
const audios = new Map();

// The renderer's own zod schema (packages/video-renderer/src/schema.ts) is the contract for manifests.
const rendererSchema = () => import('../../../packages/video-renderer/src/schema.ts');
let lastManifest = null;
const fakeRender = (fail = false) => async (manifestPath) => {
  if (fail) throw Object.assign(new Error('boom'), { code: 'VIDEO_RENDER_FAILED' });
  const manifest = JSON.parse(require('node:fs').readFileSync(manifestPath, 'utf8'));
  const { manifestSchema, sceneFrames } = await rendererSchema();
  const parsed = manifestSchema.safeParse(manifest);
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues?.slice(0, 3)));
  lastManifest = manifest;
  writeFileSync(manifest.outputPath, Buffer.from('fake mp4'));
  return { bytes: 8, durationInFrames: manifest.scenes.reduce((s, x) => s + sceneFrames(x.audioSeconds, 30), 0) };
};
const deps = (render = fakeRender()) => ({ audio: async (asset) => audios.get(asset.publicId), ai: null, stock: null, render, storageDir, workRoot });

test('creating a render reserves credit once; same inputs reuse the job', async () => {
  const { user, content } = await fixture();
  const first = await createVideoJob(user._id, String(content._id), { aspectRatio: '9:16' });
  assert.equal(first.reused, false);
  assert.equal(first.job.type, 'VIDEO_RENDER');
  assert.equal(await balance(user._id), 450);
  const second = await createVideoJob(user._id, String(content._id), { aspectRatio: '9:16' });
  assert.equal(second.reused, true);
  assert.equal(String(second.job._id), String(first.job._id));
  assert.equal(await balance(user._id), 450);
});

test('rejects missing audio, foreign content, bad input and insufficient credit', async () => {
  const noAudio = await fixture({ withAudio: false });
  await assert.rejects(() => createVideoJob(noAudio.user._id, String(noAudio.content._id), {}), (e) => e.code === 'VIDEO_AUDIO_MISSING' && e.details.sceneOrders.length === 2);
  const other = await fixture();
  await assert.rejects(() => createVideoJob(noAudio.user._id, String(other.content._id), {}), (e) => e.code === 'NOT_FOUND');
  await assert.rejects(() => createVideoJob(other.user._id, String(other.content._id), { aspectRatio: '4:3' }), (e) => e.code === 'VIDEO_INVALID_INPUT');
  const poor = await fixture({ credit: 10 });
  await assert.rejects(() => createVideoJob(poor.user._id, String(poor.content._id), {}), (e) => e.code === 'INSUFFICIENT_CREDIT');
  assert.equal(await Job.countDocuments({ ownerId: poor.user._id, type: 'VIDEO_RENDER' }), 0);
});

test('audio made from an older narration does not count', async () => {
  const { user, content, scenes } = await fixture();
  await Scene.updateOne({ _id: scenes[1]._id }, { $set: { narration: 'Lời đọc đã sửa.' } });
  await assert.rejects(() => createVideoJob(user._id, String(content._id), {}), (e) => e.code === 'VIDEO_AUDIO_MISSING' && e.details.sceneOrders[0] === 2);
});

test('plan duration limit applies to lower plans', async () => {
  const { user, content } = await fixture({ tier: 'FREE', seconds: 40 }); // 80s > 60s * 1.25
  await assert.rejects(() => createVideoJob(user._id, String(content._id), {}), (e) => e.code === 'VIDEO_DURATION_LIMIT');
});

test('worker renders, stores the file, records the video and settles credit', async () => {
  const { user, content } = await fixture();
  const { job } = await createVideoJob(user._id, String(content._id), {});
  const claimed = await claimVideoJob(String(job._id));
  await processVideoJob(claimed, deps());
  const done = await Job.findById(job._id).lean();
  assert.equal(done.status, 'COMPLETED', done.error);
  assert.equal(done.progress.stage, 'SAVING');
  const video = await Video.findById(done.result.videoId).lean();
  assert.equal(video.scenes.length, 2);
  assert.equal(video.scenes[0].imageSource, 'GENERATED');
  assert.equal(video.scenes[0].imageQuery, 'planet earth space');
  // Without AI the heuristic storyboard still follows the rules: hook first, cta last.
  assert.deepEqual(video.scenes.map((s) => s.type), ['hook', 'cta']);
  assert.deepEqual(lastManifest.scenes.map((s) => s.background.kind), ['gradient', 'gradient']);
  const words = lastManifest.scenes[0].scene.words;
  assert.equal(words.map((w) => w.text).join(' '), 'Điều gì sẽ xảy ra nếu Trái Đất ngừng quay?');
  assert.ok(words.every((w, i) => w.end > w.start && (i === 0 || w.start >= words[i - 1].start)));
  assert.ok(existsSync(join(storageDir, video.storageKey)));
  assert.equal(await balance(user._id), 450);
  assert.equal((await CreditReservation.findOne({ jobId: job._id }).lean()).status, 'SETTLED');
  assert.deepEqual(readdirSync(workRoot), []); // temp files removed
});

test('backgrounds prefer stock video, then photo, then the animated gradient', async () => {
  const { user, content } = await fixture({ narrations: ['Cảnh một có video.', 'Cảnh hai chỉ có ảnh.', 'Cảnh ba không có gì.'] });
  const queries = [];
  const credit = { photographer: 'P', photographerUrl: 'https://www.pexels.com/@p', pageUrl: 'https://www.pexels.com/x' };
  let n = 0;
  const stock = {
    async searchVideo(query) { queries.push(query); n++; if (n === 1) return { bytes: Buffer.from('mp4'), extension: 'mp4', source: 'PEXELS_VIDEO', providerId: 'v1', credit }; if (n === 2) return null; throw new Error('STOCK_RATE_LIMITED'); },
    async search(query, o, w, h, used) { assert.ok(used.has('v1')); return n === 2 ? { bytes: Buffer.from([0xff, 0xd8]), extension: 'jpg', source: 'PEXELS', providerId: 'p1', credit } : null; },
  };
  const { job } = await createVideoJob(user._id, String(content._id), {});
  await processVideoJob(await claimVideoJob(String(job._id)), { ...deps(), stock });
  const done = await Job.findById(job._id).lean();
  assert.equal(done.status, 'COMPLETED', done.error);
  assert.deepEqual(lastManifest.scenes.map((s) => s.background), [{ kind: 'video', file: 'bg-0.mp4' }, { kind: 'image', file: 'bg-1.jpg' }, { kind: 'gradient' }]);
  const video = await Video.findById(done.result.videoId).lean();
  assert.deepEqual(video.scenes.map((s) => s.imageSource), ['PEXELS_VIDEO', 'PEXELS', 'GENERATED']);
  assert.equal(queries.length, 3);
});

test('render failure releases credit and leaves no stored file', async () => {
  const { user, content } = await fixture();
  const { job } = await createVideoJob(user._id, String(content._id), {});
  const before = readdirSync(storageDir).length;
  await processVideoJob(await claimVideoJob(String(job._id)), deps(fakeRender(true)));
  const failed = await Job.findById(job._id).lean();
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.error, 'VIDEO_RENDER_FAILED');
  assert.equal(await balance(user._id), 500);
  assert.equal(readdirSync(storageDir).length, before);
  // A new attempt is allowed after a failure.
  const retry = await createVideoJob(user._id, String(content._id), {});
  assert.equal(retry.reused, false);
});

test('scene edited after queueing fails as stale and refunds', async () => {
  const { user, content, scenes } = await fixture();
  const { job } = await createVideoJob(user._id, String(content._id), {});
  await Scene.updateOne({ _id: scenes[0]._id }, { $inc: { revision: 1 } });
  await processVideoJob(await claimVideoJob(String(job._id)), deps());
  const failed = await Job.findById(job._id).lean();
  assert.equal(failed.error, 'VIDEO_STALE_SCENES');
  assert.equal(await balance(user._id), 500);
});

test('end to end with the real Remotion renderer', { timeout: 300000 }, async () => {
  const { user, content } = await fixture({ seconds: 1 });
  const { job } = await createVideoJob(user._id, String(content._id), { aspectRatio: '16:9' });
  await processVideoJob(await claimVideoJob(String(job._id)), deps((manifest, onProgress) => renderWithRemotion(manifest, onProgress)));
  const done = await Job.findById(job._id).lean();
  assert.equal(done.status, 'COMPLETED', done.error);
  const video = await Video.findById(done.result.videoId).lean();
  assert.equal(video.width, 1920);
  assert.ok(video.bytes > 10000);
  assert.ok(video.durationSeconds >= 2 && video.durationSeconds <= 3.5, String(video.durationSeconds));
  assert.ok(existsSync(join(storageDir, video.storageKey)));
});

const { test, before, after, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
process.env.NODE_ENV = 'test';
process.env.AI_PROVIDER = 'gemini';
process.env.GEMINI_API_KEY = 'unit-test-provider-key'; // provider mocked, never real inference
const mongoose = require('mongoose');
const crypto = require('crypto');
const { mkdtempSync, rmSync, writeFileSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { User } = require('../dist/models/User');
const { Job } = require('../dist/models/Job');
const { Scene } = require('../dist/models/Scene');
const { Voice } = require('../dist/models/Voice');
const { MediaAsset } = require('../dist/models/MediaAsset');
const { Video } = require('../dist/models/Video');
const { AutoVideoRun } = require('../dist/models/AutoVideoRun');
const { Wallet, CreditLot, CreditLedger, CreditReservation } = require('../dist/models/Credits');
const { savePlan, seedConfig } = require('../dist/services/PlanService');
const { CreditService } = require('../dist/services/CreditService');
const { GeminiContentProvider } = require('../dist/providers/AiProvider');
const { processContentJob } = require('../dist/workers/ContentWorker');
const { claimVideoJob, processVideoJob } = require('../dist/workers/VideoWorker');
const auto = require('../dist/services/AutoVideoService');

let replica, storageDir, workRoot, voice;
before(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replica.getUri());
  await Promise.all([User, Job, Scene, Voice, MediaAsset, Video, AutoVideoRun, Wallet, CreditLot, CreditLedger, CreditReservation].map((m) => m.init()));
  await savePlan('PRO', seedConfig('PRO'), 0, null, 'Auto video fixtures', true);
  voice = await Voice.create({ provider: 'VIENEU_LOCAL', providerVoiceId: 'test-fixture', name: 'Fixture', language: 'vi-VN', gender: 'male', planEntitlements: ['*'], status: 'ACTIVE', isSystem: true });
  storageDir = mkdtempSync(join(tmpdir(), 'auto-store-'));
  workRoot = mkdtempSync(join(tmpdir(), 'auto-work-'));
});
after(async () => { await mongoose.disconnect(); await replica?.stop(); rmSync(storageDir, { recursive: true, force: true }); rmSync(workRoot, { recursive: true, force: true }); });
afterEach(() => mock.restoreAll());

async function fixtureUser(credit = 5000) {
  const user = await User.create({ email: crypto.randomUUID() + '@example.invalid', displayName: 'Auto test', plan: 'PRO' });
  const wallet = await Wallet.create({ userId: user._id, bucket: 'PAID', available: credit, reserved: 0 });
  await CreditLot.create({ walletId: wallet._id, amount: credit, available: credit, source: 'ADMIN', expiresAt: new Date(Date.now() + 86400000) });
  return user;
}
const scenesJson = JSON.stringify([1, 2, 3].map((n) => ({
  title: `Cảnh ${n}`, narration: `Đây là lời đọc số ${n} về việc Trái Đất ngừng quay và điều gì sẽ xảy ra tiếp theo.`,
  visualDescription: 'Trái Đất trong vũ trụ', estimatedDuration: 10, imagePrompt: 'Planet earth in space --ar 9:16', videoPrompt: 'Slow zoom on planet earth',
})));

const wav = (seconds) => {
  const rate = 24000, data = Buffer.alloc(Math.floor(seconds * rate) * 2), h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
};
const audioStore = new Map();
/** Stand-in for the TTS worker: completes queued TTS jobs the way TtsWorker publishes audio. */
async function fakeTtsWorker(fail = false) {
  for (const job of await Job.find({ type: 'TTS', status: 'QUEUED' })) {
    if (fail) { await CreditService.release(job._id); await Job.updateOne({ _id: job._id }, { $set: { status: 'FAILED', error: 'TTS_PROCESSING_FAILED' } }); continue; }
    const audio = wav(1);
    const asset = await MediaAsset.create({ ownerId: job.ownerId, projectId: job.payload.projectId, sceneId: job.payload.sceneId, jobId: job._id, publicId: `test/${job._id}`, cloudinaryAssetId: 'a', deliveryType: 'authenticated', resourceType: 'video', format: 'wav', bytes: audio.length, duration: 1, sampleRate: 24000, channels: 1, sha256: crypto.createHash('sha256').update(audio).digest('hex') });
    audioStore.set(asset.publicId, audio);
    await Scene.updateOne({ _id: job.payload.sceneId }, { $set: { ttsAudioId: asset._id, voiceId: job.payload.voiceId } });
    await CreditService.settle(job._id, job.payload.cost);
    await Job.updateOne({ _id: job._id }, { $set: { status: 'COMPLETED', result: { audioId: asset._id } } });
  }
}
const fakeRender = async (manifestPath) => {
  const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
  writeFileSync(m.outputPath, Buffer.from('mp4'));
  return { bytes: 3, durationInFrames: m.scenes.reduce((s, x) => s + Math.ceil(x.audioSeconds * 30) + 6, 0) };
};
const videoDeps = () => ({ audio: async (a) => audioStore.get(a.publicId), ai: null, stock: null, render: fakeRender, storageDir, workRoot });

async function drive(runId, { ttsFail = false, renderFail = false } = {}) {
  for (let i = 0; i < 20; i++) {
    const run = await AutoVideoRun.findById(runId);
    if (run.status !== 'RUNNING') return run;
    await auto.advanceRun(run);
    // Simulate the background workers between ticks.
    const content = await Job.findOne({ type: 'AI_CONTENT', status: 'QUEUED' });
    if (content) await processContentJob({ data: { jobId: String(content._id) } });
    await fakeTtsWorker(ttsFail);
    const video = await claimVideoJob();
    if (video) await processVideoJob(video, renderFail ? { ...videoDeps(), render: async () => { throw new Error('boom'); } } : videoDeps());
  }
  return AutoVideoRun.findById(runId);
}

test('one sentence becomes a finished video through the normal jobs', async () => {
  mock.method(GeminiContentProvider.prototype, 'generate', async () => ({ text: scenesJson }));
  const user = await fixtureUser();
  const run = await auto.createAutoVideoRun(user._id, { topic: 'Điều gì sẽ xảy ra khi Trái Đất ngừng quay', voiceId: String(voice._id), tone: 'drama' });
  assert.equal(run.input.aspectRatio, '9:16');
  const done = await drive(run._id);
  assert.equal(done.status, 'COMPLETED', done.error);
  assert.equal(done.step, 'DONE');
  assert.equal(done.ttsJobIds.length, 3);
  const video = await Video.findById(done.videoId).lean();
  assert.equal(video.scenes.length, 3);
  const view = await auto.runView(done);
  assert.equal(view.videoUrl, `/api/videos/${done.videoId}/file`);
  // Charged exactly once per step: content + 3 TTS + render, no reservations left open.
  assert.equal(await CreditReservation.countDocuments({ status: 'RESERVED', jobId: { $in: [done.contentJobId, ...done.ttsJobIds, done.videoJobId] } }), 0);
});

test('more scenes than the concurrent job limit are voiced in batches, not failed', async () => {
  const seven = JSON.stringify([1, 2, 3, 4, 5, 6, 7].map((n) => ({ ...JSON.parse(scenesJson)[0], title: `Cảnh ${n}`, narration: `Lời đọc cảnh ${n} về nền văn minh cấp bảy và năng lượng của các vì sao.` })));
  mock.method(GeminiContentProvider.prototype, 'generate', async () => ({ text: seven }));
  const user = await fixtureUser();
  const run = await auto.createAutoVideoRun(user._id, { topic: 'Nền văn minh cấp 7 là gì?', voiceId: String(voice._id) });
  let peak = 0;
  for (let i = 0; i < 30; i++) {
    const current = await AutoVideoRun.findById(run._id);
    if (current.status !== 'RUNNING') break;
    await auto.advanceRun(current);
    const content = await Job.findOne({ type: 'AI_CONTENT', status: 'QUEUED', ownerId: user._id });
    if (content) await processContentJob({ data: { jobId: String(content._id) } });
    peak = Math.max(peak, await Job.countDocuments({ ownerId: user._id, status: { $in: ['QUEUED', 'PROCESSING'] } }));
    // Complete only one TTS job per tick, like a single slow TTS worker.
    await fakeTtsWorkerOne(user._id);
    const video = await claimVideoJob();
    if (video) await processVideoJob(video, videoDeps());
  }
  const done = await AutoVideoRun.findById(run._id);
  assert.equal(done.status, 'COMPLETED', done.error);
  assert.equal(done.ttsJobIds.length, 7);
  assert.ok(peak <= 4, `peak pending jobs ${peak}`);
});

async function fakeTtsWorkerOne(ownerId) {
  const job = await Job.findOne({ type: 'TTS', status: 'QUEUED', ownerId }).sort({ createdAt: 1 });
  if (!job) return;
  const audio = wav(1);
  const asset = await MediaAsset.create({ ownerId: job.ownerId, projectId: job.payload.projectId, sceneId: job.payload.sceneId, jobId: job._id, publicId: `test/${job._id}`, cloudinaryAssetId: 'a', deliveryType: 'authenticated', resourceType: 'video', format: 'wav', bytes: audio.length, duration: 1, sampleRate: 24000, channels: 1, sha256: crypto.createHash('sha256').update(audio).digest('hex') });
  audioStore.set(asset.publicId, audio);
  await Scene.updateOne({ _id: job.payload.sceneId }, { $set: { ttsAudioId: asset._id } });
  await CreditService.settle(job._id, job.payload.cost);
  await Job.updateOne({ _id: job._id }, { $set: { status: 'COMPLETED', result: { audioId: asset._id } } });
}

test('retry resumes a failed run from the failed step and keeps finished audio', async () => {
  mock.method(GeminiContentProvider.prototype, 'generate', async () => ({ text: scenesJson }));
  const user = await fixtureUser();
  const run = await auto.createAutoVideoRun(user._id, { topic: 'Thử lại sau khi lỗi giọng đọc', voiceId: String(voice._id) });
  const failed = await drive(run._id, { ttsFail: true });
  assert.equal(failed.failedStep, 'VOICE');
  const keptContentJob = String(failed.contentJobId);
  await assert.rejects(() => auto.retryAutoVideoRun(new mongoose.Types.ObjectId(), String(run._id)), /NOT_FOUND/);
  const resumed = await auto.retryAutoVideoRun(user._id, String(run._id));
  assert.equal(resumed.status, 'RUNNING');
  assert.equal(resumed.step, 'VOICE');
  assert.equal(resumed.ttsJobIds.length, 0); // failed TTS jobs dropped
  const done = await drive(run._id);
  assert.equal(done.status, 'COMPLETED', done.error);
  assert.equal(String(done.contentJobId), keptContentJob); // script not rewritten or re-charged
  assert.equal(await Job.countDocuments({ ownerId: user._id, type: 'AI_CONTENT' }), 1);
  await assert.rejects(() => auto.retryAutoVideoRun(user._id, String(run._id)), /AUTO_VIDEO_NOT_FAILED/);
});

test('advancing twice never duplicates jobs', async () => {
  mock.method(GeminiContentProvider.prototype, 'generate', async () => ({ text: scenesJson }));
  const user = await fixtureUser();
  const run = await auto.createAutoVideoRun(user._id, { topic: 'Vì sao bầu trời có màu xanh?', voiceId: String(voice._id) });
  await auto.advanceRun(run);
  const again = await AutoVideoRun.findById(run._id);
  again.step = 'CREATE'; // simulate a crash right after creating the content job
  await auto.advanceRun(again);
  assert.equal(await Job.countDocuments({ ownerId: user._id, type: 'AI_CONTENT' }), 1);
});

test('a failed step stops the run with that step and code', async () => {
  mock.method(GeminiContentProvider.prototype, 'generate', async () => ({ text: scenesJson }));
  const user = await fixtureUser();
  const run = await auto.createAutoVideoRun(user._id, { topic: 'Bí ẩn tam giác quỷ Bermuda', voiceId: String(voice._id) });
  const failed = await drive(run._id, { ttsFail: true });
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.failedStep, 'VOICE');
  assert.equal(failed.error, 'TTS_PROCESSING_FAILED');
  assert.equal(await Job.countDocuments({ ownerId: user._id, type: 'VIDEO_RENDER' }), 0);
});

test('input is validated before anything is charged', async () => {
  const user = await fixtureUser();
  await assert.rejects(() => auto.createAutoVideoRun(user._id, { topic: 'ngắn', voiceId: String(voice._id) }), /AUTO_VIDEO_INVALID_INPUT/);
  await assert.rejects(() => auto.createAutoVideoRun(user._id, { topic: 'Một chủ đề hợp lệ', voiceId: 'x' }), /AUTO_VIDEO_VOICE_REQUIRED/);
  await assert.rejects(() => auto.createAutoVideoRun(user._id, { topic: 'Một chủ đề hợp lệ', voiceId: String(new mongoose.Types.ObjectId()) }), /TTS_VOICE_NOT_FOUND/);
  await assert.rejects(() => auto.createAutoVideoRun(user._id, { topic: 'Một chủ đề hợp lệ', voiceId: String(voice._id), publishYoutube: true }), /YOUTUBE_NOT_CONNECTED/);
  await auto.createAutoVideoRun(user._id, { topic: 'Chủ đề thứ nhất', voiceId: String(voice._id) });
  await auto.createAutoVideoRun(user._id, { topic: 'Chủ đề thứ hai', voiceId: String(voice._id) });
  await assert.rejects(() => auto.createAutoVideoRun(user._id, { topic: 'Chủ đề thứ ba', voiceId: String(voice._id) }), /AUTO_VIDEO_BUSY/);
  assert.equal(await Job.countDocuments({ ownerId: user._id }), 0);
});

test('the ticker leases runs so two ticks do not advance the same run at once', async () => {
  const user = await fixtureUser();
  const run = await auto.createAutoVideoRun(user._id, { topic: 'Chủ đề cho ticker', voiceId: String(voice._id) });
  await AutoVideoRun.updateOne({ _id: run._id }, { $set: { leaseUntil: new Date(Date.now() + 60000) } });
  mock.method(GeminiContentProvider.prototype, 'generate', async () => ({ text: scenesJson }));
  await auto.tickAutoVideos(5);
  assert.equal((await AutoVideoRun.findById(run._id)).step, 'CREATE'); // leased elsewhere: untouched
});

test('details: node states, real stats, scene rows and a bounded newest-first activity log', async () => {
  const { runDetails } = require('../dist/services/AutoVideoDetails');
  mock.method(GeminiContentProvider.prototype, 'generate', async () => ({ text: scenesJson }));
  const user = await fixtureUser();
  const run = await auto.createAutoVideoRun(user._id, { topic: 'Chi tiết thẻ workflow', voiceId: String(voice._id) });
  const queued = await runDetails(run);
  assert.equal(queued.nodes.write.status, 'RUNNING');
  assert.equal(queued.nodes.voice.status, 'PENDING');
  assert.equal(queued.nodes.publish.status, 'SKIPPED');
  const done = await runDetails(await drive(run._id));
  assert.deepEqual(['write', 'voice', 'render'].map((k) => done.nodes[k].status), ['DONE', 'DONE', 'DONE']);
  assert.equal(done.nodes.write.stats.scenes, 3);
  assert.ok(done.nodes.write.stats.words > 10);
  assert.equal(done.nodes.voice.done, 3);
  assert.equal(done.nodes.voice.stats.audioSeconds, 3);
  assert.equal(done.nodes.render.stats.width, 1080);
  assert.equal(done.voiceName, 'Fixture');
  assert.ok(done.scenes.every((s) => s.status === 'COMPLETED' && s.audioSeconds === 1 && s.audioUrl.startsWith('/api/media/')));
  assert.ok(done.events.length <= 12);
  assert.ok(done.events.every((e) => ['ai', 'model', 'image', 'voice', 'render', 'publish', 'system'].includes(e.cat)));
  assert.ok(done.eventsTotal >= done.events.length);
  for (let i = 1; i < done.events.length; i++) assert.ok(done.events[i - 1].at >= done.events[i].at);
  assert.equal(done.events[0].text, 'Workflow hoàn tất');

  const failedRun = await auto.createAutoVideoRun((await fixtureUser())._id, { topic: 'Chi tiết khi lỗi', voiceId: String(voice._id) });
  const failed = await runDetails(await drive(failedRun._id, { ttsFail: true }));
  assert.equal(failed.nodes.write.status, 'DONE');
  assert.equal(failed.nodes.voice.status, 'FAILED');
  assert.equal(failed.nodes.voice.error, 'TTS_PROCESSING_FAILED');
  assert.equal(failed.nodes.render.status, 'PENDING');
  assert.equal(failed.events[0].kind, 'fail');
});

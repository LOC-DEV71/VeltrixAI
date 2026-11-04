const { test, before, after, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
process.env.NODE_ENV = 'test';
process.env.AI_PROVIDER = 'gemini';
process.env.GEMINI_API_KEY = 'unit-test-provider-key'; // provider mocked, never real inference
process.env.IMAGE_GEN_ASSUME_READY = '1'; // the Python worker is replaced by a fake runner
const mongoose = require('mongoose');
const crypto = require('crypto');
const { mkdtempSync, rmSync, writeFileSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { User } = require('../dist/models/User');
const { Workspace } = require('../dist/models/Workspace');
const { Project } = require('../dist/models/Project');
const { Job } = require('../dist/models/Job');
const { Scene } = require('../dist/models/Scene');
const { Voice } = require('../dist/models/Voice');
const { MediaAsset } = require('../dist/models/MediaAsset');
const { Video } = require('../dist/models/Video');
const { AutoVideoRun } = require('../dist/models/AutoVideoRun');
const { SceneImage, ImageGenStat } = require('../dist/models/SceneImage');
const { Wallet, CreditLot, CreditLedger, CreditReservation } = require('../dist/models/Credits');
const { savePlan, seedConfig } = require('../dist/services/PlanService');
const { CreditService } = require('../dist/services/CreditService');
const { GeminiContentProvider } = require('../dist/providers/AiProvider');
const { processContentJob } = require('../dist/workers/ContentWorker');
const { claimVideoJob, processVideoJob } = require('../dist/workers/VideoWorker');
const { claimImageJob, processImageJob } = require('../dist/workers/ImageWorker');
const images = require('../dist/services/ImageGenService');
const auto = require('../dist/services/AutoVideoService');

let replica, storageDir, workRoot, imageDir, voice;
before(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replica.getUri());
  await Promise.all([User, Job, Scene, Voice, MediaAsset, Video, AutoVideoRun, SceneImage, ImageGenStat, Wallet, CreditLot, CreditLedger, CreditReservation].map((m) => m.init()));
  await savePlan('PRO', seedConfig('PRO'), 0, null, 'Image fixtures', true);
  voice = await Voice.create({ provider: 'VIENEU_LOCAL', providerVoiceId: 'img-fixture', name: 'Fixture', language: 'vi-VN', gender: 'male', planEntitlements: ['*'], status: 'ACTIVE', isSystem: true });
  storageDir = mkdtempSync(join(tmpdir(), 'img-store-'));
  workRoot = mkdtempSync(join(tmpdir(), 'img-work-'));
  imageDir = mkdtempSync(join(tmpdir(), 'img-cache-'));
  process.env.IMAGE_GEN_CACHE_DIR = imageDir;
});
after(async () => { await mongoose.disconnect(); await replica?.stop(); for (const d of [storageDir, workRoot, imageDir]) rmSync(d, { recursive: true, force: true }); });
afterEach(() => mock.restoreAll());

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');

async function project(prompts) {
  const user = await User.create({ email: crypto.randomUUID() + '@example.invalid', displayName: 'Image test', plan: 'PRO' });
  const workspace = await Workspace.create({ ownerId: user._id, name: 'W' });
  const p = await Project.create({ workspaceId: workspace._id, name: 'P' });
  const scenes = [];
  for (const [i, imagePrompt] of prompts.entries()) {
    scenes.push(await Scene.create({ projectId: p._id, order: i + 1, title: `Cảnh ${i + 1}`, narration: `Lời đọc cảnh ${i + 1}.`, visualDescription: 'x', imagePrompt, estimatedDuration: 2, sourceContentRevision: 1 }));
  }
  return { user, project: p, scenes };
}

/** Fake generate.py: answers each item with the given outcome. */
const fakeRunner = (outcome = () => 'ok') => async (args, onEvent, signal) => {
  const job = JSON.parse(readFileSync(args[1], 'utf8'));
  onEvent({ type: 'loading', preset: job.preset });
  onEvent({ type: 'loaded', preset: job.preset, seconds: 3 });
  for (const [i, item] of job.items.entries()) {
    const result = outcome(item, i);
    if (result === 'hang') { await new Promise((ok) => signal.addEventListener('abort', ok, { once: true })); return 1; }
    if (result === 'error') { onEvent({ type: 'error', id: item.id, code: 'IMAGE_GENERATION_FAILED', preset: job.preset }); continue; }
    const path = join(imageDir, `${crypto.randomUUID()}.png`);
    writeFileSync(path, PNG);
    const downgraded = result === 'downgrade';
    if (downgraded) onEvent({ type: 'downgrade', id: item.id, fromPreset: job.preset, toPreset: 'fast', reason: 'OOM' });
    onEvent({ type: 'image', id: item.id, path, seconds: 12, preset: downgraded ? 'fast' : job.preset, cached: false, seed: item.seed, downgradedFrom: downgraded ? job.preset : null });
  }
  onEvent({ type: 'done', failures: 0, peakVramMB: 5100, peakRamMB: 7000, minFreeRamMB: 2000 });
  return 0;
};
const noUnload = async () => 'NOT_LOCAL';

test('jobs skip scenes without a prompt and give every scene the video seed plus its order', async () => {
  const { user, project: p, scenes } = await project(['A red planet at dawn', '', 'Ocean waves at night']);
  const job = await images.createImageJob({ ownerId: user._id, projectId: p._id, preset: 'balanced' });
  assert.deepEqual(job.payload.sceneIds, [String(scenes[0]._id), String(scenes[2]._id)]);
  const rows = await SceneImage.find({ projectId: p._id }).sort({ order: 1 }).lean();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].seed, images.baseSeed(p._id) + 1);
  assert.equal(rows[1].seed, images.baseSeed(p._id) + 3);
  await assert.rejects(() => images.createImageJob({ ownerId: user._id, projectId: p._id, preset: 'balanced' }), /IMAGE_ALREADY_GENERATING/);
  const empty = await project(['', '']);
  assert.equal(await images.createImageJob({ ownerId: empty.user._id, projectId: empty.project._id, preset: 'fast' }), null);
  assert.throws(() => images.validPreset('nope'), /IMAGE_PRESET_UNKNOWN/);
  assert.throws(() => images.validPreset('cloud'), /IMAGE_PRESET_UNAVAILABLE/); // no FAL_KEY in tests
});

test('worker records ready, failed and downgraded images, timings and peaks', async () => {
  const { user, project: p } = await project(['one', 'two', 'three']);
  const job = await images.createImageJob({ ownerId: user._id, projectId: p._id, preset: 'quality' });
  const claimed = await claimImageJob(String(job._id));
  await processImageJob(claimed, { run: fakeRunner((_, i) => (i === 1 ? 'error' : i === 2 ? 'downgrade' : 'ok')), unloadAi: noUnload });
  const done = await Job.findById(job._id).lean();
  assert.equal(done.status, 'COMPLETED');
  assert.equal(done.result.ready, 2);
  assert.equal(done.result.failed, 1);
  assert.equal(done.result.peakVramMB, 5100);
  const rows = await SceneImage.find({ projectId: p._id }).sort({ order: 1 }).lean();
  assert.deepEqual(rows.map((r) => r.status), ['READY', 'FAILED', 'READY']);
  assert.equal(rows[2].preset, 'fast');
  assert.equal(rows[2].downgradedFrom, 'quality');
  assert.ok((await ImageGenStat.findOne({ preset: 'quality' })).avgSeconds > 0);
  // Measured averages replace the default estimate.
  mock.method(images, 'presetStatus', async () => ({}));
  const list = await images.listPresets();
  assert.equal(list.default, 'balanced');
  assert.ok(!list.presets.some((x) => x.id === 'cloud')); // hidden without FAL_KEY
});

test('a stuck image is killed and marked as timed out; the rest still run', async () => {
  const { user, project: p } = await project(['one', 'two']);
  const job = await images.createImageJob({ ownerId: user._id, projectId: p._id, preset: 'fast' });
  let calls = 0;
  const run = async (args, onEvent, signal) => { calls++; return fakeRunner((_, i) => (calls === 1 && i === 0 ? 'hang' : 'ok'))(args, onEvent, signal); };
  await processImageJob(await claimImageJob(String(job._id)), { run, stallSeconds: () => 1, unloadAi: noUnload });
  const rows = await SceneImage.find({ projectId: p._id }).sort({ order: 1 }).lean();
  assert.deepEqual(rows.map((r) => [r.status, r.error]), [['FAILED', 'IMAGE_TIMEOUT'], ['READY', null]]);
  assert.equal(calls, 2);
});

test('cancel stops the job; unfinished scenes are skipped and fall back', async () => {
  const { user, project: p } = await project(['one', 'two']);
  const job = await images.createImageJob({ ownerId: user._id, projectId: p._id, preset: 'fast' });
  const claimed = await claimImageJob(String(job._id));
  const run = async (args, onEvent, signal) => {
    setTimeout(() => images.cancelImageJob(user._id, job._id), 50);
    return fakeRunner(() => 'hang')(args, onEvent, signal);
  };
  await processImageJob(claimed, { run, unloadAi: noUnload });
  const done = await Job.findById(job._id).lean();
  assert.equal(done.result.cancelled, true);
  assert.deepEqual((await SceneImage.find({ projectId: p._id }).lean()).map((r) => r.status), ['SKIPPED', 'SKIPPED']);
});

test('edited prompts stay on the image, never on the scene (voice audio stays valid)', async () => {
  const { user, project: p, scenes } = await project(['original prompt']);
  const job = await images.createImageJob({ ownerId: user._id, projectId: p._id, preset: 'fast' });
  await processImageJob(await claimImageJob(String(job._id)), { run: fakeRunner(), unloadAi: noUnload });
  await images.editImagePrompt(user._id, String(scenes[0]._id), 'A brand new prompt');
  const again = await images.createImageJob({ ownerId: user._id, projectId: p._id, preset: 'fast', regenerate: true });
  assert.ok(again);
  const row = await SceneImage.findOne({ sceneId: scenes[0]._id }).lean();
  assert.equal(row.prompt, 'A brand new prompt');
  assert.equal(row.attempt, 1);
  assert.equal(row.seed, images.baseSeed(p._id) + 1 + 7919); // new seed on "Tạo lại"
  const scene = await Scene.findById(scenes[0]._id).lean();
  assert.equal(scene.imagePrompt, 'original prompt');
  assert.equal(scene.revision, 0);
});

// ---- Full auto run with the IMAGES step ----
const wav = (seconds) => {
  const rate = 24000, data = Buffer.alloc(Math.floor(seconds * rate) * 2), h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
};
const audioStore = new Map();
async function fakeTts() {
  for (const job of await Job.find({ type: 'TTS', status: 'QUEUED' })) {
    const audio = wav(1);
    const asset = await MediaAsset.create({ ownerId: job.ownerId, projectId: job.payload.projectId, sceneId: job.payload.sceneId, jobId: job._id, publicId: `test/${job._id}`, cloudinaryAssetId: 'a', deliveryType: 'authenticated', resourceType: 'video', format: 'wav', bytes: audio.length, duration: 1, sampleRate: 24000, channels: 1, sha256: crypto.createHash('sha256').update(audio).digest('hex') });
    audioStore.set(asset.publicId, audio);
    await Scene.updateOne({ _id: job.payload.sceneId }, { $set: { ttsAudioId: asset._id, voiceId: job.payload.voiceId } });
    await CreditService.settle(job._id, job.payload.cost);
    await Job.updateOne({ _id: job._id }, { $set: { status: 'COMPLETED', result: { audioId: asset._id } } });
  }
}
let lastManifest = null;
const fakeRender = async (manifestPath) => {
  const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
  lastManifest = m;
  writeFileSync(m.outputPath, Buffer.from('mp4'));
  return { bytes: 3, durationInFrames: m.scenes.reduce((s, x) => s + Math.ceil(x.audioSeconds * 30) + 6, 0) };
};
const scriptJson = JSON.stringify([1, 2, 3].map((n) => ({
  title: `Cảnh ${n}`, narration: `Lời đọc cảnh ${n} về sao Hỏa và những cơn bão bụi khổng lồ.`, visualDescription: 'Sao Hỏa', estimatedDuration: 8,
  imagePrompt: n === 2 ? '' : `Mars dust storm, scene ${n}`, videoPrompt: n === 1 ? 'slow push in' : 'camera pans left',
})));

test('auto run: script -> storyboard -> images -> voice -> render, AI images become backgrounds', async () => {
  let storyboardCalls = 0;
  const hooks = [];
  mock.method(GeminiContentProvider.prototype, 'generate', async (request) => {
    if (/đạo diễn motion graphics/.test(request.instruction)) { storyboardCalls++; return { text: 'not json' }; }
    return { text: scriptJson };
  });
  const user = await User.create({ email: crypto.randomUUID() + '@example.invalid', displayName: 'Auto image', plan: 'PRO' });
  const wallet = await Wallet.create({ userId: user._id, bucket: 'PAID', available: 5000, reserved: 0 });
  await CreditLot.create({ walletId: wallet._id, amount: 5000, available: 5000, source: 'ADMIN', expiresAt: new Date(Date.now() + 86400000) });
  const run = await auto.createAutoVideoRun(user._id, { topic: 'Bão bụi trên sao Hỏa', voiceId: String(voice._id), imagePreset: 'balanced' });
  assert.equal(run.input.imagePreset, 'balanced');
  const steps = [];
  for (let i = 0; i < 25; i++) {
    const current = await AutoVideoRun.findById(run._id);
    if (current.status !== 'RUNNING') break;
    if (steps[steps.length - 1] !== current.step) steps.push(current.step);
    await auto.advanceRun(current);
    const content = await Job.findOne({ type: 'AI_CONTENT', status: 'QUEUED' });
    if (content) await processContentJob({ data: { jobId: String(content._id) } });
    const imageJob = await claimImageJob();
    if (imageJob) await processImageJob(imageJob, { run: fakeRunner((item) => { if (item.hook) hooks.push(item.hook); return 'ok'; }), unloadAi: noUnload });
    await fakeTts();
    const video = await claimVideoJob();
    if (video) await processVideoJob(video, { audio: async (a) => audioStore.get(a.publicId), ai: null, stock: null, render: fakeRender, storageDir, workRoot });
  }
  const done = await AutoVideoRun.findById(run._id);
  assert.equal(done.status, 'COMPLETED', done.error);
  assert.deepEqual(steps.filter((s) => s !== 'CREATE'), ['WRITE', 'IMAGES', 'VOICE', 'RENDER']);
  // The storyboard is planned once after writing (here: retried then heuristic) and reused by the render.
  assert.equal(storyboardCalls, 3);
  assert.ok((await Scene.find({ projectId: done.projectId }).lean()).every((s) => s.storyboard && s.storyboardRevision === s.revision));
  assert.deepEqual(lastManifest.scenes.map((s) => s.background.kind), ['image', 'gradient', 'image']); // scene 2 has no prompt
  assert.equal(lastManifest.scenes[0].scene.videoPrompt, 'slow push in');
  // The mocked LLM gives no valid theme, so the topic's keywords decide ("sao Hỏa" -> cosmic).
  assert.equal(lastManifest.theme, 'cosmic');
  assert.ok(Number.isInteger(lastManifest.seed));
  assert.equal(done.resolvedTheme, 'cosmic');
  assert.equal(done.themeSource, 'keywords');
  const video = await Video.findById(done.videoId).lean();
  assert.deepEqual(video.scenes.map((s) => s.imageSource), ['AI_IMAGE', 'GENERATED', 'AI_IMAGE']);
  const { runDetails } = require('../dist/services/AutoVideoDetails');
  const details = await runDetails(done);
  assert.equal(details.nodes.images.status, 'DONE');
  assert.equal(details.nodes.images.ready, 3); // 2 scenes + the dedicated thumbnail
  assert.ok(details.scenes[0].image.url.startsWith('/api/images/'));
  // Only the thumbnail carries the hook, which generate.py draws on it as a banner.
  assert.equal(hooks.length, 1);
  assert.equal(hooks[0], done.thumbnailHook);
  assert.ok(done.thumbnailHook.length > 0 && done.thumbnailHook.length <= 40);
  assert.match(done.thumbnailPrompt, /no text/);
  assert.equal(details.scenes[1].image, null);
  // Finished: images can be regenerated again, then "Dựng lại video" renders a new video.
  assert.equal(details.nodes.images.canEdit, true);
  assert.equal(details.nodes.images.canRerender, true);
  const again = await auto.rerenderAutoVideoRun(user._id, String(done._id));
  assert.equal(again.step, 'RENDER');
  for (let i = 0; i < 6; i++) {
    const current = await AutoVideoRun.findById(run._id);
    if (current.status !== 'RUNNING') break;
    await auto.advanceRun(current);
    const v = await claimVideoJob();
    if (v) await processVideoJob(v, { audio: async (a) => audioStore.get(a.publicId), ai: null, stock: null, render: fakeRender, storageDir, workRoot });
  }
  const rerendered = await AutoVideoRun.findById(run._id);
  assert.equal(rerendered.status, 'COMPLETED');
  assert.notEqual(String(rerendered.videoId), String(done.videoId));
  await assert.rejects(auto.rerenderAutoVideoRun(user._id, String(crypto.randomUUID().replace(/-/g, '').slice(0, 24))), /NOT_FOUND/);
});

test('auto run with images off skips the step', async () => {
  mock.method(GeminiContentProvider.prototype, 'generate', async () => ({ text: scriptJson }));
  const user = await User.create({ email: crypto.randomUUID() + '@example.invalid', displayName: 'Auto off', plan: 'PRO' });
  const wallet = await Wallet.create({ userId: user._id, bucket: 'PAID', available: 5000, reserved: 0 });
  await CreditLot.create({ walletId: wallet._id, amount: 5000, available: 5000, source: 'ADMIN', expiresAt: new Date(Date.now() + 86400000) });
  const run = await auto.createAutoVideoRun(user._id, { topic: 'Bão bụi trên sao Hỏa', voiceId: String(voice._id), imagePreset: 'off' });
  for (let i = 0; i < 6; i++) {
    const current = await AutoVideoRun.findById(run._id);
    await auto.advanceRun(current);
    const content = await Job.findOne({ type: 'AI_CONTENT', status: 'QUEUED' });
    if (content) await processContentJob({ data: { jobId: String(content._id) } });
  }
  const current = await AutoVideoRun.findById(run._id);
  assert.equal(current.step, 'VOICE');
  assert.equal(await Job.countDocuments({ type: 'IMAGE_GEN', 'payload.projectId': current.projectId }), 0);
});

// ---- Real archival photos (services/RealPhotos.ts) ----
const commonsFetch = (calls = []) => async (url) => {
  const u = String(url); calls.push(u);
  const json = (body) => ({ ok: true, status: 200, headers: new Map(), json: async () => body });
  const page = (title, license, w = 900, h = 1200) => ({ title, imageinfo: [{ thumburl: `https://upload.example/${encodeURIComponent(title)}.jpg`, width: w, height: h, mime: 'image/jpeg', descriptionurl: `https://commons.example/${encodeURIComponent(title)}`, extmetadata: { LicenseShortName: { value: license }, Artist: { value: '<a href="x">Agence Meurisse</a>' } } }] });
  if (u.includes('wbsearchentities')) return json({ search: [{ id: 'Q36014', label: 'Ho Chi Minh' }] });
  if (u.includes('wbgetentities')) return json({ entities: { Q36014: { claims: { P18: [{ mainsnak: { datavalue: { value: 'Ho Chi Minh 1946.jpg' } } }], P373: [{ mainsnak: { datavalue: { value: 'Ho Chi Minh' } } }] } } } });
  if (u.includes('titles=File')) return json({ query: { pages: [page('File:Ho Chi Minh 1946.jpg', 'Public domain', 282, 383)] } });
  if (u.includes('categorymembers')) return json({ query: { pages: [
    page('File:Calliandra surinamensis 02.JPG', 'CC BY-SA 3.0'), // loosely related: no name in title
    page('File:Ho-chi-Minh with children (1).jpg', 'Public domain'),
    page('File:Ho Chi Minh portrait (copyrighted).jpg', 'All rights reserved'), // not free
    page('File:Ho Chi Minh signature.png', 'Public domain'), // not a photo
  ] } });
  if (u.startsWith('https://upload.example/')) return { ok: true, status: 200, headers: new Map(), arrayBuffer: async () => Buffer.alloc(5000, 7) };
  return { ok: false, status: 404, headers: new Map(), json: async () => ({}) };
};

test('real photos: Wikidata entity first, only free licenses, unrelated category files dropped', async () => {
  const { searchCommons } = require('../dist/services/RealPhotos');
  const photos = await searchCommons('Ho Chi Minh', commonsFetch());
  assert.deepEqual(photos.map((p) => p.title), ['File:Ho Chi Minh 1946.jpg', 'File:Ho-chi-Minh with children (1).jpg']);
  assert.equal(photos[0].artist, 'Agence Meurisse');
});

test('real photos attach to scenes naming a subject, never over an image the user already has', async () => {
  const { attachRealPhotos } = require('../dist/services/RealPhotos');
  const { user, project: p, scenes } = await project(['portrait', 'city', 'kept']);
  await Scene.updateOne({ _id: scenes[0]._id }, { $set: { storyboard: { subject: 'Ho Chi Minh' } } });
  await Scene.updateOne({ _id: scenes[1]._id }, { $set: { storyboard: { subject: '' } } });
  await Scene.updateOne({ _id: scenes[2]._id }, { $set: { storyboard: { subject: 'Ho Chi Minh' } } });
  await SceneImage.create({ ownerId: user._id, projectId: p._id, sceneId: scenes[2]._id, order: 3, status: 'READY', prompt: 'kept', preset: 'fast', seed: 1, file: join(imageDir, 'kept.png') });
  assert.equal(await attachRealPhotos(p._id, user._id, commonsFetch()), 1);
  const real = await SceneImage.findOne({ sceneId: scenes[0]._id }).lean();
  assert.equal(real.preset, 'wikimedia');
  assert.match(real.credit, /Agence Meurisse \/ Wikimedia Commons \(Public domain\)/);
  assert.ok(readFileSync(real.file).length === 5000);
  assert.equal(await SceneImage.countDocuments({ sceneId: scenes[1]._id }), 0);
  assert.equal((await SceneImage.findOne({ sceneId: scenes[2]._id }).lean()).preset, 'fast');
  // The AI image job leaves the real photo alone unless that scene is regenerated.
  const { createImageJob } = require('../dist/services/ImageGenService');
  const job = await createImageJob({ ownerId: user._id, projectId: p._id, preset: 'fast' });
  assert.ok(!job || !job.payload.sceneIds.includes(String(scenes[0]._id)));
});

// ---- "Dừng" (cancelAutoVideoRun) ----
async function stoppableRun(label) {
  mock.method(GeminiContentProvider.prototype, 'generate', async (request) => (/đạo diễn motion graphics/.test(request.instruction) ? { text: 'not json' } : { text: scriptJson }));
  const user = await User.create({ email: crypto.randomUUID() + '@example.invalid', displayName: label, plan: 'PRO' });
  const wallet = await Wallet.create({ userId: user._id, bucket: 'PAID', available: 5000, reserved: 0 });
  await CreditLot.create({ walletId: wallet._id, amount: 5000, available: 5000, source: 'ADMIN', expiresAt: new Date(Date.now() + 86400000) });
  const run = await auto.createAutoVideoRun(user._id, { topic: 'Bão bụi trên sao Hỏa', voiceId: String(voice._id), imagePreset: 'off' });
  return { user, wallet, run };
}
const advanceUntil = async (runId, step, onTick = async () => {}) => {
  for (let i = 0; i < 20; i++) {
    const current = await AutoVideoRun.findById(runId);
    if (current.step === step || current.status !== 'RUNNING') return current;
    await auto.advanceRun(current);
    const content = await Job.findOne({ type: 'AI_CONTENT', status: 'QUEUED' });
    if (content) await processContentJob({ data: { jobId: String(content._id) } });
    await onTick();
  }
  return AutoVideoRun.findById(runId);
};

test('Dừng while voices are queued: jobs cancelled, credits released, "Chạy tiếp" resumes and finishes', async () => {
  const { user, wallet, run } = await stoppableRun('Stop voice');
  let current = await advanceUntil(run._id, 'VOICE');
  await auto.advanceRun(current); // queues the TTS jobs
  current = await AutoVideoRun.findById(run._id);
  assert.ok(current.ttsJobIds.length > 0);
  const heldBefore = (await Wallet.findById(wallet._id)).reserved;
  assert.ok(heldBefore > 0);

  const { run: stopped, stopped: count } = await auto.cancelAutoVideoRun(user._id, String(run._id));
  assert.equal(stopped.status, 'FAILED');
  assert.equal(stopped.error, 'AUTO_VIDEO_CANCELLED');
  assert.equal(stopped.failedStep, 'VOICE');
  assert.equal(count, current.ttsJobIds.length);
  assert.equal(await Job.countDocuments({ _id: { $in: current.ttsJobIds }, status: 'CANCELLED' }), current.ttsJobIds.length);
  assert.equal((await Wallet.findById(wallet._id)).reserved, 0);
  await assert.rejects(auto.cancelAutoVideoRun(user._id, String(run._id)), /AUTO_VIDEO_NOT_RUNNING/);
  // The orchestrator leaves a stopped run alone.
  await auto.advanceRun(await AutoVideoRun.findById(run._id));
  assert.equal((await AutoVideoRun.findById(run._id)).status, 'FAILED');

  // "Chạy tiếp": continues from VOICE (script is not rewritten) and completes.
  const contentJobs = await Job.countDocuments({ type: 'AI_CONTENT', ownerId: user._id });
  const resumed = await auto.retryAutoVideoRun(user._id, String(run._id));
  assert.equal(resumed.step, 'VOICE');
  const finished = await advanceUntil(run._id, '__never__', async () => {
    await fakeTts();
    const v = await claimVideoJob();
    if (v) await processVideoJob(v, { audio: async (a) => audioStore.get(a.publicId), ai: null, stock: null, render: fakeRender, storageDir, workRoot });
  });
  assert.equal(finished.status, 'COMPLETED', finished.error);
  assert.equal(await Job.countDocuments({ type: 'AI_CONTENT', ownerId: user._id }), contentJobs);
});

test('Dừng during the render aborts the renderer and releases the render credits', async () => {
  const { user, wallet, run } = await stoppableRun('Stop render');
  let current = await advanceUntil(run._id, 'RENDER', fakeTts);
  await auto.advanceRun(current); // queues the render
  const job = await claimVideoJob();
  assert.ok(job);
  let aborted = false;
  const hangingRender = (_m, _p, signal) => new Promise((_, fail) => signal.addEventListener('abort', () => { aborted = true; fail(Object.assign(new Error('x'), { code: 'VIDEO_CANCELLED' })); }, { once: true }));
  const rendering = processVideoJob(job, { audio: async (a) => audioStore.get(a.publicId), ai: null, stock: null, render: hangingRender, storageDir, workRoot });
  await new Promise((ok) => setTimeout(ok, 300));
  await auto.cancelAutoVideoRun(user._id, String(run._id));
  await rendering;
  assert.equal(aborted, true);
  const failed = await Job.findById(job._id).lean();
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.error, 'VIDEO_CANCELLED');
  assert.equal((await Wallet.findById(wallet._id)).reserved, 0);
});

test('Đổi giọng: a finished video is read again with the new voice and rendered again; same voice is refused', async () => {
  const { user, run } = await stoppableRun('Revoice');
  const tick = async () => {
    await fakeTts();
    const v = await claimVideoJob();
    if (v) await processVideoJob(v, { audio: async (a) => audioStore.get(a.publicId), ai: null, stock: null, render: fakeRender, storageDir, workRoot });
  };
  const first = await advanceUntil(run._id, '__never__', tick);
  assert.equal(first.status, 'COMPLETED', first.error);
  const oldAudio = (await Scene.find({ projectId: first.projectId }).sort({ order: 1 }).lean()).map((s) => String(s.ttsAudioId));
  const other = await Voice.create({ provider: 'VIENEU_LOCAL', providerVoiceId: 'img-fixture-2', name: 'Fixture 2', language: 'vi-VN', gender: 'female', planEntitlements: ['*'], status: 'ACTIVE', isSystem: true });

  await assert.rejects(auto.revoiceAutoVideoRun(user._id, String(run._id), String(voice._id)), /AUTO_VIDEO_SAME_VOICE/);
  const started = await auto.revoiceAutoVideoRun(user._id, String(run._id), String(other._id));
  assert.equal(started.step, 'VOICE');
  assert.equal(started.ttsJobIds.length, 0);
  await assert.rejects(auto.revoiceAutoVideoRun(user._id, String(run._id), String(voice._id)), /AUTO_VIDEO_NOT_FINISHED/); // running now

  const done = await advanceUntil(run._id, '__never__', tick);
  assert.equal(done.status, 'COMPLETED', done.error);
  assert.equal(String(done.input.voiceId), String(other._id));
  assert.notEqual(String(done.videoId), String(first.videoId));
  const ttsJobs = await Job.find({ _id: { $in: done.ttsJobIds } }).lean();
  assert.equal(ttsJobs.length, oldAudio.length);
  assert.ok(ttsJobs.every((j) => String(j.payload.voiceId) === String(other._id)));
  const newAudio = (await Scene.find({ projectId: done.projectId }).sort({ order: 1 }).lean()).map((s) => String(s.ttsAudioId));
  assert.ok(newAudio.every((id, i) => id !== oldAudio[i]));
});

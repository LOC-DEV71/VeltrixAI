// Full local acceptance: real Python model, real Mongo transactions, real Cloudinary,
// protected HTTP playback, and a separate Node worker. Never print credentials/log bodies.
const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const net = require('node:net');
const assert = require('node:assert/strict');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
const mongoose = require('mongoose');
const express = require('express');
const cookieParser = require('cookie-parser');
const { User } = require('../dist/models/User');
const { Session } = require('../dist/models/Session');
const { Workspace } = require('../dist/models/Workspace');
const { Project } = require('../dist/models/Project');
const { Scene } = require('../dist/models/Scene');
const { Job } = require('../dist/models/Job');
const { MediaAsset } = require('../dist/models/MediaAsset');
const { Wallet, CreditLot, CreditReservation, CreditLedger } = require('../dist/models/Credits');
const { signAccessToken } = require('../dist/utils/jwt');
const { inspectWave } = require('../dist/providers/AudioValidation');
const { CloudinaryAudioProvider, getCloudinaryConfiguration } = require('../dist/providers/CloudinaryAudioProvider');
const { CreditService } = require('../dist/services/CreditService');
const { Voice } = require('../dist/models/Voice');
const { seedSystemVoices } = require('../dist/scripts/seedSystemVoices');
const root = path.resolve(__dirname, '../../..');
const output = path.join(root, 'services/tts/offline-output/ag019');
const delay = ms => new Promise(done => { const timer = setTimeout(done, ms); timer.unref(); });
const children = [];
const owners = []; const wallets = []; const jobs = [];
const fixtureVoices = [];
let server; let cloudinary; let pythonOutput = ''; let currentStage = 'initializing';
const report = { full_flow_pass: false, checks: {} };
async function port() {
  const server = net.createServer();
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const number = server.address().port;
  await new Promise(done => server.close(done));
  return number;
}
function child(executable, args, cwd, env) {
  const process = spawn(executable, args, { cwd, env: { ...global.process.env, ...env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(process);
  return process;
}
async function stop(process) {
  if (process.exitCode !== null) return;
  if (global.process.platform === 'win32') {
    // The Windows venv launcher starts a base-Python child: stop our whole test tree.
    const killer = spawn('taskkill.exe', ['/PID', String(process.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    await new Promise(done => killer.once('exit', done));
  } else process.kill();
  await Promise.race([new Promise(done => process.once('exit', done)), delay(3000)]);
  if (process.exitCode === null) process.kill('SIGKILL');
}
async function worker(jobId, url) {
  const process = child(global.process.execPath, [path.join(root, 'apps/backend-api/dist/workers/tts.js'), '--job-id', jobId], path.join(root, 'apps/backend-api'), { TTS_SERVICE_URL: url });
  let logs = '';
  process.stdout.on('data', data => { logs += data; }); process.stderr.on('data', data => { logs += data; });
  const exit = await Promise.race([new Promise(done => process.once('exit', done)), delay(240000).then(() => 'timeout')]);
  if (exit !== 0) { await stop(process); throw new Error('WORKER_ACCEPTANCE_FAILED'); }
  assert.ok(!logs.includes(global.process.env.TTS_SERVICE_TOKEN));
}
async function run() {
  await fs.mkdir(output, { recursive: true });
  currentStage = 'cloudinary_configuration';
  cloudinary = new CloudinaryAudioProvider(getCloudinaryConfiguration());
  process.env.TTS_SERVICE_TOKEN = crypto.randomBytes(32).toString('hex');
  const pythonPort = await port();
  process.env.TTS_SERVICE_URL = `http://127.0.0.1:${pythonPort}`;
  currentStage = 'python_startup';
  const python = child(path.join(root, 'services/tts/.venv/Scripts/python.exe'), ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', String(pythonPort), '--no-access-log'], path.join(root, 'services/tts'), { PYTHONUTF8: '1', TTS_BUNDLE_PATH: path.join(root, 'services/tts/artifacts') });
  python.stdout.on('data', data => { pythonOutput += data; }); python.stderr.on('data', data => { pythonOutput += data; });
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (python.exitCode !== null) throw new Error('PYTHON_STARTUP_FAILED');
    try { ready = (await fetch(process.env.TTS_SERVICE_URL + '/health/ready', { signal: AbortSignal.timeout(1000) })).ok; } catch {}
    if (ready) break;
    await delay(1000);
  }
  assert.ok(ready, 'Python startup timed out'); report.checks.real_tts_ready = true;
  const denied = await fetch(process.env.TTS_SERVICE_URL + '/synthesize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'No worker token' }) });
  assert.equal(denied.status, 401); report.checks.direct_client_rejected = true;
  currentStage = 'mongo_fixture';
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  const defaultVoice = await seedSystemVoices();
  const seedReplay = await seedSystemVoices();
  assert.equal(String(seedReplay._id), String(defaultVoice._id));
  assert.equal(await Voice.countDocuments({ provider: 'VIENEU_LOCAL', providerVoiceId: 'Hải Đăng' }), 1);
  assert.equal(defaultVoice.status, 'ACTIVE'); report.checks.system_voice_seed_idempotent = true;
  await Promise.all([User, Session, Workspace, Project, Scene, Job, MediaAsset, Wallet, CreditLot, CreditReservation, CreditLedger].map(model => model.init()));
  const owner = await User.create({ email: `ag018-${crypto.randomUUID()}@example.invalid`, displayName: 'AG018 test' }); owners.push(owner._id);
  const foreign = await User.create({ email: `ag018-${crypto.randomUUID()}@example.invalid`, displayName: 'AG018 foreign test' }); owners.push(foreign._id);
  const workspace = await Workspace.create({ ownerId: owner._id, name: 'AG018 temporary fixture' });
  const project = await Project.create({ workspaceId: workspace._id, name: 'AG018 temporary fixture' });
  const makeScene = () => Scene.create({ projectId: project._id, order: 1, title: 'TTS acceptance', narration: 'Xin chào, đây là audio được tạo bởi Worker và dịch vụ TTS chạy trên máy local.', visualDescription: 'Acceptance fixture', estimatedDuration: 5, sourceContentRevision: 1, revision: 0 });
  const scene = await makeScene();
  const wallet = await Wallet.create({ userId: owner._id, bucket: 'FREE', available: 100000, reserved: 0 }); wallets.push(wallet._id);
  await CreditLot.create({ walletId: wallet._id, amount: 100000, available: 100000, expiresAt: new Date(Date.now() + 86400000) });
  async function cookie(user) {
    const session = await Session.create({ userId: user._id, tokenFamily: crypto.randomUUID(), refreshTokenHash: crypto.randomBytes(32).toString('hex'), expiresAt: new Date(Date.now() + 3600000) });
    return `accessToken=${signAccessToken({ sessionId: session._id, userId: user._id })}; csrfToken=ag018-csrf`;
  }
  const ownerCookie = await cookie(owner); const foreignCookie = await cookie(foreign);
  const app = express(); app.use(express.json()); app.use(cookieParser());
  app.use('/api/scenes', require('../dist/routes/scenes').default);
  app.use('/api/jobs', require('../dist/routes/jobs').default);
  app.use('/api/media', require('../dist/routes/media').default);
  app.use('/api/voices', require('../dist/routes/voices').default);
  server = await new Promise(done => { const instance = app.listen(0, '127.0.0.1', () => done(instance)); });
  const api = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'Content-Type': 'application/json', Cookie: ownerCookie, 'x-csrf-token': 'ag018-csrf', 'Idempotency-Key': crypto.randomUUID() };
  let selectedVoiceId = String(defaultVoice._id);
  const post = (id, extra = {}) => fetch(`${api}/api/scenes/${id}/tts`, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify({ voiceId: selectedVoiceId }) });
  assert.equal((await fetch(`${api}/api/voices`)).status, 401);
  const listed = (await (await fetch(`${api}/api/voices`, { headers: { Cookie: ownerCookie } })).json()).data.systemVoices;
  assert.ok(listed.some(voice => voice.id === String(defaultVoice._id) && voice.isDefault));
  assert.ok(listed.every(voice => voice.status === 'ACTIVE' && !('providerVoiceId' in voice)));
  report.checks.authenticated_database_voices = true;
  currentStage = 'job_creation';
  assert.equal((await post(scene._id, { Cookie: '' })).status, 401);
  assert.equal((await post(scene._id, { 'x-csrf-token': '' })).status, 403);
  assert.equal((await post(scene._id, { Cookie: foreignCookie })).status, 403);
  report.checks.auth_csrf_owner_enforced = true;
  const concurrent = await Promise.all(Array.from({ length: 4 }, () => post(scene._id)));
  assert.equal(concurrent.filter(response => response.status === 202).length, 1);
  const bodies = await Promise.all(concurrent.map(async response => {
    assert.ok([200, 202].includes(response.status)); return (await response.json()).data;
  }));
  const created = bodies[0]; jobs.push(created.jobId);
  for (const body of bodies) assert.equal(body.jobId, created.jobId);
  const duplicates = await Promise.all(Array.from({ length: 4 }, () => post(scene._id)));
  for (const duplicate of duplicates) { assert.equal(duplicate.status, 200); assert.equal((await duplicate.json()).data.jobId, created.jobId); }
  assert.equal(await CreditLedger.countDocuments({ referenceId: `reserve_${created.jobId}` }), 1);
  assert.equal((await Wallet.findById(wallet._id)).reserved, created.reservedCredits);
  report.checks.repeated_requests_single_hold = true;
  report.checks.concurrent_creation_single_job = true;
  currentStage = 'worker_synthesis_upload';
  await worker(created.jobId, process.env.TTS_SERVICE_URL);
  const completed = await Job.findById(created.jobId);
  if (completed.status !== 'COMPLETED') throw new Error(typeof completed.error === 'string' ? completed.error : 'TTS_JOB_NOT_COMPLETED');
  report.checks.worker_completed = true;
  const asset = await MediaAsset.findOne({ jobId: completed._id });
  assert.ok(asset); assert.equal(asset.deliveryType, 'authenticated');
  assert.equal(String((await Scene.findById(scene._id)).ttsAudioId), String(asset._id));
  assert.equal((await Wallet.findById(wallet._id)).available, 100000 - created.reservedCredits);
  assert.equal((await Wallet.findById(wallet._id)).reserved, 0);
  assert.equal((await CreditReservation.findOne({ jobId: completed._id })).status, 'SETTLED');
  await CreditService.settle(completed._id, created.reservedCredits);
  await worker(created.jobId, process.env.TTS_SERVICE_URL);
  assert.equal(await CreditLedger.countDocuments({ referenceId: `settle_${created.jobId}` }), 1);
  assert.equal(await MediaAsset.countDocuments({ jobId: completed._id }), 1);
  report.checks.repeated_completion_single_charge = true;
  currentStage = 'protected_playback';
  assert.equal((await fetch(api + completed.result.audioUrl)).status, 401);
  assert.equal((await fetch(api + completed.result.audioUrl, { headers: { Cookie: foreignCookie } })).status, 404);
  const playback = await fetch(api + completed.result.audioUrl, { headers: { Cookie: ownerCookie } });
  assert.equal(playback.status, 200); assert.equal(playback.headers.get('content-type').split(';')[0], 'audio/wav');
  const audio = Buffer.from(await playback.arrayBuffer()); const info = inspectWave(audio);
  assert.equal(crypto.createHash('sha256').update(audio).digest('hex'), asset.sha256);
  assert.ok(info.duration > 1); let peak = 0;
  // PCM16 emitted by the real service; scan its data chunk, not RIFF text/header bytes.
  assert.equal(info.bitsPerSample, 16);
  for (let offset = 12; offset + 8 <= audio.length;) {
    const size = audio.readUInt32LE(offset + 4);
    if (audio.toString('ascii', offset, offset + 4) === 'data') for (let i = offset + 8; i < offset + 8 + size; i += 2) peak = Math.max(peak, Math.abs(audio.readInt16LE(i)));
    offset += 8 + size + size % 2;
  }
  assert.ok(peak > 100);
  await fs.writeFile(path.join(output, 'worker-playback.wav'), audio);
  await fs.writeFile(path.join(output, 'worker-playback.html'), '<!doctype html><meta charset="utf-8"><title>AG-018 playback</title><h1>Audio từ Worker → TTS local → Cloudinary authenticated → API</h1><audio controls src="worker-playback.wav"></audio>');
  report.checks.protected_audio_download_decodes = true;
  report.audio = { ...info, peakPcm16: peak, sha256: asset.sha256, file: 'worker-playback.wav' };
  currentStage = 'stale_and_unavailable_refund';
  const staleScene = await makeScene(); headers['Idempotency-Key'] = crypto.randomUUID();
  const stale = (await (await post(staleScene._id)).json()).data; jobs.push(stale.jobId);
  await Scene.updateOne({ _id: staleScene._id }, { $inc: { revision: 1 } });
  await worker(stale.jobId, process.env.TTS_SERVICE_URL);
  assert.equal((await Job.findById(stale.jobId)).error, 'TTS_STALE_SCENE');
  const failedScene = await makeScene(); headers['Idempotency-Key'] = crypto.randomUUID();
  const failed = (await (await post(failedScene._id)).json()).data; jobs.push(failed.jobId);
  await worker(failed.jobId, `http://127.0.0.1:${await port()}`);
  assert.equal((await Job.findById(failed.jobId)).error, 'TTS_SERVICE_UNAVAILABLE');
  for (const id of [stale.jobId, failed.jobId]) {
    await CreditService.release(new mongoose.Types.ObjectId(id));
    assert.equal(await CreditLedger.countDocuments({ referenceId: `release_${id}` }), 1);
    assert.equal((await CreditReservation.findOne({ jobId: id })).status, 'RELEASED');
  }
  assert.equal((await Wallet.findById(wallet._id)).available, 100000 - created.reservedCredits);
  assert.equal((await Wallet.findById(wallet._id)).reserved, 0);
  report.checks.stale_and_unavailable_single_refund = true;
  currentStage = 'missing_and_revoked_voice_refund';
  const revokedVoice = await Voice.create({ provider: `ACCEPTANCE_ONLY_${crypto.randomUUID()}`, providerVoiceId: 'Hải Đăng', name: 'Revoked acceptance fixture', language: 'vi-VN', gender: 'male', planEntitlements: ['*'], status: 'REVOKED', isSystem: false });
  fixtureVoices.push(revokedVoice._id);
  for (const [id, expected] of [[new mongoose.Types.ObjectId(), 'TTS_VOICE_NOT_FOUND'], [revokedVoice._id, 'TTS_VOICE_REVOKED']]) {
    selectedVoiceId = String(id); headers['Idempotency-Key'] = crypto.randomUUID();
    const invalidVoiceJob = (await (await post(scene._id)).json()).data; jobs.push(invalidVoiceJob.jobId);
    await worker(invalidVoiceJob.jobId, process.env.TTS_SERVICE_URL);
    assert.equal((await Job.findById(invalidVoiceJob.jobId)).error, expected);
    await CreditService.release(new mongoose.Types.ObjectId(invalidVoiceJob.jobId));
    assert.equal(await CreditLedger.countDocuments({ referenceId: `release_${invalidVoiceJob.jobId}` }), 1);
    assert.equal(await MediaAsset.countDocuments({ jobId: invalidVoiceJob.jobId }), 0);
  }
  assert.equal((await Wallet.findById(wallet._id)).available, 100000 - created.reservedCredits);
  assert.equal((await Wallet.findById(wallet._id)).reserved, 0);
  report.checks.missing_and_revoked_voice_single_refund = true;
  assert.ok(!pythonOutput.includes(process.env.TTS_SERVICE_TOKEN));
  report.full_flow_pass = true;
}
run().catch(error => {
  report.failedStage = currentStage;
  // Only allow our stable codes; assertion output must not dump cookies, config or URLs.
  report.error = /^[A-Z][A-Z_]{2,}$/.test(error.message || '') ? error.message : 'ACCEPTANCE_ASSERTION_FAILED';
  process.exitCode = 1;
}).finally(async () => {
  for (const process of children) await stop(process);
  if (server) await new Promise(done => server.close(done));
  if (mongoose.connection.readyState === 1) {
    const fixtureJobIds = (await Job.find({ ownerId: { $in: owners } }).select('_id')).map(job => job._id);
    for (const asset of await MediaAsset.find({ ownerId: { $in: owners } })) {
      try { await cloudinary?.destroy(asset.publicId); } catch { report.cloudCleanupPending = true; }
    }
    const workspaceIds = (await Workspace.find({ ownerId: { $in: owners } })).map(item => item._id);
    const projectIds = (await Project.find({ workspaceId: { $in: workspaceIds } })).map(item => item._id);
    // Delete only fixture documents owned by the users created in this invocation.
    await Scene.deleteMany({ projectId: { $in: projectIds } });
    await MediaAsset.deleteMany({ ownerId: { $in: owners } });
    await CreditReservation.deleteMany({ jobId: { $in: fixtureJobIds } });
    await CreditLedger.deleteMany({ walletId: { $in: wallets } });
    await CreditLot.deleteMany({ walletId: { $in: wallets } });
    await Wallet.deleteMany({ userId: { $in: owners } });
    await Job.deleteMany({ ownerId: { $in: owners } });
    await Project.deleteMany({ workspaceId: { $in: workspaceIds } });
    await Workspace.deleteMany({ ownerId: { $in: owners } });
    await Session.deleteMany({ userId: { $in: owners } });
    await User.deleteMany({ _id: { $in: owners } });
    await Voice.deleteMany({ _id: { $in: fixtureVoices } });
    report.fixturesRemoved = true;
  }
  await mongoose.disconnect();
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, 'acceptance.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}).catch(() => { console.error('TTS_ACCEPTANCE_CLEANUP_FAILED'); process.exitCode = 1; });

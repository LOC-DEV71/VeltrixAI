// Real local API + Worker + pinned ONNX + authenticated Cloudinary. Temporary fixtures only.
const path = require('node:path'), fs = require('node:fs/promises'), crypto = require('node:crypto'), assert = require('node:assert/strict');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
const mongoose = require('mongoose');
const { User } = require('../dist/models/User'), { Session } = require('../dist/models/Session');
const { Voice } = require('../dist/models/Voice'), { VoiceEnrollment } = require('../dist/models/VoiceEnrollment');
const { Job } = require('../dist/models/Job'), { MediaAsset } = require('../dist/models/MediaAsset');
const { Wallet, CreditLot, CreditReservation, CreditLedger } = require('../dist/models/Credits');
const { signAccessToken } = require('../dist/utils/jwt');
const { inspectWave } = require('../dist/providers/AudioValidation');
const { CloudinaryAudioProvider, getCloudinaryConfiguration } = require('../dist/providers/CloudinaryAudioProvider');
const { stopEnrollment } = require('../dist/services/VoiceEnrollmentService');
const { cleanupEnrollmentFiles } = require('../dist/workers/VoiceEnrollmentWorker');
const root = path.resolve(__dirname, '../../../services/tts');
const eightSeconds = process.argv.includes('--eight-seconds');
const output = path.join(root, eightSeconds ? 'offline-output/clone-integration-8s' : 'offline-output/clone-integration');
const api = 'http://localhost:3001/api'; const owners = []; const report = { passed: false, checks: {} }; let stage = 'startup', cloud;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function auth(plan) {
  const owner = await User.create({ email: crypto.randomUUID() + '@example.invalid', displayName: 'Temporary clone acceptance', plan }); owners.push(owner._id);
  const session = await Session.create({ userId: owner._id, tokenFamily: crypto.randomUUID(), refreshTokenHash: crypto.randomBytes(32).toString('hex'), expiresAt: new Date(Date.now() + 1800000) });
  const wallet = await Wallet.create({ userId: owner._id, bucket: 'FREE', available: 1000, reserved: 0 });
  await CreditLot.create({ walletId: wallet._id, amount: 1000, available: 1000, expiresAt: new Date(Date.now() + 86400000) });
  return { owner, wallet, headers: { Cookie: `accessToken=${signAccessToken({ sessionId: session._id })}; csrfToken=${'c'.repeat(64)}`, 'Content-Type': 'application/json', 'x-csrf-token': 'c'.repeat(64) } };
}
async function request(actor, route, method = 'GET', body, key) {
  const response = await fetch(api + route, { method, headers: { ...actor.headers, ...(key ? { 'Idempotency-Key': key } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() };
}
async function waitJob(id) {
  for (let i = 0; i < 360; i++) { const job = await Job.findById(id); if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status)) return job; await sleep(1000); }
  throw new Error('JOB_TIMEOUT');
}
async function run() {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 }); cloud = new CloudinaryAudioProvider(getCloudinaryConfiguration());
  const plus = await auth('PLUS'), pro = await auth('PRO'), free = await auth('FREE');
  let audio = await fs.readFile(path.join(root, 'offline-output/clone/reference.wav'));
  if (eightSeconds) {
    // Repeat a consented synthetic fixture, never a user's recording, to exercise the exact upper limit.
    const { pathToFileURL } = require('node:url');
    const { encodeCloneSample } = await import(pathToFileURL(path.resolve(__dirname, '../../web-client/src/utils/cloneSample.ts')).href);
    const original = inspectWave(audio); assert.equal(original.bitsPerSample, 16);
    let offset = 12, data;
    while (offset + 8 <= audio.length) { const size = audio.readUInt32LE(offset + 4); if (audio.toString('ascii', offset, offset + 4) === 'data') { data = audio.subarray(offset + 8, offset + 8 + size); break; } offset += 8 + size + size % 2; }
    assert.ok(data);
    const frames = data.length / (original.channels * 2), length = original.sampleRate * 8;
    const samples = Float32Array.from({ length }, (_, i) => data.readInt16LE((i % frames) * original.channels * 2) / 32768);
    const normalized = encodeCloneSample({ sampleRate: original.sampleRate, length, numberOfChannels: 1, getChannelData: () => samples });
    audio = Buffer.from(await normalized.blob.arrayBuffer());
  }
  const info = inspectWave(audio); assert.ok(info.duration >= 3 && info.duration <= 8); report.sample = info;
  const body = { name: 'Veltrix offline clone acceptance', audioBase64: audio.toString('base64'), consentToClone: true, hasVoiceRights: true, consentVersion: 'voice-cloning-v1' }; const key = crypto.randomUUID();
  stage = 'authorization';
  assert.equal((await fetch(api + '/voice-enrollments')).status, 401);
  assert.equal((await request(free, '/voice-enrollments', 'POST', { ...body, plan: 'PRO' }, key)).status, 403);
  assert.equal((await request(plus, '/voice-enrollments', 'POST', { ...body, hasVoiceRights: false }, key)).status, 400);
  assert.equal((await fetch(api + '/voice-enrollments', { method: 'POST', headers: { Cookie: plus.headers.Cookie, 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body) })).status, 403);
  report.checks.auth_plan_consent_csrf = true;
  if (eightSeconds) {
    const unsupported = Buffer.from(audio); unsupported.writeUInt32LE(96000, 24); unsupported.writeUInt32LE(192000, 28);
    const format = await request(plus, '/voice-enrollments', 'POST', { ...body, audioBase64: unsupported.toString('base64') }, crypto.randomUUID());
    assert.equal(format.status, 400); assert.equal(format.body.error.code, 'CLONE_SAMPLE_FORMAT_INVALID'); assert.equal(typeof format.body.error.message, 'string');
    const longer = Buffer.concat([audio, Buffer.alloc(info.sampleRate * 2)]); longer.writeUInt32LE(longer.length - 8, 4); longer.writeUInt32LE(longer.length - 44, 40);
    const duration = await request(plus, '/voice-enrollments', 'POST', { ...body, audioBase64: longer.toString('base64') }, crypto.randomUUID());
    assert.equal(duration.status, 400); assert.equal(duration.body.error.code, 'CLONE_SAMPLE_DURATION_INVALID'); assert.equal(typeof duration.body.error.message, 'string');
    report.checks.precise_validation_errors = true;
  }
  stage = 'enrollment';
  const created = await Promise.all([request(plus, '/voice-enrollments', 'POST', body, key), request(plus, '/voice-enrollments', 'POST', body, key)]);
  assert.ok(created.every(v => [200, 202].includes(v.status))); assert.equal(created[0].body.data.voiceId, created[1].body.data.voiceId);
  const ids = created[0].body.data; const job = await waitJob(ids.jobId); assert.equal(job.status, 'COMPLETED', String(job.error));
  const enrollment = await VoiceEnrollment.findById(ids.enrollmentId);
  assert.equal(enrollment.status, 'ACTIVE'); assert.equal(enrollment.sample.deliveryType, 'authenticated');
  const referenceVoice = await Voice.findById(ids.voiceId).select('+clonedReference'); assert.equal(referenceVoice.clonedReference.speakerEmbedding.length, 192);
  assert.equal((await Voice.findById(ids.voiceId)).clonedReference, undefined);
  const stored = await cloud.download(enrollment.sample.publicId); assert.equal(crypto.createHash('sha256').update(stored.audio).digest('hex'), enrollment.sample.sha256);
  const cfg = getCloudinaryConfiguration(); const unsigned = await fetch(`https://res.cloudinary.com/${cfg.cloud}/video/authenticated/${enrollment.sample.publicId}.wav`); assert.ok([401, 403, 404].includes(unsigned.status)); await unsigned.body?.cancel();
  assert.ok((await request(plus, '/voices')).body.data.cloneVoices.some(v => v.id === ids.voiceId)); assert.equal((await request(pro, '/voices')).body.data.cloneVoices.length, 0);
  assert.equal((await request(pro, '/voice-enrollments/' + ids.enrollmentId + '/revoke', 'POST')).status, 404);
  assert.equal((await request(pro, '/tts', 'POST', { text: 'Xin chào.', voiceId: ids.voiceId }, crypto.randomUUID())).status, 404);
  report.checks.enrollment_idempotent_private_owned = true;
  stage = 'cloned_synthesis';
  const ttsKey = crypto.randomUUID(); const speech = { text: 'Đây là Veltrix TTS, ứng dụng chuyển đổi văn bản thành giọng nói và sáng tạo nội dung.', voiceId: ids.voiceId };
  const tts = await Promise.all([request(plus, '/tts', 'POST', speech, ttsKey), request(plus, '/tts', 'POST', speech, ttsKey)]);
  assert.ok(tts.every(r => [200, 202].includes(r.status))); assert.equal(tts[0].body.data.jobId, tts[1].body.data.jobId);
  const speechJob = await waitJob(tts[0].body.data.jobId); assert.equal(speechJob.status, 'COMPLETED', String(speechJob.error));
  assert.equal(await CreditLedger.countDocuments({ referenceId: 'reserve_' + speechJob._id }), 1); assert.equal(await CreditLedger.countDocuments({ referenceId: 'settle_' + speechJob._id }), 1);
  const result = await fetch('http://localhost:3001' + speechJob.result.audioUrl, { headers: plus.headers }); assert.equal(result.status, 200); assert.equal(result.headers.get('content-type'), 'audio/wav');
  const wav = Buffer.from(await result.arrayBuffer()); const wavInfo = inspectWave(wav); await fs.mkdir(output, { recursive: true }); await fs.writeFile(path.join(output, 'cloned.wav'), wav);
  report.audio = { ...wavInfo, sha256: crypto.createHash('sha256').update(wav).digest('hex') }; report.checks.synthesis_wav_idempotent_credit = true;
  stage = 'revoke_cleanup';
  assert.equal((await request(plus, '/voice-enrollments/' + ids.enrollmentId + '/revoke', 'POST')).status, 200);
  const rejected = await request(plus, '/tts', 'POST', speech, crypto.randomUUID()); assert.equal(rejected.status, 202);
  const failed = await waitJob(rejected.body.data.jobId); assert.equal(failed.status, 'FAILED'); assert.equal(failed.error, 'TTS_VOICE_REVOKED');
  assert.equal(await CreditLedger.countDocuments({ referenceId: 'release_' + failed._id }), 1);
  for (let i = 0; i < 60; i++) { if (!(await VoiceEnrollment.findById(ids.enrollmentId)).cleanupPending) break; await sleep(1000); }
  assert.equal((await VoiceEnrollment.findById(ids.enrollmentId)).cleanupPending, false);
  assert.equal((await Voice.findById(ids.voiceId).select('+clonedReference')).clonedReference, undefined);
  await assert.rejects(cloud.download(enrollment.sample.publicId));
  const wallet = await Wallet.findById(plus.wallet._id); assert.equal(wallet.available, 1000 - speechJob.payload.cost); assert.equal(wallet.reserved, 0);
  assert.equal((await request(plus, '/voice-enrollments/' + ids.enrollmentId, 'DELETE')).status, 200);
  assert.equal((await request(plus, '/voice-enrollments/' + ids.enrollmentId, 'DELETE')).status, 200);
  report.checks.revoke_release_cleanup_delete = true; report.passed = true;
}
run().catch(error => { report.failedStage = stage; report.reason = typeof error?.code === 'string' ? error.code : 'CLONE_ACCEPTANCE_FAILED'; console.error('CLONE_ACCEPTANCE_FAILED_AT_' + stage); process.exitCode = 1; }).finally(async () => {
  if (mongoose.connection.readyState) {
    const items = await VoiceEnrollment.find({ ownerId: { $in: owners } });
    for (const item of items) { await stopEnrollment(item.ownerId, String(item._id), 'DELETED'); if (cloud) await cloud.destroy(item.sample.publicId).catch(() => {}); }
    const assets = await MediaAsset.find({ ownerId: { $in: owners } }); for (const asset of assets) { if (cloud) await cloud.destroy(asset.publicId).catch(() => {}); }
    if (cloud) for (let i = 0; i < items.length + 2; i++) await cleanupEnrollmentFiles(cloud);
    const pending = await VoiceEnrollment.countDocuments({ ownerId: { $in: owners }, cleanupPending: true });
    if (!pending) { await VoiceEnrollment.deleteMany({ ownerId: { $in: owners } }); await Voice.deleteMany({ ownerId: { $in: owners } }); }
    const jobs = await Job.find({ ownerId: { $in: owners } }); const wallets = await Wallet.find({ userId: { $in: owners } });
    await CreditReservation.deleteMany({ jobId: { $in: jobs.map(v => v._id) } }); await CreditLedger.deleteMany({ walletId: { $in: wallets.map(v => v._id) } }); await CreditLot.deleteMany({ walletId: { $in: wallets.map(v => v._id) } });
    await Wallet.deleteMany({ userId: { $in: owners } }); await MediaAsset.deleteMany({ ownerId: { $in: owners } }); await Job.deleteMany({ ownerId: { $in: owners } }); await Session.deleteMany({ userId: { $in: owners } }); await User.deleteMany({ _id: { $in: owners } });
    report.fixturesRemoved = !pending;
  }
  await mongoose.disconnect(); await fs.mkdir(output, { recursive: true }); await fs.writeFile(path.join(output, 'acceptance.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
}).catch(() => { console.error('CLONE_ACCEPTANCE_CLEANUP_FAILED'); process.exitCode = 1; });

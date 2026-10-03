const {Plan,PlanRevision,PlanAudit,PlanUsage}=require('../dist/models/Plan');const {seedConfig,savePlan}=require('../dist/services/PlanService');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { Voice } = require('../dist/models/Voice');
const { VoiceEnrollment } = require('../dist/models/VoiceEnrollment');
const { User } = require('../dist/models/User');
const { Job } = require('../dist/models/Job');
const { MediaAsset } = require('../dist/models/MediaAsset');
const { Wallet, CreditLot, CreditLedger, CreditReservation } = require('../dist/models/Credits');
const { createEnrollment, stopEnrollment } = require('../dist/services/VoiceEnrollmentService');
const { clonePlanAllowed, resolveTtsVoice } = require('../dist/services/VoiceService');
const { createTtsJob } = require('../dist/services/TtsJobService');
const { claimEnrollmentJob, processEnrollmentJob, cleanupEnrollmentFiles } = require('../dist/workers/VoiceEnrollmentWorker');
const { claimTtsJob, processTtsJob } = require('../dist/workers/TtsWorker');
const { inspectReferenceAudio, readStagedReference } = require('../dist/services/VoiceEnrollmentStorage');
const { validateClonedReference } = require('../dist/providers/TtsProvider');
const { inspectWave } = require('../dist/providers/AudioValidation');
const { getVoices } = require('../dist/controllers/VoicesController');
let repl, plus, pro, free;
const cloudObjects = new Map();
let syntheses = 0, enrollments = 0;
const reference = { speakerEmbedding: Array(192).fill(.1), codes: [Array(16).fill(1)] };
function wave(seconds = 4) {
  const b = Buffer.alloc(44 + seconds * 32000); b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(b.length - 44, 40); for (let i = 44; i < b.length; i += 2) b.writeInt16LE(Math.round(Math.sin(i / 30) * 8000), i); return b;
}
const sample = wave(); const input = (name = 'Test owned voice') => ({ name, audioBase64: sample.toString('base64'), consentToClone: true, hasVoiceRights: true, consentVersion: 'voice-cloning-v1' });
const tts = { async enroll() { enrollments++; return reference; }, async synthesize() { syntheses++; return { audio: sample, ...inspectWave(sample) }; } };
const cloud = { async upload(audio, publicId) { cloudObjects.set(publicId, audio); return { publicId, assetId: 'test-private-asset' }; }, async download(id) { const audio = cloudObjects.get(id); if (!audio) throw new Error('NOT_FOUND'); return { audio, ...inspectWave(audio) }; }, async destroy(id) { cloudObjects.delete(id); } };
async function user(plan) { return User.create({ email: crypto.randomUUID() + '@example.invalid', displayName: 'Clone test fixture', plan }); }
async function ready(owner = plus) { const item = await createEnrollment(owner._id, input(), crypto.randomUUID()); const job = await claimEnrollmentJob(String(item.jobId)); await processEnrollmentJob(job, tts, cloud); assert.equal((await VoiceEnrollment.findById(item.enrollmentId)).status, 'ACTIVE'); return item; }
async function audioJob(owner, voiceId, key = crypto.randomUUID()) { return createTtsJob(owner._id, '', String(voiceId), key, { text: 'Xin chào Veltrix.' }); }
before(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: '8.2.6' } });
  await mongoose.connect(repl.getUri()); await Promise.all([Voice.init(), VoiceEnrollment.init(), Job.init(), MediaAsset.init(), Wallet.init(), CreditLot.init(), CreditReservation.init(), CreditLedger.init()]);
  await Promise.all([Plan,PlanRevision,PlanAudit,PlanUsage].map(m=>m.init())); for(const tier of ['FREE','BASIC_STUDENT','PLUS','PRO'])await savePlan(tier,seedConfig(tier),0,null,'Fixture initial configuration',true);
  plus = await user('PLUS'); pro = await user('PRO'); free = await user('FREE');
  for (const owner of [plus, pro, free]) { const w = await Wallet.create({ userId: owner._id, bucket: 'FREE', available: 1000, reserved: 0 }); await CreditLot.create({ walletId: w._id, amount: 1000, available: 1000, expiresAt: new Date(Date.now() + 86400000) }); }
});
after(async () => {
  if (mongoose.connection.readyState) {
    for (const item of await VoiceEnrollment.find()) { await stopEnrollment(item.ownerId, String(item._id), 'DELETED'); }
    for (let i = 0; i < 20; i++) await cleanupEnrollmentFiles(cloud);
    await mongoose.disconnect();
  }
  if (repl) await repl.stop();
});
test('only PLUS/PRO enroll; both explicit consents and version are required; rejected requests write nothing', async () => {
  assert.equal(await clonePlanAllowed('FREE'), false); assert.equal(await clonePlanAllowed('PLUS'), true); assert.equal(await clonePlanAllowed('PRO'), true);
  await assert.rejects(createEnrollment(free._id, { ...input(), plan: 'PRO' }, crypto.randomUUID()), e => e.code === 'PLAN_FEATURE_DISABLED');
  for (const patch of [{ hasVoiceRights: false }, { consentToClone: false }, { consentVersion: 'old' }]) await assert.rejects(createEnrollment(plus._id, { ...input(), ...patch }, crypto.randomUUID()), e => e.code === 'CLONE_CONSENT_REQUIRED');
  assert.equal(await VoiceEnrollment.countDocuments(), 0);
});
test('sample duration, PCM format, reference dimensions and path/checksum boundaries are enforced', async () => {
  assert.equal(inspectReferenceAudio(sample).duration, 4);
  assert.equal(inspectReferenceAudio(wave(8)).duration, 8);
  for (const duration of [1, 9]) assert.throws(() => inspectReferenceAudio(wave(duration)), e => e.code === 'CLONE_SAMPLE_DURATION_INVALID');
  const lowRate = wave(); lowRate.writeUInt32LE(8000, 24); lowRate.writeUInt32LE(16000, 28);
  assert.throws(() => inspectReferenceAudio(lowRate), e => e.code === 'CLONE_SAMPLE_FORMAT_INVALID');
  assert.throws(() => validateClonedReference({ speakerEmbedding: Array(192).fill(NaN), codes: reference.codes }));
  assert.throws(() => validateClonedReference({ speakerEmbedding: reference.speakerEmbedding, codes: [[1, 2]] }));
  await assert.rejects(readStagedReference('../secrets', 'a'.repeat(64)));
});
test('concurrent retries create exactly one enrollment/voice/job and no credit debit; mismatched replay conflicts', async () => {
  const key = crypto.randomUUID(); const results = await Promise.all([createEnrollment(plus._id, input(), key), createEnrollment(plus._id, input(), key)]);
  assert.equal(String(results[0].voiceId), String(results[1].voiceId)); assert.equal(await Job.countDocuments({ _id: results[0].jobId }), 1);
  assert.equal(await CreditLedger.countDocuments({ referenceId: 'reserve_' + results[0].jobId }), 0);
  await assert.rejects(createEnrollment(plus._id, input('Changed name'), key), e => e.code === 'IDEMPOTENCY_CONFLICT');
  const job = await claimEnrollmentJob(String(results[0].jobId)); await processEnrollmentJob(job, tts, cloud);
  await processEnrollmentJob(job, tts, cloud); assert.equal(enrollments, 1);
  assert.equal((await VoiceEnrollment.findById(results[0].enrollmentId)).status, 'ACTIVE');
  assert.equal((await Voice.findById(results[0].voiceId)).clonedReference, undefined);
  assert.deepEqual((await Voice.findById(results[0].voiceId).select('+clonedReference')).clonedReference, reference);
  await assert.rejects(fs.access(path.resolve(__dirname, '../../../services/tts/.runtime/enrollment-staging/' + results[0].enrollmentId + '.wav')));
});
test('database owner/plan guard applies to listing, synthesis, revoke and deletion, regardless of caller roles/credits', async () => {
  const item = await ready();
  await assert.rejects(resolveTtsVoice(pro._id, item.voiceId), e => e.code === 'TTS_VOICE_NOT_FOUND');
  await assert.rejects(audioJob(pro, item.voiceId), e => e.code === 'TTS_VOICE_NOT_FOUND');
  await assert.rejects(stopEnrollment(pro._id, String(item.enrollmentId), 'REVOKED'), e => e.code === 'NOT_FOUND');
  const res = () => ({ status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
  const mine = res(), other = res(); await getVoices({ user: plus }, mine); await getVoices({ user: pro }, other);
  assert.ok(mine.body.data.cloneVoices.some(v => String(v.id) === String(item.voiceId))); assert.equal(other.body.data.cloneVoices.length, 0);
  assert.ok(mine.body.data.cloneVoices.every(v => !('clonedReference' in v) && !('providerVoiceId' in v)));
  await User.updateOne({ _id: plus._id }, { $set: { plan: 'FREE' } });
  await assert.rejects(resolveTtsVoice(plus._id, item.voiceId), e => e.code === 'TTS_VOICE_PLAN_DENIED');
  await assert.rejects(audioJob(plus, item.voiceId), e => e.code === 'PLAN_FEATURE_DISABLED');
  await User.updateOne({ _id: plus._id }, { $set: { plan: 'PLUS' } });
});
test('cloned TTS reserves/settles once; retrying a completed job neither synthesizes nor charges again', async () => {
  const item = await ready(); const key = crypto.randomUUID();
  const [a, b] = await Promise.all([audioJob(plus, item.voiceId, key), audioJob(plus, item.voiceId, key)]);
  assert.equal(String(a.job._id), String(b.job._id));
  const before = syntheses; const job = await claimTtsJob(String(a.job._id)); await processTtsJob(job, tts, cloud); await processTtsJob(job, tts, cloud);
  assert.equal(syntheses - before, 1); assert.equal((await Job.findById(job._id)).status, 'COMPLETED');
  assert.equal(await CreditLedger.countDocuments({ referenceId: 'reserve_' + job._id }), 1); assert.equal(await CreditLedger.countDocuments({ referenceId: 'settle_' + job._id }), 1);
});
test('revoke before processing fails the queued TTS job and releases once, then removes reference/sample files', async () => {
  const item = await ready(); const result = await audioJob(plus, item.voiceId);
  const sampleId = (await VoiceEnrollment.findById(item.enrollmentId)).sample.publicId;
  await stopEnrollment(plus._id, String(item.enrollmentId), 'REVOKED'); await stopEnrollment(plus._id, String(item.enrollmentId), 'REVOKED');
  const job = await claimTtsJob(String(result.job._id)); const count = syntheses; await processTtsJob(job, tts, cloud); await processTtsJob(job, tts, cloud);
  assert.equal(syntheses, count); assert.equal((await Job.findById(job._id)).status, 'FAILED');
  assert.equal(await CreditLedger.countDocuments({ referenceId: 'release_' + job._id }), 1); assert.equal(await CreditLedger.countDocuments({ referenceId: 'settle_' + job._id }), 0);
  await cleanupEnrollmentFiles(cloud); assert.equal(cloudObjects.has(sampleId), false);
  assert.equal((await Voice.findById(item.voiceId).select('+clonedReference')).clonedReference, undefined);
  await stopEnrollment(plus._id, String(item.enrollmentId), 'DELETED'); await cleanupEnrollmentFiles(cloud);
  assert.equal((await VoiceEnrollment.findById(item.enrollmentId)).status, 'DELETED');
});
test('revoke during inference prevents publication and refunds; revoke during enrollment cannot reactivate a voice', async () => {
  const item = await ready(); const result = await audioJob(plus, item.voiceId); const job = await claimTtsJob(String(result.job._id));
  await processTtsJob(job, { async synthesize() { await stopEnrollment(plus._id, String(item.enrollmentId), 'REVOKED'); return { audio: sample }; } }, cloud);
  assert.equal((await Job.findById(job._id)).status, 'FAILED'); assert.equal(await MediaAsset.countDocuments({ jobId: job._id }), 0);
  assert.equal((await CreditReservation.findOne({ jobId: job._id })).status, 'RELEASED');
  const pending = await createEnrollment(plus._id, input(), crypto.randomUUID()); const enrollmentJob = await claimEnrollmentJob(String(pending.jobId));
  await processEnrollmentJob(enrollmentJob, { async enroll() { await stopEnrollment(plus._id, String(pending.enrollmentId), 'REVOKED'); return reference; } }, cloud);
  assert.equal((await Voice.findById(pending.voiceId)).status, 'REVOKED'); assert.equal((await Job.findById(pending.jobId)).status, 'CANCELLED');
  await cleanupEnrollmentFiles(cloud);
});
test('unavailable enrollment marks REVOKED, removes staging/cloud; cleanup failure remains visible and can be retried', async () => {
  const item = await createEnrollment(pro._id, input(), crypto.randomUUID()); const job = await claimEnrollmentJob(String(item.jobId));
  await processEnrollmentJob(job, { async enroll() { throw new Error('sensitive upstream details'); } }, cloud);
  assert.equal((await Job.findById(job._id)).error, 'CLONE_ENROLLMENT_FAILED');
  for (let i = 0; i < 3; i++) await cleanupEnrollmentFiles({ async destroy() { throw new Error('unavailable'); } });
  assert.ok(await VoiceEnrollment.exists({ cleanupPending: true }));
  for (const entry of await VoiceEnrollment.find({ cleanupPending: true })) await stopEnrollment(entry.ownerId, String(entry._id), 'DELETED');
  for (let i = 0; i < 10; i++) await cleanupEnrollmentFiles(cloud);
  assert.equal(await VoiceEnrollment.countDocuments({ cleanupPending: true }), 0);
});

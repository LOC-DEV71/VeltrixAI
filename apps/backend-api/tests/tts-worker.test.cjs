const ent=require('../dist/services/EntitlementService'); const {seedConfig}=require('../dist/services/PlanService');
const { test, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { Job } = require('../dist/models/Job');
const { Scene } = require('../dist/models/Scene');
const { Project } = require('../dist/models/Project');
const { Workspace } = require('../dist/models/Workspace');
const { MediaAsset } = require('../dist/models/MediaAsset');
const { Voice } = require('../dist/models/Voice');
const { User } = require('../dist/models/User');
const { CreditService } = require('../dist/services/CreditService');
const { AudioError } = require('../dist/providers/AudioValidation');
const { claimTtsJob, processTtsJob } = require('../dist/workers/TtsWorker');
afterEach(() => mock.restoreAll());
function query(value) { return { session() { return this; }, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } }; }
function setup() {
  const id = new mongoose.Types.ObjectId();
  const job = { _id: id, ownerId: id, type: 'TTS', status: 'PROCESSING', executionClaim: 'claim', attempts: 1,
    payload: { sceneId: id, projectId: id, narration: 'Test', voiceId: id, cost: 1, sceneRevision: 0, sourceContentRevision: 1 }, async save() {} };
  mock.method(ent,'verifyJobEntitlements',async()=>({tier:'FREE',config:seedConfig('FREE')})); mock.method(ent,'reconcileUsage',async()=>{});
  const session = { async withTransaction(action) { return action(); }, async endSession() {} };
  mock.method(mongoose, 'startSession', async () => session);
  mock.method(Job, 'exists', async () => job.status === 'PROCESSING');
  const owned = mock.method(Job, 'findOne', () => query(job.status === 'PROCESSING' ? job : null));
  mock.method(Scene, 'findOne', () => query({ ...job.payload, narration: 'Test', projectId: id }));
  mock.method(Project, 'findById', () => query({ workspaceId: id }));
  mock.method(Workspace, 'findOne', () => query({ ownerId: id }));
  mock.method(User, 'findById', () => query({ status: 'ACTIVE', plan: 'FREE' }));
  mock.method(Voice, 'findById', () => query({ _id: id, status: 'ACTIVE', provider: 'VIENEU_LOCAL', providerVoiceId: 'Hải Đăng', planEntitlements: ['*'] }));
  mock.method(Voice, 'updateOne', async () => ({ matchedCount: 1 }));
  const sceneUpdate = mock.method(Scene, 'updateOne', async () => ({ matchedCount: 1 }));
  const assets = mock.method(MediaAsset, 'create', async () => [{ _id: id, bytes: 100, duration: 2 }]);
  const settle = mock.method(CreditService, 'settle', async () => {});
  const release = mock.method(CreditService, 'release', async () => {});
  const tts = { synthesize: mock.fn(async () => ({ audio: Buffer.from('fixture') })) };
  const cloud = { upload: mock.fn(async (_, publicId) => ({ publicId, assetId: 'asset' })), download: mock.fn(async () => ({ audio: Buffer.from('fixture'), bytes: 100, duration: 2, sampleRate: 48000, channels: 1 })), destroy: mock.fn(async () => {}) };
  return { job, session, owned, tts, cloud, assets, settle, release, sceneUpdate };
}
test('publishes media and scene, and settles in the same transaction; completed job replay does nothing', async () => {
  const f = setup();
  await processTtsJob(f.job, f.tts, f.cloud);
  assert.equal(f.job.status, 'COMPLETED');
  assert.equal(f.job.result.audioUrl, `/api/media/${f.job._id}/audio`);
  assert.equal(f.assets.mock.calls[0].arguments[1].session, f.session);
  assert.equal(f.sceneUpdate.mock.calls[0].arguments[2].session, f.session);
  assert.equal(f.settle.mock.calls[0].arguments[2], f.session);
  assert.equal(f.assets.mock.calls[0].arguments[0][0].deliveryType, 'authenticated');
  assert.equal(f.release.mock.callCount(), 0);
  assert.equal(f.tts.synthesize.mock.calls[0].arguments[1], 'Hải Đăng');
  await processTtsJob(f.job, f.tts, f.cloud);
  assert.equal(f.tts.synthesize.mock.callCount(), 1);
  assert.equal(f.settle.mock.callCount(), 1);
});

for (const [label, value, code] of [
  ['missing', null, 'TTS_VOICE_NOT_FOUND'],
  ['revoked', { status: 'REVOKED' }, 'TTS_VOICE_REVOKED'],
  ['plan denied', { status: 'ACTIVE', planEntitlements: ['PRO'] }, 'TTS_VOICE_PLAN_DENIED'],
]) test(`${label} voice fails and releases once without inference`, async () => {
  const f = setup(); mock.method(Voice, 'findById', () => query(value));
  await processTtsJob(f.job, f.tts, f.cloud);
  assert.equal(f.job.status, 'FAILED'); assert.equal(f.job.error, code);
  assert.equal(f.tts.synthesize.mock.callCount(), 0); assert.equal(f.release.mock.callCount(), 1);
  await processTtsJob(f.job, f.tts, f.cloud); assert.equal(f.release.mock.callCount(), 1);
});
test('voice revoked during inference is refunded before upload', async () => {
  const f = setup(); f.tts.synthesize = mock.fn(async () => {
    mock.method(Voice, 'findById', () => query({ status: 'REVOKED' }));
    return { audio: Buffer.from('fixture') };
  });
  await processTtsJob(f.job, f.tts, f.cloud);
  assert.equal(f.job.error, 'TTS_VOICE_REVOKED'); assert.equal(f.release.mock.callCount(), 1);
  assert.equal(f.cloud.upload.mock.callCount(), 0);
});
test('voice revoked at publication cannot settle or publish', async () => {
  const f = setup(); mock.method(Voice, 'updateOne', async () => ({ matchedCount: 0 }));
  await processTtsJob(f.job, f.tts, f.cloud);
  assert.equal(f.job.error, 'TTS_VOICE_REVOKED'); assert.equal(f.settle.mock.callCount(), 0);
  assert.equal(f.assets.mock.callCount(), 0); assert.equal(f.release.mock.callCount(), 1);
  assert.equal(f.cloud.destroy.mock.callCount(), 1);
});
test('stale scene fails before inference, with one refund and no media', async () => {
  const f = setup(); mock.method(Scene, 'findOne', () => query(null));
  await processTtsJob(f.job, f.tts, f.cloud);
  assert.equal(f.job.status, 'FAILED'); assert.equal(f.job.error, 'TTS_STALE_SCENE');
  assert.equal(f.tts.synthesize.mock.callCount(), 0); assert.equal(f.assets.mock.callCount(), 0);
  assert.equal(f.release.mock.calls[0].arguments[1], f.session);
  await processTtsJob(f.job, f.tts, f.cloud);
  assert.equal(f.release.mock.callCount(), 1);
});

test('standalone TTS persists authenticated media and settles without a project or scene', async () => {
  const f = setup(); f.job.payload.source = 'STANDALONE';
  delete f.job.payload.sceneId; delete f.job.payload.projectId;
  await processTtsJob(f.job, f.tts, f.cloud);
  assert.equal(f.job.status, 'COMPLETED');
  assert.equal(f.assets.mock.calls[0].arguments[0][0].source, 'STANDALONE');
  assert.equal(f.sceneUpdate.mock.callCount(), 0);
  assert.equal(f.settle.mock.callCount(), 1); assert.equal(f.release.mock.callCount(), 0);
});
test('lease lost after upload cannot publish, refund, or delete a newer worker asset', async () => {
  const f = setup(); f.owned.mock.mockImplementation(() => query(null));
  await processTtsJob(f.job, f.tts, f.cloud);
  assert.equal(f.assets.mock.callCount(), 0); assert.equal(f.settle.mock.callCount(), 0);
  assert.equal(f.release.mock.callCount(), 0); assert.equal(f.cloud.destroy.mock.callCount(), 0);
});
test('upload failure refunds; opaque errors never leak into job result or logs', async () => {
  const f = setup(); f.cloud.upload = mock.fn(async () => { throw new Error('private-provider-secret-marker'); });
  await processTtsJob(f.job, f.tts, f.cloud);
  assert.equal(f.job.status, 'FAILED'); assert.equal(f.job.error, 'TTS_PROCESSING_FAILED');
  assert.equal(f.release.mock.callCount(), 1); assert.equal(f.settle.mock.callCount(), 0);
  assert.equal(f.cloud.destroy.mock.callCount(), 1);
});
test('service unavailable releases once and never tries Cloudinary upload', async () => {
  const f = setup(); f.tts.synthesize = mock.fn(async () => { throw new AudioError('TTS_SERVICE_UNAVAILABLE'); });
  await processTtsJob(f.job, f.tts, f.cloud);
  assert.equal(f.job.error, 'TTS_SERVICE_UNAVAILABLE'); assert.equal(f.release.mock.callCount(), 1);
  assert.equal(f.cloud.upload.mock.callCount(), 0); assert.equal(f.cloud.destroy.mock.callCount(), 0);
});
test('attempt cap releases a repeatedly crashed job before inference', async () => {
  const f = setup(); f.job.attempts = 4;
  await processTtsJob(f.job, f.tts, f.cloud);
  assert.equal(f.job.error, 'TTS_RETRY_EXHAUSTED'); assert.equal(f.tts.synthesize.mock.callCount(), 0);
  assert.equal(f.release.mock.callCount(), 1);
});
test('TTS claims use the shared entitlement fence and pipeline filter', async () => {
  const method=mock.method(ent,'claimPlanJob',async(filter,lease)=>({filter,lease}));
  const result=await claimTtsJob('0123456789abcdef01234567');
  assert.equal(result.filter.type,'TTS');assert.equal(result.filter['payload.pipelineVersion'],2);
  assert.equal(result.lease,120000);assert.equal(method.mock.callCount(),1);
});

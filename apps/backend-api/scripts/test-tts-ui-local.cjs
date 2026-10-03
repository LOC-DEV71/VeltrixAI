// Exercises the running local API + persistent Worker; fixture data only, never logs secrets.
const path = require('node:path'), fs = require('node:fs/promises'), crypto = require('node:crypto'), assert = require('node:assert/strict');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
const mongoose = require('mongoose');
const { User } = require('../dist/models/User'), { Session } = require('../dist/models/Session');
const { Workspace } = require('../dist/models/Workspace'), { Project } = require('../dist/models/Project');
const { Content } = require('../dist/models/Content'), { Scene } = require('../dist/models/Scene');
const { Job } = require('../dist/models/Job'), { MediaAsset } = require('../dist/models/MediaAsset');
const { Wallet, CreditLot, CreditReservation, CreditLedger } = require('../dist/models/Credits');
const { signAccessToken } = require('../dist/utils/jwt');
const { inspectWave } = require('../dist/providers/AudioValidation');
const { CloudinaryAudioProvider, getCloudinaryConfiguration } = require('../dist/providers/CloudinaryAudioProvider');
const output = path.resolve(__dirname, '../../../services/tts/offline-output/ui-integration');
const api = 'http://localhost:3001/api', owners = [], wallets = [], jobIds = [];
let project, workspace, content, cloud; const report = { pass: false, checks: {} }; let stage = 'startup';
const sleep = ms => new Promise(done => setTimeout(done, ms));
async function run() {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 }); cloud = new CloudinaryAudioProvider(getCloudinaryConfiguration());
  async function auth() {
    const owner = await User.create({ email: `tts-ui-${crypto.randomUUID()}@example.invalid`, displayName: 'Temporary TTS UI acceptance' }); owners.push(owner._id);
    const session = await Session.create({ userId: owner._id, tokenFamily: crypto.randomUUID(), refreshTokenHash: crypto.randomBytes(32).toString('hex'), expiresAt: new Date(Date.now() + 600000) });
    return { owner, cookie: `accessToken=${signAccessToken({ sessionId: session._id })}; csrfToken=${'a'.repeat(64)}` };
  }
  const main = await auth(), foreign = await auth();
  const headers = { Cookie: main.cookie, 'Content-Type': 'application/json', 'x-csrf-token': 'a'.repeat(64) };
  const wallet = await Wallet.create({ userId: main.owner._id, bucket: 'FREE', available: 10000, reserved: 0 }); wallets.push(wallet._id);
  await CreditLot.create({ walletId: wallet._id, amount: 10000, available: 10000, expiresAt: new Date(Date.now() + 86400000) });
  assert.equal((await fetch(api + '/tts/config')).status, 401);
  const config = await fetch(api + '/tts/config', { headers }); assert.equal(config.status, 200); const pricing = (await config.json()).data; assert.equal(pricing.available, true); assert.equal(pricing.creditsPer100Chars, 100); report.checks.creditsPer100Chars = 100;
  const voices = (await (await fetch(api + '/voices', { headers })).json()).data.systemVoices;
  const voice = voices.find(v => v.isDefault), second = voices.find(v => v.name === 'Mai Anh'); assert.ok(voice && second);
  const text = 'Đây là Veltrix TTS, ứng dụng chuyển đổi văn bản thành giọng nói và sáng tạo nội dung.';
  const key = crypto.randomUUID(); stage = 'standalone_creation';
  assert.equal((await fetch(api + '/tts', { method: 'POST', headers: { Cookie: main.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voiceId: voice.id }) })).status, 403);
  const requests = await Promise.all([0, 1].map(() => fetch(api + '/tts', { method: 'POST', headers: { ...headers, 'Idempotency-Key': key }, body: JSON.stringify({ text, voiceId: voice.id }) })));
  assert.ok(requests.every(r => [200, 202].includes(r.status))); const created = await Promise.all(requests.map(async r => (await r.json()).data));
  assert.equal(created[0].jobId, created[1].jobId); jobIds.push(created[0].jobId);
  report.checks.standalone_idempotent_reserved = true;
  workspace = await Workspace.create({ ownerId: main.owner._id, name: 'Temporary acceptance workspace' });
  project = await Project.create({ workspaceId: workspace._id, name: 'Temporary acceptance project' });
  content = await Content.create({ projectId: project._id, rawText: text });
  const scene = await Scene.create({ projectId: project._id, title: 'Veltrix TTS', order: 1, narration: 'Nội dung trước khi sửa.', visualDescription: 'Acceptance only', estimatedDuration: 8, revision: 0, sourceContentRevision: 0 });
  stage = 'scene_edit';
  const changedText = 'Veltrix TTS giúp bạn chuyển văn bản thành giọng nói tự nhiên và sáng tạo nội dung mỗi ngày.';
  const edit = { narration: changedText, voiceId: second.id, revision: 0 };
  assert.equal((await fetch(api + `/scenes/${scene._id}`, { method: 'PATCH', headers, body: JSON.stringify(edit) })).status, 200);
  assert.equal((await fetch(api + `/scenes/${scene._id}`, { method: 'PATCH', headers, body: JSON.stringify(edit) })).status, 409);
  assert.equal((await Scene.findById(scene._id)).narration, changedText);
  const queued = await fetch(api + `/scenes/${scene._id}/tts`, { method: 'POST', headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ voiceId: second.id }) });
  assert.equal(queued.status, 202); const sceneJob = (await queued.json()).data; jobIds.push(sceneJob.jobId);
  report.checks.scene_text_voice_saved_with_conflict_guard = true; stage = 'worker_processing';
  for (let attempt = 0; attempt < 120; attempt++) {
    const records = await Job.find({ _id: { $in: jobIds } });
    if (records.some(j => j.status === 'FAILED')) throw new Error('WORKER_JOB_FAILED');
    if (records.length === 2 && records.every(j => j.status === 'COMPLETED')) break;
    await sleep(2000);
  }
  await fs.mkdir(output, { recursive: true }); const audioEvidence = [];
  for (const [i, id] of jobIds.entries()) {
    const job = await Job.findById(id); assert.equal(job.status, 'COMPLETED'); assert.equal(job.payload.cost, Math.ceil([...job.payload.narration.trim()].length / 100) * 100);
    assert.equal(await CreditLedger.countDocuments({ referenceId: `reserve_${id}` }), 1);
    assert.equal(await CreditLedger.countDocuments({ referenceId: `settle_${id}` }), 1);
    const asset = await MediaAsset.findOne({ jobId: id }); assert.ok(asset);
    assert.equal((await fetch(api + job.result.audioUrl.replace(/^\/api/, ''))).status, 401);
    assert.equal((await fetch(api + job.result.audioUrl.replace(/^\/api/, ''), { headers: { Cookie: foreign.cookie } })).status, 404);
    const response = await fetch(api + job.result.audioUrl.replace(/^\/api/, ''), { headers }); assert.equal(response.status, 200);
    const audio = Buffer.from(await response.arrayBuffer()); const wav = inspectWave(audio); const sha256 = crypto.createHash('sha256').update(audio).digest('hex'); assert.equal(sha256, asset.sha256);
    await fs.writeFile(path.join(output, i ? 'scene.wav' : 'standalone.wav'), audio); audioEvidence.push({ kind: i ? 'scene' : 'standalone', ...wav, sha256 });
  }
  const saved = await Scene.findById(scene._id); assert.ok(saved.ttsAudioId); assert.equal(String(saved.voiceId), second.id);
  const standaloneHistory = (await (await fetch(api + '/tts/history', { headers })).json()).data.jobs; assert.equal(standaloneHistory.length, 1); assert.equal(standaloneHistory[0].status, 'COMPLETED');
  const sceneHistory = (await (await fetch(api + `/tts/history?projectId=${project._id}`, { headers })).json()).data.jobs; assert.equal(sceneHistory.length, 1); assert.equal(sceneHistory[0].status, 'COMPLETED');
  assert.equal((await fetch(api + `/tts/history?projectId=${project._id}`, { headers: { Cookie: foreign.cookie } })).status, 404);
  const restored = (await (await fetch(api + `/contents/${content._id}`, { headers })).json()).data.scenes; assert.equal(String(restored[0].ttsAudioId), String(saved.ttsAudioId));
  const finalWallet = await Wallet.findById(wallet._id); assert.equal(finalWallet.reserved, 0); const totalCost = (await Job.find({ _id: { $in: jobIds } })).reduce((sum, job) => sum + job.payload.cost, 0); assert.equal(finalWallet.available, 10000 - totalCost); report.checks.settledCredits = totalCost;
  report.checks.real_worker_cloudinary_database_audio = true; report.checks.history_and_scene_survive_reload = true; report.checks.owner_only_playback = true; report.audio = audioEvidence; report.pass = true;
}
run().catch(error => { report.failedStage = stage; report.error = error.message === 'WORKER_JOB_FAILED' ? error.message : 'UI_ACCEPTANCE_FAILED'; process.exitCode = 1; }).finally(async () => {
  if (mongoose.connection.readyState === 1) {
    const ids = (await Job.find({ ownerId: { $in: owners } }).select('_id')).map(j => j._id);
    for (const asset of await MediaAsset.find({ ownerId: { $in: owners } })) await cloud.destroy(asset.publicId);
    await CreditReservation.deleteMany({ jobId: { $in: ids } }); await CreditLedger.deleteMany({ walletId: { $in: wallets } }); await CreditLot.deleteMany({ walletId: { $in: wallets } }); await Wallet.deleteMany({ userId: { $in: owners } });
    await require('../dist/models/Plan').PlanUsage.deleteMany({ownerId:{$in:owners}});
    await MediaAsset.deleteMany({ ownerId: { $in: owners } }); await Job.deleteMany({ ownerId: { $in: owners } });
    if (project) { await Scene.deleteMany({ projectId: project._id }); await Content.deleteMany({ projectId: project._id }); await Project.deleteOne({ _id: project._id }); }
    if (workspace) await Workspace.deleteOne({ _id: workspace._id });
    await Session.deleteMany({ userId: { $in: owners } }); await User.deleteMany({ _id: { $in: owners } }); report.fixturesRemoved = true;
  }
  await mongoose.disconnect(); await fs.mkdir(output, { recursive: true }); await fs.writeFile(path.join(output, 'acceptance.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
}).catch(() => { console.error('UI_ACCEPTANCE_CLEANUP_FAILED'); process.exitCode = 1; });

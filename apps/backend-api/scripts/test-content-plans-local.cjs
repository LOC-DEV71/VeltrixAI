// Real API -> Gemini -> database using isolated temporary users and credit wallets.
const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
const mongoose = require('mongoose');
const { User } = require('../dist/models/User'), { Session } = require('../dist/models/Session');
const { Workspace } = require('../dist/models/Workspace'), { Project } = require('../dist/models/Project'), { Content } = require('../dist/models/Content'), { Scene } = require('../dist/models/Scene'), { Job } = require('../dist/models/Job');
const { Wallet, CreditLot, CreditLedger, CreditReservation } = require('../dist/models/Credits');
const { signAccessToken } = require('../dist/utils/jwt');
const { validateSceneOptions } = require('../dist/services/ContentGeneration');
const { getPlanSnapshot }=require('../dist/services/PlanService');
const { PlanUsage,ContentRevision }=require('../dist/models/Plan');
const { resolveContentOptions } = require('../dist/services/ContentCapabilities');
const api = 'http://localhost:3001/api', owners = [], projects = [], workspaces = [];
const limits = process.argv.includes('--limits');
const report = { passed: false, cases: [] }; let stage = 'startup';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function actor(plan) {
  const user = await User.create({ email: crypto.randomUUID() + '@example.invalid', displayName: 'Temporary content plan acceptance', plan }); owners.push(user._id);
  const session = await Session.create({ userId: user._id, tokenFamily: crypto.randomUUID(), refreshTokenHash: crypto.randomBytes(32).toString('hex'), expiresAt: new Date(Date.now() + 1800000) });
  const workspace = await Workspace.create({ ownerId: user._id, name: 'Temporary acceptance' }); workspaces.push(workspace._id);
  const project = await Project.create({ workspaceId: workspace._id, name: 'Temporary acceptance' }); projects.push(project._id);
  const content = await Content.create({ projectId: project._id });
  const wallet = await Wallet.create({ userId: user._id, bucket: 'FREE', available: 1000, reserved: 0 });
  await CreditLot.create({ walletId: wallet._id, amount: 1000, available: 1000, expiresAt: new Date(Date.now() + 86400000) });
  return { user, content, wallet, headers: { Cookie: `accessToken=${signAccessToken({ sessionId: session._id })}; csrfToken=${'c'.repeat(64)}`, 'x-csrf-token': 'c'.repeat(64), 'Content-Type': 'application/json' } };
}
async function request(actor, route, body) {
  const response = await fetch(api + route, { headers: actor.headers, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() };
}
async function run() {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  const input = { topic: 'Ba cách giảm lãng phí thực phẩm trong gia đình', platform: 'reels', audience: 'Gia đình trẻ, muốn tiết kiệm', tone: 'pro' };
  for (const [plan, options] of [
    ['FREE', { durationSeconds: 15 }],
    ['PLUS', { durationSeconds: 60, sceneCount: 8, structure: 'pas', cta: 'Mời người xem chia sẻ một mẹo tiết kiệm của họ' }],
    ['PRO', { durationSeconds: 90, sceneCount: 12, structure: 'storytelling', creativeBrief: 'Kể một câu chuyện gia đình, có chuyển biến rõ, ví dụ thực tế; không bịa số liệu.', visualStyle: 'Warm cinematic family kitchen, consistent natural lighting.' }],
  ]) {
    if (limits) { options.durationSeconds = { FREE: 60, PLUS: 300, PRO: 600 }[plan]; if (plan === 'PRO') options.sceneCount = 20; }
    stage = plan; const fixture = await actor(plan);
    const config = await request(fixture, '/contents/generation-config'); assert.equal(config.body.data.plan, plan);
    if (plan === 'FREE') { const rejected = await request(fixture, `/contents/${fixture.content._id}/generate`, { ...input, plan: 'PRO', sceneCount: 8 }); assert.equal(rejected.status, 403); assert.equal(await Job.countDocuments({ ownerId: fixture.user._id }), 0); }
    const created = await request(fixture, `/contents/${fixture.content._id}/generate`, { ...input, ...options }); assert.equal(created.status, 200);
    let job;
    for (let i = 0; i < 330; i++) { job = await Job.findById(created.body.data.jobId); if (['COMPLETED', 'FAILED'].includes(job.status)) break; await sleep(1000); }
    assert.equal(job.status, 'COMPLETED', job.error || 'CONTENT_ACCEPTANCE_TIMEOUT');
    const result = await request(fixture, `/contents/${fixture.content._id}`); const scenes = result.body.data.scenes;
    validateSceneOptions(scenes, resolveContentOptions(options, await getPlanSnapshot(plan)));
    assert.equal(result.body.data.generationSettings.durationSeconds, options.durationSeconds);
    if (options.sceneCount) assert.equal(scenes.length, options.sceneCount);
    assert.equal(await CreditLedger.countDocuments({ referenceId: 'reserve_' + job._id }), 1);
    assert.equal(await CreditLedger.countDocuments({ referenceId: 'settle_' + job._id }), 1);
    const balance = await Wallet.findById(fixture.wallet._id); assert.equal(balance.available, 980); assert.equal(balance.reserved, 0);
    report.cases.push({ plan, scenes: scenes.length, seconds: scenes.reduce((sum, s) => sum + s.estimatedDuration, 0), words: scenes.reduce((sum, s) => sum + s.narration.split(/\s+/).length, 0), persistedSettings: true, chargedCredits: 20 });
  }
  report.passed = true;
}
run().catch(error => { report.failedStage = stage; report.reason = /^(CONTENT_|INVALID_GEMINI_)/.test(error.message || '') ? error.message : 'CONTENT_ACCEPTANCE_FAILED'; process.exitCode = 1; }).finally(async () => {
  if (mongoose.connection.readyState) {
    const running = await Job.countDocuments({ ownerId: { $in: owners }, status: { $in: ['QUEUED', 'PROCESSING'] } });
    if (!running) {
      const jobs = await Job.find({ ownerId: { $in: owners } }), wallets = await Wallet.find({ userId: { $in: owners } });
      await CreditReservation.deleteMany({ jobId: { $in: jobs.map(job => job._id) } }); await CreditLedger.deleteMany({ walletId: { $in: wallets.map(wallet => wallet._id) } }); await CreditLot.deleteMany({ walletId: { $in: wallets.map(wallet => wallet._id) } });
      await PlanUsage.deleteMany({ownerId:{$in:owners}});const contents=await Content.find({projectId:{$in:projects}});await ContentRevision.deleteMany({contentId:{$in:contents.map(c=>c._id)}});
      await Scene.deleteMany({ projectId: { $in: projects } }); await Content.deleteMany({ projectId: { $in: projects } }); await Project.deleteMany({ _id: { $in: projects } }); await Workspace.deleteMany({ _id: { $in: workspaces } });
      await Wallet.deleteMany({ userId: { $in: owners } }); await Job.deleteMany({ ownerId: { $in: owners } }); await Session.deleteMany({ userId: { $in: owners } }); await User.deleteMany({ _id: { $in: owners } });
      report.fixturesRemoved = true;
    } else report.fixturesRemoved = false;
  }
  await mongoose.disconnect();
  const output = path.resolve(__dirname, limits ? '../../../services/tts/.runtime/content-limit-acceptance.json' : '../../../services/tts/.runtime/content-plan-acceptance.json'); await fs.writeFile(output, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
}).catch(() => { console.error('CONTENT_ACCEPTANCE_CLEANUP_FAILED'); process.exitCode = 1; });

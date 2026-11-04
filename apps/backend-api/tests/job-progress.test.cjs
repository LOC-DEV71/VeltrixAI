const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const crypto = require('crypto');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { Job } = require('../dist/models/Job');
const { setJobProgress, publicProgress, CONTENT_STAGES } = require('../dist/services/JobProgress');
const { getJob } = require('../dist/controllers/JobsController');

let replica;
before(async () => { replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } }); await mongoose.connect(replica.getUri()); await Job.init(); });
after(async () => { await mongoose.disconnect(); await replica?.stop(); });

const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const fixture = (extra = {}) => Job.create({ ownerId: new mongoose.Types.ObjectId(), type: 'AI_CONTENT', status: 'PROCESSING', executionClaim: 'claim-a', idempotencyKey: crypto.randomUUID(), payload: {}, ...extra });
const stages = CONTENT_STAGES.AI_CONTENT;

test('records step position and default message for the claim owner', async () => {
  const job = await fixture();
  await setJobProgress(job._id, 'claim-a', stages, 'WRITING');
  const saved = await Job.findById(job._id).lean();
  assert.equal(saved.progress.stage, 'WRITING');
  assert.equal(saved.progress.step, 2);
  assert.equal(saved.progress.totalSteps, stages.length);
  assert.equal(saved.progress.message, stages[1].message);
});

test('a stale claim or finished job cannot overwrite progress', async () => {
  const job = await fixture();
  await setJobProgress(job._id, 'claim-a', stages, 'PREPARING');
  await setJobProgress(job._id, 'claim-old', stages, 'SAVING');
  assert.equal((await Job.findById(job._id).lean()).progress.stage, 'PREPARING');
  await Job.updateOne({ _id: job._id }, { $set: { status: 'COMPLETED' } });
  await setJobProgress(job._id, 'claim-a', stages, 'SAVING');
  assert.equal((await Job.findById(job._id).lean()).progress.stage, 'PREPARING');
});

test('unknown stage is ignored and never throws', async () => {
  const job = await fixture();
  await setJobProgress(job._id, 'claim-a', stages, 'NOT_A_STAGE');
  assert.equal((await Job.findById(job._id).lean()).progress, undefined);
});

test('queued jobs report a waiting stage; public shape excludes internals', async () => {
  assert.equal(publicProgress({ status: 'QUEUED' }).stage, 'QUEUED');
  assert.equal(publicProgress({ status: 'PROCESSING' }), null);
  const job = await fixture();
  await setJobProgress(job._id, 'claim-a', stages, 'VALIDATING', 'Thông điệp riêng');
  const res = response();
  await getJob({ params: { id: String(job._id) }, user: { _id: job.ownerId } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(Object.keys(res.body.data.progress).sort(), ['message', 'stage', 'step', 'totalSteps', 'updatedAt']);
  assert.equal(res.body.data.progress.message, 'Thông điệp riêng');
  assert.equal(res.body.data.progress.step, 3);
});

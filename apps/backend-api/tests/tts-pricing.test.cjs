const ent=require('../dist/services/EntitlementService');const {seedConfig}=require('../dist/services/PlanService');
const { test, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict'); const mongoose = require('mongoose');
const { Job } = require('../dist/models/Job'), { Voice } = require('../dist/models/Voice'), { User } = require('../dist/models/User');
const { SystemSettings } = require('../dist/models/SystemSettings');
const { CreditService } = require('../dist/services/CreditService'); const { createTtsJob } = require('../dist/services/TtsJobService');
const { getTtsConfig } = require('../dist/controllers/TtsController');
afterEach(() => mock.restoreAll());
const query = value => ({ session() { return this; }, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } });
test('replaying a job created before the rate change preserves its cost and reserves nothing', async () => {
  const id = new mongoose.Types.ObjectId();
  const previous = { payload: { voiceId: id, narration: 'a', cost: 20 } };
  mock.method(mongoose, 'startSession', async () => ({ withTransaction: action => action(), async endSession() {} }));
  mock.method(Job, 'findOne', () => query(previous));
  const pricing = mock.method(SystemSettings, 'findOne', () => { throw new Error('Unexpected repricing'); });
  const reserve = mock.method(CreditService, 'reserveUsable', () => { throw new Error('Unexpected second hold'); });
  const result = await createTtsJob(id, '', String(id), 'old-pricing-check', { text: 'a' });
  assert.equal(result.reused, true); assert.equal(result.job.payload.cost, 20);
  assert.equal(pricing.mock.callCount(), 0); assert.equal(reserve.mock.callCount(), 0);
});
for (const [text, expected, setting] of [
  ['a', 100, { value: 100 }], ['a'.repeat(100), 100, { value: 100 }], ['a'.repeat(101), 200, { value: 100 }],
  ['a'.repeat(200), 200, { value: 100 }], ['😀'.repeat(100), 100, { value: 100 }], ['a', 100, null],
]) test(`TTS ${[...text].length} characters reserves ${expected} credits${setting ? '' : ' with fallback pricing'}`, async () => {
  const id = new mongoose.Types.ObjectId();
  mock.method(ent,'forOwner',async()=>({tier:'FREE',config:seedConfig('FREE')}));mock.method(ent,'reserveUsage',async()=>({}));
  mock.method(mongoose, 'startSession', async () => ({ withTransaction: action => action(), async endSession() {} }));
  mock.method(Job, 'findOne', () => query(null));
  mock.method(Voice, 'findById', () => query({ provider: 'VIENEU_LOCAL', isSystem: true, status: 'ACTIVE', planEntitlements: ['*'] }));
  mock.method(User, 'findById', () => query({ status: 'ACTIVE', plan: 'FREE' }));
  mock.method(SystemSettings, 'findOne', () => query(setting));
  mock.method(Job, 'create', async records => [{ ...records[0], _id: id, async save() {} }]);
  const reserve = mock.method(CreditService, 'reserveUsable', async () => ({ _id: id }));
  const created = await createTtsJob(id, '', String(id), 'pricing-check-key', { text });
  assert.equal(created.job.payload.cost, expected); assert.equal(reserve.mock.calls[0].arguments[1], expected);
  const res = { json(body) { this.body = body; return this; } };
  await getTtsConfig({user:{_id:id}}, res); assert.equal(res.body.data.creditsPer100Chars, 100);
});

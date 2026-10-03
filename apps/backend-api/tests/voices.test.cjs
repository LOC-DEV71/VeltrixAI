const ent=require('../dist/services/EntitlementService');const ps=require('../dist/services/PlanService');
const { test, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { Voice } = require('../dist/models/Voice');
const { User } = require('../dist/models/User');
const { getVoices, getVoicePreview } = require('../dist/controllers/VoicesController');
const { generateSceneAudio } = require('../dist/controllers/TtsController');
const { resolveTtsVoice, voiceAllowed } = require('../dist/services/VoiceService');
beforeEach(()=>mock.method(Voice,'countDocuments',async()=>1));
afterEach(() => mock.restoreAll());
function response() { return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }
function query(value) { return { sort(){return this;},skip(){return this;},limit(){return this;}, session() { return this; }, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } }; }
for (const plan of ['FREE', 'PRO']) test(`GET voices lists ACTIVE system voices with access for server-owned ${plan} plan`, async () => {
  const id = new mongoose.Types.ObjectId();
  mock.method(ent,'forOwner',async()=>({tier:plan,config:ps.seedConfig(plan)}));
  let filter;
  mock.method(Voice, 'find', value => { if (value.isSystem === false) return { sort: async () => [] }; filter = value; return query([{ isSystem:true,_id: id, name: 'Hải Đăng', provider: 'VIENEU_LOCAL', providerVoiceId: 'Hải Đăng', language: 'vi-VN', gender: 'male', planEntitlements: ['*'], status: 'ACTIVE', isDefault: true }]); });
  const res = response(); await getVoices({ user: { plan }, query: { plan: 'ADMIN' } }, res);
  assert.equal(filter.planEntitlements, undefined); assert.equal(res.body.data.systemVoices[0].canUse,true);
  assert.equal(filter.status, 'ACTIVE'); assert.equal(filter.$or[0].isSystem, true);
  assert.equal(res.body.data.systemVoices[0].id, id);
  assert.ok(!('providerVoiceId' in res.body.data.systemVoices[0]));
});
test('voice preview is unavailable for revoked voices, private clones and unsafe file names', async () => {
  const id = String(new mongoose.Types.ObjectId());
  mock.method(ent,'forOwner',async()=>({tier:'FREE',config:ps.seedConfig('FREE')}));
  const safe = { isSystem: true, status: 'ACTIVE', planEntitlements: ['*'], preview: { fileName: 'a'.repeat(64) + '.wav' } };
  for (const [voice, status] of [[{ ...safe,isSystem:false },404], [null, 404], [{ ...safe, status: 'REVOKED' }, 404], [{ ...safe, preview: { fileName: '../secret.env' } }, 503]]) {
    mock.method(Voice, 'findById', () => query(voice));
    const res = response(); await getVoicePreview({ params: { id }, user: { plan: 'FREE' } }, res);
    assert.equal(res.statusCode, status);
  }
});
test('voice entitlement never infers paid access from credit balance or role', () => {
  assert.equal(voiceAllowed({ planEntitlements: ['PRO'] }, 'FREE'), false);
  assert.equal(voiceAllowed({ planEntitlements: ['*'] }, 'FREE'), true);
  assert.equal(voiceAllowed({ planEntitlements: ['PRO'] }, 'PRO'), true);
});
test('provider voice ID is resolved from the database, not request text', async () => {
  const id = new mongoose.Types.ObjectId();
  mock.method(Voice, 'findById', () => query({ status: 'ACTIVE', provider: 'VIENEU_LOCAL', providerVoiceId: 'Hải Đăng', planEntitlements: ['*'] }));
  mock.method(User, 'findById', () => query({ status: 'ACTIVE', plan: 'FREE' }));
  mock.method(ps,'getPlanSnapshot',async()=>({tier:'FREE',config:ps.seedConfig('FREE')}));
  assert.equal((await resolveTtsVoice(id, id)).providerVoiceId, 'Hải Đăng');
  await assert.rejects(resolveTtsVoice(id, 'Hải Đăng'), error => error.code === 'TTS_VOICE_NOT_FOUND');
});
test('TTS API rejects provider names, omitted voiceId and malformed database IDs', async () => {
  mock.method(require('../dist/providers/TtsProvider'), 'getTtsConfiguration', () => ({}));
  mock.method(require('../dist/providers/CloudinaryAudioProvider'), 'getCloudinaryConfiguration', () => ({}));
  const id = String(new mongoose.Types.ObjectId());
  for (const body of [{ voice: 'Hải Đăng' }, {}, { voiceId: 'sv_fake' }, { voiceId: id, providerVoiceId: 'Hải Đăng' }]) {
    const res = response();
    await generateSceneAudio({ params: { id }, get: () => 'request-key-123', user: { _id: new mongoose.Types.ObjectId() }, body }, res);
    assert.equal(res.statusCode, 400); assert.equal(res.body.error.code, 'INVALID_INPUT');
  }
});

test('public catalogue contains safe metadata only and never queries private clones',async()=>{
  const {getVoiceCatalogue}=require('../dist/controllers/VoicesController');
  mock.method(Voice,'find',filter=>{assert.deepEqual(filter,{isSystem:true,status:'ACTIVE'});return query([{_id:new mongoose.Types.ObjectId(),name:'Premium',language:'vi-VN',gender:'male',tags:['News'],planEntitlements:['PRO'],providerVoiceId:'secret-internal',clonedReference:{codes:'private'},ownerId:'private',preview:{text:'Sample',duration:1,fileName:'private',publicId:'private'}}]);});
  mock.method(ent,'forOwner',()=>{throw Error('must not authenticate public catalogue');});
  const res=response();await getVoiceCatalogue({},res);assert.equal(res.statusCode,200);assert.equal(res.body.data.systemVoices.length,1);
  const serialized=JSON.stringify(res.body);for(const field of ['providerVoiceId','clonedReference','ownerId','publicId','fileName','secret-internal'])assert.ok(!serialized.includes(field));
});
test('FREE sees premium voice locked and cannot synthesize it',async()=>{
  const id=new mongoose.Types.ObjectId(),voice={_id:id,isSystem:true,status:'ACTIVE',name:'Premium',language:'vi-VN',gender:'male',planEntitlements:['PRO'],provider:'VIENEU_LOCAL',providerVoiceId:'private'};
  const snapshot={tier:'FREE',config:ps.seedConfig('FREE')};mock.method(ent,'forOwner',async()=>snapshot);
  mock.method(Voice,'find',()=>query([voice]));const res=response();await getVoices({user:{_id:id}},res);
  assert.equal(res.body.data.systemVoices[0].canUse,false);mock.method(Voice,'findById',()=>query(voice));mock.method(User,'findById',()=>query({status:'ACTIVE',plan:'FREE'}));
  await assert.rejects(resolveTtsVoice(id,id,undefined,snapshot),e=>e.code==='TTS_VOICE_PLAN_DENIED');
});
test('anonymous listener can hear stored premium preview without generating a job',async()=>{
  const wav=Buffer.alloc(16044);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(16000,40);
  const hash=require('crypto').createHash('sha256').update(wav).digest('hex');mock.method(require('node:fs/promises'),'readFile',async()=>wav);
  mock.method(ent,'forOwner',()=>{throw Error('preview must be public');});mock.method(Voice,'findById',()=>query({isSystem:true,status:'ACTIVE',planEntitlements:['PRO'],preview:{fileName:hash+'.wav',sha256:hash}}));
  const res=response();res.set=headers=>{res.headers=headers;return res;};res.send=audio=>{res.audio=audio;return res;};await getVoicePreview({params:{id:String(new mongoose.Types.ObjectId())}},res);
  assert.equal(res.statusCode,200);assert.equal(res.headers['Content-Type'],'audio/wav');assert.deepEqual(res.audio,wav);
});

const {test,before,after}=require('node:test'), assert=require('node:assert/strict'), crypto=require('node:crypto'), mongoose=require('mongoose');
const {MongoMemoryReplSet}=require('mongodb-memory-server');
const {DeveloperToken,DeveloperTokenAudit,DeveloperRateUsage}=require('../dist/models/DeveloperToken');
const {createDeveloperToken,revokeDeveloperToken,tokenDigest,tokenView}=require('../dist/services/DeveloperTokens');
const {User}=require('../dist/models/User'),{Job}=require('../dist/models/Job'),{Voice}=require('../dist/models/Voice');
const {Wallet,CreditLot,CreditReservation,CreditLedger}=require('../dist/models/Credits');
const {Plan,PlanRevision,PlanAudit,PlanUsage}=require('../dist/models/Plan');
const {savePlan,seedConfig}=require('../dist/services/PlanService');
let replica,server,origin,owner,other;
const issue=(user=owner,scopes=['voices:read','tts:read','tts:write'])=>createDeveloperToken(user._id,{name:'Integration fixture',scopes,expiresInDays:30});
const call=async(path,token,options={})=>{const response=await fetch(origin+path,{...options,headers:{...(token?{Authorization:'Bearer '+token}:{}),...options.headers}});return {status:response.status,headers:response.headers,body:await response.json()};};
before(async()=>{
  Object.assign(process.env,{TTS_SERVICE_URL:'http://127.0.0.1:9999',TTS_SERVICE_TOKEN:'test-only-token-'.repeat(3),CLOUDINARY_CLOUD_NAME:'fixture',CLOUDINARY_API_KEY:'123',CLOUDINARY_API_SECRET:'fixture-only'});
  replica=await MongoMemoryReplSet.create({replSet:{count:1}});await mongoose.connect(replica.getUri());
  await Promise.all([DeveloperToken,DeveloperTokenAudit,DeveloperRateUsage,User,Job,Voice,Wallet,CreditLot,CreditReservation,CreditLedger,Plan,PlanRevision,PlanAudit,PlanUsage].map(m=>m.init()));
  for (const tier of ['FREE','BASIC_STUDENT','PLUS','PRO']) {const c=seedConfig(tier);c.limits.requestsPerMinute=100;await savePlan(tier,c,0,null,'Developer API test fixture',true);}
  owner=await User.create({email:crypto.randomUUID()+'@example.invalid',displayName:'Developer fixture',plan:'PRO'});
  other=await User.create({email:crypto.randomUUID()+'@example.invalid',displayName:'Other fixture',plan:'FREE'});
  const app=require('express')();app.use(require('express').json());app.use(require('cookie-parser')());app.use('/api/developer',require('../dist/routes/developer').default);
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));origin='http://127.0.0.1:'+server.address().port+'/api/developer';
});
after(async()=>{await new Promise(r=>server.close(r));await mongoose.disconnect();await replica?.stop();});
test('tokens store hashes only, validate input and audit creation/revocation once',async()=>{
  for(const bad of [{name:''},{expiresInDays:0},{expiresInDays:366},{scopes:[]},{scopes:['admin']},{scopes:['tts:read','tts:read']},{secret:'injected'}])await assert.rejects(createDeveloperToken(owner._id,{name:'App',scopes:['tts:read'],expiresInDays:30,...bad}),e=>e.code==='API_TOKEN_INVALID_INPUT');
  const t=await issue(),stored=await DeveloperToken.findById(t.id).select('+tokenHash').lean();assert.equal(stored.tokenHash,tokenDigest(t.token));assert.ok(!JSON.stringify(stored).includes(t.token));assert.equal(tokenView(stored).tokenHash,undefined);
  await assert.rejects(revokeDeveloperToken(other._id,t.id),e=>e.code==='API_TOKEN_NOT_FOUND');await revokeDeveloperToken(owner._id,t.id);await revokeDeveloperToken(owner._id,t.id);
  assert.equal(await DeveloperTokenAudit.countDocuments({tokenId:t.id}),2);await assert.rejects(DeveloperTokenAudit.updateMany({},{$set:{action:'CREATE'}}),/IMMUTABLE/);
});
test('Bearer auth rejects cookies, missing scope, expiration, revocation and banned owners',async()=>{
  assert.equal((await call('/v1/limits',null)).status,401);
  const limited=await issue(owner,['voices:read']);assert.equal((await call('/v1/limits',limited.token)).body.error.code,'API_SCOPE_REQUIRED');
  const t=await issue();assert.equal((await call('/v1/limits',t.token)).status,200);await DeveloperToken.updateOne({_id:t.id},{$set:{expiresAt:new Date(0)}});assert.equal((await call('/v1/limits',t.token)).status,401);
  const revoked=await issue();await revokeDeveloperToken(owner._id,revoked.id);assert.equal((await call('/v1/limits',revoked.token)).status,401);
  const banned=await issue(other);await User.updateOne({_id:other._id},{$set:{status:'BANNED'}});assert.equal((await call('/v1/limits',banned.token)).status,403);await User.updateOne({_id:other._id},{$set:{status:'ACTIVE'}});
  const suspended=await issue(other);await User.updateOne({_id:other._id},{$set:{developerApiDisabled:true}});assert.equal((await call('/v1/limits',suspended.token)).body.error.code,'API_ACCESS_SUSPENDED');assert.equal((await User.findById(other._id)).status,'ACTIVE');await User.updateOne({_id:other._id},{$set:{developerApiDisabled:false}});
});
test('request telemetry stores safe metadata with retention and no Bearer secret',async()=>{
 const {DeveloperRequest}=require('../dist/models/DeveloperRequest');const t=await issue();await call('/v1/limits',t.token);
 let rows=[];for(let i=0;i<30&&!rows.length;i++){rows=await DeveloperRequest.find({tokenId:t.id}).lean();await new Promise(r=>setTimeout(r,10));}
 assert.equal(rows.length,1);assert.equal(rows[0].status,200);assert.ok(rows[0].expiresAt>rows[0].createdAt);assert.ok(!JSON.stringify(rows).includes(t.token));assert.equal(rows[0].headers,undefined);assert.equal(rows[0].body,undefined);
});
test('API job ownership and result projection never expose provider details',async()=>{
  const t=await issue(),foreign=await issue(other);
  const job=await Job.create({ownerId:owner._id,type:'TTS',status:'COMPLETED',idempotencyKey:crypto.randomUUID(),payload:{source:'STANDALONE',internalSecret:'never-return'},result:{audioId:new mongoose.Types.ObjectId(),duration:2,chargedCredits:100,providerVoiceId:'private-provider'}});
  const mine=await call('/v1/tts/jobs/'+job._id,t.token);assert.equal(mine.status,200);assert.equal(mine.body.data.result.duration,2);assert.ok(!JSON.stringify(mine.body).includes('private-provider'));assert.ok(!JSON.stringify(mine.body).includes('never-return'));
  assert.equal((await call('/v1/tts/jobs/'+job._id,foreign.token)).status,404);assert.equal((await call('/v1/tts/jobs/'+job._id+'/audio',foreign.token)).status,404);assert.equal((await call('/v1/tts/jobs/not-an-id',t.token)).status,404);
  const pending=await Job.create({ownerId:owner._id,type:'TTS',idempotencyKey:crypto.randomUUID(),payload:{source:'STANDALONE'}});assert.equal((await call('/v1/tts/jobs/'+pending._id+'/audio',t.token)).status,409);
});
test('real API creates snapshotted TTS jobs and idempotent retries reserve credit only once',async()=>{
  const t=await issue(),wallet=await Wallet.create({userId:owner._id,bucket:'PAID',available:10000});await CreditLot.create({walletId:wallet._id,amount:10000,available:10000,expiresAt:new Date(Date.now()+86400000)});
  const voice=await Voice.create({provider:'VIENEU_LOCAL',providerVoiceId:crypto.randomUUID(),name:'API fixture',language:'vi',gender:'male',planEntitlements:['*'],status:'ACTIVE',isSystem:true});
  const key=crypto.randomUUID(),options={method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({text:'Xin chao.',voiceId:String(voice._id)})};
  const first=await call('/v1/tts/jobs',t.token,options);assert.equal(first.status,202,JSON.stringify(first.body));const retry=await call('/v1/tts/jobs',t.token,options);assert.equal(retry.status,200);assert.equal(first.body.data.jobId,retry.body.data.jobId);
  const after=await Wallet.findById(wallet._id);assert.equal(after.reserved,first.body.data.reservedCredits);assert.equal(after.available,10000-first.body.data.reservedCredits);
  const job=await Job.findById(first.body.data.jobId);assert.ok(job.payload.entitlementSnapshot);assert.equal(await CreditReservation.countDocuments({jobId:job._id}),1);
  const bad=await call('/v1/tts/jobs',t.token,{...options,body:JSON.stringify({text:'Xin chao.',voiceId:String(voice._id),providerVoiceId:'injected'})});assert.equal(bad.status,400);
});
test('each plan enforces input boundaries, denies restricted voices before holding credits',async()=>{
  const voice=await Voice.create({provider:'VIENEU_LOCAL',providerVoiceId:crypto.randomUUID(),name:'All plans',language:'vi',gender:'male',planEntitlements:['*'],status:'ACTIVE',isSystem:true});
  const restricted=await Voice.create({provider:'VIENEU_LOCAL',providerVoiceId:crypto.randomUUID(),name:'Pro only',language:'vi',gender:'male',planEntitlements:['PRO'],status:'ACTIVE',isSystem:true});
  for(const tier of ['FREE','BASIC_STUDENT','PLUS','PRO']) {
    const u=await User.create({email:crypto.randomUUID()+'@example.invalid',displayName:tier,plan:tier}),t=await issue(u);
    const c=seedConfig(tier),request=(text,voiceId=voice._id)=>call('/v1/tts/jobs',t.token,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({text,voiceId:String(voiceId)})});
    const over=await request('a'.repeat(c.tts.maxTextChars+1));assert.equal(over.body.error.code,'TTS_TEXT_LIMIT_EXCEEDED');
    const boundary=await request('a'.repeat(c.tts.maxTextChars));assert.equal(boundary.body.error.code,'INSUFFICIENT_CREDIT');assert.equal(boundary.status,402);
    const missing=await request('Hi',new mongoose.Types.ObjectId());assert.equal(missing.status,404);
    if(tier!=='PRO')assert.equal((await request('Hi',restricted._id)).body.error.code,'TTS_VOICE_PLAN_DENIED');
    assert.equal(await CreditReservation.countDocuments({jobId:{$in:await Job.find({ownerId:u._id}).distinct('_id')}}),0);
  }
});
test('account-level rate limits are dynamic and shared across multiple tokens',async()=>{
  const a=await issue(other),b=await issue(other),c=seedConfig('FREE');c.limits.requestsPerMinute=2;await savePlan('FREE',c,1,null,'Test rate boundary',true);await DeveloperRateUsage.deleteMany({ownerId:other._id});
  assert.equal((await call('/v1/limits',a.token)).status,200);assert.equal((await call('/v1/limits',b.token)).status,200);const excess=await call('/v1/limits',a.token);assert.equal(excess.status,429);assert.equal(excess.body.error.code,'API_RATE_LIMIT_EXCEEDED');assert.ok(Number(excess.headers.get('Retry-After'))>0);
});
test('token administration requires session and CSRF; histories are scoped and paginated at ten',async()=>{
  const {Session}=require('../dist/models/Session'),{signAccessToken}=require('../dist/utils/jwt');
  const u=await User.create({email:crypto.randomUUID()+'@example.invalid',displayName:'Token pagination',plan:'PLUS'});
  const session=await Session.create({userId:u._id,tokenFamily:crypto.randomUUID(),refreshTokenHash:'fixture',expiresAt:new Date(Date.now()+60000)});
  const headers={Cookie:'accessToken='+signAccessToken({sessionId:session._id})+'; csrfToken=fixture','Content-Type':'application/json'};
  assert.equal((await call('/tokens',null)).status,401);assert.equal((await call('/tokens',null,{method:'POST',headers,body:JSON.stringify({name:'App',scopes:['tts:read'],expiresInDays:30})})).status,403);
  for(let i=0;i<11;i++){const response=await call('/tokens',null,{method:'POST',headers:{...headers,'x-csrf-token':'fixture'},body:JSON.stringify({name:'App '+i,scopes:['tts:read'],expiresInDays:30})});assert.equal(response.status,201);}
  const a=await call('/tokens?page=1',null,{headers}),b=await call('/tokens?page=2',null,{headers});assert.equal(a.body.data.items.length,10);assert.equal(b.body.data.items.length,1);assert.equal(a.body.data.total,11);assert.ok(!JSON.stringify(a.body).includes('tokenHash'));assert.ok(!a.body.data.items.some(t=>t.token));
  assert.equal((await call('/tokens/'+a.body.data.items[0].id,null,{method:'DELETE',headers:{...headers,'x-csrf-token':'fixture'}})).status,200);
});

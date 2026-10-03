const {test,before,after,mock}=require('node:test');
const assert=require('node:assert/strict'),mongoose=require('mongoose');
process.env.AI_PROVIDER='gemini';process.env.GEMINI_API_KEY='unit-test-provider-key'; // Inference is mocked in the prompt-only test.
const {MongoMemoryReplSet}=require('mongodb-memory-server');
const {PLAN_FIELDS,validatePlan,planDiff}=require('../dist/services/PlanSchema');
const {seedConfig,savePlan,getPlanSnapshot,verifySnapshot}=require('../dist/services/PlanService');
const {validateRequest,reserveUsage,claimPlanJob}=require('../dist/services/EntitlementService');
const {Plan,PlanRevision,PlanAudit,PlanUsage,ContentRevision}=require('../dist/models/Plan');
const {User}=require('../dist/models/User'),{Voice}=require('../dist/models/Voice'),{Job}=require('../dist/models/Job');
const {Wallet,CreditLot,CreditLedger}=require('../dist/models/Credits');
const {createTtsJob}=require('../dist/services/TtsJobService');
const {claimTtsJob,processTtsJob}=require('../dist/workers/TtsWorker');
process.env.NODE_ENV='test';
let replica;
test('worker claims serialize concurrency and protect running old snapshots',async()=>{
 const original=await getPlanSnapshot('PRO'),config=structuredClone(original.config);config.limits.concurrentJobs=1;config.limits.concurrentAiJobs=1;
 await savePlan('PRO',config,original.revision,null,'Execution fence boundary test',true);
 const old=await getPlanSnapshot('PRO'),owner=new mongoose.Types.ObjectId();
 const [first]=await Job.create([{ownerId:owner,type:'AI_CONTENT',status:'QUEUED',payload:{entitlementSnapshot:old},idempotencyKey:'claim-first-'+owner}]);
 const a=await claimPlanJob({_id:first._id},10000);assert.ok(a);assert.equal(a.attempts,1);
 const expanded=structuredClone(old.config);expanded.limits.concurrentJobs=3;expanded.limits.concurrentAiJobs=3;
 await savePlan('PRO',expanded,old.revision,null,'Expand new request concurrency',true);const newer=await getPlanSnapshot('PRO');
 const [second]=await Job.create([{ownerId:owner,type:'AI_CONTENT',status:'QUEUED',payload:{entitlementSnapshot:newer},idempotencyKey:'claim-second-'+owner}]);
 assert.equal(await claimPlanJob({_id:second._id},10000),null);assert.equal((await Job.findById(second._id)).attempts,0);
 await Job.updateOne({_id:first._id},{$set:{status:'COMPLETED'}});assert.ok(await claimPlanJob({_id:second._id},10000));
 await savePlan('PRO',original.config,newer.revision,null,'Restore execution test settings',true);
});
test('two workers cannot claim two jobs against a one-job snapshot',async()=>{
 const original=await getPlanSnapshot('PRO'),config=structuredClone(original.config);config.limits.concurrentJobs=1;
 await savePlan('PRO',config,original.revision,null,'Concurrent worker claim test',true);const snapshot=await getPlanSnapshot('PRO'),owner=new mongoose.Types.ObjectId();
 const jobs=await Job.create([1,2].map(n=>({ownerId:owner,type:'AI_CONTENT',status:'QUEUED',payload:{entitlementSnapshot:snapshot},idempotencyKey:'racing-claim-'+owner+'-'+n})));
 const results=await Promise.all(jobs.map(j=>claimPlanJob({_id:j._id},10000)));assert.equal(results.filter(Boolean).length,1);
 await savePlan('PRO',original.config,snapshot.revision,null,'Restore concurrent claim settings',true);
});
test('credit expiration and rollover reductions require confirmation',()=>{
 const before=seedConfig('PRO'),after=structuredClone(before);before.credits.expiresAfterDays=30;after.credits.expiresAfterDays=7;
 before.credits.maxRollover=500;after.credits.maxRollover=100;
 const diff=planDiff(before,after);assert.ok(diff.find(d=>d.path==='credits.expiresAfterDays').restrictive);assert.ok(diff.find(d=>d.path==='credits.maxRollover').restrictive);
});
before(async()=>{
  replica=await MongoMemoryReplSet.create({replSet:{count:1}});await mongoose.connect(replica.getUri());
  await Promise.all([Plan,PlanRevision,PlanAudit,PlanUsage,Job,User,Voice,Wallet,CreditLot,CreditLedger].map(m=>m.init()));
  for(const tier of ['FREE','BASIC_STUDENT','PLUS','PRO'])await savePlan(tier,seedConfig(tier),0,null,'Initial test configuration',true);
});
after(async()=>{await mongoose.disconnect();await replica?.stop();});
for(const tier of ['FREE','BASIC_STUDENT','PLUS','PRO'])test(tier+' normalized configuration',()=>assert.deepEqual(validatePlan(seedConfig(tier),tier),seedConfig(tier)));
for(const f of PLAN_FIELDS.filter(f=>['limit','number'].includes(f.type)))test('integer boundary: '+f.section+'.'+f.key,()=>{
  const c=seedConfig('PRO');c[f.section][f.key]=-1;assert.throws(()=>validatePlan(c,'PRO'),e=>e.code==='PLAN_INVALID');
  c[f.section][f.key]=1.5;assert.throws(()=>validatePlan(c,'PRO'));
  c[f.section][f.key]=Number.MAX_SAFE_INTEGER+1;assert.throws(()=>validatePlan(c,'PRO'));
  if(f.type==='limit'){c[f.section][f.key]=0;assert.throws(()=>validatePlan(c,'PRO'));}
  if(f.nullable&&!['minReferenceSeconds','maxReferenceSeconds','maxFileBytes'].includes(f.key)){c[f.section][f.key]=null;assert.doesNotThrow(()=>validatePlan(c,'PRO'));}
});
test('cross-field validation and Basic Pro-only restriction',()=>{
  let c=seedConfig('BASIC_STUDENT');c.content.creativeDirection=true;assert.throws(()=>validatePlan(c,'BASIC_STUDENT'));
  c=seedConfig('FREE');c.clone.maxVoices=3;assert.throws(()=>validatePlan(c,'FREE'));
  c=seedConfig('PRO');c.clone.minReferenceSeconds=8;c.clone.maxReferenceSeconds=3;assert.throws(()=>validatePlan(c,'PRO'));
  c=seedConfig('PRO');c.overview.apiKey='private';assert.throws(()=>validatePlan(c,'PRO'));
});
test('request boundaries and stable errors',async()=>{
  const s=await getPlanSnapshot('PRO'),c=s.config;
  c.content.maxInputChars=100;validateRequest(s,'AI_CONTENT',{input:'a'.repeat(100)});
  assert.throws(()=>validateRequest(s,'AI_CONTENT',{input:'a'.repeat(101)}),e=>e.code==='CONTENT_INPUT_LIMIT_EXCEEDED');
  c.content.enabled=false;assert.throws(()=>validateRequest(s,'AI_CONTENT',{}),e=>e.code==='CONTENT_FEATURE_DISABLED');c.content.enabled=true;
  c.scenes.maxScenes=5;validateRequest(s,'AI_SPLIT',{scenes:5});assert.throws(()=>validateRequest(s,'AI_SPLIT',{scenes:6}),e=>e.code==='SCENE_LIMIT_EXCEEDED');
  c.tts.maxTextChars=100;validateRequest(s,'TTS',{input:'x'.repeat(100)});assert.throws(()=>validateRequest(s,'TTS',{input:'x'.repeat(101)}),e=>e.code==='TTS_TEXT_LIMIT_EXCEEDED');
  c.clone.maxTextChars=20;validateRequest(s,'TTS',{input:'x'.repeat(20),clone:true});assert.throws(()=>validateRequest(s,'TTS',{input:'x'.repeat(21),clone:true}),e=>e.code==='CLONE_TEXT_LIMIT_EXCEEDED');
  validateRequest(s,'VOICE_ENROLLMENT',{duration:3,bytes:4194304});validateRequest(s,'VOICE_ENROLLMENT',{duration:8});
  assert.throws(()=>validateRequest(s,'VOICE_ENROLLMENT',{duration:8.01}));assert.throws(()=>validateRequest(s,'VOICE_ENROLLMENT',{bytes:4194305}));
  c.prompts.imageEnabled=false;c.prompts.videoEnabled=false;assert.throws(()=>validateRequest(s,'AI_PROMPT_GEN',{}),e=>e.code==='CONTENT_FEATURE_DISABLED');
  c.regeneration.enabled=false;assert.throws(()=>validateRequest(s,'AI_CONTENT',{regenerate:true}),e=>e.code==='CONTENT_FEATURE_DISABLED');
  assert.throws(()=>validateRequest(s,'AI_CONTENT',{language:'unsupported'}));
});
test('confirmation, concurrent update, rollback and immutable history',async()=>{
  const old=await getPlanSnapshot('PLUS'),config=structuredClone(old.config);config.tts.maxTextChars=100;
  assert.ok(planDiff(old.config,config).some(d=>d.restrictive));
  await assert.rejects(()=>savePlan('PLUS',config,old.revision,null,'Reduce limits test',false),e=>e.code==='PLAN_CONFIRMATION_REQUIRED');
  const results=await Promise.allSettled([savePlan('PLUS',config,old.revision,null,'Concurrent update one',true),savePlan('PLUS',config,old.revision,null,'Concurrent update two',true)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'PLAN_REVISION_CONFLICT');
  await savePlan('PLUS',old.config,2,null,'Rollback configuration test',true,'ROLLBACK');assert.equal((await getPlanSnapshot('PLUS')).revision,3);
  assert.equal((await verifySnapshot(old)).config.tts.maxTextChars,3000);
  await assert.rejects(()=>PlanAudit.updateOne({planId:old.planId},{$set:{reason:'edited'}}),/IMMUTABLE/);
  await assert.rejects(()=>PlanRevision.deleteOne({planId:old.planId}),/IMMUTABLE/);assert.equal(await PlanAudit.countDocuments({planId:old.planId}),3);
});
test('every monthly quota boundary and concurrent reservations',async()=>{
  const user=await User.create({email:'quota@example.invalid',displayName:'Quota'});
  for(const [key,section,field,code]of [['contentChars','content','monthlyChars','CONTENT_QUOTA_EXCEEDED'],['contentJobs','content','monthlyJobs','CONTENT_QUOTA_EXCEEDED'],['prompts','prompts','monthlyGenerations','PROMPT_QUOTA_EXCEEDED'],['ttsChars','tts','monthlyChars','PLAN_LIMIT_EXCEEDED'],['cloneChars','clone','monthlyChars','PLAN_LIMIT_EXCEEDED'],['cloneSeconds','clone','monthlySeconds','PLAN_LIMIT_EXCEEDED'],['enrollments','clone','monthlyEnrollments','CLONE_VOICE_LIMIT_EXCEEDED']]){
    await PlanUsage.deleteMany({ownerId:user._id});const snap=await getPlanSnapshot('PRO');snap.config[section][field]=100;
    const session=await mongoose.startSession();try{await session.withTransaction(()=>reserveUsage(user._id,snap,'TTS',{[key]:100},session));await assert.rejects(()=>session.withTransaction(()=>reserveUsage(user._id,snap,'TTS',{[key]:1},session)),e=>e.code===code);}finally{await session.endSession();}
  }
  await PlanUsage.deleteMany({ownerId:user._id});const snap=await getPlanSnapshot('PRO');snap.config.tts.monthlyChars=100;
  const reserve=async()=>{const session=await mongoose.startSession();try{return await session.withTransaction(()=>reserveUsage(user._id,snap,'TTS',{ttsChars:60},session));}finally{await session.endSession();}};
  const concurrent=await Promise.allSettled([reserve(),reserve()]);assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await PlanUsage.findOne({ownerId:user._id,period:new Date().toISOString().slice(0,7)})).counts.ttsChars,60);
});
test('existing TTS job retains old price and entitlement after disable',async()=>{
  const user=await User.create({email:'tts-snapshot@example.invalid',displayName:'Snapshot',plan:'FREE'});
  const voice=await Voice.create({provider:'VIENEU_LOCAL',providerVoiceId:'fixture',name:'Fixture',language:'vi-VN',gender:'male',isSystem:true,status:'ACTIVE',planEntitlements:['*']});
  const wallet=await Wallet.create({userId:user._id,bucket:'FREE',available:1000});
  await CreditLot.create({walletId:wallet._id,amount:1000,available:1000,expiresAt:new Date(Date.now()+86400000)});
  const created=await createTtsJob(user._id,'',String(voice._id),'original-snapshot-request',{text:'Test'});assert.equal(created.job.payload.cost,100);
  const before=await getPlanSnapshot('FREE'),cfg=structuredClone(before.config);cfg.tts.enabled=false;cfg.credits.ttsPer100Chars=500;
  await savePlan('FREE',cfg,before.revision,null,'Disable only new requests',true);
  const reused=await createTtsJob(user._id,'',String(voice._id),'original-snapshot-request',{text:'Test'});assert.equal(reused.reused,true);assert.equal(reused.job.payload.cost,100);
  await assert.rejects(()=>createTtsJob(user._id,'',String(voice._id),'new-snapshot-request',{text:'Test'}),e=>e.code==='PLAN_FEATURE_DISABLED');
  const claimed=await claimTtsJob(String(created.job._id));
  await processTtsJob(claimed,{synthesize:async()=>({audio:Buffer.from('test')})},{upload:async(_,publicId)=>({publicId,assetId:'fixture'}),download:async()=>({audio:Buffer.from('test'),bytes:4,duration:1,sampleRate:48000,channels:1}),destroy:async()=>{}});
  assert.equal((await Job.findById(created.job._id)).status,'COMPLETED');assert.equal((await Wallet.findById(wallet._id)).available,900);assert.equal((await Wallet.findById(wallet._id)).reserved,0);
  await savePlan('FREE',before.config,before.revision+1,null,'Restore configuration test',true,'ROLLBACK');
});
test('job/rate/concurrency limits and output boundaries',async()=>{
  const {validateOutput}=require('../dist/services/EntitlementService');
  const user=await User.create({email:'concurrency@example.invalid',displayName:'Concurrency'});
  const snap=await getPlanSnapshot('PRO');const session=await mongoose.startSession();
  try{
    snap.config.limits.requestsPerMinute=1;
    await session.withTransaction(()=>reserveUsage(user._id,snap,'AI_CONTENT',{contentJobs:1},session));
    await assert.rejects(()=>session.withTransaction(()=>reserveUsage(user._id,snap,'AI_CONTENT',{contentJobs:1},session)),e=>e.code==='PLAN_LIMIT_EXCEEDED');
    await PlanUsage.deleteMany({ownerId:user._id});snap.config.limits.requestsPerMinute=null;snap.config.limits.concurrentAiJobs=1;
    await Job.create({ownerId:user._id,type:'AI_CONTENT',idempotencyKey:'quota-active-ai',status:'PROCESSING'});
    await assert.rejects(()=>session.withTransaction(()=>reserveUsage(user._id,snap,'AI_CONTENT',{},session)),e=>e.code==='PLAN_LIMIT_EXCEEDED');
    snap.config.limits.concurrentJobs=1;
    await assert.rejects(()=>session.withTransaction(()=>reserveUsage(user._id,snap,'TTS',{},session)),e=>e.code==='PLAN_LIMIT_EXCEEDED');
    snap.config.limits.concurrentJobs=null;snap.config.clone.concurrentJobs=1;
    await Job.create({ownerId:user._id,type:'VOICE_ENROLLMENT',idempotencyKey:'quota-active-clone',status:'PROCESSING'});
    await assert.rejects(()=>session.withTransaction(()=>reserveUsage(user._id,snap,'VOICE_ENROLLMENT',{},session)),e=>e.code==='PLAN_LIMIT_EXCEEDED');
  }finally{await session.endSession();}
  const scene={narration:'x'.repeat(10),imagePrompt:'image',videoPrompt:'video'};snap.config.scenes.maxNarrationChars=10;
  validateOutput(snap,[scene]);assert.throws(()=>validateOutput(snap,[{...scene,narration:'x'.repeat(11)}]),e=>e.code==='SCENE_LIMIT_EXCEEDED');
  snap.config.scenes.maxScenes=1;assert.throws(()=>validateOutput(snap,[scene,scene]),e=>e.code==='SCENE_LIMIT_EXCEEDED');
  snap.config.content.maxOutputChars=scene.narration.length;validateOutput(snap,[scene]);snap.config.content.maxOutputChars--;
  assert.throws(()=>validateOutput(snap,[scene]),e=>e.code==='CONTENT_QUOTA_EXCEEDED');
});
test('storage boundaries include exact counts and serialization',async()=>{
  const {reserveStorage}=require('../dist/services/EntitlementService'),{Workspace}=require('../dist/models/Workspace'),{Project}=require('../dist/models/Project'),{Content}=require('../dist/models/Content');
  const user=await User.create({email:'storage@example.invalid',displayName:'Storage'}),snap=await getPlanSnapshot('FREE');
  snap.config.storage={maxProjects:1,maxWorkspaces:1,maxContents:1};const session=await mongoose.startSession();
  try{await session.withTransaction(()=>reserveStorage(user._id,snap,'workspaces',session));const workspace=await Workspace.create({ownerId:user._id,name:'Workspace'});await assert.rejects(()=>session.withTransaction(()=>reserveStorage(user._id,snap,'workspaces',session)),e=>e.code==='PLAN_LIMIT_EXCEEDED');await session.withTransaction(()=>reserveStorage(user._id,snap,'projects',session));const project=await Project.create({workspaceId:workspace._id,name:'Project'});await assert.rejects(()=>session.withTransaction(()=>reserveStorage(user._id,snap,'projects',session)),e=>e.code==='PLAN_LIMIT_EXCEEDED');await session.withTransaction(()=>reserveStorage(user._id,snap,'contents',session));await Content.create({projectId:project._id});await assert.rejects(()=>session.withTransaction(()=>reserveStorage(user._id,snap,'contents',session)),e=>e.code==='PLAN_LIMIT_EXCEEDED');}finally{await session.endSession();}
});
test('OWNER/ADMIN contract rejects unauthenticated users, ordinary roles and missing CSRF',async()=>{
  const express=require('express'),request=require('supertest'),cookieParser=require('cookie-parser'),crypto=require('crypto');
  const {AdminSession}=require('../dist/models/AdminSession'),{AdminAccount}=require('../dist/models/AdminAccount'),{AdminRole}=require('../dist/models/AdminRole'),{signAccessToken}=require('../dist/utils/jwt');
  const app=express();app.use(express.json(),cookieParser());app.use('/api/admin/plans',require('../dist/routes/adminPlans').default);
  assert.equal((await request(app).get('/api/admin/plans')).status,401);
  const actor=async roles=>{const role=await AdminRole.create({name:roles[0]||'VIEWER',permissions:roles.length?['plans.read','plans.update']:[]});const user=await AdminAccount.create({email:crypto.randomUUID()+'@example.invalid',displayName:'Admin contract',passwordHash:crypto.randomUUID(),roleId:role._id});const session=await AdminSession.create({adminId:user._id,tokenFamily:crypto.randomUUID(),refreshTokenHash:crypto.randomUUID(),expiresAt:new Date(Date.now()+600000)});return {user,cookie:'adminAccessToken='+signAccessToken({sessionId:session._id})+'; csrfToken='+ 'a'.repeat(64)};};
  const normal=await actor([]);assert.equal((await request(app).get('/api/admin/plans').set('Cookie',normal.cookie)).status,403);
  for(const role of ['OWNER','ADMIN']){const who=await actor([role]);const list=await request(app).get('/api/admin/plans').set('Cookie',who.cookie);assert.equal(list.status,200);assert.equal(list.body.data.length,4);const plan=await getPlanSnapshot('BASIC_STUDENT');const config=structuredClone(plan.config);config.overview.description='Role boundary test '+role;assert.equal((await request(app).put('/api/admin/plans/BASIC_STUDENT').set('Cookie',who.cookie).send({config,expectedRevision:plan.revision,reason:'Role test change'})).status,403);const preview=await request(app).post('/api/admin/plans/BASIC_STUDENT/preview').set('Cookie',who.cookie).set('x-csrf-token','a'.repeat(64)).send({config,expectedRevision:plan.revision});assert.equal(preview.status,200);assert.equal(preview.body.data.diff.length,1);const saved=await request(app).put('/api/admin/plans/BASIC_STUDENT').set('Cookie',who.cookie).set('x-csrf-token','a'.repeat(64)).send({config,expectedRevision:plan.revision,reason:'Role test '+role});if(config.overview.description===plan.config.overview.description)assert.equal(saved.status,400);else{assert.equal(saved.status,200);const entry=await PlanAudit.findOne({planId:plan.planId,revision:saved.body.data.revision});assert.equal(String(entry.changedBy),String(who.user._id));}}
});
test('Basic cloning is database-controlled; voice boundary and replay keep the old entitlement',async()=>{
  const {createEnrollment}=require('../dist/services/VoiceEnrollmentService');
  const {claimEnrollmentJob,processEnrollmentJob}=require('../dist/workers/VoiceEnrollmentWorker');
  const {VoiceEnrollment}=require('../dist/models/VoiceEnrollment');
  const before=await getPlanSnapshot('BASIC_STUDENT'),config=structuredClone(before.config);
  config.clone={...seedConfig('PLUS').clone,maxVoices:1,monthlyEnrollments:1};
  await savePlan('BASIC_STUDENT',config,before.revision,null,'Allow Basic cloning for boundary test',true);
  const user=await User.create({email:'basic-clone@example.invalid',displayName:'Basic clone',plan:'BASIC_STUDENT'});
  const wav=Buffer.alloc(44+128000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
  const input={name:'Basic fixture',audioBase64:wav.toString('base64'),consentToClone:true,hasVoiceRights:true,consentVersion:'voice-cloning-v1'};
  const first=await createEnrollment(user._id,input,'basic-clone-snapshot');
  await assert.rejects(()=>createEnrollment(user._id,input,'basic-clone-second'),e=>e.code==='CLONE_VOICE_LIMIT_EXCEEDED');
  const active=await getPlanSnapshot('BASIC_STUDENT');await savePlan('BASIC_STUDENT',before.config,active.revision,null,'Disable Basic only for new requests',true,'ROLLBACK');
  const replay=await createEnrollment(user._id,input,'basic-clone-snapshot');assert.equal(replay.reused,true);
  const cloud=new Map();const claimed=await claimEnrollmentJob(String(first.jobId));
  await processEnrollmentJob(claimed,{enroll:async()=>({speakerEmbedding:Array(192).fill(.1),codes:[Array(16).fill(1)]})},{upload:async(audio,id)=>{cloud.set(id,audio);return {publicId:id};},download:async id=>({audio:cloud.get(id)}),destroy:async id=>cloud.delete(id)});
  assert.equal((await VoiceEnrollment.findById(first.enrollmentId)).status,'ACTIVE');
});
test('versioned grants respect expiration/rollover and preserve legacy lots',async()=>{
  const {CreditService}=require('../dist/services/CreditService');
  const original=await getPlanSnapshot('PRO'),config=structuredClone(original.config);config.credits.monthlyGrant=100;config.credits.maxRollover=50;config.credits.expiresAfterDays=7;
  await savePlan('PRO',config,original.revision,null,'Rollover boundary test configuration',true);
  const snapshot=await getPlanSnapshot('PRO'),user=await User.create({email:'rollover@example.invalid',displayName:'Rollover',plan:'PRO'});
  const wallet=await Wallet.create({userId:user._id,bucket:'FREE',available:220});
  const old=await CreditLot.create({walletId:wallet._id,amount:200,available:200,expiresAt:new Date(Date.now()+86400000*10),grantSnapshot:snapshot});
  await CreditLot.collection.updateOne({_id:old._id},{$set:{createdAt:new Date('2020-01-01')}});
  await CreditLot.create({walletId:wallet._id,amount:20,available:20,expiresAt:new Date(Date.now()+86400000*10)});
  const lot=await CreditService.grantFreeCredits(user._id,'rollover-fixture-device',new Date().toISOString().slice(0,7));
  assert.equal(lot.amount,100);assert.equal(lot.grantSnapshot.revision,snapshot.revision);
  assert.ok(Math.abs(lot.expiresAt.getTime()-Date.now()-7*86400000)<5000);assert.equal((await Wallet.findById(wallet._id)).available,170);
  assert.equal((await CreditLot.findById(old._id)).available,50);
  await savePlan('PRO',original.config,snapshot.revision,null,'Restore rollover configuration',true,'ROLLBACK');
});

function controllerResponse(){return {statusCode:200,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};}
test('manual edits enforce output boundary and retain configured revision count',async()=>{
 const {Workspace}=require('../dist/models/Workspace'),{Project}=require('../dist/models/Project'),{Content}=require('../dist/models/Content');
 const {updateContent}=require('../dist/controllers/ContentController'),{revisions:getRevisions}=require('../dist/controllers/ContentOperationsController');
 await ContentRevision.init();const original=await getPlanSnapshot('PRO'),config=structuredClone(original.config);config.content.maxOutputChars=10;config.history.retention=1;
 await savePlan('PRO',config,original.revision,null,'Manual history boundary test',true);
 const user=await User.create({email:'history@example.invalid',displayName:'History',plan:'PRO'}),workspace=await Workspace.create({ownerId:user._id,name:'History'}),project=await Project.create({workspaceId:workspace._id,name:'History'}),content=await Content.create({projectId:project._id,revision:1,rawText:'original'});
 const req={user,params:{id:String(content._id)},body:{rawText:'x'.repeat(11)}};let res=controllerResponse();await updateContent(req,res);assert.equal(res.statusCode,403);assert.equal(res.body.error.code,'CONTENT_INPUT_LIMIT_EXCEEDED');assert.equal(await ContentRevision.countDocuments({contentId:content._id}),0);
 for(const text of ['one','two','three']){res=controllerResponse();await updateContent({...req,body:{rawText:text}},res);assert.equal(res.statusCode,200);}
 assert.equal(await ContentRevision.countDocuments({contentId:content._id}),1);assert.equal((await ContentRevision.findOne({contentId:content._id})).rawText,'two');
 res=controllerResponse();await getRevisions({...req,user:{_id:new mongoose.Types.ObjectId()}},res);assert.equal(res.statusCode,404);
 const current=await getPlanSnapshot('PRO');await savePlan('PRO',original.config,current.revision,null,'Restore history boundary settings',true);
});
test('prompt-only worker preserves narration and audio, snapshots limits and omits disabled prompts',async()=>{
 const {Workspace}=require('../dist/models/Workspace'),{Project}=require('../dist/models/Project'),{Content}=require('../dist/models/Content'),{Scene}=require('../dist/models/Scene');
 const {operation}=require('../dist/controllers/ContentOperationsController'),{processContentJob}=require('../dist/workers/ContentWorker');
 const {GoogleGenerativeAI}=require('@google/generative-ai');const original=await getPlanSnapshot('PRO'),config=structuredClone(original.config);config.prompts.videoEnabled=false;config.history.retention=1;
 await savePlan('PRO',config,original.revision,null,'Prompt worker boundary test',true);
 const user=await User.create({email:'prompt-worker@example.invalid',displayName:'Prompt worker',plan:'PRO'}),workspace=await Workspace.create({ownerId:user._id,name:'Prompt'}),project=await Project.create({workspaceId:workspace._id,name:'Prompt'});
 const sources=[1,2,3].map(order=>({projectId:project._id,order,title:'Scene '+order,narration:'Original words '+order,visualDescription:'Visual',estimatedDuration:order===1?5:10,imagePrompt:'Old image',videoPrompt:'Old video',sourceContentRevision:1,ttsAudioId:new mongoose.Types.ObjectId()}));
 const scenes=await Scene.create(sources);const content=await Content.create({projectId:project._id,revision:1,rawText:JSON.stringify(sources),generationSettings:{durationSeconds:30,sceneCount:3,platform:'tiktok',tone:'pro'}});
 const wallet=await Wallet.create({userId:user._id,bucket:'FREE',available:1000,reserved:0});await CreditLot.create({walletId:wallet._id,amount:1000,available:1000,expiresAt:new Date(Date.now()+86400000)});
 const response=controllerResponse();await operation('AI_PROMPT_GEN')({user,params:{id:String(content._id)},body:{}},response);assert.equal(response.statusCode,200);
 const job=await Job.findById(response.body.data.jobId);assert.equal(job.payload.entitlementSnapshot.config.prompts.videoEnabled,false);
 mock.method(GoogleGenerativeAI.prototype,'getGenerativeModel',()=>({generateContent:async()=>({response:{text:()=>JSON.stringify(sources.map(s=>({...s,narration:'Provider changed narration',imagePrompt:'New image',videoPrompt:'Must be removed'})))}})}));
 try{await processContentJob({data:{jobId:String(job._id)}});}finally{mock.restoreAll();}
 assert.equal((await Job.findById(job._id)).status,'COMPLETED');
 for(const source of scenes){const saved=await Scene.findById(source._id);assert.equal(saved.narration,source.narration);assert.equal(String(saved.ttsAudioId),String(source.ttsAudioId));assert.equal(saved.videoPrompt,'');assert.equal(saved.imagePrompt,'New image');}
 assert.equal(await ContentRevision.countDocuments({contentId:content._id}),1);const usage=await PlanUsage.findOne({ownerId:user._id,period:new Date().toISOString().slice(0,7)});assert.equal(usage.counts.prompts,3);assert.equal(usage.counts.contentChars || 0,0);
 const current=await getPlanSnapshot('PRO');await savePlan('PRO',original.config,current.revision,null,'Restore prompt worker settings',true);
});




// Real HTTP/auth/CSRF/Mongo/credit transactions; ONLY inference is a protocol fixture.
// This does not claim that Gemma or CUDA ran.
process.env.NODE_ENV='test';process.env.AI_PROVIDER='local';process.env.AI_SERVICE_TOKEN='fixture-internal-token-'.repeat(3);
const {test,before,after}=require('node:test');const assert=require('node:assert/strict');
const mongoose=require('mongoose'),{MongoMemoryReplSet}=require('mongodb-memory-server');
const express=require('express'),cookieParser=require('cookie-parser'),http=require('node:http'),sharp=require('sharp');
const {User}=require('../dist/models/User'),{Session}=require('../dist/models/Session'),{Workspace}=require('../dist/models/Workspace'),{Project}=require('../dist/models/Project'),{Content}=require('../dist/models/Content'),{Scene}=require('../dist/models/Scene'),{Job}=require('../dist/models/Job');
const {Wallet,CreditLot,CreditLedger,CreditReservation}=require('../dist/models/Credits');
const {savePlan,seedConfig}=require('../dist/services/PlanService');
const {imageDirectory}=require('../dist/services/AiImageAssets');
const {processContentJob}=require('../dist/workers/ContentWorker');
const {signAccessToken}=require('../dist/utils/jwt');
let replica,api,runtime,user,content,base,cookie,wallet,mode='success',inferenceCalls=0;const createdImageIds=[];
const scenes=[
 {title:'Hook',narration:'Bạn có biết một thay đổi nhỏ hôm nay có thể làm ngày mai trở nên khác biệt?',visualDescription:'Người kể đứng bên cửa sổ',estimatedDuration:5,imagePrompt:'Creator near a window, natural light, vertical 9:16',videoPrompt:'Slow camera push towards the creator'},
 {title:'Nội dung',narration:'Mỗi sáng, hãy sắp xếp bàn làm việc và chọn một việc quan trọng để bắt đầu. Thói quen nhỏ này giúp bạn tập trung và chủ động hơn.',visualDescription:'Bàn làm việc gọn gàng',estimatedDuration:10,imagePrompt:'Clean desk with a notebook, warm light, vertical 9:16',videoPrompt:'Overhead camera tracks a hand opening a notebook'},
 {title:'CTA',narration:'Bạn muốn bắt đầu từ thói quen nào? Hãy chia sẻ ý tưởng cùng mọi người nhé!',visualDescription:'Người kể mỉm cười',estimatedDuration:5,imagePrompt:'Smiling creator, soft daylight, vertical 9:16',videoPrompt:'Creator smiles and points towards the camera'},
];
async function listen(server){await new Promise(r=>server.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+server.address().port;}
async function send(path,body,key='fixture-key-'+Date.now(),headers={}){const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,'x-csrf-token':'fixture-csrf','Idempotency-Key':key,...headers},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
const input={topic:'Một thói quen nhỏ tạo thay đổi tích cực',platform:'tiktok',audience:'Người mới đi làm',tone:'pro',durationSeconds:15};
before(async()=>{
 replica=await MongoMemoryReplSet.create({replSet:{count:1}});await mongoose.connect(replica.getUri());
 await savePlan('FREE',seedConfig('FREE'),0,null,'Isolated test bootstrap',true);
 await Promise.all(Object.values(mongoose.models).map(model=>model.init()));
 user=await User.create({email:'ai-fixture@example.test',displayName:'AI fixture',status:'ACTIVE',plan:'FREE'});
 const workspace=await Workspace.create({ownerId:user._id,name:'AI fixture'}),project=await Project.create({workspaceId:workspace._id,name:'Fixture script'});
 content=await Content.create({projectId:project._id});
 wallet=await Wallet.create({userId:user._id,bucket:'FREE',available:2000,reserved:0});await CreditLot.create({walletId:wallet._id,amount:2000,available:2000,expiresAt:new Date(Date.now()+86400000)});
 const session=await Session.create({userId:user._id,tokenFamily:'ai-fixture',refreshTokenHash:'fixture',expiresAt:new Date(Date.now()+86400000)});cookie='accessToken='+signAccessToken({sessionId:String(session._id)})+'; csrfToken=fixture-csrf';
 runtime=http.createServer(async(req,res)=>{let text='';for await(const part of req)text+=part;assert.equal(req.headers.authorization,'Bearer '+process.env.AI_SERVICE_TOKEN);const payload=JSON.parse(text);res.setHeader('Content-Type','application/json');
  if(req.url==='/apply-template')return res.end(JSON.stringify({prompt:JSON.stringify(payload.messages)}));
  if(req.url==='/tokenize')return res.end(JSON.stringify({tokens:Array(100).fill(1)}));
  inferenceCalls++;if(mode==='error'){res.statusCode=503;return res.end('{"error":"fixture unavailable"}');}
  return res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(scenes)}}],usage:{prompt_tokens:100,completion_tokens:500}}));
 });process.env.AI_SERVICE_URL=await listen(runtime);
 const app=express();app.use(express.json({limit:'10mb'}));app.use(cookieParser());app.use('/api/contents',require('../dist/routes/contents').default);app.use('/api/jobs',require('../dist/routes/jobs').default);api=http.createServer(app);base=await listen(api);
});
after(async()=>{for(const id of createdImageIds)await require('node:fs/promises').unlink(require('node:path').join(imageDirectory,id+'.png')).catch(()=>{});await Promise.all([api&&new Promise(r=>api.close(r)),runtime&&new Promise(r=>runtime.close(r))]);await mongoose.disconnect();await replica?.stop();});
test('HTTP local job protocol, durable credit, ownership, idempotency and revisions',async t=>{
 let jobId;
 await t.test('rejects missing auth/CSRF, foreign image and spoofed plan before reservations',async()=>{
  assert.equal((await send('/api/contents/'+content._id+'/generate',input,'auth-key-000',{Cookie:'csrfToken=fixture-csrf'})).status,401);
  assert.equal((await send('/api/contents/'+content._id+'/generate',input,'csrf-key-000',{'x-csrf-token':'wrong'})).status,403);
  assert.equal((await send('/api/contents/'+content._id+'/generate',{...input,plan:'PRO',sceneCount:8})).status,403);
  assert.equal((await send('/api/contents/'+content._id+'/generate',{...input,imageAssetIds:[String(new mongoose.Types.ObjectId())]})).status,404);
  assert.equal(await CreditReservation.countDocuments(),0);
 });
 await t.test('one owned decoded image creates one hold under concurrent idempotent requests',async()=>{
  const png=await sharp({create:{width:100,height:60,channels:3,background:'red'}}).png().toBuffer();const uploaded=await send('/api/contents/'+content._id+'/images',{imageBase64:png.toString('base64')});assert.equal(uploaded.status,201);createdImageIds.push(uploaded.body.data.id);
  const body={...input,imageAssetIds:[uploaded.body.data.id]};const results=await Promise.all([send('/api/contents/'+content._id+'/generate',body,'same-key-fixture'),send('/api/contents/'+content._id+'/generate',body,'same-key-fixture')]);
  for(const result of results)assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(results[0].body.data.jobId,results[1].body.data.jobId);jobId=results[0].body.data.jobId;
  assert.equal(await CreditReservation.countDocuments(),1);assert.equal((await Wallet.findById(wallet._id)).reserved,20);
  const conflict=await send('/api/contents/'+content._id+'/generate',{...body,topic:'Different topic'},'same-key-fixture');assert.equal(conflict.status,409);
 });
 await t.test('worker HTTP fixture completes schema, stores scenes and settles only once',async()=>{
  await processContentJob({data:{jobId}});await processContentJob({data:{jobId}});
  const job=await Job.findById(jobId);assert.equal(job.status,'COMPLETED');assert.equal(job.result.scenes.length,3);assert.equal(inferenceCalls,1);assert.equal((await Content.findById(content._id)).revision,1);
  assert.equal((await CreditReservation.findOne({jobId})).status,'SETTLED');const current=await Wallet.findById(wallet._id);assert.equal(current.reserved,0);assert.equal(current.available,1980);
  const r=await fetch(base+'/api/jobs/'+jobId,{headers:{Cookie:cookie}}),text=await r.text();assert.equal(r.status,200);assert.ok(!text.includes(process.env.AI_SERVICE_TOKEN));assert.ok(!text.includes('127.0.0.1'));assert.ok(!text.includes(imageDirectory));
 });
 await t.test('inference unavailable refunds exactly once and preserves previous content',async()=>{
  mode='error';const before=await Content.findById(content._id),response=await send('/api/contents/'+content._id+'/generate',input,'failure-key-fixture');assert.equal(response.status,200);const id=response.body.data.jobId;
  await assert.rejects(processContentJob({data:{jobId:id}}),/CONTENT_PROVIDER_UNAVAILABLE/);await processContentJob({data:{jobId:id}});
  assert.equal((await CreditReservation.findOne({jobId:id})).status,'RELEASED');assert.equal(await CreditLedger.countDocuments({referenceId:'release_'+id,transactionType:'RELEASE'}),1);
  assert.equal((await Wallet.findById(wallet._id)).available,1980);assert.equal((await Content.findById(content._id)).rawText,before.rawText);mode='success';
 });
 await t.test('scene changes during inference refuse stale publication and refund',async()=>{
  const response=await send('/api/contents/'+content._id+'/generate',input,'revision-key-fixture');assert.equal(response.status,200);const id=response.body.data.jobId;
  const scene=await Scene.findOne({projectId:content.projectId});await Scene.updateOne({_id:scene._id},{$inc:{revision:1},$set:{narration:'Lời đọc được sửa sau khi gửi job'}});
  await assert.rejects(processContentJob({data:{jobId:id}}),/CONTENT_REVISION_CONFLICT/);assert.equal((await Content.findById(content._id)).revision,1);assert.equal((await Scene.findById(scene._id)).narration,'Lời đọc được sửa sau khi gửi job');assert.equal((await CreditReservation.findOne({jobId:id})).status,'RELEASED');
 });
 await t.test('global pending queue is bounded and no credit held on full queue',async()=>{
  const fake=await Job.create(Array.from({length:10},(_,i)=>({ownerId:new mongoose.Types.ObjectId(),type:'AI_CONTENT',status:'QUEUED',payload:{},idempotencyKey:'queue-fixture-'+i})));
  const before=await CreditReservation.countDocuments(),response=await send('/api/contents/'+content._id+'/generate',input,'full-queue-fixture');assert.equal(response.status,429);assert.equal(response.body.error.code,'CONTENT_QUEUE_FULL');assert.equal(await CreditReservation.countDocuments(),before);await Job.deleteMany({_id:{$in:fake.map(j=>j._id)}});
 });
});

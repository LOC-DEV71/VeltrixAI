// Real local model + real API/auth/CSRF/worker/credit, using an isolated test DB.
// Does not load .env or use a real account, paid provider, or real financial records.
process.env.NODE_ENV='test';process.env.AI_PROVIDER='local';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),http=require('node:http');
const backend=path.resolve(__dirname,'../../apps/backend-api');const dependency=name=>require(path.join(backend,'node_modules',name));const compiled=name=>require(path.join(backend,'dist',name));
const express=dependency('express'),cookieParser=dependency('cookie-parser'),mongoose=dependency('mongoose'),{MongoMemoryReplSet}=dependency('mongodb-memory-server');
const {User}=compiled('models/User'),{Session}=compiled('models/Session'),{Workspace}=compiled('models/Workspace'),{Project}=compiled('models/Project'),{Content}=compiled('models/Content'),{Job}=compiled('models/Job'),{Scene}=compiled('models/Scene');
const {Wallet,CreditLot,CreditReservation}=compiled('models/Credits');const {savePlan,seedConfig}=compiled('services/PlanService');
const {processContentJob}=compiled('workers/ContentWorker'),{signAccessToken}=compiled('utils/jwt');
const {narrationUnits}=compiled('utils/narrationTiming');
const settingsRepro=process.argv.includes('--settings-repro');
const generateOnly=process.argv.includes('--generate-only');
let replica,server,runtimeReady=false;const uploaded=[];const report={inference:'REAL_GEMMA',checks:[],status:'BLOCKED'};
async function run(){
 const connectionFile=path.join(__dirname,'.runtime/connection.json');if(!fs.existsSync(connectionFile))throw Error('AI_RUNTIME_NOT_RUNNING');
 const c=JSON.parse(fs.readFileSync(connectionFile,'utf8'));const ready=await fetch(c.url+'/health',{signal:AbortSignal.timeout(3000)});if(!ready.ok)throw Error('AI_RUNTIME_NOT_READY');
 runtimeReady=true;
 process.env.AI_SERVICE_URL=c.url;process.env.AI_SERVICE_TOKEN=c.token;process.env.AI_MODEL=c.model;process.env.AI_CONTEXT_TOKENS=String(c.contextTokens);process.env.AI_MAX_OUTPUT_TOKENS=String(c.maxOutputTokens);
 replica=await MongoMemoryReplSet.create({replSet:{count:1}});await mongoose.connect(replica.getUri());
 const tier=settingsRepro?'PRO':'FREE';
 await savePlan(tier,seedConfig(tier),0,null,'Isolated real local model acceptance',true);await Promise.all(Object.values(mongoose.models).map(m=>m.init()));
 const user=await User.create({email:'local-acceptance@example.test',displayName:'Local AI acceptance',status:'ACTIVE',plan:tier}),workspace=await Workspace.create({ownerId:user._id,name:'Acceptance'}),project=await Project.create({workspaceId:workspace._id,name:'Acceptance'}),content=await Content.create({projectId:project._id});
 const wallet=await Wallet.create({userId:user._id,bucket:'FREE',available:2000,reserved:0});await CreditLot.create({walletId:wallet._id,amount:2000,available:2000,expiresAt:new Date(Date.now()+86400000)});
 const session=await Session.create({userId:user._id,tokenFamily:'local-acceptance',refreshTokenHash:'local-acceptance',expiresAt:new Date(Date.now()+86400000)});
 const app=express();app.use(express.json({limit:'10mb'}));app.use(cookieParser());app.use('/api/contents',compiled('routes/contents').default);app.use('/api/jobs',compiled('routes/jobs').default);server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port,cookie='accessToken='+signAccessToken({sessionId:String(session._id)})+'; csrfToken=local-acceptance';
 async function post(route,body,key){const r=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,'x-csrf-token':'local-acceptance','Idempotency-Key':key},body:JSON.stringify(body)});const result=await r.json();assert.equal(r.status<300,true,JSON.stringify(result));return result.data;}
 const input=settingsRepro?{topic:'Nền văn minh cấp 7 là gì?'.normalize('NFD'),platform:'tiktok',audience:'Gen Z, thích hài hước',tone:'funny',durationSeconds:60,sceneCount:0,structure:'auto',language:'vi-VN'}:{topic:'Vì sao nên đọc sách mỗi ngày?',platform:'tiktok',audience:'Người trẻ',tone:'pro',durationSeconds:15};
 report.settings=input;
 async function complete(name,route,body){const started=performance.now();const {jobId}=await post(route,body,'acceptance-'+name);await processContentJob({data:{jobId}});const job=await Job.findById(jobId);assert.equal(job.status,'COMPLETED');assert.equal((await CreditReservation.findOne({jobId})).status,'SETTLED');assert.equal((await Wallet.findById(wallet._id)).reserved,0);const units=job.result.scenes.reduce((sum,s)=>sum+narrationUnits(s.narration),0);const estimatedSeconds=job.result.scenes.reduce((sum,s)=>sum+s.estimatedDuration,0);if(route.endsWith('/generate')){assert.ok(units>0);assert.ok(Math.abs(estimatedSeconds-units/job.payload.options.speechUnitsPerSecond)<job.result.scenes.length*.11);}report.checks.push({name,status:'PASS',totalMs:performance.now()-started,narrationUnits:units,estimatedSeconds,targetSeconds:job.payload.options.durationSeconds,result:job.result});return job;}
 const prefix='/api/contents/'+content._id;
 await complete('Vietnamese-script',prefix+'/generate',input);
 if(!generateOnly){
 const before=await Scene.find({projectId:project._id}).sort({order:1});await complete('image-video-prompts',prefix+'/prompts',input);const after=await Scene.find({projectId:project._id}).sort({order:1});assert.deepEqual(after.map(s=>s.narration),before.map(s=>s.narration));
 await complete('faithful-scene-split',prefix+'/split',input);
 const index=process.argv.indexOf('--image');
 if(index>=0){const file=process.argv[index+1];if(!file||!fs.existsSync(file))throw Error('IMAGE_FILE_MISSING');const image=await post(prefix+'/images',{imageBase64:fs.readFileSync(file).toString('base64')},'acceptance-image-upload');uploaded.push(image.id);await complete('owned-image-script',prefix+'/generate',{...input,topic:'Mô tả chính xác ảnh cung cấp và các chi tiết quan sát được.',imageAssetIds:[image.id]});}
 else report.checks.push({name:'owned-image-script',status:'BLOCKED',reason:'Provide --image with a real local image; not replaced by a mock.'});
 }else report.scope='Content generation and real-runtime auth failure refund only; prompt/split/vision excluded.';
 const previous=await Content.findById(content._id),balance=(await Wallet.findById(wallet._id)).available;
 const failure=await post(prefix+'/generate',input,'acceptance-failure');process.env.AI_SERVICE_TOKEN='deliberately-invalid-token-for-auth-failure';
 try{await assert.rejects(processContentJob({data:{jobId:failure.jobId}}),/CONTENT_PROVIDER_AUTH_FAILED/);}finally{process.env.AI_SERVICE_TOKEN=c.token;}
 assert.equal((await CreditReservation.findOne({jobId:failure.jobId})).status,'RELEASED');assert.equal((await Wallet.findById(wallet._id)).available,balance);assert.equal((await Content.findById(content._id)).rawText,previous.rawText);report.checks.push({name:'real-runtime-auth-failure-refund',status:'PASS'});
 report.status=report.checks.some(c=>c.status==='BLOCKED')?'BLOCKED':'PASS';
}
run().catch(error=>{report.status=runtimeReady?'FAIL':'BLOCKED';report.reason=/^[A-Z_]+$/.test(error.message)?error.message:'Acceptance step failed; no secrets reported';process.exitCode=1;}).finally(async()=>{
 for(const id of uploaded)await require('node:fs/promises').unlink(path.join(compiled('services/AiImageAssets').imageDirectory,id+'.png')).catch(()=>{});
 if(server)await new Promise(r=>server.close(r));await mongoose.disconnect();await replica?.stop();fs.mkdirSync(path.join(__dirname,'.runtime'),{recursive:true});fs.writeFileSync(path.join(__dirname,'.runtime',settingsRepro?'settings-acceptance.json':'acceptance.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
});

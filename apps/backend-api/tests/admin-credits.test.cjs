process.env.NODE_ENV='test';
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),mongoose=require('mongoose');
const {MongoMemoryReplSet}=require('mongodb-memory-server');
const {Wallet,CreditLot,CreditLedger,CreditReservation}=require('../dist/models/Credits'),{CreditService}=require('../dist/services/CreditService');
const {repairAdminCreditLots}=require('../dist/scripts/repairAdminCreditLots'),{grantCredits}=require('../dist/controllers/AdminUserController');
const {User}=require('../dist/models/User'),{AdminAuditLog}=require('../dist/models/AdminAuditLog');
const {savePlan,seedConfig}=require('../dist/services/PlanService'),{Voice}=require('../dist/models/Voice'),{createTtsJob}=require('../dist/services/TtsJobService');
const express=require('express'),request=require('supertest'),{vietnameseResponses}=require('../dist/middlewares/vietnameseResponses');
let replica;before(async()=>{replica=await MongoMemoryReplSet.create({replSet:{count:1}});await mongoose.connect(replica.getUri());await Promise.all([Wallet,CreditLot,CreditLedger,CreditReservation,User,AdminAuditLog].map(m=>m.init()));});after(async()=>{await mongoose.disconnect();await replica?.stop();});
const id=()=>new mongoose.Types.ObjectId();
async function lot(owner,bucket,amount,source,expired=false){let w=await Wallet.findOne({userId:owner,bucket});if(!w)w=await Wallet.create({userId:owner,bucket,available:0,reserved:0});await Wallet.updateOne({_id:w._id},{$inc:{available:amount}});await CreditLot.create({walletId:w._id,amount,available:amount,source,expiresAt:new Date(Date.now()+(expired?-86400000:86400000))});return w;}
test('admin grant writes lot, ledger and audit; replay grants once; invalid input rejected',async()=>{
 const u=await User.create({email:id()+'@example.invalid',displayName:'Test'}),admin=id(),app=express();app.use(express.json());app.use(vietnameseResponses);app.post('/grant/:id',(req,res)=>{req.admin={_id:admin};return grantCredits(req,res);});const key='grant-test-'+id();
 const grant=()=>request(app).post('/grant/'+u._id).set('Idempotency-Key',key).send({amount:100,reason:'Administrative test grant'});
 assert.equal((await grant()).status,200);assert.equal((await grant()).status,200);const wallet=await Wallet.findOne({userId:u._id});assert.equal(wallet.available,100);assert.equal(await CreditLot.countDocuments({walletId:wallet._id}),1);assert.equal(await CreditLedger.countDocuments({walletId:wallet._id}),1);assert.equal(await AdminAuditLog.countDocuments({adminId:admin}),1);
 await CreditService.reserveUsable(u._id,20,id(),false);
 assert.equal((await request(app).post('/grant/'+u._id).send({amount:1.5,reason:'Invalid grant'})).status,400);
 assert.equal((await request(app).post('/grant/'+u._id).set('Idempotency-Key',key).send({amount:200,reason:'Conflicting grant'})).status,409);
});
test('combine free balance and admin gifts on Free; reserve/settle replay is idempotent',async()=>{
 const u=id(),job=id();await lot(u,'FREE',14);await lot(u,'PAID',100,'ADMIN');const r=await CreditService.reserveUsable(u,20,job,false);assert.equal(r.allocations.reduce((n,a)=>n+a.amount,0),20);assert.equal((await Wallet.find({userId:u})).reduce((n,w)=>n+w.available,0),94);
 await CreditService.reserveUsable(u,20,job,false);assert.equal(await CreditReservation.countDocuments({jobId:job}),1);await CreditService.settle(job,20);await CreditService.settle(job,20);assert.equal((await Wallet.find({userId:u})).reduce((n,w)=>n+w.reserved,0),0);
});
test('paid restriction and expiration still enforced; insufficient credit never changes lots',async()=>{
 const u=id();await lot(u,'FREE',10);await lot(u,'PAID',100);await assert.rejects(CreditService.reserveUsable(u,20,id(),false),/INSUFFICIENT_CREDITS/);assert.equal((await Wallet.findOne({userId:u,bucket:'FREE'})).available,10);
 const job=id();await CreditService.reserveUsable(u,20,job,true);await CreditService.release(job);await CreditService.release(job);assert.equal((await Wallet.find({userId:u})).reduce((n,w)=>n+w.available,0),110);
 const v=id();await lot(v,'PAID',100,'ADMIN',true);await assert.rejects(CreditService.reserveUsable(v,1,id(),false),/INSUFFICIENT_CREDITS/);
});
test('parallel reservations cannot overspend',async()=>{const u=id();await lot(u,'PAID',100,'ADMIN');const result=await Promise.allSettled([CreditService.reserveUsable(u,80,id(),false),CreditService.reserveUsable(u,80,id(),false)]);assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal((await Wallet.findOne({userId:u})).available,20);});
test('legacy repair preserves balance, is idempotent and does not revive expired lots',async()=>{
 const u=id(),w=await Wallet.create({userId:u,bucket:'PAID',available:1000000,reserved:0});assert.ok((await repairAdminCreditLots(false)).credits>=1000000);assert.equal(await CreditLot.countDocuments({walletId:w._id}),0);await repairAdminCreditLots(true);assert.equal((await Wallet.findById(w._id)).available,1000000);assert.equal((await CreditLot.findOne({walletId:w._id})).available,1000000);assert.equal((await repairAdminCreditLots(true)).wallets,0);
 const v=id(),expired=await lot(v,'PAID',100,'ADMIN',true);await repairAdminCreditLots(true);assert.equal(await CreditLot.countDocuments({walletId:expired._id}),1);await assert.rejects(CreditService.reserveUsable(v,1,id(),false),/INSUFFICIENT_CREDITS/);
});
test('Free TTS accepts admin gift and retains pricing snapshot; same key holds once',async()=>{
 await savePlan('FREE',seedConfig('FREE'),0,null,'Test initialization',true);const u=await User.create({email:id()+'@example.invalid',displayName:'TTS test',plan:'FREE'});await lot(u._id,'PAID',1000,'ADMIN');const v=await Voice.create({provider:'VIENEU_LOCAL',providerVoiceId:'test-fixture',name:'Fixture',language:'vi-VN',gender:'male',planEntitlements:['*'],status:'ACTIVE',isSystem:true});
 const key='tts-admin-'+id(),a=await createTtsJob(u._id,'',String(v._id),key,{text:'Xin chào'});assert.equal(a.job.status,'QUEUED');assert.equal(a.job.payload.cost,a.job.payload.entitlementSnapshot.config.credits.ttsPer100Chars);assert.ok(a.job.reservationId);const b=await createTtsJob(u._id,'',String(v._id),key,{text:'Xin chào'});assert.equal(b.reused,true);assert.equal(await CreditReservation.countDocuments({jobId:a.job._id}),1);
});
test('Vietnamese errors preserve code and hide internal text',async()=>{const app=express();app.use(vietnameseResponses);app.get('/error',(_,res)=>res.status(500).json({success:false,error:{code:'INTERNAL_ERROR',message:'SECRET_DATABASE_CONNECTION'}}));const r=await request(app).get('/error');assert.match(r.body.error.message,/Hệ thống/);assert.equal(r.body.error.code,'INTERNAL_ERROR');assert.ok(!JSON.stringify(r.body).includes('SECRET_DATABASE'));});

test('Free content generation accepts combined free/admin balance',async()=>{
 const {Workspace}=require('../dist/models/Workspace'),{Project}=require('../dist/models/Project'),{Content}=require('../dist/models/Content'),{generateContent}=require('../dist/controllers/ContentController'),{Job}=require('../dist/models/Job');
 const u=await User.create({email:id()+'@example.invalid',displayName:'Content test',plan:'FREE'});await lot(u._id,'FREE',14);await lot(u._id,'PAID',100,'ADMIN');const w=await Workspace.create({ownerId:u._id,name:'Test'}),p=await Project.create({workspaceId:w._id,name:'Test'}),c=await Content.create({projectId:p._id});
 const app=express();app.use(express.json());app.use(vietnameseResponses);app.post('/generate/:id',(req,res)=>{req.user=u;return generateContent(req,res);});const r=await request(app).post('/generate/'+c._id).send({topic:'Tình yêu là gì?',platform:'tiktok',tone:'funny',audience:'Người trẻ'});assert.equal(r.status,200,JSON.stringify(r.body.error));const j=await Job.findById(r.body.data.jobId);assert.ok(j.reservationId);assert.equal(j.payload.entitlementSnapshot.tier,'FREE');assert.equal((await Wallet.find({userId:u._id})).reduce((n,w)=>n+w.available,0),114-j.payload.cost);
});
test('real admin auth routes exist, enforce CSRF and return safe Vietnamese login errors',async()=>{
 const {AdminAccount}=require('../dist/models/AdminAccount'),{AdminRole}=require('../dist/models/AdminRole'),{hashSecret}=require('../dist/utils/crypto');const role=await AdminRole.create({name:'OWNER',permissions:['*']}),email=id()+'@example.invalid',password='Temporary integration credential';await AdminAccount.create({email,passwordHash:hashSecret(password),displayName:'Test admin',roleId:role._id});const app=express();app.use(express.json());app.use(require('cookie-parser')());app.use(vietnameseResponses);app.use('/api/admin/auth',require('../dist/routes/adminAuth').default);const agent=request.agent(app);
 const csrf=await agent.get('/api/admin/auth/csrf');assert.equal(csrf.status,200);const token=csrf.body.data.csrfToken;assert.equal((await agent.post('/api/admin/auth/login').send({email,password})).status,403);const bad=await agent.post('/api/admin/auth/login').set('x-csrf-token',decodeURIComponent(token)).send({email,password:'wrong'});assert.equal(bad.status,401);assert.match(bad.body.error.message,/mật khẩu/);
 const good=await agent.post('/api/admin/auth/login').set('x-csrf-token',decodeURIComponent(token)).send({email,password});assert.equal(good.status,200);assert.equal(good.body.data.passwordHash,undefined);assert.equal((await agent.get('/api/admin/auth/me')).status,200);
});


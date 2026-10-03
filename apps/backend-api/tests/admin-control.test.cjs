const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),mongoose=require('mongoose'),crypto=require('node:crypto');
const {MongoMemoryReplSet}=require('mongodb-memory-server');
const control=require('../dist/services/AdminControl');
const {adminCan,ROLE_PERMISSIONS}=require('../dist/services/AdminAccess');
const {AdminAccount}=require('../dist/models/AdminAccount'),{AdminRole}=require('../dist/models/AdminRole'),{AdminSession}=require('../dist/models/AdminSession'),{AdminAuditLog}=require('../dist/models/AdminAuditLog');
const {User}=require('../dist/models/User'),{Job}=require('../dist/models/Job'),{DeveloperToken}=require('../dist/models/DeveloperToken'),{DeveloperRequest}=require('../dist/models/DeveloperRequest'),{SystemSettings}=require('../dist/models/SystemSettings');
const {createDeveloperToken}=require('../dist/services/DeveloperTokens'),{signAccessToken}=require('../dist/utils/jwt'),{hashAdminPassword,verifyAdminPassword}=require('../dist/utils/adminPassword');
let replica,server,origin,owner,customer,ownerCookie,financeCookie;
const note={reason:'Integration test audit reason',confirmed:true};
async function request(path,cookie=ownerCookie,options={}){const r=await fetch(origin+path,{...options,headers:{Cookie:cookie,...options.headers}});return {status:r.status,data:await r.json()};}
before(async()=>{
 replica=await MongoMemoryReplSet.create({replSet:{count:1}});await mongoose.connect(replica.getUri());
 await Promise.all([AdminAccount,AdminRole,AdminSession,AdminAuditLog,User,Job,DeveloperToken,DeveloperRequest,SystemSettings].map(m=>m.init()));
 const role=await AdminRole.create({name:'OWNER',permissions:[]});owner=await AdminAccount.create({email:'owner@example.invalid',displayName:'Owner',passwordHash:hashAdminPassword('fixture-password-long'),roleId:role._id});owner=await AdminAccount.findById(owner._id).populate('roleId');
 const financeRole=await AdminRole.create({name:'FINANCE',permissions:ROLE_PERMISSIONS.FINANCE}),finance=await AdminAccount.create({email:'finance@example.invalid',displayName:'Finance',passwordHash:'fixture',roleId:financeRole._id});
 const cookie=async(admin)=>{const s=await AdminSession.create({adminId:admin._id,tokenFamily:crypto.randomUUID(),refreshTokenHash:'fixture',expiresAt:new Date(Date.now()+3600000)});return 'adminAccessToken='+signAccessToken({sessionId:s._id});};ownerCookie=await cookie(owner);financeCookie=await cookie(finance);
 customer=await User.create({email:'customer@example.invalid',displayName:'Customer',plan:'PRO'});
 const app=require('express')();app.use(require('express').json());app.use(require('cookie-parser')());app.use('/control',require('../dist/routes/adminControl').default);server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));origin='http://127.0.0.1:'+server.address().port;
});
after(async()=>{await new Promise(r=>server.close(r));await mongoose.disconnect();await replica.stop();});
test('roles enforce ownership, finance separation, and CSRF',async()=>{
 assert.equal(adminCan(owner,'admins.manage'),true);assert.equal(adminCan({roleId:{name:'FINANCE',permissions:ROLE_PERMISSIONS.FINANCE}},'jobs.retry'),false);
 assert.equal(adminCan({roleId:{name:'ADMIN',permissions:[]}},'plans.update'),true);
 assert.equal((await request('/control/jobs','')).status,401);assert.equal((await request('/control/jobs',financeCookie)).status,403);assert.equal((await request('/control/audit',financeCookie)).status,200);
 assert.equal((await request('/control/settings',ownerCookie,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...note,expectedRevision:0,...control.defaultOperations})})).status,403);
});
test('large job lists page by ten and never expose narration or provider secrets',async()=>{
 await Job.insertMany(Array.from({length:11},(_,i)=>({ownerId:customer._id,type:'TTS',status:'FAILED',idempotencyKey:crypto.randomUUID(),error:i?'PROCESSING_FAILED':'secret-provider-response',payload:{source:'STANDALONE',narration:'private customer text',providerToken:'secret-token',cost:100}})));
 const a=await control.jobs({ownerId:String(customer._id)}),b=await control.jobs({ownerId:String(customer._id),page:2});assert.equal(a.limit,10);assert.equal(a.items.length,10);assert.equal(b.items.length,1);assert.equal(a.total,11);assert.ok(!a.items.some(j=>String(j._id)===String(b.items[0]._id)));
 assert.ok(!JSON.stringify(a).includes('private customer'));assert.ok(!JSON.stringify(a).includes('secret-token'));assert.ok(!JSON.stringify(a).includes('secret-provider-response'));await assert.rejects(control.jobs({page:-1}),e=>e.code==='INVALID_PAGINATION');
});
test('API suspension is versioned, audited and does not ban login account',async()=>{
 await control.apiAccess(owner,String(customer._id),{...note,expectedRevision:0,disabled:true});const u=await User.findById(customer._id);assert.equal(u.status,'ACTIVE');assert.equal(u.developerApiDisabled,true);assert.equal(u.controlRevision,1);
 await assert.rejects(control.apiAccess(owner,String(customer._id),{...note,expectedRevision:0,disabled:false}),e=>e.code==='ADMIN_REVISION_CONFLICT');
 const concurrent=await Promise.allSettled([control.apiAccess(owner,String(customer._id),{...note,expectedRevision:1,disabled:false}),control.apiAccess(owner,String(customer._id),{...note,expectedRevision:1,disabled:true})]);assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);assert.equal(await AdminAuditLog.countDocuments({action:'DEVELOPER_ACCESS_CHANGED'}),2);
});
test('Developer list requires real tokens, scopes owners, and does not reveal hashes',async()=>{
 const token=await createDeveloperToken(customer._id,{name:'Fixture app',scopes:['tts:read'],expiresInDays:30});
 const a=await control.developers({ownerId:String(customer._id)});assert.equal(a.items.length,1);const detail=await control.developerDetail(String(customer._id),{});assert.equal(detail.tokens.items.length,1);assert.ok(!JSON.stringify(detail).includes(token.token));assert.ok(!JSON.stringify(detail).includes('tokenHash'));
 await control.adminRevokeToken(owner,String(customer._id),token.id,note);assert.ok((await DeveloperToken.findById(token.id)).revokedAt);
});
test('staff uses salted passwords and invalid configurations are rejected',async()=>{
 const password='strong-fixture-password';const created=await control.createStaff(owner,{...note,email:'support@example.invalid',displayName:'Support',password,role:'SUPPORT'});const a=await AdminAccount.findById(created.id);assert.equal(verifyAdminPassword(password,a.passwordHash),true);assert.equal(verifyAdminPassword('wrong',a.passwordHash),false);assert.notEqual(hashAdminPassword(password),a.passwordHash);
 assert.ok(!JSON.stringify(await control.staff({})).includes('passwordHash'));assert.ok(!JSON.stringify(await AdminAuditLog.find()).includes(password));
 await assert.rejects(control.createStaff(owner,{...note,email:'bad@example.invalid',displayName:'Bad',password,role:'OWNER'}),e=>e.code==='ADMIN_INVALID_INPUT');
});
test('role changes revoke sessions and cannot change owner or overwrite revisions',async()=>{
 const a=await AdminAccount.findOne({email:'support@example.invalid'});const session=await AdminSession.create({adminId:a._id,tokenFamily:crypto.randomUUID(),refreshTokenHash:'private-hash',expiresAt:new Date(Date.now()+60000)});
 await control.updateStaff(owner,String(a._id),{...note,expectedRevision:0,role:'VIEWER',status:'ACTIVE'});assert.ok((await AdminSession.findById(session._id)).revokedAt);
 await assert.rejects(control.updateStaff(owner,String(a._id),{...note,expectedRevision:0,role:'SUPPORT',status:'ACTIVE'}),e=>e.code==='ADMIN_REVISION_CONFLICT');
 await assert.rejects(control.updateStaff(owner,String(owner._id),{...note,expectedRevision:0,role:'VIEWER',status:'SUSPENDED'}),e=>e.code==='OWNER_ACCOUNT_PROTECTED');assert.ok(!JSON.stringify(await control.sessions({})).includes('private-hash'));
});
test('settings validate boundaries and serialize simultaneous changes',async()=>{
 for(const requestRetentionDays of [0,366,1.5])await assert.rejects(control.saveSettings(owner,{...note,expectedRevision:0,...control.defaultOperations,requestRetentionDays}),e=>e.code==='ADMIN_INVALID_INPUT');
 const result=await Promise.allSettled([1,365].map(requestRetentionDays=>control.saveSettings(owner,{...note,expectedRevision:0,...control.defaultOperations,requestRetentionDays})));assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(result.find(r=>r.status==='rejected').reason.code,'ADMIN_REVISION_CONFLICT');assert.equal((await control.operationSettings()).revision,1);
 await assert.rejects(control.saveSettings(owner,{...note,confirmed:false,expectedRevision:1,...control.defaultOperations}),e=>e.code==='ADMIN_CONFIRMATION_REQUIRED');
});
test('audit logs are immutable and safe to read',async()=>{
 const row=await AdminAuditLog.findOne();await assert.rejects(AdminAuditLog.updateOne({_id:row._id},{$set:{action:'CHANGED'}}),/IMMUTABLE/);await assert.rejects(AdminAuditLog.deleteOne({_id:row._id}),/IMMUTABLE/);row.action='CHANGED';await assert.rejects(row.save(),/IMMUTABLE/);
 const list=await control.auditHistory({});assert.equal(list.limit,10);assert.ok(list.items.every(r=>r.changes===undefined));
});
test('internal reconciliation finds anomalies without modifying orders or credit',async()=>{
 const {BillingOrder}=require('../dist/models/BillingOrder'),{CreditReservation}=require('../dist/models/Credits');await Promise.all([BillingOrder,CreditReservation].map(m=>m.init()));
 const order=await BillingOrder.create({ownerId:customer._id,requestKey:crypto.randomUUID(),tier:'PLUS',billingCycle:'monthly',amount:199000,planSnapshot:{},status:'PENDING',expiresAt:new Date(0),mode:'sandbox'});
 const job=await Job.findOne({ownerId:customer._id,status:'FAILED'}),reservation=await CreditReservation.create({jobId:job._id,allocations:[],status:'HELD'});
 assert.ok((await control.reconciliation({})).items.some(r=>String(r._id)===String(order._id)&&r.issue==='ORDER_CONFIRMATION_OVERDUE'));assert.ok((await control.reconciliation({kind:'credits'})).items.some(r=>String(r._id)===String(reservation._id)));
 assert.equal((await BillingOrder.findById(order._id)).status,'PENDING');assert.equal((await CreditReservation.findById(reservation._id)).status,'HELD');
});
test('user status changes require reason/version and create immutable audit',async()=>{
 const {updateUserStatus}=require('../dist/controllers/AdminUserController');const u=await User.create({email:'status@example.invalid',displayName:'Status'});
 const invoke=async(body)=>{const res={statusCode:200,status(n){this.statusCode=n;return this;},json(data){this.data=data;return this;}};await updateUserStatus({params:{id:String(u._id)},body,admin:owner},res);return res;};
 assert.equal((await invoke({status:'BANNED'})).statusCode,400);assert.equal((await invoke({...note,status:'BANNED',expectedRevision:0})).statusCode,200);assert.equal((await invoke({...note,status:'ACTIVE',expectedRevision:0})).statusCode,409);assert.equal(await AdminAuditLog.countDocuments({action:'USER_STATUS_CHANGED',resourceId:String(u._id)}),1);
});
test('retry creates an idempotent replacement and preserves old job snapshot',async()=>{
 const {Plan,PlanRevision,PlanAudit,PlanUsage}=require('../dist/models/Plan'),{Voice}=require('../dist/models/Voice'),{Wallet,CreditLot,CreditLedger}=require('../dist/models/Credits');const {savePlan,seedConfig,getPlanSnapshot}=require('../dist/services/PlanService');await Promise.all([Plan,PlanRevision,PlanAudit,PlanUsage,Voice,Wallet,CreditLot,CreditLedger].map(m=>m.init()));
 await savePlan('PRO',seedConfig('PRO'),0,null,'Retry fixture seed',true);const snapshot=await getPlanSnapshot('PRO');const voice=await Voice.create({provider:'VIENEU_LOCAL',providerVoiceId:crypto.randomUUID(),name:'Retry fixture',language:'vi',gender:'male',planEntitlements:['*'],status:'ACTIVE',isSystem:true});
 const wallet=await Wallet.create({userId:customer._id,bucket:'PAID',available:10000});await CreditLot.create({walletId:wallet._id,amount:10000,available:10000,expiresAt:new Date(Date.now()+86400000)});
 const old=await Job.create({ownerId:customer._id,type:'TTS',status:'FAILED',idempotencyKey:crypto.randomUUID(),payload:{source:'STANDALONE',voiceId:voice._id,narration:'Retry fixture text',entitlementSnapshot:snapshot,cost:100}});
 const a=await control.retryJob(owner,String(old._id),note),b=await control.retryJob(owner,String(old._id),note);assert.equal(String(a.jobId),String(b.jobId));assert.equal(b.reused,true);assert.notEqual(String(a.jobId),String(old._id));assert.equal((await Job.findById(old._id)).status,'FAILED');assert.equal((await Job.findById(old._id)).payload.entitlementSnapshot.revision,snapshot.revision);assert.equal((await Wallet.findById(wallet._id)).reserved,100);
});

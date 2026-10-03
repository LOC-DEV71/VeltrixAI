const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),mongoose=require('mongoose'),crypto=require('node:crypto');
const {MongoMemoryReplSet}=require('mongodb-memory-server');
const {canonical,signature,verifyCallback,vnPayConfig}=require('../dist/services/VNPayProvider');
const {createCheckout,receiveIPN,billingCapabilities,savedPaymentMethods}=require('../dist/services/BillingService');
const {CardSetup,tokenIPN,setupCard}=require('../dist/services/VNPayCards');
const {BillingOrder}=require('../dist/models/BillingOrder'),{PaymentMethod}=require('../dist/models/PaymentMethod'),{User}=require('../dist/models/User');
const {Plan,PlanRevision,PlanAudit}=require('../dist/models/Plan'),{Wallet,CreditLot,CreditLedger}=require('../dist/models/Credits');
const {savePlan,seedConfig,getPlanSnapshot}=require('../dist/services/PlanService'),{forOwner}=require('../dist/services/EntitlementService');
let replica;
before(async()=>{Object.assign(process.env,{VNPAY_MODE:'sandbox',VNPAY_TMN_CODE:'TESTONLY',VNPAY_HASH_SECRET:'test-only-signing-key',VNPAY_RETURN_URL:'https://example.invalid/api/billing/vnpay/return',VNPAY_CLIENT_URL:'http://localhost:5173'});replica=await MongoMemoryReplSet.create({replSet:{count:1}});await mongoose.connect(replica.getUri());await Promise.all([BillingOrder,PaymentMethod,CardSetup,require('../dist/models/Notification').Notification,User,Plan,PlanRevision,PlanAudit,Wallet,CreditLot,CreditLedger].map(m=>m.init()));for(const tier of ['FREE','PLUS','PRO']){const c=seedConfig(tier);if(tier!=='FREE')Object.assign(c.pricing,{monthlyAvailable:true,yearlyAvailable:true,monthlyPrice:199000,yearlyPrice:1990000});await savePlan(tier,c,0,null,'Billing test seed',true);}});
after(async()=>{await mongoose.disconnect();await replica?.stop();});
test('payment sockets authenticate, isolate owners and notify only after verified IPN commits',async()=>{
 const {createServer}=require('node:http'),{io}=require('socket.io-client'),express=require('express');
 const {attachBillingRealtime}=require('../dist/services/BillingRealtime'),{Session}=require('../dist/models/Session');
 const {AdminSession}=require('../dist/models/AdminSession'),{AdminAccount}=require('../dist/models/AdminAccount'),{AdminRole}=require('../dist/models/AdminRole'),{signAccessToken}=require('../dist/utils/jwt');
 const u=await user(),other=await user(),userSession=await Session.create({userId:u._id,tokenFamily:crypto.randomUUID(),refreshTokenHash:'fixture',expiresAt:new Date(Date.now()+60000)});
 const otherSession=await Session.create({userId:other._id,tokenFamily:crypto.randomUUID(),refreshTokenHash:'fixture',expiresAt:new Date(Date.now()+60000)});
 const role=await AdminRole.create({name:'OWNER',permissions:[]}),admin=await AdminAccount.create({email:crypto.randomUUID()+'@example.invalid',displayName:'Socket fixture',passwordHash:'fixture',roleId:role._id,status:'ACTIVE'});
 const adminSession=await AdminSession.create({adminId:admin._id,tokenFamily:crypto.randomUUID(),refreshTokenHash:'fixture',expiresAt:new Date(Date.now()+60000)});
 const server=createServer(express()),socketServer=attachBillingRealtime(server,['http://localhost:5174']);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const clients=[],connect=async(namespace,cookie,origin='http://localhost:5174',denied=false)=>{
  const socket=io(`http://127.0.0.1:${server.address().port}${namespace}`,{transports:['websocket'],reconnection:false,extraHeaders:{Origin:origin,Cookie:cookie||''},timeout:2000});clients.push(socket);
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Socket timed out')),3000);socket.once(denied?'connect_error':'connect',()=>{clearTimeout(timer);resolve();});socket.once(denied?'connect':'connect_error',()=>{clearTimeout(timer);reject(Error('Unexpected socket authentication result'));});});return socket;
 };
 const cookie=(name,session)=>name+'='+signAccessToken({sessionId:session._id});
 try {
  await connect('/billing','',undefined,true);await connect('/billing',cookie('accessToken',userSession),'https://untrusted.invalid',true);
  await connect('/admin-billing',cookie('accessToken',userSession),undefined,true);
  const mine=await connect('/billing',cookie('accessToken',userSession)),foreign=await connect('/billing',cookie('accessToken',otherSession)),owner=await connect('/admin-billing',cookie('adminAccessToken',adminSession));
  const mineEvents=[],foreignEvents=[],adminEvents=[];mine.on('billing:order',e=>mineEvents.push(e));foreign.on('billing:order',e=>foreignEvents.push(e));owner.on('billing:order',e=>adminEvents.push(e));
  const order=await request(u);const bad=await callback(order.orderId);bad.vnp_SecureHash='0'.repeat(128);assert.equal((await receiveIPN(bad)).RspCode,'97');
  assert.equal((await receiveIPN(await callback(order.orderId))).RspCode,'00');
  for(let i=0;i<30&&!adminEvents.some(e=>e.status==='PAID');i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(mineEvents.filter(e=>e.status==='PAID').length,1);assert.equal(adminEvents.filter(e=>e.status==='PAID').length,1);assert.equal(foreignEvents.length,0);
  const paid=mineEvents.find(e=>e.status==='PAID');assert.equal(String((await BillingOrder.findById(paid.orderId)).status),'PAID');assert.equal(paid.ownerId,undefined);assert.ok(!JSON.stringify(paid).includes('planSnapshot'));
  assert.equal((await receiveIPN(await callback(order.orderId))).RspCode,'02');await new Promise(r=>setTimeout(r,30));assert.equal(adminEvents.filter(e=>e.status==='PAID').length,1);
  await AdminSession.updateOne({_id:adminSession._id},{$set:{revokedAt:new Date()}});
  const next=await request(u);await receiveIPN(await callback(next.orderId));await new Promise(r=>setTimeout(r,30));assert.equal(adminEvents.filter(e=>e.status==='PAID').length,1);
 } finally {clients.forEach(s=>s.disconnect());await new Promise(r=>socketServer.close(r));}
});
test('large histories return ten rows with totals and disjoint subsequent pages',async()=>{
 const {Notification}=require('../dist/models/Notification'),{notificationList}=require('../dist/routes/notifications');
 const {orderHistory}=require('../dist/services/BillingHistory'),{subscriptions}=require('../dist/services/BillingService');
 const u=await user(),other=await user();
 await Notification.insertMany(Array.from({length:11},(_,i)=>({ownerId:u._id,sourceId:crypto.randomUUID(),title:'Notice '+i,message:'Fixture'})));
 await Notification.create({ownerId:other._id,sourceId:crypto.randomUUID(),title:'Private',message:'Fixture'});
 const first=await notificationList(u._id),second=await notificationList(u._id,2);
 assert.equal(first.items.length,10);assert.equal(first.total,11);assert.equal(first.unread,11);assert.equal(second.items.length,1);
 assert.ok(!first.items.some(n=>String(n._id)===String(second.items[0]._id)));
 const purchase=await request(u);const base=await BillingOrder.findById(purchase.orderId).lean();
 for(let i=0;i<10;i++){const {_id,__v,...copy}=base;await BillingOrder.create({...copy,requestKey:crypto.randomUUID()});}
 const a=await orderHistory({},u._id),b=await orderHistory({page:'2'},u._id);
 assert.equal(a.limit,10);assert.equal(a.total,11);assert.equal(a.items.length,10);assert.equal(b.items.length,1);
 assert.ok(!a.items.some(o=>String(o._id)===String(b.items[0]._id)));
 await BillingOrder.updateMany({ownerId:u._id},{$set:{status:'PAID',paidAt:new Date(),startsAt:new Date(),endsAt:new Date(Date.now()+86400000)}});
 const plans=await subscriptions(u._id),next=await subscriptions(u._id,{page:2});
 assert.equal(plans.total,11);assert.equal(plans.items.length,10);assert.equal(next.items.length,1);
 await assert.rejects(subscriptions(u._id,{page:-1}),e=>e.code==='BILLING_INVALID_INPUT');
});
test('TTS history paginates while scene editor receives the latest job for every scene',async()=>{
 const {Job}=require('../dist/models/Job'),{Workspace}=require('../dist/models/Workspace'),{Project}=require('../dist/models/Project'),{getTtsHistory}=require('../dist/controllers/TtsController');
 const u=await user(),other=await user();
 await Job.insertMany(Array.from({length:11},()=>({ownerId:u._id,type:'TTS',idempotencyKey:crypto.randomUUID(),payload:{source:'STANDALONE',narration:'Fixture'}})));
 await Job.create({ownerId:other._id,type:'TTS',idempotencyKey:crypto.randomUUID(),payload:{source:'STANDALONE',narration:'Private'}});
 const read=async(query)=>{const res={statusCode:200,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};await getTtsHistory({user:u,query},res);return res;};
 const first=await read({}),second=await read({page:'2'});assert.equal(first.statusCode,200);assert.equal(first.body.data.jobs.length,10);assert.equal(first.body.data.total,11);assert.equal(second.body.data.jobs.length,1);
 assert.ok(!first.body.data.jobs.some(j=>String(j.id)===String(second.body.data.jobs[0].id)));
 assert.equal((await read({page:'-1'})).statusCode,400);
 const workspace=await Workspace.create({ownerId:u._id,name:'Fixture'}),project=await Project.create({workspaceId:workspace._id,name:'Fixture'});
 const ids=Array.from({length:11},()=>new mongoose.Types.ObjectId());
 for(const sceneId of ids){await Job.create({ownerId:u._id,type:'TTS',idempotencyKey:crypto.randomUUID(),payload:{projectId:project._id,sceneId,narration:'Old'}});await Job.create({ownerId:u._id,type:'TTS',idempotencyKey:crypto.randomUUID(),payload:{projectId:project._id,sceneId,narration:'Latest'}});}
 const scenes=await read({projectId:String(project._id)});assert.equal(scenes.statusCode,200);assert.equal(scenes.body.data.jobs.length,11);assert.ok(scenes.body.data.jobs.every(j=>j.text==='Latest'));
});
test('notification SSE and read state require owner login and CSRF, persist without leaking other owners',async()=>{
 const express=require('express'),cookie=require('cookie-parser'),http=require('supertest'),{Session}=require('../dist/models/Session'),{signAccessToken}=require('../dist/utils/jwt'),{Notification}=require('../dist/models/Notification');
 const app=express();app.use(express.json(),cookie());app.use('/api/notifications',require('../dist/routes/notifications').default);
 const u=await user(),other=await user(),session=await Session.create({userId:u._id,tokenFamily:crypto.randomUUID(),refreshTokenHash:crypto.randomUUID(),expiresAt:new Date(Date.now()+60000)});
 const own=await Notification.create({ownerId:u._id,sourceId:crypto.randomUUID(),title:'Payment confirmed',message:'Fixture'}),foreign=await Notification.create({ownerId:other._id,sourceId:crypto.randomUUID(),title:'Other',message:'Private'});
 const auth='accessToken='+signAccessToken({sessionId:session._id})+'; csrfToken=notice-test';
 assert.equal((await http(app).get('/api/notifications')).status,401);assert.equal((await http(app).post('/api/notifications/all/read').set('Cookie',auth).send({})).status,403);
 const list=await http(app).get('/api/notifications').set('Cookie',auth);assert.equal(list.body.data.unread,1);assert.equal(list.body.data.items.length,1);
 await http(app).post('/api/notifications/'+foreign._id+'/read').set('Cookie',auth).set('x-csrf-token','notice-test').send({});assert.equal((await Notification.findById(foreign._id)).readAt,undefined);
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const abort=new AbortController();
 try{const response=await fetch(`http://127.0.0.1:${server.address().port}/api/notifications/stream`,{headers:{Cookie:auth},signal:abort.signal});assert.equal(response.headers.get('content-type').split(';')[0],'text/event-stream');const first=await response.body.getReader().read();const payload=Buffer.from(first.value).toString();assert.ok(payload.includes('event: notifications'));assert.ok(payload.includes(String(own._id)));assert.ok(!payload.includes(String(foreign._id)));}finally{abort.abort();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 const read=await http(app).post('/api/notifications/all/read').set('Cookie',auth).set('x-csrf-token','notice-test').send({});assert.equal(read.body.data.unread,0);assert.ok((await Notification.findById(own._id)).readAt);
});
test('multiple purchases keep separate periods, add credits, switching does not regrant, and notifications deduplicate',async()=>{
 const {subscriptions,selectSubscription}=require('../dist/services/BillingService'),{Notification}=require('../dist/models/Notification');
 const u=await user(),first=await request(u);const a=await callback(first.orderId);await receiveIPN(a);const credits=(await Wallet.findOne({userId:u._id,bucket:'FREE'})).available;
 const second=await createCheckout(u._id,{tier:'PRO',billingCycle:'monthly',expectedRevision:(await getPlanSnapshot('PRO')).revision},crypto.randomUUID(),'127.0.0.1');const b=await callback(second.orderId);await receiveIPN(b);assert.equal((await Wallet.findOne({userId:u._id,bucket:'FREE'})).available,credits*2);
 const list=await subscriptions(u._id);assert.equal(list.items.filter(o=>o.active).length,2);assert.equal(list.selectedId,second.orderId);assert.equal((await forOwner(u._id)).tier,'PRO');
 await selectSubscription(u._id,first.orderId,second.orderId);assert.equal((await subscriptions(u._id)).selectedId,first.orderId);assert.equal((await Wallet.findOne({userId:u._id,bucket:'FREE'})).available,credits*2);
 await assert.rejects(selectSubscription(u._id,second.orderId,second.orderId),e=>e.code==='BILLING_SELECTION_CONFLICT');
 const stranger=await user();await assert.rejects(selectSubscription(stranger._id,first.orderId,null),e=>e.code==='BILLING_SUBSCRIPTION_EXPIRED');
 await receiveIPN(b);assert.equal(await Notification.countDocuments({ownerId:u._id}),2);
 await BillingOrder.updateOne({_id:first.orderId},{$set:{endsAt:new Date(Date.now()-1)}});assert.equal((await forOwner(u._id)).tier,'PRO');assert.equal((await subscriptions(u._id)).selectedId,second.orderId);
});
test('history isolates owners, paginates, returns dates without snapshots/secrets and separates sandbox cash',async()=>{
 const {orderHistory,cashSummary,creditHistory}=require('../dist/services/BillingHistory');
 const u=await user(),other=await user();const order=await request(u);await request(other);await receiveIPN(await callback(order.orderId));
 const history=await orderHistory({limit:'1',page:'1'},u._id);assert.equal(history.total,1);assert.equal(history.items.length,1);assert.ok(history.items[0].createdAt&&history.items[0].paidAt&&history.items[0].startsAt&&history.items[0].endsAt);assert.equal(history.items[0].planSnapshot,undefined);assert.equal(history.items[0].ownerId,undefined);
 await assert.rejects(orderHistory({ownerId:String(other._id)},u._id),e=>e.code==='BILLING_INVALID_INPUT');await assert.rejects(orderHistory({limit:'101'}),e=>e.code==='BILLING_INVALID_INPUT');
 const summary=await cashSummary({ownerId:String(u._id)});assert.equal(summary.rows.find(r=>r.status==='PAID').mode,'sandbox');assert.equal(summary.settlementAvailable,false);assert.deepEqual((await cashSummary({mode:'production',ownerId:String(u._id)})).rows,[]);
 const credits=await creditHistory({ownerId:String(u._id)});assert.equal(credits.items.length,1);assert.ok(credits.items[0].createdAt);assert.equal(String(credits.items[0].ownerId),String(u._id));
 const express=require('express'),requestHTTP=require('supertest'),cookie=require('cookie-parser');const app=express();app.use(cookie());app.use('/api/admin/billing',require('../dist/routes/adminBilling').default);assert.equal((await requestHTTP(app).get('/api/admin/billing/orders')).status,401);
});
test('billing routes enforce login, CSRF and order ownership; return cannot activate account',async()=>{
 const express=require('express'),cookieParser=require('cookie-parser'),request=require('supertest'),{Session}=require('../dist/models/Session'),{signAccessToken}=require('../dist/utils/jwt');
 const app=express();app.use(express.json(),cookieParser());app.use('/api/billing',require('../dist/routes/billing').default);
 const u=await user(),other=await user(),order=await requestCheckout(other),session=await Session.create({userId:u._id,tokenFamily:crypto.randomUUID(),refreshTokenHash:crypto.randomUUID(),expiresAt:new Date(Date.now()+60000)});
 const cookie='accessToken='+signAccessToken({sessionId:session._id})+'; csrfToken=billing-test';
 assert.equal((await request(app).post('/api/billing/checkout').send({})).status,401);
 assert.equal((await request(app).post('/api/billing/checkout').set('Cookie',cookie).send({})).status,403);
 assert.equal((await request(app).get('/api/billing/orders/'+order.orderId).set('Cookie',cookie)).status,404);
 const callbackData=await callback(order.orderId);const result=await request(app).get('/api/billing/vnpay/return').query(callbackData);assert.equal(result.status,303);assert.equal((await User.findById(other._id)).plan,'FREE');assert.equal((await BillingOrder.findById(order.orderId)).status,'PENDING');
});
test('saved-card checkout resolves owner token only on server and token IPN settles once',async()=>{
 Object.assign(process.env,{VNPAY_TOKEN_ENABLED:'true',VNPAY_TOKEN_TMN_CODE:'TOKTEST1',VNPAY_TOKEN_HASH_SECRET:'token-test-secret',VNPAY_TOKEN_ENCRYPTION_KEY:'a'.repeat(64),VNPAY_TOKEN_RETURN_URL:'https://example.invalid/api/billing/vnpay/token/return'});
 const u=await user(),setup=await setupCard(u._id,'127.0.0.1'),p={vnp_command:'token_create',vnp_tmn_code:'TOKTEST1',vnp_app_user_id:String(u._id),vnp_txn_ref:setup.setupId,vnp_response_code:'00',vnp_transaction_status:'00',vnp_token:'S'.repeat(64),vnp_card_number:'123456xxxxxx1234',vnp_bank_code:'VISA',vnp_card_type:'02'};
 await tokenIPN({...p,vnp_secure_hash:signature(p,process.env.VNPAY_TOKEN_HASH_SECRET)});
 const method=(await savedPaymentMethods(u._id))[0],order=await createCheckout(u._id,{tier:'PLUS',billingCycle:'monthly',expectedRevision:(await getPlanSnapshot('PLUS')).revision,paymentMethodId:String(method._id)},crypto.randomUUID(),'127.0.0.1');
 const url=new URL(order.checkoutUrl);assert.equal(url.pathname,'/token_ui/payment-token.html');assert.equal(url.searchParams.get('vnp_token'),'S'.repeat(64));
 const q={vnp_command:'token_pay',vnp_tmn_code:'TOKTEST1',vnp_app_user_id:String(u._id),vnp_txn_ref:order.orderId,vnp_amount:String((await BillingOrder.findById(order.orderId)).amount*100),vnp_response_code:'00',vnp_transaction_status:'00',vnp_transaction_no:'987654321'};
 const raw={...q,vnp_secure_hash:signature(q,process.env.VNPAY_TOKEN_HASH_SECRET)};assert.equal((await receiveIPN(raw,true)).RspCode,'00');assert.equal((await receiveIPN(raw,true)).RspCode,'02');assert.equal((await User.findById(u._id)).plan,'PLUS');
});
const user=()=>User.create({email:crypto.randomUUID()+'@example.invalid',displayName:'Billing fixture'});
const request=async(owner,cycle='monthly')=>createCheckout(owner._id,{tier:'PLUS',billingCycle:cycle,expectedRevision:(await getPlanSnapshot('PLUS')).revision},crypto.randomUUID(),'127.0.0.1');
const requestCheckout=request;
const callback=async(id,changes={})=>{const order=await BillingOrder.findById(id),p={vnp_TmnCode:'TESTONLY',vnp_TxnRef:String(id),vnp_Amount:String(order.amount*100),vnp_ResponseCode:'00',vnp_TransactionStatus:'00',vnp_TransactionNo:String(Date.now())+String(Math.floor(Math.random()*10000)),...changes};return {...p,vnp_SecureHash:signature(p,process.env.VNPAY_HASH_SECRET)};};
test('provider canonical signing rejects tampering and duplicate fields',()=>{assert.equal(canonical({b:'two words',a:'x/y'}),'a=x%2Fy&b=two+words');const p={vnp_TmnCode:'TESTONLY',vnp_TxnRef:'abc'},raw={...p,vnp_SecureHash:signature(p,process.env.VNPAY_HASH_SECRET)};assert.ok(verifyCallback(raw,vnPayConfig()));assert.equal(verifyCallback({...raw,vnp_TxnRef:['abc','def']},vnPayConfig()),null);assert.equal(verifyCallback({...raw,vnp_TxnRef:'def'},vnPayConfig()),null);});
test('missing configuration fails closed without changing account',async()=>{const old=process.env.VNPAY_HASH_SECRET;delete process.env.VNPAY_HASH_SECRET;assert.equal(billingCapabilities().available,false);await assert.rejects(request(await user()),e=>e.code==='PAYMENT_PROVIDER_UNAVAILABLE');process.env.VNPAY_HASH_SECRET=old;});
test('checkout is idempotent and does not activate plan before IPN',async()=>{const u=await user(),snapshot=await getPlanSnapshot('PLUS'),key=crypto.randomUUID(),body={tier:'PLUS',billingCycle:'monthly',expectedRevision:snapshot.revision};const a=await createCheckout(u._id,body,key,'127.0.0.1'),b=await createCheckout(u._id,body,key,'127.0.0.1');assert.equal(a.orderId,b.orderId);assert.equal((await User.findById(u._id)).plan,'FREE');assert.equal(await CreditLedger.countDocuments({referenceId:`billing_${a.orderId}_0`}),0);assert.equal(new URL(a.checkoutUrl).hostname,'sandbox.vnpayment.vn');});
test('wrong amount/signature cannot settle; concurrent duplicate IPN grants once',async()=>{const u=await user(),o=await request(u),good=await callback(o.orderId);assert.equal((await receiveIPN({...good,vnp_SecureHash:'0'.repeat(128)})).RspCode,'97');assert.equal((await receiveIPN(await callback(o.orderId,{vnp_Amount:'1'}))).RspCode,'04');const results=await Promise.all([receiveIPN(good),receiveIPN(good)]);assert.deepEqual(results.map(r=>r.RspCode).sort(),['00','02']);assert.equal((await User.findById(u._id)).plan,'PLUS');assert.equal(await CreditLedger.countDocuments({referenceId:`billing_${o.orderId}_0`,transactionType:'GRANT'}),1);});
test('failed payment never grants credits',async()=>{const u=await user(),o=await request(u);assert.equal((await receiveIPN(await callback(o.orderId,{vnp_ResponseCode:'24',vnp_TransactionStatus:'02'}))).RspCode,'00');assert.equal((await User.findById(u._id)).plan,'FREE');assert.equal((await BillingOrder.findById(o.orderId)).status,'FAILED');});
test('paid subscriptions retain pricing and entitlement snapshot across admin edits',async()=>{const u=await user(),o=await request(u),original=await getPlanSnapshot('PLUS');const c=structuredClone(original.config);c.credits.monthlyGrant+=100;await savePlan('PLUS',c,original.revision,null,'Billing pricing snapshot test',true);await receiveIPN(await callback(o.orderId));const snapshot=await forOwner(u._id);assert.equal(snapshot.revision,original.revision);assert.equal((await Wallet.findOne({userId:u._id,bucket:'FREE'})).available,original.config.credits.monthlyGrant);const latest=await getPlanSnapshot('PLUS');await savePlan('PLUS',original.config,latest.revision,null,'Restore billing fixture',true);});
test('annual grants are monthly, expiry falls back to Free and expired subscriptions fall back to Free',async()=>{const u=await user(),o=await request(u,'yearly');await receiveIPN(await callback(o.orderId));const current=await User.findById(u._id),start=new Date();start.setMonth(start.getMonth()-2);await User.updateOne({_id:u._id},{$set:{'planPeriod.startsAt':start}});await BillingOrder.updateOne({_id:o.orderId},{$set:{startsAt:start}});await forOwner(u._id);assert.equal(await CreditLedger.countDocuments({referenceId:{$regex:`^billing_${o.orderId}_\\d+$`}}),3);await User.updateOne({_id:u._id},{$set:{'planPeriod.endsAt':new Date(Date.now()-1000)}});await BillingOrder.updateOne({_id:o.orderId},{$set:{endsAt:new Date(Date.now()-1000)}});assert.equal((await forOwner(u._id)).tier,'FREE');});
test('saved Visa token is encrypted, masked metadata only, duplicate IPN safe',async()=>{Object.assign(process.env,{VNPAY_TOKEN_ENABLED:'true',VNPAY_TOKEN_TMN_CODE:'TOKTEST1',VNPAY_TOKEN_HASH_SECRET:'token-test-secret',VNPAY_TOKEN_ENCRYPTION_KEY:'a'.repeat(64),VNPAY_TOKEN_RETURN_URL:'https://example.invalid/api/billing/vnpay/token/return'});const u=await user(),s=await setupCard(u._id,'127.0.0.1'),token='T'.repeat(64),p={vnp_command:'token_create',vnp_tmn_code:'TOKTEST1',vnp_app_user_id:String(u._id),vnp_txn_ref:s.setupId,vnp_response_code:'00',vnp_transaction_status:'00',vnp_token:token,vnp_card_number:'123456xxxxxx6789',vnp_bank_code:'VISA',vnp_card_type:'02'};const raw={...p,vnp_secure_hash:signature(p,process.env.VNPAY_TOKEN_HASH_SECRET)};assert.equal((await tokenIPN(raw)).RspCode,'00');assert.equal((await tokenIPN(raw)).RspCode,'02');const methods=await savedPaymentMethods(u._id);assert.equal(methods.length,1);assert.equal(methods[0].last4,'6789');assert.ok(!JSON.stringify(methods).includes(token));const stored=await PaymentMethod.findOne({ownerId:u._id}).select('+providerTokenEncrypted');assert.ok(stored.providerTokenEncrypted&&!stored.providerTokenEncrypted.includes(token));const stranger=await user();assert.equal((await savedPaymentMethods(stranger._id)).length,0);await assert.rejects(createCheckout(stranger._id,{tier:'PLUS',billingCycle:'monthly',expectedRevision:(await getPlanSnapshot('PLUS')).revision,paymentMethodId:String(methods[0]._id)},crypto.randomUUID(),'127.0.0.1'),e=>e.code==='BILLING_PAYMENT_METHOD_NOT_FOUND');});

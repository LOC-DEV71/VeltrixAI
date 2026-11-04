const {test,before,after,mock}=require('node:test'),assert=require('node:assert/strict');
const mongoose=require('mongoose'),{MongoMemoryReplSet}=require('mongodb-memory-server');
const http=require('node:http'),{spawn}=require('node:child_process'),path=require('node:path'),{randomUUID,createHmac}=require('node:crypto');
const {User}=require('../dist/models/User'),{BillingOrder}=require('../dist/models/BillingOrder');
const {Wallet,CreditLot,CreditLedger,CreditReservation}=require('../dist/models/Credits');
const {PaymentReceipt,CashMovement}=require('../dist/models/Finance');
const {BillingRefund,BillingRefundQuote,RefundReceipt,RefundAudit}=require('../dist/models/BillingRefund');
const {Session}=require('../dist/models/Session');
const {signAccessToken}=require('../dist/utils/jwt');
const request=require('supertest'),express=require('express');
const {CreditService}=require('../dist/services/CreditService'),{seedConfig}=require('../dist/services/PlanService');
const service=require('../dist/services/BillingRefundService'),provider=require('../dist/services/VNPayRefundProvider');
const {cashflow}=require('../dist/services/AdminFinance');
const {vnDate}=require('../dist/services/VNPayProvider');
let mongo,server,url,sequence=0;const registry=new Map(),moneyRequests=[];const realFetch=global.fetch;
const signature=(fields,data)=>createHmac('sha512','test-refund-key').update(fields.map(key=>data[key]??'').join('|')).digest('hex');
before(async()=>{
 Object.assign(process.env,{NODE_ENV:'test',VNPAY_MODE:'sandbox',VNPAY_TMN_CODE:'TESTONLY',VNPAY_HASH_SECRET:'test-refund-key',VNPAY_RETURN_URL:'https://example.invalid/return',VNPAY_CLIENT_URL:'http://localhost:5173',VNPAY_REFUND_ENABLED:'true',VNPAY_SERVER_IP:'127.0.0.1'});
 mongo=await MongoMemoryReplSet.create({replSet:{count:1}});await mongoose.connect(mongo.getUri());
 await Promise.all([User,BillingOrder,Wallet,CreditLot,CreditLedger,CreditReservation,PaymentReceipt,CashMovement,BillingRefund,BillingRefundQuote,RefundReceipt].map(m=>m.init()));
 server=http.createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;const data=JSON.parse(body),entry=registry.get(data.vnp_TxnRef);assert.ok(entry);
  assert.equal(data.vnp_SecureHash,signature(data.vnp_Command==='refund'?provider.REFUND_FIELDS:provider.QUERY_FIELDS,data));
  assert.equal(data.vnp_TransactionDate,vnDate(entry.order.createdAt));
  if(data.vnp_Command==='refund'){moneyRequests.push(data.vnp_TxnRef);assert.equal(data.vnp_Amount,String(entry.order.amount*100));if(entry.behavior==='lost'){req.socket.destroy();return;}}
  const refund=data.vnp_Command==='refund'||entry.reconciled;
  const result={vnp_ResponseId:randomUUID().replaceAll('-',''),vnp_Command:data.vnp_Command,vnp_ResponseCode:refund&&entry.behavior==='rejected'?'95':'00',vnp_Message:'Protocol test',vnp_TmnCode:'TESTONLY',vnp_TxnRef:data.vnp_TxnRef,vnp_Amount:String(entry.order.amount*100),vnp_BankCode:'TESTBANK',vnp_PayDate:vnDate(entry.order.paidAt),vnp_TransactionNo:refund?'900'+entry.number:entry.order.providerTransactionId,vnp_TransactionType:refund?'02':'01',vnp_TransactionStatus:refund&&entry.behavior==='rejected'?'09':refund&&entry.behavior==='pending'?'05':'00',vnp_OrderInfo:'Protocol test'};
  result.vnp_SecureHash=signature(data.vnp_Command==='querydr'?[...provider.RESPONSE_FIELDS,'vnp_PromotionCode','vnp_PromotionAmount']:provider.RESPONSE_FIELDS,result);
  if(entry.behavior==='bad-signature'&&data.vnp_Command==='refund')result.vnp_SecureHash='0'.repeat(128);
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));url='http://127.0.0.1:'+server.address().port;
 mock.method(global,'fetch',(endpoint,options)=>{assert.ok(String(endpoint).startsWith('https://sandbox.vnpayment.vn/'));return realFetch(url,options);});
});
after(async()=>{mock.restoreAll();if(server)await new Promise(resolve=>server.close(resolve));await mongoose.disconnect();await mongo?.stop();});
async function fixture(behavior='success'){
 const number=++sequence,now=new Date(Math.floor(Date.now()/1000)*1000),owner=await User.create({email:'refund-'+number+'@example.invalid',displayName:'Refund Test',plan:'PLUS'});
 const config=seedConfig('PLUS');config.credits.monthlyGrant=10000;
 const common={ownerId:owner._id,tier:'PLUS',billingCycle:'monthly',amount:199000,planSnapshot:{tier:'PLUS',revision:1,config},status:'PAID',mode:'sandbox',expiresAt:now};
 const prior=await BillingOrder.create({...common,requestKey:randomUUID(),paidAt:new Date(+now-86400000),createdAt:new Date(+now-2*86400000),startsAt:new Date(+now-86400000),endsAt:new Date(+now+10*86400000),providerTransactionId:'300'+number,purpose:'PURCHASE'});
 const order=await BillingOrder.create({...common,requestKey:randomUUID(),paidAt:now,createdAt:new Date(+now-60000),startsAt:now,endsAt:new Date(+now+30*86400000),providerTransactionId:'400'+number,purpose:'RENEWAL',renewalOfOrderId:prior._id});
 const receipt=await PaymentReceipt.create({orderId:order._id,ownerId:owner._id,provider:'VNPAY',mode:'sandbox',amount:order.amount,outcome:'SUCCESS',channel:'CHECKOUT',responseCode:'00',transactionStatus:'00',providerTransactionId:order.providerTransactionId,providerPaidAt:now,confirmedAt:now});
 await CashMovement.create({orderId:order._id,ownerId:owner._id,paymentId:receipt._id,kind:'PAYMENT_RECEIVED',amount:order.amount,mode:'sandbox',occurredAt:now,tier:'PLUS',planName:config.overview.name,billingCycle:'monthly'});
 const wallet=await Wallet.create({userId:owner._id,bucket:'FREE',available:10000,reserved:0});
 const lot=await CreditLot.create({walletId:wallet._id,billingOrderId:order._id,amount:10000,available:10000,expiresAt:new Date(+now+30*86400000),grantSnapshot:order.planSnapshot});
 await CreditLedger.create({walletId:wallet._id,transactionType:'GRANT',deltaAvailable:10000,deltaReserved:0,referenceId:`billing_${order._id}_0`});
 await User.updateOne({_id:owner._id},{$set:{billingOrderId:order._id,planPeriod:{billingCycle:'MONTHLY',startsAt:order.startsAt,endsAt:order.endsAt}}});
 registry.set(String(order._id),{order,number,behavior});return {owner,order,prior,wallet,lot,ip:'192.0.2.'+number};
}
async function quote(f){return service.checkRenewalRefund(f.owner._id,String(f.order._id),f.ip);}
const body=(q)=>({quoteId:q.quoteId,requestId:randomUUID(),confirmed:true});
async function spend(f,amount,final=amount){const jobId=new mongoose.Types.ObjectId();await CreditService.reserveUsable(f.owner._id,amount,jobId,true);await CreditService.settle(jobId,final);return jobId;}
function child(f,q,key){return new Promise(resolve=>{const processChild=spawn(process.execPath,[path.join(__dirname,'refund-worker.cjs'),String(f.owner._id),String(f.order._id),q.quoteId,key,f.ip],{env:{...process.env,MONGODB_URI:mongo.getUri(),REFUND_FIXTURE_URL:url},windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';processChild.stdout.on('data',chunk=>output+=chunk);processChild.on('exit',code=>resolve({code,result:JSON.parse(output||'{}')}));});}
test('two separate Node processes and rapid retries issue exactly one refund for one order',async()=>{
 const f=await fixture(),q=await quote(f),inputs=[randomUUID(),randomUUID()];
 const results=await Promise.all(inputs.map(key=>child(f,q,key)));assert.ok(results.some(r=>r.result.status==='COMPLETED'),JSON.stringify(results));
 assert.equal(moneyRequests.filter(id=>id===String(f.order._id)).length,1);assert.equal(await BillingRefund.countDocuments({orderId:f.order._id}),1);assert.equal(await RefundReceipt.countDocuments({orderId:f.order._id}),1);
 for(let i=0;i<3;i++)assert.equal((await service.confirmRenewalRefund(f.owner._id,String(f.order._id),body(q),f.ip)).status,'COMPLETED');
 assert.equal(moneyRequests.filter(id=>id===String(f.order._id)).length,1);assert.equal((await CreditLot.findById(f.lot._id)).available,0);assert.equal((await Wallet.findById(f.wallet._id)).available,0);
 const report=await cashflow({mode:'sandbox',ownerId:String(f.owner._id)});assert.equal(report.refunds,199000);assert.equal(report.summary.netReceived,199000); // prior payment is a legacy receipt, renewal nets to zero
 const stored=await BillingRefund.findOne({orderId:f.order._id});assert.equal(stored.policyVersion,'renewal-24h-1000-v1');assert.equal(stored.quoteId.toString(),q.quoteId);assert.ok(stored.paymentReceiptId&&stored.cashMovementId&&stored.grantLedgerId);assert.ok(stored.confirmedAt&&stored.paymentVerifiedAt);
 assert.equal(await RefundAudit.countDocuments({refundId:stored._id,status:'SENDING'}),1);await assert.rejects(RefundAudit.updateOne({refundId:stored._id},{$set:{status:'COMPLETED'}}),/IMMUTABLE_REFUND_AUDIT/);
});

test('actual HTTP routes require session, allowed origin, CSRF and matching owner before money moves',async()=>{
 const f=await fixture(),app=express();app.use('/api/support',require('../dist/routes/support').default);
 const origin='http://localhost:5175',path='/api/support/billing/'+f.order._id+'/refund';
 await request(app).post(path).set('Origin',origin).send({}).expect(401);
 const session=await Session.create({userId:f.owner._id,tokenFamily:randomUUID(),refreshTokenHash:'testhash',expiresAt:new Date(Date.now()+3600000)});
 const access='accessToken='+signAccessToken({sessionId:session._id,userId:f.owner._id});
 await request(app).post(path).set('Cookie',access).set('Origin','https://attacker.invalid').send({}).expect(403);
 await request(app).post(path).set('Cookie',access).set('Origin',origin).send({}).expect(403);
 const csrf=await request(app).get('/api/support/csrf').set('Cookie',access).set('Origin',origin).expect(200);
 const cookies=access+'; '+csrf.headers['set-cookie'][0].split(';')[0],token=csrf.body.data.csrfToken;
 const other=await fixture();await request(app).post('/api/support/billing/'+other.order._id+'/check').set('Cookie',cookies).set('Origin',origin).set('x-csrf-token',token).send({}).expect(404);
 await request(app).post(path).set('Cookie',cookies).set('Origin',origin).set('x-csrf-token',token).send({confirmed:true,amount:1}).expect(400);
 const history=await request(app).get('/api/support/billing').set('Cookie',cookies).set('Origin',origin).expect(200);assert.ok(history.body.data.items.every(order=>[String(f.order._id),String(f.prior._id)].includes(order.orderId)));assert.equal(history.body.data.limit,10);
 assert.equal(moneyRequests.filter(id=>id===String(f.order._id)).length,0);
});

test('a reservation racing confirmation cannot spend the refunded credits',async()=>{
 const f=await fixture(),q=await quote(f),jobId=new mongoose.Types.ObjectId();
 const [reservation,refund]=await Promise.allSettled([CreditService.reserveUsable(f.owner._id,1001,jobId,true),service.confirmRenewalRefund(f.owner._id,String(f.order._id),body(q),f.ip)]);
 if(reservation.status==='fulfilled'){await CreditService.settle(jobId,1001);assert.equal(moneyRequests.filter(id=>id===String(f.order._id)).length,0);assert.equal(refund.status,'rejected');}
 else {assert.equal(refund.status,'fulfilled');assert.equal(refund.value.status,'COMPLETED');assert.equal((await Wallet.findById(f.wallet._id)).available,0);assert.equal(await CreditReservation.countDocuments({jobId}),0);}
});
test('lost response never resends; only a signed reconciliation can finish the refund',async()=>{
 const f=await fixture('lost'),q=await quote(f),result=await service.confirmRenewalRefund(f.owner._id,String(f.order._id),body(q),f.ip);assert.equal(result.status,'UNKNOWN');
 await service.confirmRenewalRefund(f.owner._id,String(f.order._id),body(q),f.ip);assert.equal(moneyRequests.filter(id=>id===String(f.order._id)).length,1);assert.equal(await RefundReceipt.countDocuments({orderId:f.order._id}),0);
 registry.get(String(f.order._id)).reconciled=true;await BillingRefund.updateOne({orderId:f.order._id},{$set:{lastCheckedAt:new Date(Date.now()-60000)}});
 const status=await service.getRenewalRefund(f.owner._id,String(f.order._id),f.ip);assert.equal(status.status,'COMPLETED');assert.equal(moneyRequests.filter(id=>id===String(f.order._id)).length,1);
});
test('1000 settled credits qualify; pending reservations and 1001 consumed credits block',async()=>{
 const allowed=await fixture();await spend(allowed,2000,1000);assert.equal((await quote(allowed)).spentCredits,1000);
 const denied=await fixture();await spend(denied,1001);await assert.rejects(quote(denied),e=>e.code==='REFUND_CREDIT_LIMIT');
 const pending=await fixture();await CreditService.reserveUsable(pending.owner._id,100,new mongoose.Types.ObjectId(),true);await assert.rejects(quote(pending),e=>e.code==='REFUND_JOBS_PENDING');
});
test('mixed lots use actual settlement attribution, not allocations or the whole wallet balance',async()=>{
 const f=await fixture();await CreditLot.create({walletId:f.wallet._id,amount:1000,available:1000,expiresAt:new Date(Date.now()+3600000),source:'ADMIN'});await Wallet.updateOne({_id:f.wallet._id},{$inc:{available:1000}});
 await spend(f,1500,1100);assert.equal((await quote(f)).spentCredits,100);
});
test('confirmation rechecks usage and rejects a stale quote before money moves',async()=>{
 const f=await fixture(),q=await quote(f);await spend(f,1001);await assert.rejects(service.confirmRenewalRefund(f.owner._id,String(f.order._id),body(q),f.ip),e=>e.code==='REFUND_CREDIT_LIMIT');assert.equal(moneyRequests.filter(id=>id===String(f.order._id)).length,0);
 const old=await fixture(),oldQuote=await quote(old);await BillingRefundQuote.updateOne({_id:oldQuote.quoteId},{$set:{expiresAt:new Date(Date.now()-1000)}});await assert.rejects(service.confirmRenewalRefund(old.owner._id,String(old.order._id),body(oldQuote),old.ip),e=>e.code==='REFUND_QUOTE_EXPIRED');
});
test('ownership, signed payment evidence, renewal classification and the 24h window are mandatory',async()=>{
 const f=await fixture();await assert.rejects(service.renewalEvidence(new mongoose.Types.ObjectId(),String(f.order._id)),e=>e.code==='REFUND_NOT_FOUND');
 await BillingOrder.updateOne({_id:f.order._id},{$set:{purpose:'PURCHASE'}});await assert.rejects(service.renewalEvidence(f.owner._id,String(f.order._id)),e=>e.code==='REFUND_NOT_RENEWAL');
 await BillingOrder.updateOne({_id:f.order._id},{$set:{purpose:'RENEWAL',paidAt:new Date(Date.now()-86401000)}});await assert.rejects(service.renewalEvidence(f.owner._id,String(f.order._id)),e=>e.code==='REFUND_OUTSIDE_WINDOW');
 const incomplete=await fixture();await CreditLedger.updateOne({referenceId:`billing_${incomplete.order._id}_0`},{$inc:{deltaAvailable:1}});await assert.rejects(quote(incomplete),e=>e.code==='REFUND_EVIDENCE_INCOMPLETE');
 const manipulated=await fixture(),q=await quote(manipulated);await assert.rejects(service.confirmRenewalRefund(manipulated.owner._id,String(manipulated.order._id),{...body(q),amount:1},manipulated.ip),e=>e.code==='REFUND_INVALID_INPUT');
});
test('rejected refund restores only frozen credits; invalid signatures keep funds and credits unresolved',async()=>{
 const f=await fixture('rejected'),q=await quote(f);assert.equal((await service.confirmRenewalRefund(f.owner._id,String(f.order._id),body(q),f.ip)).status,'REJECTED');assert.equal((await Wallet.findById(f.wallet._id)).available,10000);assert.ok(!(await BillingOrder.findById(f.order._id)).refundLockedAt);assert.equal(await RefundReceipt.countDocuments({orderId:f.order._id}),0);
 const bad=await fixture('bad-signature'),bq=await quote(bad);assert.equal((await service.confirmRenewalRefund(bad.owner._id,String(bad.order._id),body(bq),bad.ip)).status,'UNKNOWN');assert.equal((await Wallet.findById(bad.wallet._id)).available,0);assert.equal(await RefundReceipt.countDocuments({orderId:bad.order._id}),0);
});
test('atomic shared check rate permits one concurrent query; disabled gateway fails closed',async()=>{
 const f=await fixture();const results=await Promise.allSettled(Array.from({length:4},()=>quote(f)));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.ok(results.filter(r=>r.status==='rejected').every(r=>r.reason.code==='REFUND_RATE_LIMITED'));
 process.env.VNPAY_REFUND_ENABLED='false';assert.throws(()=>provider.refundGateway(f.order),e=>e.code==='REFUND_GATEWAY_UNAVAILABLE');process.env.VNPAY_REFUND_ENABLED='true';
 const initial=await fixture();const reads=await Promise.allSettled(Array.from({length:8},()=>service.refundRate(initial.owner._id,initial.ip,'view')));assert.equal(reads.filter(row=>row.status==='fulfilled').length,6);assert.ok(reads.filter(row=>row.status==='rejected').every(row=>row.reason.code==='REFUND_RATE_LIMITED'));
});

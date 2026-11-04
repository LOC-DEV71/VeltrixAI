// Real Support UI + isolated Mongo and signed VNPay protocol fixture; no real refund.
// SUPPORT_BROWSER_LIVE_AI=true also verifies the real local Gemma answer.
const path=require('node:path'),assert=require('node:assert/strict'),{randomUUID,createHmac}=require('node:crypto');
const root=path.resolve(__dirname,'../../..'),backend=path.join(root,'apps/backend-api');const fs=require('node:fs');const screenshots=path.join(root,'.runtime');fs.mkdirSync(screenshots,{recursive:true});require(path.join(backend,'node_modules/dotenv')).config({path:path.join(backend,'.env'),quiet:true});
const mongoose=require(path.join(backend,'node_modules/mongoose')),{MongoMemoryReplSet}=require(path.join(backend,'node_modules/mongodb-memory-server'));
const express=require(path.join(backend,'node_modules/express')),{chromium}=require(path.join(root,'apps/web-client/node_modules/playwright'));
const {User}=require(path.join(backend,'dist/models/User')),{Session}=require(path.join(backend,'dist/models/Session')),{BillingOrder}=require(path.join(backend,'dist/models/BillingOrder'));
const {Wallet,CreditLot,CreditLedger}=require(path.join(backend,'dist/models/Credits')),{PaymentReceipt,CashMovement}=require(path.join(backend,'dist/models/Finance'));
const {BillingRefund,RefundReceipt}=require(path.join(backend,'dist/models/BillingRefund')),{signAccessToken}=require(path.join(backend,'dist/utils/jwt'));
const {seedConfig}=require(path.join(backend,'dist/services/PlanService')),{vnDate}=require(path.join(backend,'dist/services/VNPayProvider'));
const provider=require(path.join(backend,'dist/services/VNPayRefundProvider'));
const signature=(fields,data)=>createHmac('sha512','browser-protocol-key').update(fields.map(key=>data[key]??'').join('|')).digest('hex');
(async()=>{
 let mongo,server,browser;const realFetch=global.fetch;let moneyRequests=0;
 try{
 Object.assign(process.env,{NODE_ENV:'test',VNPAY_MODE:'sandbox',VNPAY_TMN_CODE:'UITEST00',VNPAY_HASH_SECRET:'browser-protocol-key',VNPAY_RETURN_URL:'https://example.invalid/return',VNPAY_CLIENT_URL:'http://localhost:5173',VNPAY_REFUND_ENABLED:'true',VNPAY_SERVER_IP:'127.0.0.1'});
 mongo=await MongoMemoryReplSet.create({replSet:{count:1}});await mongoose.connect(mongo.getUri());await Promise.all([User,Session,BillingOrder,Wallet,CreditLot,CreditLedger,PaymentReceipt,CashMovement,BillingRefund,RefundReceipt].map(model=>model.init()));
 const now=new Date(Math.floor(Date.now()/1000)*1000),user=await User.create({email:'refund-browser@example.invalid',displayName:'Khách kiểm thử',plan:'PLUS'}),config=seedConfig('PLUS');config.credits.monthlyGrant=10000;
 const common={ownerId:user._id,tier:'PLUS',billingCycle:'monthly',amount:199000,planSnapshot:{tier:'PLUS',revision:1,config},status:'PAID',mode:'sandbox',expiresAt:now};
 const prior=await BillingOrder.create({...common,requestKey:randomUUID(),purpose:'PURCHASE',providerTransactionId:'30001',createdAt:new Date(+now-2*86400000),paidAt:new Date(+now-86400000),startsAt:new Date(+now-86400000),endsAt:new Date(+now+10*86400000)});
 const order=await BillingOrder.create({...common,requestKey:randomUUID(),purpose:'RENEWAL',renewalOfOrderId:prior._id,providerTransactionId:'40001',createdAt:new Date(+now-60000),paidAt:now,startsAt:now,endsAt:new Date(+now+30*86400000)});
 await User.updateOne({_id:user._id},{$set:{billingOrderId:order._id,planPeriod:{billingCycle:'MONTHLY',startsAt:order.startsAt,endsAt:order.endsAt}}});
 const payment=await PaymentReceipt.create({ownerId:user._id,orderId:order._id,provider:'VNPAY',mode:'sandbox',amount:order.amount,outcome:'SUCCESS',channel:'CHECKOUT',responseCode:'00',transactionStatus:'00',providerTransactionId:order.providerTransactionId,providerPaidAt:now,confirmedAt:now});
 await CashMovement.create({ownerId:user._id,orderId:order._id,paymentId:payment._id,kind:'PAYMENT_RECEIVED',amount:order.amount,mode:'sandbox',occurredAt:now,tier:'PLUS',planName:config.overview.name,billingCycle:'monthly'});
 const wallet=await Wallet.create({userId:user._id,bucket:'FREE',available:10000,reserved:0});await CreditLot.create({walletId:wallet._id,billingOrderId:order._id,amount:10000,available:10000,expiresAt:order.endsAt,grantSnapshot:order.planSnapshot});await CreditLedger.create({walletId:wallet._id,transactionType:'GRANT',deltaAvailable:10000,deltaReserved:0,referenceId:`billing_${order._id}_0`});
 const session=await Session.create({userId:user._id,tokenFamily:randomUUID(),refreshTokenHash:'browserhash',expiresAt:new Date(Date.now()+3600000)});
 const app=express();app.use('/api/support',require(path.join(backend,'dist/routes/support')).default);
 app.post('/fixture/vnpay',express.json(),(req,res)=>{const data=req.body,isRefund=data.vnp_Command==='refund';assert.equal(data.vnp_SecureHash,signature(isRefund?provider.REFUND_FIELDS:provider.QUERY_FIELDS,data));if(isRefund)moneyRequests++;
 const result={vnp_ResponseId:randomUUID().replaceAll('-',''),vnp_Command:data.vnp_Command,vnp_ResponseCode:'00',vnp_Message:'Isolated browser protocol test',vnp_TmnCode:'UITEST00',vnp_TxnRef:String(order._id),vnp_Amount:String(order.amount*100),vnp_BankCode:'TESTBANK',vnp_PayDate:vnDate(now),vnp_TransactionNo:isRefund?'90001':order.providerTransactionId,vnp_TransactionType:isRefund?'02':'01',vnp_TransactionStatus:'00',vnp_OrderInfo:'Protocol test'};result.vnp_SecureHash=signature(isRefund?provider.RESPONSE_FIELDS:[...provider.RESPONSE_FIELDS,'vnp_PromotionCode','vnp_PromotionAmount'],result);res.json(result);});
 server=await new Promise(resolve=>{const handle=app.listen(0,'127.0.0.1',()=>resolve(handle));});const api='http://127.0.0.1:'+server.address().port;
 global.fetch=(endpoint,options)=>String(endpoint).startsWith('https://sandbox.vnpayment.vn/')?realFetch(api+'/fixture/vnpay',options):realFetch(endpoint,options);
 browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await context.addCookies([{name:'accessToken',value:signAccessToken({sessionId:session._id,userId:user._id}),domain:'localhost',path:'/',httpOnly:true,sameSite:'Lax'}]);
 await page.route('http://localhost:3001/api/**',async route=>{const url=new URL(route.request().url()),response=await route.fetch({url:api+url.pathname+url.search});await route.fulfill({response});});
 await page.goto('http://localhost:5175/?chat=1');await page.getByRole('textbox',{name:'Câu hỏi cho AI'}).waitFor();
 if(process.env.SUPPORT_BROWSER_LIVE_AI!=='true'){await page.getByRole('button',{name:'Gia hạn & hoàn tiền',exact:true}).click();}
 else{
 await page.getByRole('textbox',{name:'Câu hỏi cho AI'}).fill('Tôi đang dùng gói gì? Tôi muốn hoàn tiền lần gia hạn, tôi cần làm gì?');
 const answer=page.waitForResponse(r=>r.url().endsWith('/api/support/chat')&&r.request().method()==='POST',{timeout:100000});await page.getByRole('button',{name:'Gửi câu hỏi'}).click();const reply=await (await answer).json();assert.ok(reply.success,JSON.stringify(reply));assert.match(reply.data.answer,/Plus/i);assert.deepEqual(reply.data.actions,['review-renewal-refund']);assert.equal(moneyRequests,0);console.log('PASS real Gemma reads the authenticated plan and opens review without sending any money');
 await page.getByRole('button',{name:'Kiểm tra đơn gia hạn',exact:true}).click();}
 await page.getByRole('button',{name:'Kiểm tra điều kiện hoàn'}).click();await page.getByRole('heading',{name:/Xác nhận hoàn toàn bộ/}).waitFor();
 await page.screenshot({path:path.join(screenshots,'support-refund-confirm-1440.png')});
 await page.getByRole('button',{name:'Xác nhận hoàn toàn bộ tiền',exact:true}).evaluate(button=>{button.click();button.click();button.click();});
 await page.locator('.billing-status').filter({hasText:/VNPay.*xác nhận/}).waitFor({timeout:30000});assert.equal(moneyRequests,1);assert.equal(await RefundReceipt.countDocuments({orderId:order._id}),1);
 console.log('PASS actual UI triple-click produces one signed protocol refund and one immutable receipt');
 for(const width of [820,390]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.ok(await page.locator('.chat-panel').evaluate(el=>el.getBoundingClientRect().width<=innerWidth));await page.screenshot({path:path.join(screenshots,'support-refund-'+width+'.png')});}
 assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>localStorage.length),0);console.log('PASS desktop/tablet/mobile layout; no JavaScript errors or browser token storage');
 }finally{global.fetch=realFetch;await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));await mongoose.disconnect();await mongo?.stop();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});

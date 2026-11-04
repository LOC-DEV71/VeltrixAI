// Separate Node process, isolated test Mongo and a signed gateway protocol fixture.
if(process.env.NODE_ENV!=='test'||!process.env.REFUND_FIXTURE_URL)throw Error('TEST_ONLY');
const mongoose=require('mongoose');const realFetch=global.fetch;
global.fetch=(url,options)=>{if(!String(url).startsWith('https://sandbox.vnpayment.vn/'))throw Error('TEST_NETWORK_DENIED');return realFetch(process.env.REFUND_FIXTURE_URL,options);};
(async()=>{await mongoose.connect(process.env.MONGODB_URI);const [ownerId,orderId,quoteId,key,ip]=process.argv.slice(2);const result=await require('../dist/services/BillingRefundService').confirmRenewalRefund(ownerId,orderId,{quoteId,requestId:key,confirmed:true},ip);process.stdout.write(JSON.stringify({status:result.status}));})().catch(error=>{process.stdout.write(JSON.stringify({error:error.code||'FAILED'}));process.exitCode=1;}).finally(()=>mongoose.disconnect());

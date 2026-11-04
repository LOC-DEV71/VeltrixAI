const mongoose=require('mongoose');
const admission=require('../dist/services/SupportAdmission');
(async()=>{
 if(process.env.NODE_ENV!=='test'||!process.env.MONGODB_URI?.includes('127.0.0.1'))throw Error('ISOLATED_TEST_REQUIRED');
 await mongoose.connect(process.env.MONGODB_URI);
 let token;
 try{token=await admission.acquireSupportAdmission(process.argv[2],process.argv[3]);console.log(JSON.stringify({acquired:true}));await new Promise(resolve=>setTimeout(resolve,2000));}
 catch(error){console.log(JSON.stringify({code:error.code||'FAILED'}));}
 finally{if(token)await admission.releaseSupportAdmission(token);}
})().catch(()=>{process.exitCode=1;}).finally(()=>mongoose.disconnect());

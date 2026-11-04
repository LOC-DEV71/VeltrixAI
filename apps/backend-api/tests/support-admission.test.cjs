const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const mongoose=require('mongoose'),{MongoMemoryReplSet}=require('mongodb-memory-server');
const {randomUUID}=require('node:crypto'),{spawn}=require('node:child_process'),path=require('node:path');
const admission=require('../dist/services/SupportAdmission');
let mongo;
before(async()=>{mongo=await MongoMemoryReplSet.create({replSet:{count:1}});await mongoose.connect(mongo.getUri());});
after(async()=>{await mongoose.disconnect();await mongo?.stop();});
function worker(){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(__dirname,'support-admission-worker.cjs'),randomUUID(),randomUUID()],{env:{...process.env,NODE_ENV:'test',MONGODB_URI:mongo.getUri()},windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',chunk=>output+=chunk);child.on('error',reject);child.on('exit',code=>code?reject(Error('worker failed')):resolve(JSON.parse(output)));});}
test('separate replicas share one inference lease, and an old worker cannot release its replacement',async()=>{
 const result=await Promise.all([worker(),worker()]);assert.equal(result.filter(row=>row.acquired).length,1);assert.equal(result.filter(row=>row.code==='SUPPORT_AI_BUSY').length,1);
 const stale=await admission.acquireSupportAdmission(randomUUID(),randomUUID());await admission.SupportLease.updateOne({key:'support-global'},{$set:{expiresAt:new Date(Date.now()-1000)}});
 const current=await admission.acquireSupportAdmission(randomUUID(),randomUUID());await admission.releaseSupportAdmission(stale);
 assert.equal((await admission.SupportLease.findOne({key:'support-global'})).token,current);await admission.releaseSupportAdmission(current);
});
test('shared request rate is atomic even on cache retries, and inference has a separate six-call ceiling',async()=>{
 const owner=randomUUID(),ip=randomUUID();const result=await Promise.allSettled(Array.from({length:25},()=>admission.supportRequestRate(owner,ip)));assert.equal(result.filter(row=>row.status==='fulfilled').length,20);assert.ok(result.filter(row=>row.status==='rejected').every(row=>row.reason.code==='SUPPORT_RATE_LIMITED'));
 const second=randomUUID(),secondIp=randomUUID();for(let i=0;i<6;i++){const token=await admission.acquireSupportAdmission(second,secondIp);await admission.releaseSupportAdmission(token);}await assert.rejects(admission.acquireSupportAdmission(second,secondIp),error=>error.code==='SUPPORT_RATE_LIMITED');
});
test('cached answers are scoped to account/IP/request and expired replies cannot replay private data',async()=>{
 const key=randomUUID()+':ip:request';await admission.cacheSharedSupportReply(key,'input-hash',{answer:'Private account reply',memory:'private memory'});assert.equal((await admission.getSharedSupportReply(key)).data.answer,'Private account reply');assert.equal(await admission.getSharedSupportReply('other-'+key),null);await admission.SupportReply.updateOne({key},{$set:{expiresAt:new Date(Date.now()-1000)}});assert.equal(await admission.getSharedSupportReply(key),null);
});

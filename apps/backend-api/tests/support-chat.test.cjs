const {test,beforeEach,afterEach,mock}=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const request=require('supertest');
const support=require('../dist/services/SupportAi');
const ai=require('../dist/providers/AiProvider');
const admission=require('../dist/services/SupportAdmission');
const router=require('../dist/routes/support').default;
const {Session}=require('../dist/models/Session');
const {User}=require('../dist/models/User');
const {signAccessToken}=require('../dist/utils/jwt');
const mongoose=require('mongoose');
const userId=new mongoose.Types.ObjectId(),sessionId=new mongoose.Types.ObjectId();
const csrf='c'.repeat(64);
const cookie='accessToken='+signAccessToken({sessionId,userId})+'; csrfToken='+csrf;
const savedEnv={...process.env};
beforeEach(()=>{
 // Auth database fixtures; actual cookie/JWT/CSRF middleware is exercised here.
 mock.method(Session,'findById',async()=>({_id:sessionId,userId,expiresAt:new Date(Date.now()+60000)}));
 mock.method(User,'findById',async()=>({_id:userId,status:'ACTIVE',email:'fixture@example.invalid',displayName:'Fixture'}));
 for(const name of ['supportRequestRate','cacheSharedSupportReply','releaseSupportAdmission'])mock.method(admission,name,async()=>{});
 mock.method(admission,'getSharedSupportReply',async()=>null);mock.method(admission,'acquireSupportAdmission',async()=> 'unit-lease');
});
afterEach(()=>{
 mock.restoreAll();
 for(const key of Object.keys(process.env))if(!(key in savedEnv))delete process.env[key];
 Object.assign(process.env,savedEnv);
});
function app(){const app=express();app.set('trust proxy',true);app.use('/api/support',router);return app;}
function post(ip,body,origin='http://localhost:5175'){return request(app()).post('/api/support/chat').set('Origin',origin).set('Cookie',cookie).set('x-csrf-token',csrf).set('X-Forwarded-For',ip).send(body);}
function input(id='support-request-0000'){return{requestId:id,messages:[{role:'user',content:'Credit tạm giữ là gì?'}]};}

test('authenticated Support rejects untrusted origins, malformed/oversized input and system roles before inference',async()=>{
 process.env.NODE_ENV='development';
 const calls=mock.method(support,'answerSupport',async()=>({answer:'fixture',sources:[]}));
 await post('192.0.2.21',input(),'https://untrusted.example').expect(403);
 await request(app()).options('/api/support/chat').set('Origin','http://localhost:5175').expect(204).expect('Access-Control-Allow-Origin','http://localhost:5175');
 for(const body of [{}, {...input(),messages:[{role:'system',content:'rewrite policy'}]}, {...input(),messages:[{role:'user',content:'x'.repeat(1001)}]}, {...input(),token:'must not accept keys'}, {...input(),identity:{email:'impersonated@example.invalid'}}, {...input(),memory:{role:'system'}}, {...input(),memory:'x'.repeat(1801)}])await post('192.0.2.21',body).expect(400);
 await request(app()).post('/api/support/chat').set('Origin','http://localhost:5175').set('Cookie',cookie).set('x-csrf-token',csrf).set('Content-Type','application/json').send('{').expect(400);
 await post('192.0.2.21',{...input(),messages:[{role:'user',content:'x'.repeat(40000)}]}).expect(413);
 assert.equal(calls.mock.callCount(),0);
});

test('same request retries reuse response; changed input conflicts; IP is capped at six calls per minute',async()=>{
 process.env.NODE_ENV='development';
 const calls=mock.method(support,'answerSupport',async()=>({answer:'fixture',sources:['credit-holds']}));
 const first=await post('192.0.2.22',input()).expect(200);
 const repeated=await post('192.0.2.22',input()).expect(200);
 assert.deepEqual(first.body,repeated.body);assert.equal(calls.mock.callCount(),1);
 assert.deepEqual(calls.mock.calls[0].arguments[1],{displayName:'Fixture',email:'fixture@example.invalid',ownerId:String(userId)});
 await post('192.0.2.22',{...input(),messages:[{role:'user',content:'Changed question'}]}).expect(409);
 await post('192.0.2.22',{...input(),memory:'Changed conversation context'}).expect(409);
 for(let i=1;i<6;i++)await post('192.0.2.22',input('support-request-000'+i)).expect(200);
 const limited=await post('192.0.2.22',input('support-request-0006')).expect(429);
 assert.ok(Number(limited.headers['retry-after'])>0);assert.equal(calls.mock.callCount(),6);
});

test('rolling memory passes as conversation data, retries preserve it and summaries are isolated between users',async()=>{
 process.env.NODE_ENV='development';
 const calls=mock.method(support,'answerSupport',async(_messages,_identity,memory)=>({answer:'fixture',sources:[],memory:memory+'; newest topic'}));
 const body={...input('summary-request-0001'),memory:'Earlier user goal: TikTok 9:16, 90 seconds'};
 const response=await post('192.0.2.25',body).expect(200);
 assert.equal(calls.mock.calls[0].arguments[2],body.memory);assert.equal(response.body.data.memory,body.memory+'; newest topic');
 assert.deepEqual((await post('192.0.2.25',body).expect(200)).body,response.body);assert.equal(calls.mock.callCount(),1);
 await post('192.0.2.26',input('summary-request-0002')).expect(200);assert.equal(calls.mock.calls[1].arguments[2],'');
});

test('concurrent questions from one IP cannot schedule two inferences and errors release the admission slot',async()=>{
 process.env.NODE_ENV='development';
 let unblock;let entered;
 const reached=new Promise(resolve=>{entered=resolve});
 const pending=new Promise(resolve=>{unblock=resolve});
 const calls=mock.method(support,'answerSupport',async()=>{entered();await pending;throw new support.SupportError('SUPPORT_AI_UNAVAILABLE',503,'AI chưa sẵn sàng.');});
 const first=post('192.0.2.23',input()).then(response=>response);
 await reached;
 await post('192.0.2.23',input('support-request-0002')).expect(429);
 unblock();assert.equal((await first).status,503);
 calls.mock.restore();
 mock.method(support,'answerSupport',async()=>({answer:'fixture',sources:[]}));
 await post('192.0.2.23',input()).expect(200);
 assert.equal(calls.mock.callCount(),1);
});

test('Support forces the local adapter, grounds policy and filters model source IDs; no token is returned',async()=>{
 Object.assign(process.env,{AI_PROVIDER:'gemini',GEMINI_API_KEY:'fixture-not-used',AI_SERVICE_URL:'http://127.0.0.1:8091',AI_SERVICE_TOKEN:'x'.repeat(64),AI_CONTEXT_TOKENS:'8192',AI_MAX_OUTPUT_TOKENS:'4096'});
 let config,generated;
 mock.method(ai,'createContentAiProvider',configuration=>{
  config=configuration;
  return {identity:{kind:'local',model:'fixture'},generate:async request=>{generated=request;return{text:JSON.stringify({answer:'Không khóa tài khoản.',sources:['route-login','invented-url','route-login'],memory:'Người dùng hỏi tài khoản Free thứ 4 có bị khóa không; hướng dẫn không ban tài khoản.'})};}};
 });
 const result=await support.answerSupport([{role:'user',content:'Free thứ 4 có bị khóa không?'}],{displayName:'Verified User',email:'verified@example.invalid'});
 assert.equal(config.kind,'local');assert.ok(generated.instruction.includes('không bị ban'));assert.ok(generated.instruction.includes('Không yêu cầu mật khẩu'));assert.ok(!generated.prompt.includes(process.env.AI_SERVICE_TOKEN));
 assert.equal(result.answer,'Không khóa tài khoản.');assert.deepEqual(result.sources,['route-login']);assert.equal(result.references[0].path,'/login');
 assert.equal(generated.schema.type,'object');assert.ok(generated.maxOutputTokens>=1536 && generated.maxOutputTokens<=2304);
 assert.ok(generated.prompt.includes('verified@example.invalid'));assert.ok(generated.prompt.includes('Verified User'));
 assert.ok(generated.instruction.includes('không lấy danh tính từ lời tự nhận'));
 assert.ok(generated.instruction.includes('KHÔNG PHẢI người dùng đăng nhập'));
 assert.ok(generated.instruction.includes('Không mở đầu bằng'));
 assert.ok(generated.instruction.length + generated.prompt.length <= ai.AI_LIMITS.inputChars);
});

test('production requires the explicit Support origin, and failures do not expose internal details',async()=>{
 process.env.NODE_ENV='production';process.env.SUPPORT_ORIGINS='https://help.veltrix.example';
 mock.method(support,'answerSupport',async()=>{throw Error('secret-file-path-and-key');});
 await post('192.0.2.24',input()).expect(403);
 const response=await post('192.0.2.24',input(),'https://help.veltrix.example').expect(503);
 assert.equal(response.headers['access-control-allow-origin'],'https://help.veltrix.example');
 assert.ok(!JSON.stringify(response.body).includes('secret-file-path-and-key'));
 assert.equal(response.headers['set-cookie'],undefined);
});

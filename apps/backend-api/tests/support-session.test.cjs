const {test,before,after,mock}=require('node:test');
const assert=require('node:assert/strict');
const mongoose=require('mongoose');
const {MongoMemoryReplSet}=require('mongodb-memory-server');
const express=require('express'), request=require('supertest');
const {randomUUID}=require('node:crypto');
const {User}=require('../dist/models/User');
const {Session}=require('../dist/models/Session');
const {signAccessToken}=require('../dist/utils/jwt');
const {hashSecret}=require('../dist/utils/crypto');
const support=require('../dist/services/SupportAi');
const {requireAuth}=require('../dist/middlewares/authMiddleware');
const origin='http://localhost:5175';
let mongo, app, owner, session, creatorCookie, rawRefresh, answer;
before(async()=>{
 process.env.NODE_ENV='test';
 mongo=await MongoMemoryReplSet.create({replSet:{count:1}});await mongoose.connect(mongo.getUri());
 await Promise.all([User.init(),Session.init()]);
 owner=await User.create({email:'shared-session@example.invalid',displayName:'Creator Member'});
 rawRefresh=randomUUID()+randomUUID();
 session=await Session.create({userId:owner._id,tokenFamily:randomUUID(),refreshTokenHash:hashSecret(rawRefresh),expiresAt:new Date(Date.now()+3600000)});
 creatorCookie='accessToken='+signAccessToken({sessionId:session._id,userId:owner._id})+'; refreshToken='+rawRefresh;
 answer=mock.method(support,'answerSupport',async()=>({answer:'Authenticated AI protocol fixture.',sources:['credit-holds']}));
 app=express();app.use('/api/support',require('../dist/routes/support').default);
 app.get('/creator/me',require('cookie-parser')(),requireAuth,(req,res)=>res.json({id:String(req.user._id),sessionId:String(req.session._id)}));
});
after(async()=>{mock.restoreAll();await mongoose.disconnect();await mongo?.stop();});
function get(path,cookie=creatorCookie){let call=request(app).get('/api/support'+path).set('Origin',origin);if(cookie)call=call.set('Cookie',cookie);return call;}
function post(path,cookie,csrf,body={}){let call=request(app).post('/api/support'+path).set('Origin',origin).send(body);if(cookie)call=call.set('Cookie',cookie);if(csrf)call=call.set('x-csrf-token',csrf);return call;}
const input={requestId:'shared-session-request-0001',messages:[{role:'user',content:'Credit tạm giữ là gì?'}]};

test('no login cookie cannot read the Support session or call AI; no new session is issued',async()=>{
 const count=await Session.countDocuments();
 await get('/session','').expect(401);
 const response=await post('/chat','','',input).expect(401);
 assert.equal(response.headers['set-cookie'],undefined);assert.equal(answer.mock.callCount(),0);
 assert.equal(await Session.countDocuments(),count);
});

test('same Creator cookie identifies the same account and session, without bearer tokens in response',async()=>{
 const creator=await request(app).get('/creator/me').set('Cookie',creatorCookie).expect(200);
 const supportProfile=await get('/session').expect(200);
 assert.equal(supportProfile.body.data.id,creator.body.id);assert.equal(creator.body.sessionId,session.id);
 assert.deepEqual(Object.keys(supportProfile.body.data).sort(),['displayName','email','id']);
 assert.equal(supportProfile.headers['access-control-allow-credentials'],'true');
 assert.equal(await Session.countDocuments(),1);
 await request(app).get('/api/support/session').set('Cookie',creatorCookie).expect(200); // same-origin proxy GET has no Origin
});

test('shared cookie is insufficient for mutation without matching CSRF; bootstrap and chat work with it',async()=>{
 await post('/chat',creatorCookie,'',input).expect(403);assert.equal(answer.mock.callCount(),0);
 const csrfResponse=await get('/csrf').expect(200);const token=csrfResponse.body.data.csrfToken;
 const csrfCookie=csrfResponse.headers['set-cookie'][0].split(';')[0];
 assert.ok(csrfResponse.headers['set-cookie'][0].includes('HttpOnly'));
 assert.equal(csrfResponse.headers['x-csrf-token'],token);
 const response=await post('/chat',creatorCookie+'; '+csrfCookie,token,input).expect(200);
 assert.equal(response.body.data.answer,'Authenticated AI protocol fixture.');assert.equal(answer.mock.callCount(),1);
 await get('/csrf',creatorCookie+'; '+csrfCookie).expect(200).expect('x-csrf-token',token);
});

test('expired access cookie refreshes the existing shared session rather than creating a new one',async()=>{
 const csrfResponse=await get('/csrf').expect(200);const token=csrfResponse.body.data.csrfToken;const csrfCookie=csrfResponse.headers['set-cookie'][0].split(';')[0];
 const expiredCookie='accessToken='+signAccessToken({sessionId:session._id,userId:owner._id},'-1s')+'; refreshToken='+rawRefresh+'; '+csrfCookie;
 await get('/session',expiredCookie).expect(401);
 const response=await post('/refresh',expiredCookie,token).expect(200);
 creatorCookie=response.headers['set-cookie'].filter(value=>value.startsWith('accessToken=')||value.startsWith('refreshToken=')).map(value=>value.split(';')[0]).join('; ');
 await get('/session').expect(200);
 assert.equal(await Session.countDocuments(),1);assert.equal((await Session.findById(session._id)).userId.toString(),owner.id);
});

test('revoked sessions and banned users cannot use Support, and logout revokes the same Creator session',async()=>{
 await User.updateOne({_id:owner._id},{$set:{status:'BANNED'}});await get('/session').expect(401);
 await User.updateOne({_id:owner._id},{$set:{status:'ACTIVE'}});
 const csrfResponse=await get('/csrf').expect(200);const token=csrfResponse.body.data.csrfToken;const csrfCookie=csrfResponse.headers['set-cookie'][0].split(';')[0];
 await post('/logout',creatorCookie+'; '+csrfCookie,token).expect(200);
 assert.ok((await Session.findById(session._id)).revokedAt);
 await get('/session').expect(401);await request(app).get('/creator/me').set('Cookie',creatorCookie).expect(401);
 assert.equal(await Session.countDocuments(),1);
});

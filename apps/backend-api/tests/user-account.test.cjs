const {test,before,after}=require('node:test');
const assert=require('node:assert/strict'),mongoose=require('mongoose'),crypto=require('crypto');
const {MongoMemoryServer}=require('mongodb-memory-server');
const {User}=require('../dist/models/User'),{Session}=require('../dist/models/Session');
const {parseAccountPatch,accountFields,updateAccount}=require('../dist/services/UserAccount');
const {signAccessToken}=require('../dist/utils/jwt');
const request=require('supertest'),express=require('express'),cookieParser=require('cookie-parser');
let db;
before(async()=>{db=await MongoMemoryServer.create();await mongoose.connect(db.getUri());});
after(async()=>{await mongoose.disconnect();await db?.stop();});
const fixture=()=>User.create({email:crypto.randomUUID()+'@example.invalid',displayName:'Fixture'});
test('strict allowlist rejects privilege changes, bad choices, blank names and oversized text',()=>{
 for(const body of [{plan:'PRO'},{credits:1000},{email:'changed@example.invalid'},{profile:{roles:['ADMIN']}},{preferences:{tone:'unknown'}},{preferences:{platform:'unknown'}},{displayName:' '},{profile:{bio:'a'.repeat(501)}},{preferences:{audience:'a'.repeat(301)}},{profile:[]}])assert.throws(()=>parseAccountPatch({expectedRevision:0,...body}),e=>e.code==='ACCOUNT_INVALID_INPUT');
 assert.throws(()=>parseAccountPatch({expectedRevision:-1,displayName:'Name'}));
 assert.throws(()=>parseAccountPatch({expectedRevision:0}));
});
test('old users receive defaults without modifying stored documents',()=>{
 const old={displayName:'Old user'};assert.equal(accountFields(old).accountRevision,0);assert.equal(accountFields(old).preferences.platform,'tiktok');assert.equal(old.preferences,undefined);
});
test('profile and preferences survive database reload and retain protected properties',async()=>{
 const user=await fixture();await updateAccount(user._id,{expectedRevision:0,displayName:'Creator',profile:{bio:'Hello',occupation:'Writer'}});
 await updateAccount(user._id,{expectedRevision:1,preferences:{platform:'reels',audience:'Adults',tone:'pro'}});
 const saved=await User.findById(user._id);assert.equal(saved.displayName,'Creator');assert.equal(saved.profile.bio,'Hello');assert.equal(saved.preferences.tone,'pro');assert.equal(saved.accountRevision,2);assert.equal(saved.plan,'FREE');assert.equal(saved.email,user.email);
});
test('concurrent profile updates accept only one revision and legacy missing revision works',async()=>{
 const user=await fixture();await User.collection.updateOne({_id:user._id},{$unset:{accountRevision:''}});
 const results=await Promise.allSettled(['A','B'].map(displayName=>updateAccount(user._id,{expectedRevision:0,displayName})));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'ACCOUNT_REVISION_CONFLICT');
});
test('own-account API requires auth and CSRF, cannot update another user, and exposes no token',async()=>{
 const app=express();app.use(express.json(),cookieParser());app.use('/api/users',require('../dist/routes/users').default);
 const own=await fixture(),other=await fixture();const session=await Session.create({userId:own._id,tokenFamily:crypto.randomUUID(),refreshTokenHash:crypto.randomUUID(),expiresAt:new Date(Date.now()+60000)});
 const token=signAccessToken({sessionId:session._id}),cookie='accessToken='+token+'; csrfToken=test-csrf';
 assert.equal((await request(app).patch('/api/users/me').send({expectedRevision:0,displayName:'Blocked'})).status,401);
 assert.equal((await request(app).patch('/api/users/me').set('Cookie',cookie).send({expectedRevision:0,displayName:'Blocked'})).status,403);
 const put=body=>request(app).patch('/api/users/me').set('Cookie',cookie).set('x-csrf-token','test-csrf').send(body);
 assert.equal((await put({expectedRevision:0,userId:String(other._id),displayName:'Blocked'})).status,400);
 const result=await put({expectedRevision:0,displayName:'Saved'});assert.equal(result.status,200);assert.equal(result.body.data.accountRevision,1);
 assert.equal((await User.findById(other._id)).displayName,'Fixture');
 const me=await request(app).get('/api/users/me').set('Cookie',cookie);assert.equal(me.status,200);assert.equal(me.body.data.displayName,'Saved');assert.equal(me.body.data.plan,'FREE');assert.ok(!JSON.stringify(me.body).includes(token));
 await Session.updateOne({_id:session._id},{$set:{revokedAt:new Date()}});assert.equal((await put({expectedRevision:1,displayName:'Blocked'})).status,401);
});

const {test,before,after}=require('node:test');
const assert=require('node:assert/strict'), mongoose=require('mongoose'), crypto=require('node:crypto');
const {MongoMemoryReplSet}=require('mongodb-memory-server');
const express=require('express'), request=require('supertest'), {createServer}=require('node:http');
const {io}=require('socket.io-client');
process.env.JWT_SECRET='fixture-jwt-secret';process.env.OTP_SECRET='fixture-otp-secret';
const {User}=require('../dist/models/User'),{Session}=require('../dist/models/Session');
const {Workspace}=require('../dist/models/Workspace'),{Project}=require('../dist/models/Project');
const {OtpChallenge}=require('../dist/models/OtpChallenge'),{Wallet}=require('../dist/models/Credits');
const {FreeIpWindow,FreeIpDenial}=require('../dist/models/FreeIpPolicy');
const {admitVerifiedAccount,normalizeIp,requestIp,freeIpMonth}=require('../dist/services/FreeIpPolicy');
const {googleLogin,verifyOtp}=require('../dist/controllers/AuthController');
const {CreditService}=require('../dist/services/CreditService');
const {AdminAccount}=require('../dist/models/AdminAccount'),{AdminRole}=require('../dist/models/AdminRole'),{AdminSession}=require('../dist/models/AdminSession');
const {signAccessToken}=require('../dist/utils/jwt'),{hmacToken}=require('../dist/utils/crypto');
const {attachBillingRealtime}=require('../dist/services/BillingRealtime');
let replica,app,server,sockets,origin,adminCookie,noPermissionCookie,grantCalls=0;
const realFetch=global.fetch, realGrant=CreditService.grantFreeCredits;
const login=(email,ip,token=email)=>request(app).post('/google').set('X-Forwarded-For',ip).send({credential:token});
before(async()=>{
  replica=await MongoMemoryReplSet.create({replSet:{count:1}});await mongoose.connect(replica.getUri());
  await Promise.all([User,Session,Workspace,Project,OtpChallenge,Wallet,FreeIpWindow,FreeIpDenial,AdminAccount,AdminRole,AdminSession].map(model=>model.init()));
  // Only the external Google proof and unrelated credit grant are test doubles.
  global.fetch=async(url,options)=>url==='https://www.googleapis.com/oauth2/v3/userinfo' ? {ok:options.headers.Authorization!=='Bearer invalid',json:async()=>{
    const email=options.headers.Authorization.slice(7);return {email,email_verified:true,sub:'google:'+email,name:email};
  }} : realFetch(url,options);
  CreditService.grantFreeCredits=async()=>{grantCalls++;};
  app=express();app.set('trust proxy','loopback');app.use(express.json());app.use(require('cookie-parser')());
  app.post('/google',googleLogin);app.post('/otp',verifyOtp);app.use('/admin/users',require('../dist/routes/adminUsers').default);
  server=createServer(app);sockets=attachBillingRealtime(server,['http://admin.test']);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
  async function cookie(name,permissions){const role=await AdminRole.create({name,permissions});const admin=await AdminAccount.create({email:name+'@example.invalid',displayName:name,passwordHash:'fixture',roleId:role._id});const session=await AdminSession.create({adminId:admin._id,tokenFamily:crypto.randomUUID(),refreshTokenHash:crypto.randomUUID(),expiresAt:new Date(Date.now()+3600000)});return 'adminAccessToken='+signAccessToken({sessionId:session._id});}
  adminCookie=await cookie('SUPPORT',['users.read']);noPermissionCookie=await cookie('OPERATIONS',['jobs.read']);
});
after(async()=>{global.fetch=realFetch;CreditService.grantFreeCredits=realGrant;await new Promise(resolve=>sockets.close(resolve));await mongoose.disconnect();await replica?.stop();});

test('three unique Free accounts, repeat login, fourth denied before session/cookies/credit; flag does not ban members',async()=>{
  const ip='203.0.113.10';
  for(let i=1;i<=3;i++){const response=await login('member'+i+'@example.invalid',ip);assert.equal(response.status,200);assert.ok(response.headers['set-cookie'].some(value=>value.startsWith('accessToken=')));}
  assert.equal((await FreeIpWindow.findOne({ip})).accountIds.length,3);
  assert.equal((await login('member1@example.invalid',ip)).status,200);
  const fourth=await User.create({email:'fourth@example.invalid',googleId:'google:fourth@example.invalid',displayName:'Fourth'});
  await Wallet.create({userId:fourth._id,bucket:'PAID',available:900,reserved:0});
  const count=await Session.countDocuments(),grants=grantCalls;
  const denial=await login(fourth.email,ip);assert.equal(denial.status,403);assert.equal(denial.body.error.code,'FREE_IP_ACCOUNT_LIMIT');
  assert.equal(denial.headers['set-cookie'],undefined);assert.equal(await Session.countDocuments(),count);assert.equal(grantCalls,grants);
  assert.equal((await User.findById(fourth._id)).status,'ACTIVE');assert.equal((await Wallet.findOne({userId:fourth._id})).available,900);
  assert.ok((await FreeIpWindow.findOne({ip})).suspicious);assert.equal((await FreeIpDenial.findOne({ip})).userId.toString(),fourth.id);
  assert.ok(!JSON.stringify(denial.body).includes('member1@example.invalid'));
  assert.equal((await login('member1@example.invalid',ip)).status,200);assert.equal((await FreeIpWindow.findOne({ip})).accountIds.length,3);
  assert.equal(await Session.countDocuments({revokedAt:{$ne:null}}),0);
  const newUser=await login('registration-blocked@example.invalid',ip);assert.equal(newUser.status,403);
  assert.equal(await User.countDocuments({email:'registration-blocked@example.invalid'}),0);
});

test('concurrent registrations and repeated logins cannot exceed three memberships or create rejected accounts',async()=>{
  const ip='203.0.113.20';
  const responses=await Promise.all(Array.from({length:12},(_,i)=>login('race'+i+'@example.invalid',ip)));
  assert.equal(responses.filter(response=>response.status===200).length,3,JSON.stringify(responses.map(response=>[response.status,response.body.error])));
  assert.equal(responses.filter(response=>response.status===403).length,9);
  const window=await FreeIpWindow.findOne({ip});assert.equal(window.accountIds.length,3);assert.equal(new Set(window.accountIds.map(String)).size,3);
  const users=await User.find({email:/^race\d+@/});assert.equal(users.length,3);
  assert.equal(await Workspace.countDocuments({ownerId:{$in:users.map(user=>user._id)}}),3);
  const retries=await Promise.all(Array.from({length:6},()=>login(users[0].email,ip)));
  assert.ok(retries.every(response=>response.status===200));assert.equal((await FreeIpWindow.findOne({ip})).accountIds.length,3);
});

test('paid accounts bypass full Free network, and monthly reset preserves previous history',async()=>{
  const paid=await User.create({email:'paid@example.invalid',displayName:'Paid',googleId:'google:paid@example.invalid',plan:'PRO'});
  assert.equal((await login(paid.email,'203.0.113.10')).status,200);
  assert.equal((await FreeIpWindow.findOne({ip:'203.0.113.10'})).accountIds.length,3);
  assert.equal((await login(paid.email,'203.0.113.50')).status,200);assert.equal(await FreeIpWindow.countDocuments({ip:'203.0.113.50'}),0);
  assert.equal((await admitVerifiedAccount({body:{},socket:{}},{email:paid.email,googleId:paid.googleId,attempt:'paid-without-ip'})).id,paid.id);
  const {BillingOrder}=require('../dist/models/BillingOrder');await BillingOrder.init();
  const billed=await User.create({email:'billing-paid@example.invalid',displayName:'Purchased',googleId:'google:billing-paid@example.invalid',plan:'PRO'});
  const expired=await BillingOrder.create({ownerId:billed._id,requestKey:'expired',tier:'PRO',billingCycle:'monthly',amount:1,planSnapshot:{},status:'PAID',expiresAt:new Date(0),startsAt:new Date(0),endsAt:new Date(1000),mode:'sandbox'});
  billed.billingOrderId=expired._id;await billed.save();
  await BillingOrder.create({ownerId:billed._id,requestKey:'active',tier:'PLUS',billingCycle:'monthly',amount:1,planSnapshot:{},status:'PAID',expiresAt:new Date(0),startsAt:new Date(Date.now()-1000),endsAt:new Date(Date.now()+60000),mode:'sandbox'});
  assert.equal((await login(billed.email,'203.0.113.10')).status,200,'Another valid paid subscription exempts the account');
  const req={ip:'203.0.113.30',socket:{},body:{}};
  for(let i=0;i<3;i++)await admitVerifiedAccount(req,{email:`month${i}@example.invalid`,attempt:String(i)},new Date('2026-12-31T23:59:59Z'));
  await assert.rejects(admitVerifiedAccount(req,{email:'new-month@example.invalid',attempt:'december'},new Date('2026-12-31T23:59:59Z')),error=>error.code==='FREE_IP_ACCOUNT_LIMIT');
  await admitVerifiedAccount(req,{email:'new-month@example.invalid',attempt:'january'},new Date('2027-01-01T00:00:00Z'));
  assert.equal((await FreeIpWindow.findOne({ip:req.ip,month:'2027-01'})).accountIds.length,1);
  assert.equal(await FreeIpDenial.countDocuments({ip:req.ip,month:'2026-12'}),1);
});

test('the same newly verified identity logging in from concurrent IPs creates one account',async()=>{
  const responses=await Promise.all(Array.from({length:5},(_,i)=>login('same-identity@example.invalid',`203.0.113.${60+i}`)));
  assert.ok(responses.every(response=>response.status===200),JSON.stringify(responses.map(response=>response.body)));
  assert.equal(await User.countDocuments({email:'same-identity@example.invalid'}),1);
});

test('verified OTP applies the same policy; incorrect credentials do not flag or count accounts',async()=>{
  const user=await User.create({email:'otp-fourth@example.invalid',displayName:'OTP fourth'}),id=new mongoose.Types.ObjectId();
  await OtpChallenge.create({_id:id,email:user.email,purpose:'LOGIN',codeHash:hmacToken(`${id}:LOGIN:123456`,process.env.OTP_SECRET),expiresAt:new Date(Date.now()+60000)});
  const before=await Session.countDocuments();
  const response=await request(app).post('/otp').set('X-Forwarded-For','203.0.113.10').send({challengeId:String(id),code:'123456',purpose:'LOGIN'});
  assert.equal(response.status,403);assert.equal(response.headers['set-cookie'],undefined);assert.equal(await Session.countDocuments(),before);
  assert.equal((await login('invalid','203.0.113.99','invalid')).status,400);assert.equal(await FreeIpWindow.countDocuments({ip:'203.0.113.99'}),0);
});

test('trusted proxy resolution ignores spoofed headers when untrusted, and normalizes mapped/expanded IPs',async()=>{
  assert.equal(normalizeIp('::ffff:203.0.113.10'),'203.0.113.10');assert.equal(normalizeIp('2001:0db8:0000:0000:0000:0000:0000:0001'),'2001:db8::1');
  assert.equal(normalizeIp('1.2.3.4, 5.6.7.8'),null);assert.equal(normalizeIp('not-an-ip'),null);
  const probe=express();probe.set('trust proxy',false);probe.get('/',(req,res)=>res.json({ip:requestIp(req)}));
  const ignored=await request(probe).get('/').set('X-Forwarded-For','203.0.113.99');assert.equal(ignored.body.ip,'127.0.0.1');
  probe.set('trust proxy','loopback');const trusted=await request(probe).get('/').set('X-Forwarded-For','203.0.113.99');assert.equal(trusted.body.ip,'203.0.113.99');
  assert.equal(freeIpMonth(new Date('2027-01-01T00:00:00Z')),'2027-01');
});

test('authorized admin receives one durable event for concurrent retries, IP lookup/history paginate and permissions hold',async()=>{
  const socket=io(origin+'/admin-security',{transports:['websocket'],extraHeaders:{Origin:'http://admin.test',Cookie:adminCookie},reconnection:false});
  const deniedSocket=io(origin+'/admin-security',{transports:['websocket'],extraHeaders:{Origin:'http://admin.test',Cookie:noPermissionCookie},reconnection:false});
  try {
    await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});
    const rejected=await new Promise(resolve=>deniedSocket.once('connect_error',resolve));assert.ok(rejected);
    const events=[];socket.on('security:free-ip',event=>events.push(event));
    const ip='203.0.113.40';for(let i=0;i<3;i++)await login(`notice${i}@example.invalid`,ip);
    const retries=await Promise.all(Array.from({length:5},()=>login('notice-fourth@example.invalid',ip)));
    assert.ok(retries.every(response=>response.status===403));
    await new Promise(resolve=>setTimeout(resolve,100));assert.equal(await FreeIpDenial.countDocuments({ip}),1);assert.equal(events.filter(event=>event.ip===ip).length,1);
    const event=events.find(event=>event.ip===ip);assert.ok(event.eventId);assert.equal(event.reason,'FREE_IP_ACCOUNT_LIMIT');
    const path='/admin/users/ip-history?ip='+ip;
    assert.equal((await request(app).get(path)).status,401);assert.equal((await request(app).get(path).set('Cookie',noPermissionCookie)).status,403);
    for(let i=0;i<11;i++)await login(`notice-extra${i}@example.invalid`,ip);
    const history=await request(app).get(path).set('Cookie',adminCookie);assert.equal(history.status,200);assert.equal(history.body.data.limit,10);assert.equal(history.body.data.items.length,10);assert.equal(history.body.data.total,12);assert.equal(history.body.data.linkedAccounts.length,3);assert.ok(history.body.data.suspicious);
    const next=await request(app).get(path+'&page=2').set('Cookie',adminCookie);assert.equal(next.body.data.items.length,2);
    const users=await request(app).get('/admin/users?search='+ip).set('Cookie',adminCookie);assert.equal(users.body.data.total,3);
    assert.equal((await request(app).get('/admin/users/ip-history?ip=bad').set('Cookie',adminCookie)).status,400);
    socket.disconnect();socket.connect();await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});
    const catchup=await request(app).get(path).set('Cookie',adminCookie);assert.equal(catchup.body.data.total,12);
    // HTTP history survives reconnect; the server does not re-emit old events.
  } finally {socket.disconnect();deniedSocket.disconnect();}
});

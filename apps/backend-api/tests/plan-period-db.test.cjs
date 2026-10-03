const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),mongoose=require('mongoose'),crypto=require('crypto');
const {MongoMemoryReplSet}=require('mongodb-memory-server');
const {User}=require('../dist/models/User'),{AdminAuditLog}=require('../dist/models/AdminAuditLog');
const {updateUserPlan,getUserDetails}=require('../dist/controllers/AdminUserController');
const {getMe}=require('../dist/controllers/UsersController');
let replica;
before(async()=>{replica=await MongoMemoryReplSet.create({replSet:{count:1}});await mongoose.connect(replica.getUri());await Promise.all([User.init(),AdminAuditLog.init()]);});
after(async()=>{await mongoose.disconnect();await replica?.stop();});
const response=()=>({statusCode:200,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}});
const fixture=()=>User.create({email:crypto.randomUUID()+'@example.invalid',displayName:'Period fixture',plan:'PRO'});
const update=async(user,body)=>{const res=response();await updateUserPlan({params:{id:String(user._id)},admin:{_id:new mongoose.Types.ObjectId()},body},res);return res;};
test('admin-set annual dates are stored and returned by GET me with immutable audit',async()=>{
 const user=await fixture(),result=await update(user,{tier:'PRO',planPeriod:{billingCycle:'YEARLY',startsAt:'2026-10-01'}});assert.equal(result.statusCode,200);
 const saved=await User.findById(user._id);assert.equal(saved.planPeriod.billingCycle,'YEARLY');assert.equal(saved.planPeriod.endsAt.toISOString(),'2027-09-30T17:00:00.000Z');
 const me=response();await getMe({user:saved},me);assert.equal(me.body.data.subscriptionPeriod.totalMonths,12);assert.equal(me.body.data.subscriptionPeriod.billingCycle,'YEARLY');
 const audit=await AdminAuditLog.findOne({resourceId:String(user._id),action:'USER_PLAN_UPDATED'});assert.equal(audit.changes.after.planPeriod.billingCycle,'YEARLY');
});
test('legacy manual plan has no fake subscription; changing tier clears old dates',async()=>{
 const user=await fixture();const details=response();await getUserDetails({params:{id:String(user._id)}},details);assert.deepEqual(details.body.data.subscriptions,[]);
 await update(user,{tier:'PRO',planPeriod:{billingCycle:'MONTHLY',startsAt:'2026-10-01'}});
 await update(user,{tier:'PRO'});assert.ok((await User.findById(user._id)).planPeriod);
 await update(user,{tier:'PLUS'});assert.equal((await User.findById(user._id)).planPeriod,undefined);
});
test('invalid period does not change tier or write an audit',async()=>{
 const user=await fixture(),result=await update(user,{tier:'PLUS',planPeriod:{billingCycle:'YEARLY',startsAt:'2026-02-30'}});
 assert.equal(result.statusCode,400);assert.equal(result.body.error.code,'PLAN_PERIOD_INVALID');assert.equal((await User.findById(user._id)).plan,'PRO');assert.equal(await AdminAuditLog.countDocuments({resourceId:String(user._id)}),0);
});

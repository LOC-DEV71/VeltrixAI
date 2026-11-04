const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const mongoose=require('mongoose');
const {MongoMemoryReplSet}=require('mongodb-memory-server');
const {Plan,PlanRevision}=require('../dist/models/Plan');
const {seedConfig}=require('../dist/services/PlanService');
const {readSupportPlans}=require('../dist/services/SupportPlans');
let mongo,plus;
function parse(result){assert.equal(result.status,'ready');return JSON.parse(result.context.split(' JSON:\n')[1]);}
async function publish(tier,revision,config,head){
  head ||= await Plan.create({tier,slug:tier.toLowerCase(),revision});
  await PlanRevision.create({planId:head._id,tier,revision,config,changedAt:new Date(),reason:'PRIVATE_ADMIN_REASON',changedBy:new mongoose.Types.ObjectId()});
  await Plan.updateOne({_id:head._id},{$set:{revision}});
  return head;
}
before(async()=>{
  mongo=await MongoMemoryReplSet.create({replSet:{count:1}});await mongoose.connect(mongo.getUri());
  const config=seedConfig('PLUS');config.clone.enabled=false;config.clone.maxVoices=null;config.pricing.monthlyPrice=123456;
  plus=await publish('PLUS',1,config);
  await publish('PRO',1,seedConfig('PRO'));
  const inactive=seedConfig('FREE');inactive.overview.active=false;await publish('FREE',1,inactive);
  const archived=await publish('BASIC_STUDENT',1,seedConfig('BASIC_STUDENT'));await Plan.updateOne({_id:archived._id},{$set:{archived:true}});
});
after(async()=>{await mongoose.disconnect();await mongo?.stop();});
test('Support reads published active heads, exact clone flags and prices without admin metadata',async()=>{
  const result=await readSupportPlans('Plus hay Pro được clone giọng?');const rows=parse(result);
  assert.deepEqual(rows.map(row=>row.tier),['PLUS','PRO']);
  assert.equal(rows[0].features.clone,false);assert.equal(rows[0].clone.maxVoices,null);assert.equal(rows[0].pricing.monthlyPrice,123456);
  assert.equal(rows[1].features.clone,true);assert.ok(!result.context.includes('PRIVATE_ADMIN_REASON'));assert.ok(!result.context.includes('changedBy'));
});
test('new published revision is visible on next question; unpublished future revision is ignored',async()=>{
  const config=seedConfig('PLUS');config.clone.maxVoices=7;config.pricing.monthlyPrice=234567;
  await PlanRevision.create({planId:plus._id,tier:'PLUS',revision:2,config,changedAt:new Date(),reason:'unpublished'});
  assert.equal(parse(await readSupportPlans('clone Plus')).find(row=>row.tier==='PLUS').revision,1);
  await Plan.updateOne({_id:plus._id},{$set:{revision:2}});
  const row=parse(await readSupportPlans('clone Plus')).find(row=>row.tier==='PLUS');
  assert.equal(row.revision,2);assert.equal(row.clone.maxVoices,7);assert.equal(row.features.clone,true);assert.equal(row.pricing.monthlyPrice,234567);
});
test('broad quota questions keep complete catalog JSON within context budget',async()=>{
  const result=await readSupportPlans('mọi gói clone tts content studio prompt video credit giá tháng năm đồng thời rate phút hàng đợi workspace lưu trữ');
  assert.equal(parse(result).length,2);assert.ok(result.context.length<6000);
});
test('unrelated questions do not query plans; unavailable DB does not invent seed entitlements',async()=>{
  assert.equal((await readSupportPlans('Bạn tên gì?')).status,'not-requested');
  await mongoose.disconnect();const result=await readSupportPlans('Plus hay Pro được clone?');
  assert.equal(result.status,'unavailable');assert.ok(!result.context.includes('monthlyPrice'));await mongoose.connect(mongo.getUri());
});

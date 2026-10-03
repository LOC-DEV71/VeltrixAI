const {test,afterEach,mock}=require('node:test');
const assert=require('node:assert/strict');
const {validatePlan,planDiff}=require('../dist/services/PlanSchema');
const {seedConfig}=require('../dist/services/PlanService');
const {User}=require('../dist/models/User');
const {currentPlanUserCounts}=require('../dist/services/PlanPopularity');
afterEach(()=>mock.restoreAll());
test('popular badge defaults off for old configurations without changing input',()=>{
  const config=seedConfig('PLUS');delete config.overview.popular;
  const normalized=validatePlan(config,'PLUS');assert.equal(normalized.overview.popular,false);
  assert.equal(config.overview.popular,undefined);
});
test('popular tag is validated and appears in revision diff',()=>{
  const before=seedConfig('PLUS'),after=structuredClone(before);after.overview.popular=true;
  assert.equal(validatePlan(after,'PLUS').overview.popular,true);
  const diff=planDiff(before,after);assert.deepEqual(diff,[{path:'overview.popular',before:false,after:true,restrictive:false}]);
  after.overview.popular='true';assert.throws(()=>validatePlan(after,'PLUS'),e=>e.code==='PLAN_INVALID');
});
test('popularity counts actual active users without querying identities or photos',async()=>{
  mock.method(User,'aggregate',async pipeline=>{
    assert.deepEqual(pipeline,[{$match:{status:'ACTIVE'}},{$group:{_id:'$plan',count:{$sum:1}}}]);
    return [{_id:'FREE',count:3},{_id:'PLUS',count:2}];
  });
  const counts=await currentPlanUserCounts();assert.equal(counts.get('PLUS'),2);assert.equal(counts.get('FREE'),3);assert.equal(counts.get('PRO'),undefined);
});

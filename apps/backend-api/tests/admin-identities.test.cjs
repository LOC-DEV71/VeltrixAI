const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const mongoose=require('mongoose');
const {MongoMemoryServer}=require('mongodb-memory-server');
const {User}=require('../dist/models/User');
const {Wallet,CreditLedger}=require('../dist/models/Credits');
const {creditHistory}=require('../dist/services/BillingHistory');
const {withOwnerIdentities}=require('../dist/services/AdminIdentities');
const {getUsers}=require('../dist/controllers/AdminUserController');
let mongo,target;
before(async()=>{
  mongo=await MongoMemoryServer.create();await mongoose.connect(mongo.getUri());
  await Promise.all([User.init(),Wallet.init(),CreditLedger.init()]);
  target=await User.create({email:'owner.with.dot@example.invalid',displayName:'Account A',plan:'PRO'});
  await User.create({email:'other@example.invalid',displayName:'Account B'});
});
after(async()=>{await mongoose.disconnect();await mongo?.stop();});
async function search(value){
  let result,status=200;
  await getUsers({query:{search:value,page:1}},{status(code){status=code;return this;},json(data){result=data;return this;}});
  return {status,result};
}
test('admin search resolves exact account ID and literal name/email without regex broadening',async()=>{
  const found=await search(String(target._id));assert.equal(found.status,200);
  assert.equal(found.result.data.total,1);assert.equal(String(found.result.data.users[0]._id),String(target._id));
  assert.equal((await search('Account A')).result.data.total,1);
  assert.equal((await search('owner.with.dot')).result.data.total,1);
  assert.equal((await search('.*')).result.data.total,0);
  assert.equal((await search({$gt:''})).status,400);
});
test('ten jobs resolve identities in one bounded query and retain deleted-owner IDs',async()=>{
  const missing=new mongoose.Types.ObjectId();
  const rows=Array.from({length:9},(_,i)=>({_id:String(i),ownerId:target._id,status:'FAILED'}));
  rows.push({_id:'deleted',ownerId:missing,status:'FAILED'});
  const original=User.find;let calls=0;
  User.find=function(...args){calls++;return original.apply(this,args);};
  try{
    const result=await withOwnerIdentities(rows);assert.equal(calls,1);assert.equal(result.length,10);
    assert.equal(result[0].owner.displayName,target.displayName);assert.equal(result[0].owner.email,target.email);
    assert.deepEqual(Object.keys(result[0].owner).sort(),['_id','displayName','email']);
    assert.equal(result[9].owner,null);assert.equal(String(result[9].ownerId),String(missing));
    assert.equal(rows[0].owner,undefined);
  }finally{User.find=original;}
});
test('credit history includes account identity without changing ledger balances or pagination',async()=>{
  const wallet=await Wallet.create({userId:target._id,bucket:'PAID',available:100,reserved:0});
  await CreditLedger.create({walletId:wallet._id,transactionType:'GRANT',deltaAvailable:100,deltaReserved:0,referenceId:'test-identity-grant'});
  const result=await creditHistory({ownerId:String(target._id),page:1,limit:10});
  assert.equal(result.total,1);assert.equal(result.limit,10);
  assert.equal(result.items[0].owner.email,target.email);
  assert.equal(result.items[0].deltaAvailable,100);
  assert.equal((await Wallet.findById(wallet._id)).available,100);
  assert.equal(await CreditLedger.countDocuments(),1);
});

import mongoose from 'mongoose';
import {BillingOrder} from '../models/BillingOrder';
import {CreditLedger} from '../models/Credits';
import {BillingError} from './BillingService';
import {User} from '../models/User';
export function historyFilter(query:any,ownerId?:unknown){
 const page=Number(query.page||1),limit=Number(query.limit||10);if(!Number.isSafeInteger(page)||page<1||page>10000||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new BillingError('BILLING_INVALID_INPUT');
 const filter:any=ownerId?{ownerId}:{};
 for(const [key,allowed] of [['status',['PENDING','PAID','FAILED']],['mode',['sandbox','production']]] as const){if(query[key]){if(!allowed.includes(query[key] as never))throw new BillingError('BILLING_INVALID_INPUT');filter[key]=query[key];}}
 if(query.ownerId){if(ownerId||!mongoose.isObjectIdOrHexString(query.ownerId))throw new BillingError('BILLING_INVALID_INPUT');filter.ownerId=new mongoose.Types.ObjectId(query.ownerId);}
 if(query.orderId){if(!mongoose.isObjectIdOrHexString(query.orderId))throw new BillingError('BILLING_INVALID_INPUT');filter._id=new mongoose.Types.ObjectId(query.orderId);}
 if(query.from||query.to){filter.createdAt={};for(const key of ['from','to'])if(query[key]){if(typeof query[key]!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(query[key]))throw new BillingError('BILLING_INVALID_INPUT');const d=new Date(query[key]+(key==='from'?'T00:00:00+07:00':'T23:59:59.999+07:00'));if(!Number.isFinite(+d)||new Date(+d+7*3600000).toISOString().slice(0,10)!==query[key])throw new BillingError('BILLING_INVALID_INPUT');filter.createdAt[key==='from'?'$gte':'$lte']=d;}if(filter.createdAt.$gte>filter.createdAt.$lte)throw new BillingError('BILLING_INVALID_INPUT');}
 return {filter,page,limit:Math.min(limit,10)};
}
export async function orderHistory(query:any,ownerId?:unknown){
 const {filter,page,limit}=historyFilter(query,ownerId);
 const [items,total]=await Promise.all([BillingOrder.find(filter).select('_id ownerId tier billingCycle amount status createdAt paidAt expiresAt mode providerTransactionId startsAt endsAt planSnapshot.config.overview.name').sort({createdAt:-1,_id:-1}).skip((page-1)*limit).limit(limit).lean(),BillingOrder.countDocuments(filter)]);
 const users=ownerId?[]:await User.find({_id:{$in:items.map((o:any)=>o.ownerId)}}).select('_id displayName email').lean();
 return {items:items.map((o:any)=>({_id:o._id,ownerId:ownerId?undefined:o.ownerId,owner:users.find(u=>String(u._id)===String(o.ownerId)),tier:o.tier,planName:o.planSnapshot?.config?.overview?.name||o.tier,billingCycle:o.billingCycle,amount:o.amount,currency:'VND',status:o.status,createdAt:o.createdAt,paidAt:o.paidAt,expiresAt:o.expiresAt,startsAt:o.startsAt,endsAt:o.endsAt,mode:o.mode,provider:'VNPAY',providerTransactionId:o.providerTransactionId})),total,page,limit};
}
export async function cashSummary(query:any){
 const {filter}=historyFilter(query);const rows=await BillingOrder.aggregate([{$match:filter},{$group:{_id:{mode:'$mode',status:'$status'},orders:{$sum:1},amount:{$sum:'$amount'}}}]);
 return {rows:rows.map(r=>({mode:r._id.mode,status:r._id.status,orders:r.orders,amount:r.amount})),currency:'VND',basis:'ORDER_CREATED_AT',settlementAvailable:false};
}
export async function creditHistory(query:any){
 const {page,limit,filter:dates}=historyFilter({page:query.page,limit:query.limit,from:query.from,to:query.to});const filter:any=dates;
 if(query.type){if(!['GRANT','RESERVE','SETTLE','RELEASE','EXPIRE'].includes(query.type))throw new BillingError('BILLING_INVALID_INPUT');filter.transactionType=query.type;}
 const stages:any[]=[{$match:filter},{$lookup:{from:'wallets',localField:'walletId',foreignField:'_id',as:'wallet'}},{$unwind:'$wallet'}];
 if(query.ownerId){if(!mongoose.isObjectIdOrHexString(query.ownerId))throw new BillingError('BILLING_INVALID_INPUT');stages.push({$match:{'wallet.userId':new mongoose.Types.ObjectId(query.ownerId)}});}
 const [result]=await CreditLedger.aggregate([...stages,{$sort:{createdAt:-1,_id:-1}},{$facet:{items:[{$skip:(page-1)*limit},{$limit:limit},{$project:{_id:1,createdAt:1,transactionType:1,deltaAvailable:1,deltaReserved:1,referenceId:1,ownerId:'$wallet.userId',bucket:'$wallet.bucket'}}],count:[{$count:'total'}]}}]);return {items:result.items,total:result.count[0]?.total||0,page,limit};
}

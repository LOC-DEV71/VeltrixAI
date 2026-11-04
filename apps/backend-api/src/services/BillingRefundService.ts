import mongoose from 'mongoose';
import {createHash,randomUUID} from 'node:crypto';
import {BillingOrder} from '../models/BillingOrder';
import {BillingRefund,BillingRefundQuote,RefundReceipt,RefundRate,RefundAudit,RefundMaintenanceLease} from '../models/BillingRefund';
import {PaymentReceipt,CashMovement,providerPaymentDate} from '../models/Finance';
import {CreditLot,CreditLedger,CreditReservation,Wallet} from '../models/Credits';
import {User} from '../models/User';
import {Notification} from '../models/Notification';
import {publishBillingOrder} from './BillingRealtime';
import {callRefundGateway,refundGateway} from './VNPayRefundProvider';

export class RefundError extends Error {constructor(public code:string,public status=409){super(code);}}
let indexes:Promise<unknown>|undefined;
async function ready(){return indexes ||= Promise.all([BillingRefund,RefundRate,BillingRefundQuote,RefundReceipt,RefundAudit,RefundMaintenanceLease,Notification].map(model=>model.createIndexes())).catch(error=>{indexes=undefined;throw error;});}
export async function refundRate(ownerId:unknown,ip:string,action:string){
 await ready();const now=Date.now();
 for(const [principal,window,max] of [[`user:${ownerId}`,action==='check'?10000:60000,action==='check'?1:6],[`ip:${ip}`,60000,30],[`global`,60000,action==='check'?60:120]] as const){
  const key=createHash('sha256').update(action+':'+principal+':'+Math.floor(now/window)).digest('hex');
  try{const row=await RefundRate.findOneAndUpdate({key,count:{$lt:max}},{$inc:{count:1},$setOnInsert:{expiresAt:new Date(now+window*2)}},{upsert:true,new:true});if(!row)throw new RefundError('REFUND_RATE_LIMITED',429);}
  catch(error:any){if(error.code!==11000)throw error;const retry=await RefundRate.findOneAndUpdate({key,count:{$lt:max}},{$inc:{count:1}},{new:true});if(!retry)throw new RefundError('REFUND_RATE_LIMITED',429);}
 }
}
const id=(value:string)=>{if(typeof value!=='string'||!mongoose.isObjectIdOrHexString(value))throw new RefundError('REFUND_NOT_FOUND',404);return new mongoose.Types.ObjectId(value);};
const publicRefund=(row:any)=>row?{id:String(row._id),orderId:String(row.orderId),amount:row.amount,currency:'VND',mode:row.mode,status:row.status,spentCredits:row.spentCredits,createdAt:row.createdAt,updatedAt:row.updatedAt,completedAt:row.completedAt}:null;
async function ownedOrder(ownerId:unknown,orderId:string,session?:mongoose.ClientSession){const order=await BillingOrder.findOne({_id:id(orderId),ownerId}).maxTimeMS(2000).session(session||null);if(!order)throw new RefundError('REFUND_NOT_FOUND',404);return order;}

// Derive actual consumption from settled reservations AND their ledger, not raw
// reservation allocations (which include unused credits refunded at settlement).
export async function renewalEvidence(ownerId:unknown,orderId:string,session?:mongoose.ClientSession){
 const order=await ownedOrder(ownerId,orderId,session), now=new Date();
 if(order.refundLockedAt)throw new RefundError('REFUND_ALREADY_REQUESTED');
 if(order.purpose!=='RENEWAL'||!order.renewalOfOrderId)throw new RefundError('REFUND_NOT_RENEWAL');
 if(order.status!=='PAID'||!order.paidAt||order.paidAt>now||+now-+order.paidAt>86400000)throw new RefundError('REFUND_OUTSIDE_WINDOW');
 if(!Number.isSafeInteger(order.amount)||order.amount<=0||!/^\d{1,30}$/.test(order.providerTransactionId||''))throw new RefundError('REFUND_EVIDENCE_INCOMPLETE');
 const prior=await BillingOrder.findOne({_id:order.renewalOfOrderId,ownerId,tier:order.tier,status:'PAID',paidAt:{$lte:order.createdAt}}).session(session||null);
 const receipt=await PaymentReceipt.findOne({orderId:order._id,ownerId}).session(session||null);
 const cash=await CashMovement.findOne({orderId:order._id,ownerId}).session(session||null);
 const wallets=await Wallet.find({userId:ownerId}).session(session||null);
 if(!prior || String(prior._id)===String(order._id) || !receipt || !cash || receipt.outcome!=='SUCCESS' || receipt.responseCode!=='00' || receipt.transactionStatus!=='00' || receipt.providerTransactionId!==order.providerTransactionId || cash.kind!=='PAYMENT_RECEIVED' || String(cash.paymentId)!==String(receipt._id) || [receipt,cash].some(row=>row.amount!==order.amount||row.mode!==order.mode||row.currency!=='VND') || +receipt.confirmedAt!==+order.paidAt || +cash.occurredAt!==+order.paidAt || !receipt.providerPaidAt || receipt.providerPaidAt>now || +now-+receipt.providerPaidAt>86400000)throw new RefundError('REFUND_EVIDENCE_INCOMPLETE');
 const lots=await CreditLot.find({billingOrderId:order._id}).session(session||null);
 const grant=await CreditLedger.findOne({transactionType:'GRANT',referenceId:`billing_${order._id}_0`}).session(session||null);
 const expected=order.planSnapshot.config.credits.monthlyGrant;
 if(!grant||grant.deltaAvailable!==expected||grant.deltaReserved!==0||!wallets.some(w=>String(w._id)===String(grant.walletId))||lots.reduce((n,lot)=>n+lot.amount,0)!==expected||lots.some(lot=>String(lot.walletId)!==String(grant.walletId)||lot.refundBlocked||!Number.isSafeInteger(lot.available)||lot.available<0||lot.available>lot.amount))throw new RefundError('REFUND_EVIDENCE_INCOMPLETE');
 const lotIds=lots.map(lot=>lot._id),lotSet=new Set(lotIds.map(String));
 const reservations=await CreditReservation.find({'allocations.lotId':{$in:lotIds}}).limit(1001).maxTimeMS(2000).session(session||null);
 if(reservations.length>1000)throw new RefundError('REFUND_EVIDENCE_INCOMPLETE');
 const allLedger=await CreditLedger.find({referenceId:{$in:reservations.flatMap(row=>[`settle_${row.jobId}`,`reserve_${row.jobId}`])},transactionType:{$in:['SETTLE','RESERVE']}}).limit(4001).maxTimeMS(2000).session(session||null);
 if(allLedger.length>4000)throw new RefundError('REFUND_EVIDENCE_INCOMPLETE');
 let spent=0;const usedByLot=new Map<string,number>();
 for(const reservation of reservations){
  if(reservation.status==='HELD')throw new RefundError('REFUND_JOBS_PENDING');
  if(reservation.status!=='SETTLED')continue;
  const ledger=allLedger.filter(row=>row.referenceId===`settle_${reservation.jobId}`&&row.transactionType==='SETTLE');
  const walletIds=[...new Set(reservation.allocations.map(a=>String(a.walletId)))];
  if(ledger.length!==walletIds.length)throw new RefundError('REFUND_EVIDENCE_INCOMPLETE');
  for(const wid of walletIds){
   const entry=ledger.find(row=>String(row.walletId)===wid),allocations=reservation.allocations.filter(a=>String(a.walletId)===wid);
   const total=allocations.reduce((n,a)=>n+a.amount,0);
   const held=allLedger.filter(row=>row.referenceId===`reserve_${reservation.jobId}`&&row.transactionType==='RESERVE'&&String(row.walletId)===wid);
   if(!wallets.some(w=>String(w._id)===wid)||held.length!==1||held[0].deltaAvailable!==-total||held[0].deltaReserved!==total)throw new RefundError('REFUND_EVIDENCE_INCOMPLETE');
   if(!entry||!Number.isSafeInteger(entry.deltaAvailable)||!Number.isSafeInteger(entry.deltaReserved)||entry.deltaAvailable<0||entry.deltaReserved>0)throw new RefundError('REFUND_EVIDENCE_INCOMPLETE');
   let remaining=-entry.deltaReserved-entry.deltaAvailable;if(!Number.isSafeInteger(remaining)||remaining<0||remaining>total)throw new RefundError('REFUND_EVIDENCE_INCOMPLETE');
   for(const allocation of allocations){if(!Number.isSafeInteger(allocation.amount)||allocation.amount<=0)throw new RefundError('REFUND_EVIDENCE_INCOMPLETE');const consumed=Math.min(remaining,allocation.amount);remaining-=consumed;if(lotSet.has(String(allocation.lotId))){spent+=consumed;usedByLot.set(String(allocation.lotId),(usedByLot.get(String(allocation.lotId))||0)+consumed);}}
  }
 }
 if(lots.some(lot=>lot.expiresAt<=now || lot.amount-lot.available!==(usedByLot.get(String(lot._id))||0)))throw new RefundError('REFUND_EVIDENCE_INCOMPLETE');
 if(spent>1000)throw new RefundError('REFUND_CREDIT_LIMIT');
 return {order,lots,wallets,spent,receipt,cash,grant};
}
function paymentVerified(result:Awaited<ReturnType<typeof callRefundGateway>>,order:any){const paidAt=providerPaymentDate(result.payDate);return result.responseCode==='00'&&result.transactionType==='01'&&result.transactionStatus==='00'&&result.transactionNo===order.providerTransactionId&&!!paidAt&&paidAt<=new Date()&&Date.now()-+paidAt<=86400000;}
export async function checkRenewalRefund(ownerId:unknown,orderId:string,ip:string){
 await refundRate(ownerId,ip,'check');const evidence=await renewalEvidence(ownerId,orderId);refundGateway(evidence.order);
 const verified=await callRefundGateway(evidence.order,'querydr');if(!paymentVerified(verified,evidence.order)||providerPaymentDate(verified.payDate)?.getTime()!==evidence.receipt.providerPaidAt.getTime())throw new RefundError('REFUND_PAYMENT_NOT_VERIFIED');
 const quote=await BillingRefundQuote.create({ownerId,orderId:evidence.order._id,checkedAt:new Date(),expiresAt:new Date(Date.now()+120000)});
 return {quoteId:String(quote._id),orderId,amount:evidence.order.amount,currency:'VND',mode:evidence.order.mode,spentCredits:evidence.spent,expiresAt:quote.expiresAt};
}
export async function confirmRenewalRefund(ownerId:unknown,orderId:string,body:any,ip:string){
 await ready();id(orderId);
 if(!body||Object.keys(body).some(key=>!['quoteId','requestId','confirmed'].includes(key))||body.confirmed!==true||typeof body.requestId!=='string'||!/^[a-zA-Z0-9-]{16,64}$/.test(body.requestId)||!mongoose.isObjectIdOrHexString(body.quoteId))throw new RefundError('REFUND_INVALID_INPUT',400);
 await refundRate(ownerId,ip,'confirm');
 const existing=await BillingRefund.findOne({ownerId,orderId});if(existing)return publicRefund(existing);
  const quote=await BillingRefundQuote.findOne({_id:body.quoteId,ownerId,orderId,expiresAt:{$gt:new Date()}});if(!quote)throw new RefundError('REFUND_QUOTE_EXPIRED');
 const before=await renewalEvidence(ownerId,orderId);refundGateway(before.order);
 const verified=await callRefundGateway(before.order,'querydr');if(!paymentVerified(verified,before.order)||providerPaymentDate(verified.payDate)?.getTime()!==before.receipt.providerPaidAt.getTime())throw new RefundError('REFUND_PAYMENT_NOT_VERIFIED');
 const session=await mongoose.startSession();let prepared:any;
 try{await session.withTransaction(async()=>{
  const found=await BillingRefund.findOne({orderId:before.order._id}).session(session);if(found){if(String(found.ownerId)!==String(ownerId))throw new RefundError('REFUND_NOT_FOUND',404);prepared=found;return;}
  if(!await BillingRefundQuote.exists({_id:quote._id,ownerId,expiresAt:{$gt:new Date()}}).session(session))throw new RefundError('REFUND_QUOTE_EXPIRED');
  const evidence=await renewalEvidence(ownerId,orderId,session);
  const user=await User.findById(ownerId).session(session);if(!user||user.status!=='ACTIVE')throw new RefundError('REFUND_ACCOUNT_UNAVAILABLE',403);
  [prepared]=await BillingRefund.create([{quoteId:quote._id,confirmedAt:new Date(),policyVersion:'renewal-24h-1000-v1',confirmationIpHash:createHash('sha256').update(ip).digest('hex'),paymentReceiptId:evidence.receipt._id,cashMovementId:evidence.cash._id,grantLedgerId:evidence.grant._id,paymentVerifiedAt:new Date(),wasSelected:String(user.billingOrderId)===orderId,ownerId,orderId:evidence.order._id,requestKey:body.requestId,amount:evidence.order.amount,mode:evidence.order.mode,spentCredits:evidence.spent,status:'PREPARED',providerRequestId:randomUUID().replaceAll('-',''),providerRequestedAt:new Date(),frozenLots:evidence.lots.map(lot=>({lotId:lot._id,walletId:lot.walletId,available:lot.available}))}],{session});
  evidence.order.refundLockedAt=new Date();await evidence.order.save({session});
  for(const wallet of evidence.wallets){const amount=evidence.lots.filter(lot=>String(lot.walletId)===String(wallet._id)).reduce((n,lot)=>n+lot.available,0);if(wallet.available<amount)throw new RefundError('REFUND_EVIDENCE_INCOMPLETE');if(amount){await Wallet.updateOne({_id:wallet._id},{$inc:{available:-amount}},{session});await CreditLedger.create([{walletId:wallet._id,transactionType:'REFUND_HOLD',deltaAvailable:-amount,deltaReserved:0,referenceId:`refund_hold_${prepared._id}`}],{session});}}
  await CreditLot.updateMany({_id:{$in:evidence.lots.map(lot=>lot._id)}},{$set:{available:0,refundBlocked:true}},{session});
  await RefundAudit.create([{refundId:prepared._id,ownerId,orderId:evidence.order._id,status:'PREPARED',reason:'CUSTOMER_CONFIRMED_FULL_RENEWAL_REFUND'}],{session});
  if(String(user.billingOrderId)===orderId){const fallback=await BillingOrder.findOne({ownerId,status:'PAID',_id:{$ne:evidence.order._id},refundLockedAt:{$exists:false},startsAt:{$lte:new Date()},endsAt:{$gt:new Date()}}).sort({paidAt:-1}).session(session);user.plan=fallback?.tier||'FREE';user.billingOrderId=fallback?fallback._id:undefined;user.planPeriod=fallback?{billingCycle:fallback.billingCycle==='yearly'?'YEARLY':'MONTHLY',startsAt:fallback.startsAt,endsAt:fallback.endsAt}:undefined;await user.save({session});}
 });}catch(error:any){if(error.code!==11000)throw error;prepared=await BillingRefund.findOne({ownerId,orderId});if(!prepared)throw error;}finally{await session.endSession();}
 await sendPreparedRefund(prepared._id);return publicRefund(await BillingRefund.findById(prepared._id));
}
async function applyResult(refundId:unknown,result:Awaited<ReturnType<typeof callRefundGateway>>,command:'querydr'|'refund'){
 const completed=result.responseCode==='00'&&result.transactionType==='02'&&result.transactionStatus==='00'&&/^\d{1,30}$/.test(result.transactionNo||'');
 const rejected=command==='refund'&&['02','03','91','95','97'].includes(result.responseCode);
 const session=await mongoose.startSession();
 try{await session.withTransaction(async()=>{
  const refund=await BillingRefund.findById(refundId).session(session);if(!refund||['COMPLETED','REJECTED'].includes(refund.status))return;
  const order=await BillingOrder.findById(refund.orderId).session(session);if(!order)throw new RefundError('REFUND_EVIDENCE_INCOMPLETE');
  if(completed){refund.status='COMPLETED';refund.completedAt=new Date();refund.providerRefundId=result.transactionNo;order.refundedAt=refund.completedAt;await order.save({session});await RefundReceipt.create([{refundId:refund._id,orderId:order._id,ownerId:refund.ownerId,amount:refund.amount,mode:refund.mode,providerRefundId:result.transactionNo,occurredAt:refund.completedAt,tier:order.tier,planName:order.planSnapshot.config.overview.name,billingCycle:order.billingCycle}],{session});}
  else if(rejected){refund.status='REJECTED';order.refundLockedAt=undefined;await order.save({session});for(const frozen of refund.frozenLots){const lot=await CreditLot.findById(frozen.lotId).session(session);if(!lot||!lot.refundBlocked||lot.available!==0)throw new RefundError('REFUND_EVIDENCE_INCOMPLETE');const available=lot.expiresAt>new Date()?frozen.available:0;lot.available=available;lot.refundBlocked=false;await lot.save({session});if(available){await Wallet.updateOne({_id:frozen.walletId},{$inc:{available}},{session});await CreditLedger.create([{walletId:frozen.walletId,transactionType:'REFUND_RELEASE',deltaAvailable:available,deltaReserved:0,referenceId:`refund_release_${refund._id}_${lot._id}`}],{session});}}}
  else refund.status=['05','06'].includes(result.transactionStatus)||result.responseCode==='94'?'PROCESSING':'UNKNOWN';
  if(rejected&&refund.wasSelected&&order.startsAt<=new Date()&&order.endsAt>new Date()){const user=await User.findById(refund.ownerId).session(session);if(user&&user.plan==='FREE'&&!user.billingOrderId){user.plan=order.tier;user.billingOrderId=order._id;user.planPeriod={billingCycle:order.billingCycle==='yearly'?'YEARLY':'MONTHLY',startsAt:order.startsAt,endsAt:order.endsAt};await user.save({session});}}
  await RefundAudit.create([{refundId:refund._id,ownerId:refund.ownerId,orderId:order._id,status:refund.status,responseId:result.responseId,responseCode:result.responseCode,transactionStatus:result.transactionStatus,reason:'SIGNED_VNPAY_RESPONSE'}],{session});
  if(['COMPLETED','REJECTED'].includes(refund.status))await Notification.updateOne({ownerId:refund.ownerId,sourceId:`refund_${refund._id}_${refund.status}`},{$setOnInsert:{orderId:order._id,title:completed?'VNPay xác nhận hoàn tiền':'VNPay từ chối hoàn tiền',message:completed?`VNPay xác nhận hoàn ${refund.amount.toLocaleString('vi-VN')} ₫ cho đơn gia hạn.${refund.mode==='sandbox'?' Giao dịch thử nghiệm, không phải tiền thật.':' Thời gian tiền về phụ thuộc ngân hàng.'}`:'Yêu cầu không được VNPay chấp nhận. Quyền và Credit chưa dùng của đơn đã được khôi phục.'}},{upsert:true,session});
  refund.responseCode=result.responseCode;refund.transactionStatus=result.transactionStatus;refund.lastCheckedAt=new Date();await refund.save({session});
 });}finally{await session.endSession();}
}
export async function sendPreparedRefund(refundId:unknown){
 // Atomic transition is the only path to the money-moving request. Never resend
 // SENDING/UNKNOWN, even with a different request key, device or application replica.
 const claimed=await BillingRefund.findOneAndUpdate({_id:refundId,status:'PREPARED'},{$set:{status:'SENDING',lastCheckedAt:new Date()}},{new:true});if(!claimed)return;
 try{await RefundAudit.create({refundId:claimed._id,ownerId:claimed.ownerId,orderId:claimed.orderId,status:'SENDING',reason:'ATOMIC_PROVIDER_SEND_CLAIM'});const order=await BillingOrder.findById(claimed.orderId);if(!order)throw Error('missing order');const receipt=await PaymentReceipt.findById(claimed.paymentReceiptId);const verified=await callRefundGateway(order,'querydr');if(!receipt||!paymentVerified(verified,order)||providerPaymentDate(verified.payDate)?.getTime()!==receipt.providerPaidAt?.getTime())throw new RefundError('REFUND_PAYMENT_NOT_VERIFIED');const result=await callRefundGateway(order,'refund',claimed.providerRequestId,claimed.providerRequestedAt,String(claimed.ownerId));await applyResult(claimed._id,result,'refund');}
 catch{const changed=await BillingRefund.updateOne({_id:claimed._id,status:'SENDING'},{$set:{status:'UNKNOWN',lastCheckedAt:new Date()}});if(changed.modifiedCount)await RefundAudit.create({refundId:claimed._id,ownerId:claimed.ownerId,orderId:claimed.orderId,status:'UNKNOWN',reason:'PROVIDER_RESULT_UNVERIFIED_NO_RESEND'});}
 await publishBillingOrder(claimed.orderId).catch(()=>{});
}
export async function reconcileRefund(refundId:unknown){
 const now=new Date();const claimed=await BillingRefund.findOneAndUpdate({_id:refundId,status:{$in:['PROCESSING','UNKNOWN']},$or:[{lastCheckedAt:{$lt:new Date(+now-30000)}},{lastCheckedAt:{$exists:false}}]},{$set:{lastCheckedAt:now}},{new:true});if(!claimed)return;
 await RefundAudit.create({refundId:claimed._id,ownerId:claimed.ownerId,orderId:claimed.orderId,status:'SENDING',reason:'ATOMIC_PROVIDER_SEND_CLAIM'});
 try{const order=await BillingOrder.findById(claimed.orderId);if(order){await applyResult(claimed._id,await callRefundGateway(order,'querydr'),'querydr');await publishBillingOrder(order._id).catch(()=>{});}}catch{}
}
export async function getRenewalRefund(ownerId:unknown,orderId:string,ip:string){
 await refundRate(ownerId,ip,'status');await ownedOrder(ownerId,orderId);const refund=await BillingRefund.findOne({ownerId,orderId});if(!refund)return null;
 await reconcileRefund(refund._id);return publicRefund(await BillingRefund.findById(refund._id));
}
export async function supportBilling(ownerId:unknown,page=1){
 if(!Number.isSafeInteger(page)||page<1||page>10000)throw new RefundError('REFUND_INVALID_INPUT',400);
 const user=await User.findById(ownerId).select('plan billingOrderId planPeriod');if(!user)throw new RefundError('REFUND_ACCOUNT_UNAVAILABLE',403);
 const now=new Date(),[orders,total,wallets]=await Promise.all([BillingOrder.find({ownerId}).sort({createdAt:-1,_id:-1}).skip((page-1)*10).limit(10).lean(),BillingOrder.countDocuments({ownerId}),Wallet.find({userId:ownerId}).select('available reserved').lean()]);
 const selected:any=orders.find(order=>String(order._id)===String(user.billingOrderId))||(user.billingOrderId?await BillingOrder.findOne({_id:user.billingOrderId,ownerId}).lean():null);
 const active=selected?.status==='PAID'&&!selected.refundLockedAt&&selected.startsAt<=now&&selected.endsAt>now;
 const refunds=await BillingRefund.find({ownerId,orderId:{$in:orders.map(order=>order._id)}}).lean();
 return {account:{tier:user.billingOrderId?(active?selected.tier:'FREE'):user.plan,name:active?selected.planSnapshot.config.overview.name:user.billingOrderId?'Free':user.plan,endsAt:active?selected.endsAt:user.planPeriod?.endsAt,availableCredits:wallets.reduce((n,w)=>n+w.available,0),reservedCredits:wallets.reduce((n,w)=>n+w.reserved,0)},items:orders.map(order=>({orderId:String(order._id),name:order.planSnapshot.config.overview.name,tier:order.tier,amount:order.amount,currency:'VND',mode:order.mode,status:order.status,purpose:order.purpose||'UNCLASSIFIED',paidAt:order.paidAt,refund:publicRefund(refunds.find(row=>String(row.orderId)===String(order._id))),canCheck:order.status==='PAID'&&order.purpose==='RENEWAL'&&!order.refundLockedAt&&order.paidAt&&+now-+order.paidAt<=86400000})),page,limit:10,total};
}
export function startRefundMaintenance(){
 let active=false;
 const timer=setInterval(async()=>{
  if(active||mongoose.connection.readyState!==1)return;active=true;
  const token=randomUUID();let claimed=false;
  try{
   await ready();
   try{await RefundMaintenanceLease.findOneAndUpdate({key:'global',expiresAt:{$lte:new Date()}},{$set:{token,expiresAt:new Date(Date.now()+360000)}},{upsert:true,new:true});claimed=true;}catch(error:any){if(error.code===11000)return;throw error;}
   // One maintenance scan across replicas; bounded batches avoid gateway storms.
   const stale=await BillingRefund.find({status:'SENDING',updatedAt:{$lt:new Date(Date.now()-60000)}}).limit(10);
   for(const refund of stale){const changed=await BillingRefund.updateOne({_id:refund._id,status:'SENDING'},{$set:{status:'UNKNOWN'}});if(changed.modifiedCount)await RefundAudit.create({refundId:refund._id,ownerId:refund.ownerId,orderId:refund.orderId,status:'UNKNOWN',reason:'SEND_INTERRUPTED_NO_RESEND'});}
   const pending=await BillingRefund.find({status:{$in:['PREPARED','PROCESSING','UNKNOWN']}}).sort({lastCheckedAt:1,createdAt:1}).limit(10);
   for(const refund of pending){if(refund.status==='PREPARED')await sendPreparedRefund(refund._id);else await reconcileRefund(refund._id);}
  }catch{console.error('REFUND_MAINTENANCE_UNAVAILABLE');}
  finally{if(claimed)await RefundMaintenanceLease.deleteOne({key:'global',token}).catch(()=>{});active=false;}
 },30000);timer.unref();return ()=>clearInterval(timer);
}

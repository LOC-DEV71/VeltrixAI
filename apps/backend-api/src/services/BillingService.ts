import {publishBillingOrder} from './BillingRealtime';
import { PaymentMethod } from '../models/PaymentMethod';
import { getPlanSnapshot, PlanError } from './PlanService';
import mongoose from 'mongoose';
import { BillingOrder } from '../models/BillingOrder';
import { User } from '../models/User';
import { Wallet,CreditLot,CreditLedger } from '../models/Credits';
import { addPlanMonths } from './PlanPeriod';
import {vnPayConfig,paymentUrl,verifyCallback} from './VNPayProvider';
import {tokenConfig,tokenPaymentUrl,verifyToken} from './VNPayCards';
import {Notification} from '../models/Notification';
import {PaymentReceipt,CashMovement,providerPaymentDate} from '../models/Finance';

export class BillingError extends Error {
  constructor(public code:string,public status=400){super(code);}
}

export const billingCapabilities = () => ({ available:!!vnPayConfig(), savedCardsAvailable:!!tokenConfig(), provider:'VNPAY', mode:vnPayConfig()?.mode || null });
export async function savedPaymentMethods(ownerId:unknown) {
  return PaymentMethod.find({ownerId,status:'ACTIVE',provider:'VNPAY',mode:vnPayConfig()?.mode})
    .select('_id brand last4 expiryMonth expiryYear isDefault').sort({isDefault:-1,createdAt:-1}).lean();
}
export async function checkoutQuote(body:any) {
  if(!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).some(k=>!['tier','billingCycle','expectedRevision','paymentMethodId'].includes(k)) || typeof body.tier!=='string' || body.tier==='FREE' || !['monthly','yearly'].includes(body.billingCycle) || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision<1 || body.paymentMethodId!==undefined&&!/^[a-f0-9]{24}$/.test(body.paymentMethodId))throw new BillingError('BILLING_INVALID_INPUT');
  const snapshot=await getPlanSnapshot(body.tier);
  if(snapshot.revision!==body.expectedRevision)throw new BillingError('BILLING_PRICE_CHANGED',409);
  if(!snapshot.config.pricing[body.billingCycle+'Available'])throw new BillingError('BILLING_CYCLE_UNAVAILABLE',409);
  return {tier:snapshot.tier,revision:snapshot.revision,name:snapshot.config.overview.name,billingCycle:body.billingCycle,amount:snapshot.config.pricing[body.billingCycle+'Price'],currency:'VND'};
}

export function requireBillingGateway() { const config=vnPayConfig();if(!config)throw new BillingError('PAYMENT_PROVIDER_UNAVAILABLE',503);return config; }
export async function createCheckout(ownerId:unknown,body:any,key:unknown,ip:string) {
  const config=requireBillingGateway();
  if(typeof key!=='string'||!/^[a-zA-Z0-9-]{16,64}$/.test(key))throw new BillingError('BILLING_INVALID_INPUT');
  let order=await BillingOrder.findOne({ownerId,requestKey:key});
  if(order){if(order.tier!==body.tier||order.billingCycle!==body.billingCycle||order.planSnapshot.revision!==body.expectedRevision||String(order.paymentMethodId||'')!==String(body.paymentMethodId||''))throw new BillingError('BILLING_REQUEST_CONFLICT',409);}
  else {
    const user=await User.findById(ownerId);
    if(!user || user.status!=='ACTIVE')throw new BillingError('BILLING_ACCOUNT_UNAVAILABLE',403);
    const quote=await checkoutQuote(body);
    if(body.paymentMethodId&&(!tokenConfig()||!await PaymentMethod.exists({_id:body.paymentMethodId,ownerId,status:'ACTIVE',provider:'VNPAY',mode:config.mode})))throw new BillingError('BILLING_PAYMENT_METHOD_NOT_FOUND',404);
    if(!Number.isSafeInteger(quote.amount)||quote.amount<=0||quote.amount*100>999999999999)throw new BillingError('BILLING_INVALID_PRICE');
    const snapshot=await getPlanSnapshot(quote.tier);
    if(snapshot.revision!==quote.revision)throw new BillingError('BILLING_PRICE_CHANGED',409);
    const prior=await BillingOrder.findOne({ownerId,tier:quote.tier,status:'PAID',refundLockedAt:{$exists:false},mode:config.mode}).sort({paidAt:-1});
    try {order=await BillingOrder.create({ownerId,requestKey:key,paymentMethodId:body.paymentMethodId,tier:quote.tier,billingCycle:quote.billingCycle,amount:quote.amount,planSnapshot:snapshot,mode:config.mode,purpose:prior?'RENEWAL':'PURCHASE',renewalOfOrderId:prior?prior._id:undefined,expiresAt:new Date(Date.now()+15*60000)});}
    catch(e:any){if(e.code!==11000)throw e;return createCheckout(ownerId,body,key,ip);}
    await publishBillingOrder(order._id).catch(()=>{});
  }
  if(order.status!=='PENDING'||order.expiresAt<=new Date()||order.mode!==config.mode)throw new BillingError('BILLING_ORDER_EXPIRED',409);
  return {orderId:String(order._id),checkoutUrl:order.paymentMethodId?await tokenPaymentUrl(order,ip):paymentUrl(order,ip,config)};
}
async function grant(order:any,month:number,startsAt:Date,session:mongoose.ClientSession) {
  const referenceId=`billing_${order._id}_${month}`, c=order.planSnapshot.config.credits;
  if(await CreditLedger.exists({referenceId,transactionType:'GRANT'}).session(session))return;
  const wallet=await Wallet.findOneAndUpdate({userId:order.ownerId,bucket:'FREE'},{$setOnInsert:{available:0,reserved:0}},{upsert:true,new:true,session});
  const oldLots=await CreditLot.find({walletId:wallet._id,billingOrderId:order._id,grantSnapshot:{$exists:true},available:{$gt:0},createdAt:{$lt:startsAt}}).sort({createdAt:-1}).session(session);
  let retained=0,expired=0;
  for(const lot of oldLots){const rules=lot.grantSnapshot.config.credits;const keep=!rules.rolloverAllowed?0:rules.maxRollover===null?lot.available:Math.min(lot.available,Math.max(0,rules.maxRollover-retained));retained+=keep;expired+=lot.available-keep;lot.available=keep;await lot.save({session});}
  if(expired){await Wallet.updateOne({_id:wallet._id},{$inc:{available:-expired}},{session});await CreditLedger.create([{walletId:wallet._id,transactionType:'EXPIRE',deltaAvailable:-expired,deltaReserved:0,referenceId:referenceId+'_rollover'}],{session});}
  const expiresAt=c.expiresAfterDays===null?new Date('9999-12-31'):new Date(startsAt.getTime()+c.expiresAfterDays*86400000);
  await CreditLot.create([{walletId:wallet._id,billingOrderId:order._id,amount:c.monthlyGrant,available:c.monthlyGrant,expiresAt,grantSnapshot:order.planSnapshot}],{session});
  await Wallet.updateOne({_id:wallet._id},{$inc:{available:c.monthlyGrant}},{session});
  await CreditLedger.create([{walletId:wallet._id,transactionType:'GRANT',deltaAvailable:c.monthlyGrant,deltaReserved:0,referenceId}],{session});
}
export async function paidEntitlements(user:any,session:mongoose.ClientSession) {
  if(!user.billingOrderId)return null;
  // Preserve the period of payments created before explicit order periods existed.
  const selected=await BillingOrder.findOne({_id:user.billingOrderId,ownerId:user._id,status:'PAID',refundLockedAt:{$exists:false}}).session(session);
  if(selected&&!selected.startsAt&&user.planPeriod&&selected.tier===user.plan){selected.startsAt=user.planPeriod.startsAt;selected.endsAt=user.planPeriod.endsAt;await selected.save({session});}
  const now=new Date();const orders=await BillingOrder.find({ownerId:user._id,status:'PAID',refundLockedAt:{$exists:false},startsAt:{$lte:now},endsAt:{$gt:now}}).sort({paidAt:-1,_id:-1}).session(session);
  for(const order of orders){const months=order.billingCycle==='yearly'?12:1;for(let i=0;i<months;i++){const start=addPlanMonths(order.startsAt,i);if(start>now)break;await grant(order,i,start,session);}}
  const order=orders.find(o=>String(o._id)===String(user.billingOrderId))||orders[0];
  if(!order)return getPlanSnapshot('FREE',session);
  if(String(order._id)!==String(user.billingOrderId)){user.billingOrderId=order._id;user.plan=order.tier;user.planPeriod={billingCycle:order.billingCycle==='yearly'?'YEARLY':'MONTHLY',startsAt:order.startsAt,endsAt:order.endsAt};await user.save({session});}
  return order.planSnapshot;
}
export async function subscriptions(ownerId:unknown,query:any={}){
 const page=Number(query.page||1),limit=10;if(!Number.isSafeInteger(page)||page<1||page>10000)throw new BillingError('BILLING_INVALID_INPUT');
 const total=await BillingOrder.countDocuments({ownerId,status:'PAID'});
 const user=await User.findById(ownerId);if(!user)throw new BillingError('BILLING_ACCOUNT_UNAVAILABLE',403);
 const items=await BillingOrder.find({ownerId,status:'PAID'}).select('_id tier billingCycle startsAt endsAt paidAt mode refundLockedAt refundedAt planSnapshot.config.overview.name').sort({paidAt:-1,_id:-1}).skip((page-1)*limit).limit(limit).lean();
 return {page,limit,total,selectedId:user.billingOrderId?String(user.billingOrderId):null,items:items.map((o:any)=>{const startsAt=o.startsAt||(String(o._id)===String(user.billingOrderId)?user.planPeriod?.startsAt:undefined),endsAt=o.endsAt||(String(o._id)===String(user.billingOrderId)?user.planPeriod?.endsAt:undefined);return {_id:o._id,tier:o.tier,name:o.planSnapshot.config.overview.name,billingCycle:o.billingCycle,startsAt,endsAt,paidAt:o.paidAt,mode:o.mode,refundLockedAt:o.refundLockedAt,refundedAt:o.refundedAt,active:!o.refundLockedAt&&!!startsAt&&startsAt<=new Date()&&endsAt>new Date()};})};
}
export async function selectSubscription(ownerId:unknown,id:string,expected:unknown){
 if(!mongoose.isObjectIdOrHexString(id)||expected!==null&&!mongoose.isObjectIdOrHexString(expected))throw new BillingError('BILLING_INVALID_INPUT');
 const session=await mongoose.startSession();try{await session.withTransaction(async()=>{
   const user=await User.findById(ownerId).session(session);if(!user||user.status!=='ACTIVE')throw new BillingError('BILLING_ACCOUNT_UNAVAILABLE',403);
   if(String(user.billingOrderId||'')!==String(expected||''))throw new BillingError('BILLING_SELECTION_CONFLICT',409);
   await paidEntitlements(user,session);
   const order=await BillingOrder.findOne({_id:id,ownerId,status:'PAID',refundLockedAt:{$exists:false},startsAt:{$lte:new Date()},endsAt:{$gt:new Date()}}).session(session);if(!order)throw new BillingError('BILLING_SUBSCRIPTION_EXPIRED',409);
   user.billingOrderId=order._id;user.plan=order.tier;user.planPeriod={billingCycle:order.billingCycle==='yearly'?'YEARLY':'MONTHLY',startsAt:order.startsAt,endsAt:order.endsAt};await user.save({session});
 });}finally{await session.endSession();}return subscriptions(ownerId);
}
export async function receiveIPN(raw:unknown,token=false) {
  const config=requireBillingGateway();const p=token?verifyToken(raw):null;
  const params=token?(p&&p.vnp_command==='token_pay'?{vnp_TxnRef:p.vnp_txn_ref,vnp_Amount:p.vnp_amount,vnp_ResponseCode:p.vnp_response_code,vnp_TransactionStatus:p.vnp_transaction_status,vnp_TransactionNo:p.vnp_transaction_no}:null):verifyCallback(raw,config);
  if(!params)return {RspCode:'97',Message:'Invalid signature'};
  if(!/^[a-f0-9]{24}$/.test(params.vnp_TxnRef||''))return {RspCode:'01',Message:'Order not found'};
  await Promise.all([PaymentReceipt.init(),CashMovement.init()]);
  const session=await mongoose.startSession();
  try {const result=await session.withTransaction(async()=>{
    const order=await BillingOrder.findById(params.vnp_TxnRef).session(session);
    if(!order||order.mode!==config.mode)return {RspCode:'01',Message:'Order not found'};
    if(!!order.paymentMethodId!==token||token&&p?.vnp_app_user_id!==String(order.ownerId))return {RspCode:'97',Message:'Invalid payment channel'};
    if(params.vnp_Amount!==String(order.amount*100))return {RspCode:'04',Message:'Invalid amount'};
    if(order.status!=='PENDING')return {RspCode:'02',Message:'Order already confirmed'};
    const success=params.vnp_ResponseCode==='00'&&params.vnp_TransactionStatus==='00';
    if(success&&!/^[0-9]{1,30}$/.test(params.vnp_TransactionNo||''))return {RspCode:'99',Message:'Invalid transaction'};
    order.status=success?'PAID':'FAILED';
    if(success){
      const user=await User.findById(order.ownerId).session(session);if(!user||user.status!=='ACTIVE')return {RspCode:'99',Message:'Account unavailable'};
      const startsAt=new Date();
      user.plan=order.tier;user.billingOrderId=order._id;
      user.planPeriod={billingCycle:order.billingCycle==='yearly'?'YEARLY':'MONTHLY',startsAt,endsAt:addPlanMonths(startsAt,order.billingCycle==='yearly'?12:1)};
      order.startsAt=user.planPeriod.startsAt;order.endsAt=user.planPeriod.endsAt;
      await user.save({session});if(startsAt<=new Date())await grant(order,0,startsAt,session);
      order.paidAt=new Date();order.providerTransactionId=params.vnp_TransactionNo;
      await Notification.updateOne({ownerId:user._id,sourceId:`payment_${order._id}`},{$setOnInsert:{title:'Thanh toán thành công',message:`Đã đăng ký ${order.planSnapshot.config.overview.name}, cộng ${order.planSnapshot.config.credits.monthlyGrant.toLocaleString('vi-VN')} Credit cho kỳ đầu.${order.mode==='sandbox'?' Đây là giao dịch thử nghiệm.':''}`,orderId:order._id}},{upsert:true,session});
    }
    const safe=(v:any,pattern:RegExp)=>typeof v==='string'&&pattern.test(v)?v:undefined;
    const metadata:any=token?p:params;
    const [receipt]=await PaymentReceipt.create([{orderId:order._id,ownerId:order.ownerId,provider:'VNPAY',mode:order.mode,amount:order.amount,outcome:success?'SUCCESS':'FAILED',channel:token?'SAVED_CARD':'CHECKOUT',providerTransactionId:safe(params.vnp_TransactionNo,/^[0-9]{1,30}$/),responseCode:safe(params.vnp_ResponseCode,/^[0-9]{2}$/),transactionStatus:safe(params.vnp_TransactionStatus,/^[0-9]{2}$/),bankCode:safe(token?metadata?.vnp_bank_code:metadata?.vnp_BankCode,/^[A-Z0-9_]{1,20}$/),cardType:safe(token?metadata?.vnp_card_type:metadata?.vnp_CardType,/^[A-Z0-9_]{1,20}$/),providerPaidAt:providerPaymentDate(token?metadata?.vnp_pay_date:metadata?.vnp_PayDate),confirmedAt:order.paidAt||new Date()}],{session});
    if(success)await CashMovement.create([{orderId:order._id,paymentId:receipt._id,ownerId:order.ownerId,kind:'PAYMENT_RECEIVED',amount:order.amount,mode:order.mode,occurredAt:order.paidAt,tier:order.tier,planName:order.planSnapshot.config.overview.name,billingCycle:order.billingCycle}],{session});
    await order.save({session});return {RspCode:'00',Message:'Confirm success'};
  });
  if(result?.RspCode==='00')await publishBillingOrder(params.vnp_TxnRef).catch(()=>{});
  return result;
  }finally{await session.endSession();}
}
export {PlanError};

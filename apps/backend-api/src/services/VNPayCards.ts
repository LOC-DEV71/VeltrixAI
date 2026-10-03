import mongoose,{Schema} from 'mongoose';
import {createCipheriv,createDecipheriv,randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {PaymentMethod} from '../models/PaymentMethod';
import {canonical,signature,vnDate,vnPayConfig} from './VNPayProvider';
import {BillingError} from './BillingService';
const setupSchema=new Schema({ownerId:{type:Schema.Types.ObjectId,required:true},consentedAt:{type:Date,required:true},status:{type:String,enum:['PENDING','ACTIVE','FAILED'],default:'PENDING'},mode:String,expiresAt:Date},{timestamps:true});
export const CardSetup=mongoose.models.CardSetup||mongoose.model('CardSetup',setupSchema);
export function tokenConfig(){
  const main=vnPayConfig(),key=process.env.VNPAY_TOKEN_ENCRYPTION_KEY||'',tmnCode=process.env.VNPAY_TOKEN_TMN_CODE||'',secret=process.env.VNPAY_TOKEN_HASH_SECRET||'',returnUrl=process.env.VNPAY_TOKEN_RETURN_URL||'';
  if(!main||process.env.VNPAY_TOKEN_ENABLED!=='true'||!/^[a-f0-9]{64}$/i.test(key)||!tmnCode||!secret)return null;
  const endpoint=main.mode==='sandbox'?'https://sandbox.vnpayment.vn/token_ui/create-token.html':process.env.VNPAY_TOKEN_CREATE_URL||'';
  try{const url=new URL(endpoint);if(url.protocol!=='https:'||!['pay.vnpay.vn','sandbox.vnpayment.vn'].includes(url.hostname)||new URL(returnUrl).protocol!=='https:')return null;}catch{return null;}
  return {...main,tmnCode,secret,key,returnUrl,endpoint};
}
export function verifyToken(raw:any){
  const config=tokenConfig();if(!config||!raw||typeof raw!=='object')return null;
  const params:Record<string,string>={};for(const [k,v] of Object.entries(raw)){if(!k.startsWith('vnp_')||typeof v!=='string')return null;if(k!=='vnp_secure_hash')params[k]=v;}
  if(!/^[a-f0-9]{128}$/i.test(raw.vnp_secure_hash||'')||params.vnp_tmn_code!==config.tmnCode||!timingSafeEqual(Buffer.from(raw.vnp_secure_hash,'hex'),Buffer.from(signature(params,config.secret),'hex')))return null;
  return params;
}
export async function setupCard(ownerId:unknown,ip:string){
  const config=tokenConfig();if(!config)throw new BillingError('PAYMENT_TOKENIZATION_UNAVAILABLE',503);
  const setup=await CardSetup.create({ownerId,consentedAt:new Date(),mode:config.mode,expiresAt:new Date(Date.now()+15*60000)});
  const params={vnp_version:'2.1.0',vnp_command:'token_create',vnp_tmn_code:config.tmnCode,vnp_app_user_id:String(ownerId),vnp_bank_code:'VISA',vnp_card_type:'02',vnp_locale:'vn',vnp_txn_ref:String(setup._id),vnp_txn_desc:'Luu the Visa Veltrix',vnp_return_url:config.returnUrl,vnp_ip_addr:ip.replace(/^::ffff:/,''),vnp_create_date:vnDate(setup.createdAt)};
  return {setupId:String(setup._id),setupUrl:`${config.endpoint}?${canonical(params)}&vnp_secure_hash=${signature(params,config.secret)}`};
}
export async function tokenPaymentUrl(order:any,ip:string){
  const config=tokenConfig();if(!config)throw new BillingError('PAYMENT_TOKENIZATION_UNAVAILABLE',503);
  const method=await PaymentMethod.findOne({_id:order.paymentMethodId,ownerId:order.ownerId,status:'ACTIVE',provider:'VNPAY',mode:config.mode}).select('+providerTokenEncrypted');
  if(!method?.providerTokenEncrypted)throw new BillingError('BILLING_PAYMENT_METHOD_NOT_FOUND',404);
  const [iv,data,tag]=method.providerTokenEncrypted.split('.');const cipher=createDecipheriv('aes-256-gcm',Buffer.from(config.key,'hex'),Buffer.from(iv,'hex'));cipher.setAuthTag(Buffer.from(tag,'hex'));
  const token=Buffer.concat([cipher.update(Buffer.from(data,'hex')),cipher.final()]).toString('utf8');
  const endpoint=config.mode==='sandbox'?'https://sandbox.vnpayment.vn/token_ui/payment-token.html':process.env.VNPAY_TOKEN_PAYMENT_URL||'';
  try{const url=new URL(endpoint);if(url.protocol!=='https:'||!['pay.vnpay.vn','sandbox.vnpayment.vn'].includes(url.hostname))throw 0;}catch{throw new BillingError('PAYMENT_TOKENIZATION_UNAVAILABLE',503);}
  const params={vnp_version:'2.1.0',vnp_command:'token_pay',vnp_tmn_code:config.tmnCode,vnp_app_user_id:String(order.ownerId),vnp_token:token,vnp_amount:String(order.amount*100),vnp_curr_code:'VND',vnp_locale:'vn',vnp_txn_ref:String(order._id),vnp_txn_desc:'Thanh toan Veltrix',vnp_return_url:config.returnUrl,vnp_ip_addr:ip.replace(/^::ffff:/,''),vnp_create_date:vnDate(order.createdAt)};
  return `${endpoint}?${canonical(params)}&vnp_secure_hash=${signature(params,config.secret)}`;
}
export async function tokenIPN(raw:unknown){
  const config=tokenConfig(),p=verifyToken(raw);if(!config||!p)return {RspCode:'97',Message:'Invalid signature'};
  if(p.vnp_command!=='token_create'||!/^[a-f0-9]{24}$/.test(p.vnp_txn_ref||''))return {RspCode:'01',Message:'Not found'};
  const session=await mongoose.startSession();try{return await session.withTransaction(async()=>{
    const setup=await CardSetup.findById(p.vnp_txn_ref).session(session);
    if(!setup||String(setup.ownerId)!==p.vnp_app_user_id||setup.mode!==config.mode)return {RspCode:'01',Message:'Not found'};
    if(setup.status!=='PENDING')return {RspCode:'02',Message:'Already confirmed'};
    if(p.vnp_response_code==='00'&&p.vnp_transaction_status==='00'){
      // Reject unmasked numbers instead of accidentally persisting a full PAN.
      if(p.vnp_bank_code!=='VISA'||p.vnp_card_type!=='02'||!/^[a-z0-9]{64}$/i.test(p.vnp_token||'')||!/^[0-9xX*]{11,15}[0-9]{4}$/.test(p.vnp_card_number||'')||!/[xX*]/.test(p.vnp_card_number))return {RspCode:'99',Message:'Invalid card metadata'};
      const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(config.key,'hex'),nonce);const encrypted=Buffer.concat([cipher.update(p.vnp_token,'utf8'),cipher.final()]);
      const tokenId=createHash('sha256').update(config.mode+':'+config.tmnCode+':'+p.vnp_token).digest('hex');
      const existing=await PaymentMethod.findOne({provider:'VNPAY',providerPaymentMethodId:tokenId}).session(session);
      if(existing&&String(existing.ownerId)!==String(setup.ownerId))return {RspCode:'99',Message:'Ownership conflict'};
      if(!existing)await PaymentMethod.create([{ownerId:setup.ownerId,provider:'VNPAY',mode:config.mode,providerCustomerId:String(setup.ownerId),providerPaymentMethodId:tokenId,providerTokenEncrypted:[nonce.toString('hex'),encrypted.toString('hex'),cipher.getAuthTag().toString('hex')].join('.'),brand:'Visa',last4:p.vnp_card_number.slice(-4),isDefault:!await PaymentMethod.exists({ownerId:setup.ownerId,status:'ACTIVE'}).session(session)}],{session});
      setup.status='ACTIVE';
    }else setup.status='FAILED';await setup.save({session});return {RspCode:'00',Message:'Confirm success'};
  });}finally{await session.endSession();}
}

import {createHmac,timingSafeEqual} from 'node:crypto';
export function vnPayConfig() {
  const mode=process.env.VNPAY_MODE;
  const tmnCode=process.env.VNPAY_TMN_CODE || '', secret=process.env.VNPAY_HASH_SECRET || '';
  const returnUrl=process.env.VNPAY_RETURN_URL || '', clientUrl=process.env.VNPAY_CLIENT_URL || '';
  const endpoint=mode==='production'?'https://pay.vnpay.vn/vpcpay.html':'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html';
  try {if(!['sandbox','production'].includes(mode||'') || !tmnCode || !secret || new URL(returnUrl).protocol!=='https:' || !['http:','https:'].includes(new URL(clientUrl).protocol))return null;}catch{return null;}
  return {mode,tmnCode,secret,returnUrl,clientUrl,endpoint};
}
const encode=(v:string)=>encodeURIComponent(v).replace(/%20/g,'+');
export function canonical(params:Record<string,string>) {return Object.keys(params).sort().map(k=>`${encode(k)}=${encode(params[k])}`).join('&');}
export function signature(params:Record<string,string>,secret:string) {return createHmac('sha512',secret).update(canonical(params)).digest('hex');}
export function verifyCallback(raw:unknown,config:NonNullable<ReturnType<typeof vnPayConfig>>) {
  if(!raw || typeof raw!=='object' || Array.isArray(raw))return null;
  const params:Record<string,string>={};
  for(const [key,value] of Object.entries(raw)){if(!key.startsWith('vnp_') || typeof value!=='string')return null;if(key!=='vnp_SecureHash' && key!=='vnp_SecureHashType')params[key]=value;}
  const hash=(raw as any).vnp_SecureHash;
  if(typeof hash!=='string'||!/^[a-f0-9]{128}$/i.test(hash)||params.vnp_TmnCode!==config.tmnCode)return null;
  return timingSafeEqual(Buffer.from(hash,'hex'),Buffer.from(signature(params,config.secret),'hex'))?params:null;
}
export function vnDate(date:Date){return new Date(date.getTime()+7*3600000).toISOString().replace(/[-:T]/g,'').slice(0,14);}
export function paymentUrl(order:any,ip:string,config:NonNullable<ReturnType<typeof vnPayConfig>>) {
  const params={vnp_Version:'2.1.0',vnp_Command:'pay',vnp_TmnCode:config.tmnCode,vnp_Amount:String(order.amount*100),vnp_CurrCode:'VND',vnp_IpAddr:ip.replace(/^::ffff:/,''),vnp_Locale:'vn',vnp_OrderInfo:`Thanh toan Veltrix ${order._id}`,vnp_OrderType:'other',vnp_ReturnUrl:config.returnUrl,vnp_TxnRef:String(order._id),vnp_CreateDate:vnDate(order.createdAt),vnp_ExpireDate:vnDate(order.expiresAt)};
  return `${config.endpoint}?${canonical(params)}&vnp_SecureHash=${signature(params,config.secret)}`;
}

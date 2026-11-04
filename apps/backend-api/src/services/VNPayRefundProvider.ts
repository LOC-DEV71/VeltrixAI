import {createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {isIP} from 'node:net';
import {vnPayConfig,vnDate} from './VNPayProvider';
import {tokenConfig} from './VNPayCards';

export class RefundProviderError extends Error {constructor(public code:string){super(code);}}
const hash=(fields:string[],data:Record<string,any>,secret:string)=>createHmac('sha512',secret).update(fields.map(key=>data[key]??'').join('|')).digest('hex');
export const QUERY_FIELDS=['vnp_RequestId','vnp_Version','vnp_Command','vnp_TmnCode','vnp_TxnRef','vnp_TransactionDate','vnp_CreateDate','vnp_IpAddr','vnp_OrderInfo'];
export const REFUND_FIELDS=['vnp_RequestId','vnp_Version','vnp_Command','vnp_TmnCode','vnp_TransactionType','vnp_TxnRef','vnp_Amount','vnp_TransactionNo','vnp_TransactionDate','vnp_CreateBy','vnp_CreateDate','vnp_IpAddr','vnp_OrderInfo'];
export const RESPONSE_FIELDS=['vnp_ResponseId','vnp_Command','vnp_ResponseCode','vnp_Message','vnp_TmnCode','vnp_TxnRef','vnp_Amount','vnp_BankCode','vnp_PayDate','vnp_TransactionNo','vnp_TransactionType','vnp_TransactionStatus','vnp_OrderInfo'];
export function refundGateway(order:any){
  const config=order.paymentMethodId?tokenConfig():vnPayConfig();
  if(!config || config.mode!==order.mode || process.env.VNPAY_REFUND_ENABLED!=='true')throw new RefundProviderError('REFUND_GATEWAY_UNAVAILABLE');
  const ip=process.env.VNPAY_SERVER_IP||'';if(!isIP(ip))throw new RefundProviderError('REFUND_GATEWAY_UNAVAILABLE');
  const endpoint=config.mode==='sandbox'?'https://sandbox.vnpayment.vn/merchant_webapi/api/transaction':process.env.VNPAY_TRANSACTION_API_URL||'';
  try{const url=new URL(endpoint);if(url.protocol!=='https:'||!['sandbox.vnpayment.vn','pay.vnpay.vn'].includes(url.hostname)||url.username||url.password||url.search||url.hash)throw 0;}catch{throw new RefundProviderError('REFUND_GATEWAY_UNAVAILABLE');}
  return {...config,ip,endpoint};
}
export function buildRefundRequest(order:any,command:'querydr'|'refund',requestId:string,createdAt:Date,actorId?:string){
  const config=refundGateway(order);
  const data:Record<string,string>={vnp_RequestId:requestId,vnp_Version:'2.1.0',vnp_Command:command,vnp_TmnCode:config.tmnCode,vnp_TxnRef:String(order._id),vnp_TransactionDate:vnDate(order.createdAt),vnp_CreateDate:vnDate(createdAt),vnp_IpAddr:config.ip,vnp_OrderInfo:`Veltrix ${command} ${order._id}`};
  if(command==='refund')Object.assign(data,{vnp_TransactionType:'02',vnp_Amount:String(order.amount*100),vnp_TransactionNo:order.providerTransactionId,vnp_CreateBy:actorId||'Veltrix'});
  data.vnp_SecureHash=hash(command==='refund'?REFUND_FIELDS:QUERY_FIELDS,data,config.secret);
  return {data,config};
}
export function verifyRefundResponse(raw:any,order:any,command:'querydr'|'refund',config:ReturnType<typeof refundGateway>){
  if(!raw || typeof raw!=='object' || Array.isArray(raw) || Object.values(raw).some(value=>typeof value!=='string' && typeof value!=='number'))throw new RefundProviderError('REFUND_RESPONSE_INVALID');
  const data:Record<string,string>=Object.fromEntries(Object.entries(raw).map(([key,value])=>[key,String(value)]));
  const fields=command==='querydr'?[...RESPONSE_FIELDS,'vnp_PromotionCode','vnp_PromotionAmount']:RESPONSE_FIELDS;
  if(!/^[a-f0-9]{128}$/i.test(data.vnp_SecureHash||'')||!timingSafeEqual(Buffer.from(data.vnp_SecureHash,'hex'),Buffer.from(hash(fields,data,config.secret),'hex')))throw new RefundProviderError('REFUND_RESPONSE_INVALID');
  if(data.vnp_TmnCode!==config.tmnCode || data.vnp_Command!==command || data.vnp_TxnRef!==String(order._id) || data.vnp_Amount!==String(order.amount*100) || !/^[a-zA-Z0-9]{1,32}$/.test(data.vnp_ResponseId||'') || !/^\d{2}$/.test(data.vnp_ResponseCode||''))throw new RefundProviderError('REFUND_RESPONSE_MISMATCH');
  return {responseId:data.vnp_ResponseId,responseCode:data.vnp_ResponseCode,transactionStatus:data.vnp_TransactionStatus,transactionType:data.vnp_TransactionType,transactionNo:data.vnp_TransactionNo,payDate:data.vnp_PayDate};
}
export async function callRefundGateway(order:any,command:'querydr'|'refund',requestId=randomUUID().replaceAll('-',''),createdAt=new Date(),actorId?:string){
  const {data,config}=buildRefundRequest(order,command,requestId,createdAt,actorId);
  try{
    const response=await fetch(config.endpoint,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new RefundProviderError('REFUND_PROVIDER_UNKNOWN');
    const chunks:Buffer[]=[];let size=0;for await(const bytes of response.body as any){size+=bytes.length;if(size>16000)throw new RefundProviderError('REFUND_RESPONSE_INVALID');chunks.push(Buffer.from(bytes));}
    return verifyRefundResponse(JSON.parse(Buffer.concat(chunks).toString('utf8')),order,command,config);
  }catch(error){if(error instanceof RefundProviderError)throw error;throw new RefundProviderError('REFUND_PROVIDER_UNKNOWN');}
}

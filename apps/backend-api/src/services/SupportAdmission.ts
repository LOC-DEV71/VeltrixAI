import mongoose,{Schema} from 'mongoose';
import {randomUUID,createHash} from 'node:crypto';
const rateSchema=new Schema({key:{type:String,required:true,unique:true},count:Number,expiresAt:Date},{collection:'support_rates'});rateSchema.index({expiresAt:1},{expireAfterSeconds:0});
const leaseSchema=new Schema({key:{type:String,required:true,unique:true},token:String,expiresAt:Date},{collection:'support_inference_leases'});leaseSchema.index({expiresAt:1},{expireAfterSeconds:0});
const replySchema=new Schema({key:{type:String,required:true,unique:true},fingerprint:String,data:Schema.Types.Mixed,expiresAt:Date},{collection:'support_replies'});replySchema.index({expiresAt:1},{expireAfterSeconds:0});
export const SupportRate=mongoose.models.SupportRate||mongoose.model('SupportRate',rateSchema);
export const SupportLease=mongoose.models.SupportLease||mongoose.model('SupportLease',leaseSchema);
export const SupportReply=mongoose.models.SupportReply||mongoose.model('SupportReply',replySchema);
let indexes:Promise<unknown>|undefined;
export class SupportAdmissionError extends Error{constructor(public code:string,public status=429){super(code);}}
async function ready(){if(mongoose.connection.readyState!==1)throw new SupportAdmissionError('SUPPORT_AI_UNAVAILABLE',503);return indexes ||= Promise.all([SupportRate,SupportLease,SupportReply].map(model=>model.createIndexes())).catch(error=>{indexes=undefined;throw error;});}
async function rate(principal:string,action:string,max:number){const now=Date.now(),key=createHash('sha256').update(principal+':'+action+':'+Math.floor(now/60000)).digest('hex');try{await SupportRate.findOneAndUpdate({key,count:{$lt:max}},{$inc:{count:1},$setOnInsert:{expiresAt:new Date(now+120000)}},{upsert:true,new:true});}catch(error:any){if(error.code!==11000)throw error;const retry=await SupportRate.findOneAndUpdate({key,count:{$lt:max}},{$inc:{count:1}},{new:true});if(!retry)throw new SupportAdmissionError('SUPPORT_RATE_LIMITED');}}
export async function supportRequestRate(ownerId:string,ipKey:string){await ready();await rate(ownerId,'request',20);await rate(ipKey,'request-ip',40);}
export async function getSharedSupportReply(key:string){return SupportReply.findOne({key,expiresAt:{$gt:new Date()}}).select('fingerprint data').lean();}
export async function cacheSharedSupportReply(key:string,fingerprint:string,data:unknown){await SupportReply.updateOne({key},{$setOnInsert:{fingerprint,data,expiresAt:new Date(Date.now()+120000)}},{upsert:true});}
export async function acquireSupportAdmission(ownerId:string,ipKey:string){
 await ready();await rate(ownerId,'inference',6);await rate(ipKey,'inference-ip',6);
 const token=randomUUID();try{await SupportLease.findOneAndUpdate({key:'support-global',expiresAt:{$lte:new Date()}},{$set:{token,expiresAt:new Date(Date.now()+110000)}},{upsert:true,new:true});return token;}catch(error:any){if(error.code===11000)throw new SupportAdmissionError('SUPPORT_AI_BUSY');throw error;}
}
export async function releaseSupportAdmission(token:string){await SupportLease.deleteOne({key:'support-global',token});}

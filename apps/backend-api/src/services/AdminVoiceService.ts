import mongoose from 'mongoose';
import { Voice } from '../models/Voice';
import { VoiceEnrollment } from '../models/VoiceEnrollment';
import { Job } from '../models/Job';
import { Plan } from '../models/Plan';
import { AdminAuditLog } from '../models/AdminAuditLog';
export class AdminVoiceError extends Error { constructor(public code:string,public status=400){super(code);} }
export function adminVoiceView(v:any){return {id:String(v._id),name:v.name,avatarUrl:v.avatarUrl||null,tags:v.tags||[],position:v.position||1000,language:v.language,gender:v.gender,status:v.status,isSystem:v.isSystem,isDefault:v.isDefault,planEntitlements:v.planEntitlements,version:v.usageVersion||0,ownerId:v.ownerId?String(v.ownerId):null,createdAt:v.createdAt,updatedAt:v.updatedAt,previewUrl:v.isSystem&&v.preview?`/api/admin/voices/${v._id}/preview`:null,previewDuration:v.preview?.duration||null,previewText:v.preview?.text||null};}
export async function updateAdminVoice(id:string,body:any,actor:mongoose.Types.ObjectId,asset?:{url:string;publicId:string}){
 if(!mongoose.isObjectIdOrHexString(id))throw new AdminVoiceError('INVALID_ID');
 if(!Number.isSafeInteger(body.expectedVersion)||body.expectedVersion<0||typeof body.reason!=='string'||body.reason.trim().length<5||body.reason.length>1000)throw new AdminVoiceError('INVALID_INPUT');
 const allowed=['name','avatarUrl','tags','position','gender','planEntitlements','status','isDefault','expectedVersion','reason','confirmed'];
 if(Object.keys(body).some(k=>!allowed.includes(k)))throw new AdminVoiceError('INVALID_INPUT');
 const session=await mongoose.startSession();
 try{return await session.withTransaction(async()=>{
  const voice=await Voice.findById(id).select("+clonedReference").session(session);if(!voice)throw new AdminVoiceError('NOT_FOUND',404);
  if((voice.usageVersion||0)!==body.expectedVersion)throw new AdminVoiceError('VOICE_VERSION_CONFLICT',409);
  if(voice.status==='DELETED'||voice.status==='PENDING')throw new AdminVoiceError('VOICE_NOT_EDITABLE',409);
  const before=adminVoiceView(voice);
  if(body.name!==undefined){if(typeof body.name!=='string'||!body.name.trim()||body.name.length>100)throw new AdminVoiceError('INVALID_INPUT');voice.name=body.name.trim();}
  if(body.avatarUrl!==undefined){if(typeof body.avatarUrl!=='string'||body.avatarUrl.length>2048||body.avatarUrl && !/^https:\/\/[^\s]+$|^\/voice-avatars\/[\w-]+\.svg$/.test(body.avatarUrl))throw new AdminVoiceError('INVALID_INPUT');voice.avatarUrl=body.avatarUrl;}
  if(body.position!==undefined){if(!Number.isSafeInteger(body.position)||body.position<1||body.position>100000)throw new AdminVoiceError('INVALID_VOICE_POSITION');voice.position=body.position;}
  if(body.gender!==undefined){if(!['male','female','unknown'].includes(body.gender))throw new AdminVoiceError('INVALID_INPUT');voice.gender=body.gender;}
  if(body.tags!==undefined){if(!Array.isArray(body.tags)||body.tags.length>20||body.tags.some((t:any)=>typeof t!=='string'||!t.trim()||t.trim().length>40))throw new AdminVoiceError('INVALID_VOICE_TAGS');voice.tags=[...new Set<string>(body.tags.map((t:string)=>t.trim().normalize('NFC')))];}
  if(asset){voice.avatarUrl=asset.url;voice.avatarPublicId=asset.publicId;}else if(body.avatarUrl!==undefined){voice.set('avatarPublicId',undefined);}
  let restrictive=false;
  if(body.planEntitlements!==undefined){if(!voice.isSystem||!Array.isArray(body.planEntitlements)||!body.planEntitlements.length||body.planEntitlements.some((x:any)=>typeof x!=='string'))throw new AdminVoiceError('INVALID_INPUT');const tiers=await Plan.distinct('tier').session(session);if(body.planEntitlements.some((v:string)=>v!=='*'&&!tiers.includes(v)))throw new AdminVoiceError('INVALID_INPUT');restrictive=voice.planEntitlements.includes('*')&&!body.planEntitlements.includes('*')||voice.planEntitlements.some(v=>!body.planEntitlements.includes(v)&&!body.planEntitlements.includes('*'));voice.planEntitlements=[...new Set<string>(body.planEntitlements)];}
  if(body.status==='ACTIVE'&&voice.isSystem&&voice.providerVoiceId.startsWith('clone:')&&!voice.clonedReference)throw new AdminVoiceError('VOICE_NOT_EDITABLE',409);
  if(body.status!==undefined){if(!['ACTIVE','REVOKED'].includes(body.status)||!voice.isSystem&&body.status==='ACTIVE'&&voice.status!=='ACTIVE')throw new AdminVoiceError('VOICE_NOT_EDITABLE',409);restrictive ||= voice.status==='ACTIVE'&&body.status==='REVOKED';voice.status=body.status;}
  if(body.isDefault!==undefined){if(typeof body.isDefault!=='boolean'||!voice.isSystem)throw new AdminVoiceError('INVALID_INPUT');if(voice.isDefault&&!body.isDefault)throw new AdminVoiceError('VOICE_DEFAULT_REQUIRED',409);voice.isDefault=body.isDefault;}
  if(voice.isDefault&&(voice.status!=='ACTIVE'||!voice.planEntitlements.includes('*')))throw new AdminVoiceError('VOICE_DEFAULT_REQUIRED',409);
  if(restrictive&&body.confirmed!==true)throw new AdminVoiceError('VOICE_CONFIRMATION_REQUIRED',409);
  if(voice.isDefault&&!before.isDefault)await Voice.updateMany({_id:{$ne:voice._id},isSystem:true,isDefault:true},{$set:{isDefault:false},$inc:{usageVersion:1}},{session});
  voice.usageVersion=(voice.usageVersion||0)+1;await voice.save({session});
  if(!voice.isSystem&&voice.status==='REVOKED'&&before.status!=='REVOKED'){
   if(voice.enrollmentId){await VoiceEnrollment.updateOne({_id:voice.enrollmentId,voiceId:voice._id},{$set:{status:'REVOKED',cleanupPending:true,cleanupAttempts:0}},{session});await Job.updateMany({type:'VOICE_ENROLLMENT','payload.voiceId':voice._id,status:{$in:['QUEUED','PROCESSING']}},{$set:{status:'CANCELLED'},$unset:{leaseExpiresAt:1}},{session});}
   await Voice.updateOne({_id:voice._id},{$unset:{clonedReference:1}},{session});
  }
  const after=adminVoiceView(voice);await AdminAuditLog.create([{adminId:actor,action:'UPDATE_VOICE',resource:'Voice',resourceId:id,changes:{before,after,reason:body.reason.trim()}}],{session});return after;
 });}finally{await session.endSession();}
}

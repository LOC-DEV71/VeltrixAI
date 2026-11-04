import mongoose from 'mongoose';
import sharp from 'sharp';
import {mkdir,readFile,writeFile,unlink} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {AI_LIMITS,AiProviderError} from '../providers/AiProvider';
import {AiImageAsset} from '../models/AiImageAsset';
import {Content} from '../models/Content';
import {Project} from '../models/Project';
import {Workspace} from '../models/Workspace';
import {forOwner,enabled} from './EntitlementService';
// Private local storage: images never become public URLs or arbitrary paths.
export const imageDirectory=resolve(__dirname,'../../../../services/ai/.runtime/image-assets');
const fail=(code='CONTENT_IMAGE_INVALID',status=400)=>new AiProviderError(code,status);
export async function ownedContent(ownerId:mongoose.Types.ObjectId,contentId:unknown){
 if(typeof contentId!=='string'||!mongoose.isObjectIdOrHexString(contentId))throw fail('INVALID_INPUT');
 const content=await Content.findById(contentId),project=content&&await Project.findById(content.projectId);
 if(!content||!project||!await Workspace.exists({_id:project.workspaceId,ownerId}))throw fail('NOT_FOUND',404);
 return content;
}
export async function normalizeAiImage(base64:unknown,maxDimension:768|1536=768){
 if(maxDimension!==768&&maxDimension!==1536)throw fail();
 if(typeof base64!=='string'||!base64||base64.length>Math.ceil(AI_LIMITS.imageBytes/3)*4||base64.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(base64))throw fail();
 const bytes=Buffer.from(base64,'base64');if(bytes.length>AI_LIMITS.imageBytes)throw fail('CONTENT_IMAGE_TOO_LARGE');
 try{
  const decoder=sharp(bytes,{failOn:'error',limitInputPixels:AI_LIMITS.imagePixels});
  const metadata=await decoder.metadata();
  if(!['png','jpeg','webp'].includes(metadata.format||'')||!metadata.width||!metadata.height||metadata.width>4096||metadata.height>4096||(metadata.pages||1)!==1)throw fail();
  let result=await decoder.rotate().resize({width:maxDimension,height:maxDimension,fit:'inside',withoutEnlargement:true}).removeAlpha().png().toBuffer({resolveWithObject:true});
  // Keep the byte bound even for a noisy JPEG that expands when normalized to PNG.
  if(result.data.length>AI_LIMITS.imageBytes&&maxDimension>768)result=await sharp(bytes,{failOn:'error',limitInputPixels:AI_LIMITS.imagePixels}).rotate().resize({width:768,height:768,fit:'inside',withoutEnlargement:true}).removeAlpha().png().toBuffer({resolveWithObject:true});
  if(result.data.length>AI_LIMITS.imageBytes)throw fail('CONTENT_IMAGE_TOO_LARGE');
  return {bytes:result.data,width:result.info.width,height:result.info.height,sha256:createHash('sha256').update(result.data).digest('hex')};
 }catch(error){if(error instanceof AiProviderError)throw error;throw fail();}
}
export async function saveAiImage(ownerId:mongoose.Types.ObjectId,contentId:string,base64:unknown){
 await ownedContent(ownerId,contentId);const snapshot=await forOwner(ownerId);enabled(snapshot.config.content.enabled,'CONTENT_FEATURE_DISABLED');
 // Bounded durable storage even when the plan has unlimited text quotas.
 if(await AiImageAsset.countDocuments({ownerId})>=10)throw fail('CONTENT_IMAGE_STORAGE_LIMIT',403);
 const image=await normalizeAiImage(base64),id=new mongoose.Types.ObjectId();
 await mkdir(imageDirectory,{recursive:true});const file=join(imageDirectory,id+'.png');
 await writeFile(file,image.bytes,{flag:'wx',mode:0o600});
 try{
  const session=await mongoose.startSession();
  try{await session.withTransaction(async()=>{
   const {PlanUsage}=await import('../models/Plan');
   await PlanUsage.findOneAndUpdate({ownerId,period:'ai-image-storage'},{$inc:{fence:1},$setOnInsert:{counts:{}}},{upsert:true,session});
   if(await AiImageAsset.countDocuments({ownerId}).session(session)>=10)throw fail('CONTENT_IMAGE_STORAGE_LIMIT',403);
   await AiImageAsset.create([{_id:id,ownerId,contentId,bytes:image.bytes.length,width:image.width,height:image.height,sha256:image.sha256}],{session});
  });}finally{await session.endSession();}
  return {id:String(id),width:image.width,height:image.height,bytes:image.bytes.length};
 }catch(error){await unlink(file).catch(()=>{});throw error;}
}
export async function validateImageIds(ownerId:mongoose.Types.ObjectId,contentId:mongoose.Types.ObjectId,input:unknown,session?:mongoose.ClientSession){
 if(input===undefined)return [] as string[];
 if(!Array.isArray(input)||input.length>AI_LIMITS.imageCount||input.some(id=>typeof id!=='string'||!mongoose.isObjectIdOrHexString(id))||new Set(input).size!==input.length)throw fail();
 const count=await AiImageAsset.countDocuments({_id:{$in:input},ownerId,contentId}).session(session||null);
 if(count!==input.length)throw fail('CONTENT_IMAGE_NOT_FOUND',404);
 return input as string[];
}
export async function loadAiImages(ownerId:mongoose.Types.ObjectId,contentId:mongoose.Types.ObjectId,input:unknown){
 const ids=await validateImageIds(ownerId,contentId,input);
 return await Promise.all(ids.map(async id=>{
  const asset=await AiImageAsset.findOne({_id:id,ownerId,contentId});if(!asset)throw fail('CONTENT_IMAGE_NOT_FOUND',404);
  let bytes:Buffer;try{bytes=await readFile(join(imageDirectory,id+'.png'));}catch{throw fail('CONTENT_IMAGE_NOT_FOUND',404);}
  if(bytes.length!==asset.bytes||bytes.length>AI_LIMITS.imageBytes||createHash('sha256').update(bytes).digest('hex')!==asset.sha256)throw fail();
  return {bytes,mime:'image/png' as const};
 }));
}
export async function deleteAiImage(ownerId:mongoose.Types.ObjectId,contentId:string,id:unknown){
 await ownedContent(ownerId,contentId);if(typeof id!=='string'||!mongoose.isObjectIdOrHexString(id))throw fail();
 if(await (await import('../models/Job')).Job.exists({ownerId,'payload.imageAssetIds':id,status:{$in:['QUEUED','PROCESSING']}}))throw fail('CONTENT_BUSY',409);
 const asset=await AiImageAsset.findOneAndDelete({_id:id,ownerId,contentId});if(!asset)throw fail('CONTENT_IMAGE_NOT_FOUND',404);
 await unlink(join(imageDirectory,id+'.png')).catch(()=>{});
}

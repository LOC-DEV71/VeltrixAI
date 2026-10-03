import {randomUUID} from 'node:crypto';
import {getCloudinaryConfiguration,signCloudinaryParameters} from './CloudinaryAudioProvider';
import {readLimitedResponse} from './AudioValidation';
export class ImageUploadError extends Error {constructor(public code:string,public status=400){super(code);}}
export const MAX_AVATAR_BYTES=5*1024*1024;
export function decodeAvatarImage(base64:unknown){
 if(typeof base64!=='string'||base64.length>Math.ceil(MAX_AVATAR_BYTES/3)*4)throw new ImageUploadError('AVATAR_TOO_LARGE');
 if(!base64||base64.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(base64))throw new ImageUploadError('INVALID_AVATAR_IMAGE');
 const bytes=Buffer.from(base64,'base64');if(bytes.length>MAX_AVATAR_BYTES)throw new ImageUploadError('AVATAR_TOO_LARGE');
 const png=bytes.length>=24&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.toString('ascii',12,16)==='IHDR';
 const jpeg=bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 const webp=bytes.length>=16&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
 if(!png&&!jpeg&&!webp)throw new ImageUploadError('INVALID_AVATAR_IMAGE');
 return {bytes,mime:png?'image/png':jpeg?'image/jpeg':'image/webp'};
}
export function avatarPublicId(voiceId:string){return `veltrixai/voice-avatars/${voiceId}/${randomUUID()}`;}
export class CloudinaryImageProvider {
 private config:ReturnType<typeof getCloudinaryConfiguration>;
 constructor(){try{this.config=getCloudinaryConfiguration();}catch{throw new ImageUploadError('AVATAR_STORAGE_UNAVAILABLE',503);}}
 async upload(bytes:Buffer,mime:string,publicId:string){
  const parameters={public_id:publicId,overwrite:'false',format:'webp',transformation:'c_limit,w_512,h_512',timestamp:Math.floor(Date.now()/1000)};
  const form=new FormData();for(const [key,value] of Object.entries({...parameters,api_key:this.config.key,signature:signCloudinaryParameters(parameters,this.config.secret)}))form.set(key,String(value));
  form.set('file',new Blob([new Uint8Array(bytes)],{type:mime}),'avatar');
  try{const response=await fetch(`https://api.cloudinary.com/v1_1/${this.config.cloud}/image/upload`,{method:'POST',body:form,redirect:'error',signal:AbortSignal.timeout(30000)});if(!response.ok){await response.body?.cancel();throw new ImageUploadError('AVATAR_UPLOAD_FAILED',503);}const result=JSON.parse((await readLimitedResponse(response,128*1024)).toString('utf8'));const url=new URL(result.secure_url);if(result.public_id!==publicId||result.resource_type!=='image'||result.format!=='webp'||url.protocol!=='https:'||url.hostname!=='res.cloudinary.com'||!url.pathname.includes('/'+publicId+'.webp'))throw new ImageUploadError('AVATAR_UPLOAD_FAILED',503);return {url:url.href,publicId};}catch(e){throw e instanceof ImageUploadError?e:new ImageUploadError('AVATAR_UPLOAD_FAILED',503);}
 }
 async destroy(publicId:string){if(!publicId.startsWith('veltrixai/voice-avatars/'))throw new ImageUploadError('INVALID_AVATAR_IMAGE');const parameters={public_id:publicId,invalidate:'true',timestamp:Math.floor(Date.now()/1000)};const response=await fetch(`https://api.cloudinary.com/v1_1/${this.config.cloud}/image/destroy`,{method:'POST',body:new URLSearchParams(Object.fromEntries(Object.entries({...parameters,api_key:this.config.key,signature:signCloudinaryParameters(parameters,this.config.secret)}).map(([k,v])=>[k,String(v)]))),signal:AbortSignal.timeout(10000)});if(!response.ok)throw new ImageUploadError('AVATAR_CLEANUP_FAILED',503);}
}

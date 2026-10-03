import mongoose from 'mongoose';
import {Voice} from '../models/Voice';
import {updateAdminVoice,AdminVoiceError} from './AdminVoiceService';
import {CloudinaryImageProvider,decodeAvatarImage,avatarPublicId} from '../providers/CloudinaryImageProvider';
export async function updateVoiceWithAvatar(id:string,body:any,actor:mongoose.Types.ObjectId,provider?:Pick<CloudinaryImageProvider,'upload'|'destroy'>){
 const {avatarUpload,...changes}=body;
 if(avatarUpload===undefined)return updateAdminVoice(id,changes,actor);
 if(!avatarUpload||typeof avatarUpload!=='object'||Array.isArray(avatarUpload)||Object.keys(avatarUpload).some(k=>k!=='base64'))throw new AdminVoiceError('INVALID_AVATAR_IMAGE');
 if(!mongoose.isObjectIdOrHexString(id))throw new AdminVoiceError('INVALID_ID');
 const voice=await Voice.findById(id);if(!voice)throw new AdminVoiceError('NOT_FOUND',404);
 if((voice.usageVersion||0)!==changes.expectedVersion)throw new AdminVoiceError('VOICE_VERSION_CONFLICT',409);
 if(['DELETED','PENDING'].includes(voice.status))throw new AdminVoiceError('VOICE_NOT_EDITABLE',409);
 const {bytes,mime}=decodeAvatarImage(avatarUpload.base64),publicId=avatarPublicId(id);const cloud=provider||new CloudinaryImageProvider();
 try{const asset=await cloud.upload(bytes,mime,publicId);return await updateAdminVoice(id,changes,actor,asset);}catch(error){
  // Never delete an asset attached by a commit whose acknowledgement was lost.
  const attached=await Voice.exists({_id:id,avatarPublicId:publicId}).catch(()=>true);
  if(!attached)await cloud.destroy(publicId).catch(()=>{});throw error;
 }
}

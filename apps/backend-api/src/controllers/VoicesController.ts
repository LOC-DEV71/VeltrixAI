import { forOwner } from '../services/EntitlementService';
import { Request, Response } from 'express';
import { Voice } from '../models/Voice';
import mongoose from 'mongoose';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { voiceAllowed } from '../services/VoiceService';
import { inspectWave } from '../providers/AudioValidation';
import { CloudinaryAudioProvider, getCloudinaryConfiguration } from '../providers/CloudinaryAudioProvider';
import { getCachedAudio } from '../services/AudioCache';
export async function readSystemVoicePreview(voice:any) {
  if(!voice.isSystem||!voice.preview||!/^[a-f0-9]{64}\.wav$/.test(voice.preview.fileName))throw new Error('INVALID_PREVIEW');
  if(voice.preview.publicId){
    if(!/^veltrixai\/voice-previews\/[a-f0-9]{24}\/[a-f0-9]{24}$/.test(voice.preview.publicId))throw new Error('INVALID_PREVIEW');
    return getCachedAudio(voice.preview.sha256,async()=>(await new CloudinaryAudioProvider(getCloudinaryConfiguration()).download(voice.preview.publicId)).audio);
  }
  const audio=await readFile(resolve(__dirname,'../../../../services/tts/preview-audio',voice.preview.fileName));inspectWave(audio);
  if(createHash('sha256').update(audio).digest('hex')!==voice.preview.sha256)throw new Error('INVALID_PREVIEW');return audio;
}

export const getVoices = async (req: Request, res: Response) => {
  try {
    const snapshot=await forOwner((req as any).user._id);
    const plan=snapshot.tier;
    const params=req.query||{};const page=Number(params.page||1),limit=10;if(!Number.isSafeInteger(page)||page<1||page>10000)return res.status(400).json({success:false,error:{code:'INVALID_PAGINATION'}});
    const filter:any={status:'ACTIVE',...(params.type==='SYSTEM'?{isSystem:true}:{$or:[{isSystem:true},...(snapshot.config.clone.enabled?[{isSystem:false,ownerId:(req as any).user._id}]:[])]})};
    if(params.ids!==undefined){const ids=typeof params.ids==='string'?params.ids.split(','):[];if(!ids.length||ids.length>10||ids.some(id=>!mongoose.isObjectIdOrHexString(id)))return res.status(400).json({success:false,error:{code:'INVALID_INPUT'}});filter._id={$in:ids};}
    const [rows,total]=await Promise.all([Voice.find(filter).sort({isSystem:-1,position:1,isDefault:-1,name:1,_id:1}).skip((page-1)*limit).limit(limit),Voice.countDocuments(filter)]);
    const voices=rows.filter(v=>v.isSystem),clones=rows.filter(v=>!v.isSystem);
    return res.json({ success: true, data: {
      page,limit,total,systemVoices: voices.map(voice => ({
        id: voice._id, name: voice.name, language: voice.language, isSystem: true,
        canUse: snapshot.config.tts.enabled && voiceAllowed(voice,plan) && (voice.planEntitlements.includes('*') || voice.planEntitlements.includes('FREE') || snapshot.config.clone.premiumSystemVoices),
        avatarUrl: voice.avatarUrl || null,
        position: voice.position || 1000,
        locale: voice.language, gender: voice.gender, planEntitlements: voice.planEntitlements,
        status: voice.status, isDefault: voice.isDefault,
        isFree: voice.planEntitlements.includes('*') || voice.planEntitlements.includes('FREE'),
        tags: voice.tags || [],
        previewUrl: voice.preview ? `/api/voices/${voice._id}/preview` : null,
        previewText: voice.preview?.text || null,
        previewDuration: voice.preview?.duration || null,
      })), cloneVoices: clones.map(voice => ({ id: voice._id, name: voice.name, canUse: snapshot.config.tts.enabled && snapshot.config.clone.enabled, tags:voice.tags||[], avatarUrl: voice.avatarUrl || null, language: voice.language, locale: voice.language, gender: voice.gender, isSystem: false, isDefault: false, status: voice.status, enrollmentId: voice.enrollmentId, isFree: false })),
    } });
  } catch {
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: 'Unable to load voices' } });
  }
};

export const getVoicePreview = async (req: Request, res: Response) => {
  try {
    if (typeof req.params.id !== 'string' || !mongoose.isObjectIdOrHexString(req.params.id)) return res.status(400).json({ success: false, error: { code: 'INVALID_INPUT' } });
    const voice = await Voice.findById(req.params.id);
    if (!voice || !voice.isSystem || voice.status !== 'ACTIVE' || !voice.preview) return res.status(404).json({ success: false, error: { code: 'PREVIEW_NOT_FOUND' } });
    const audio = await readSystemVoicePreview(voice);
    res.set({ 'Content-Type': 'audio/wav', 'Content-Length': String(audio.length), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    return res.send(audio);
  } catch { return res.status(503).json({ success: false, error: { code: 'PREVIEW_UNAVAILABLE' } }); }
};

export const getVoiceCatalogue = async (req: Request, res: Response) => {
  try {
    const params=req.query||{};const page=Number(params.page||1),limit=10;if(!Number.isSafeInteger(page)||page<1||page>10000)return res.status(400).json({success:false,error:{code:'INVALID_PAGINATION'}});const filter={isSystem:true,status:'ACTIVE'};const [voices,total]=await Promise.all([Voice.find(filter).sort({position:1,isDefault:-1,name:1,_id:1}).skip((page-1)*limit).limit(limit),Voice.countDocuments(filter)]);
    return res.json({success:true,data:{page,limit,total,systemVoices:voices.map(voice=>({id:voice._id,name:voice.name,language:voice.language,gender:voice.gender,avatarUrl:voice.avatarUrl||null,tags:voice.tags||[],position:voice.position,isSystem:true,previewUrl:voice.preview ? '/api/voices/'+voice._id+'/preview' : null,previewText:voice.preview?.text||null,previewDuration:voice.preview?.duration||null}))}});
  } catch { return res.status(503).json({success:false,error:{code:'VOICE_CATALOGUE_UNAVAILABLE'}}); }
};

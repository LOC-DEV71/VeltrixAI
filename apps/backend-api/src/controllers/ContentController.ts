import {ContentRevision} from '../models/Plan';
import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {createHash} from 'node:crypto';
import mongoose from 'mongoose';
import { Content } from '../models/Content';
import { Project } from '../models/Project';
import { Workspace } from '../models/Workspace';
import { Job } from '../models/Job';
import { CreditService } from '../services/CreditService';
import { contentQueue } from '../workers/queue';
import { Scene } from '../models/Scene';
import { MediaAsset } from '../models/MediaAsset';
import { estimateNarrationSeconds } from '../utils/narrationTiming';
import { buildVideoSegments } from '../utils/videoSegments';
import { toSceneResponse } from '../utils/sceneResponse';
import { extractGenerationSettings } from '../utils/generationSettings';
import { ContentInputError, getContentCapabilities, resolveContentOptions } from '../services/ContentCapabilities';

import { forOwner, validateRequest, reserveUsage, characters, reserveStorage, limit, reconcileUsage } from '../services/EntitlementService';
import { PlanError } from '../services/PlanService';
import { AiProviderError, getAiConfiguration } from '../providers/AiProvider';
import { reserveAiQueueSlot } from '../services/AiAdmission';
import { validateImageIds } from '../services/AiImageAssets';
async function sceneDurations(scenes: any[], ownerId: mongoose.Types.ObjectId, language?: string) {
  const ids=scenes.flatMap(s=>s.ttsAudioId?[s.ttsAudioId]:[]);
  const assets=ids.length?await MediaAsset.find({_id:{$in:ids},ownerId}).select('_id duration').lean():[];
  return scenes.map(s=>{const estimatedDuration=estimateNarrationSeconds(s.narration,language&&language!=='vi-VN'?2.5:4);return {...(typeof s.toJSON === 'function'?s.toJSON():s),estimatedDuration,videoSegments:buildVideoSegments(s.narration,estimatedDuration,s.videoPrompt||'',s.videoSegments),audioDuration:assets.find(a=>String(a._id)===String(s.ttsAudioId))?.duration??null};});
}
export const getGenerationConfig = async (req: Request, res: Response) => { try { return res.json({success:true,data:((({maxTokens,...publicConfig})=>publicConfig)(getContentCapabilities(await forOwner((req as any).user._id))))}); } catch(error) { const code=error instanceof PlanError ? error.code : 'PLAN_CONFIGURATION_UNAVAILABLE'; return res.status(error instanceof PlanError ? error.status : 503).json({success:false,error:{code}}); } };

// Helper to check if user has access to project
const hasProjectAccess = async (projectId: string, userId: string) => {
  const project = await Project.findById(projectId);
  if (!project) return false;
  const workspace = await Workspace.findById(project.workspaceId);
  if (!workspace || workspace.ownerId.toString() !== userId.toString()) return false;
  return true;
};

export const createContent = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user._id;
    const { projectId, rawText, metadata } = req.body;

    if (!projectId) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: 'projectId is required' } });
    }

    const hasAccess = await hasProjectAccess(projectId, userId);
    if (!hasAccess) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'No access to this project' } });
    }

    // Check if content already exists for this project
    const existing = await Content.findOne({ projectId });
    if (existing) {
      return res.status(400).json({ success: false, error: { code: 'CONTENT_EXISTS', message: 'Content already exists for this project' } });
    }

    const session=await mongoose.startSession();let content:any;
    try{await session.withTransaction(async()=>{const policy=await forOwner(userId,session);await reserveStorage(userId,policy,'contents',session);limit(characters(rawText || ''),policy.config.content.maxInputChars,'CONTENT_INPUT_LIMIT_EXCEEDED');[content]=await Content.create([{projectId,rawText:rawText || '',metadata:metadata || {}}],{session});});}finally{await session.endSession();}
    res.status(201).json({ success: true, data: content });
  } catch (error: any) {
    if(error instanceof PlanError)return res.status(error.status).json({success:false,error:{code:error.code}});
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: error.message } });
  }
};

export const getContent = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user._id;
    const { id } = req.params;

    const content = await Content.findById(id);
    if (!content) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Content not found' } });
    }

    const hasAccess = await hasProjectAccess(content.projectId.toString(), userId);
    if (!hasAccess) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'No access to this content' } });
    }

    const scenes = await Scene.find({ projectId: content.projectId }).sort({ order: 1 });

    let generationSettings = extractGenerationSettings(content.generationSettings);
    if (!generationSettings) {
      // Restore existing scripts without a destructive migration or writes on GET.
      const previousJob = await Job.findOne({
        ownerId: userId, type: 'AI_CONTENT', status: 'COMPLETED',
        'payload.contentId': { $in: [content._id, String(content._id)] },
      }).sort({ createdAt: -1, _id: -1 }).select('payload');
      generationSettings = extractGenerationSettings(previousJob?.payload);
    }
    res.json({ success: true, data: { ...content.toJSON(), generationSettings: generationSettings ?? null, scenes:await sceneDurations(scenes,(req as any).user._id,generationSettings?.language) } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: error.message } });
  }
};

export const getContents = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user._id;
    const { projectId } = req.query;
    
    if (projectId !== undefined) {
      if (typeof projectId !== 'string' || !mongoose.isObjectIdOrHexString(projectId)) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: 'Invalid projectId' } });
      }
      const hasAccess = await hasProjectAccess(projectId, userId);
      if (!hasAccess) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'No access to this project' } });
      }
      const contents = await Content.find({ projectId });
      return res.json({ success: true, data: contents });
    }
    
    res.json({ success: true, data: [] });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: error.message } });
  }
};

export const getContentScenes = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (typeof id !== 'string' || !mongoose.isObjectIdOrHexString(id)) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: 'Invalid content id' } });
    }
    const content = await Content.findById(id);
    if (!content) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Content not found' } });
    }
    if (!await hasProjectAccess(content.projectId.toString(), (req as any).user._id)) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'No access to this content' } });
    }
    const scenes = await Scene.find({ projectId: content.projectId }).sort({ order: 1 });
    const timed=await sceneDurations(scenes,(req as any).user._id,content.generationSettings?.language);
    return res.json({ success: true, data: { scenes: timed.map(toSceneResponse) } });
  } catch {
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: 'Unable to load scenes' } });
  }
};

export const updateContent = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user._id;
    const { id } = req.params;
    const { rawText, metadata } = req.body;

    const content = await Content.findById(id);
    if (!content) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Content not found' } });
    }

    const hasAccess = await hasProjectAccess(content.projectId.toString(), userId);
    if (!hasAccess) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'No access to this content' } });
    }

    const session=await mongoose.startSession();
    try{await session.withTransaction(async()=>{const policy=await forOwner(userId,session);const current=await Content.findById(content._id).session(session);if(!current)throw new PlanError('NOT_FOUND',404);if(rawText!==undefined){if(typeof rawText!=='string')throw new PlanError('INVALID_INPUT');limit(characters(rawText),policy.config.content.maxOutputChars,'CONTENT_INPUT_LIMIT_EXCEEDED');if(current.revision>0)await ContentRevision.create([{contentId:current._id,revision:current.revision,rawText:current.rawText,scenes:await Scene.find({projectId:current.projectId}).session(session)}],{session});current.rawText=rawText;current.revision++;if(policy.config.history.retention!==null){const keep=await ContentRevision.find({contentId:current._id}).sort({revision:-1}).limit(policy.config.history.retention).session(session);await ContentRevision.deleteMany({contentId:current._id,_id:{$nin:keep.map(v=>v._id)}},{session});}}if(metadata!==undefined)current.metadata=metadata;await current.save({session});Object.assign(content,current.toObject());});}finally{await session.endSession();}

    res.json({ success: true, data: content });
  } catch (error: any) {
    if(error instanceof PlanError)return res.status(error.status).json({success:false,error:{code:error.code}});
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: 'Unable to update content' } });
  }
};

export const generateContent = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user._id;
    const { id } = req.params;
    const { platform, audience, tone, topic } = req.body;
    if (typeof topic !== 'string' || !topic.trim() || !['tiktok', 'shorts', 'reels', 'video'].includes(platform) || typeof audience !== 'string' || !['funny', 'pro', 'drama'].includes(tone)) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_CONTENT_INPUT', message: 'Kiểm tra chủ đề, nền tảng, đối tượng người xem và tone giọng.' } });
    }
    const kind=(req as any).aiOperation || 'AI_CONTENT';
    getAiConfiguration();
    const snapshot = await forOwner(userId);
    const options = resolveContentOptions(req.body, snapshot);
    const key=req.get?.('Idempotency-Key');
    if(key!==undefined && !/^[A-Za-z0-9_.-]{8,128}$/.test(key))throw new AiProviderError('INVALID_INPUT',400);
    const idempotencyKey=key?`content:${userId}:${createHash('sha256').update(key).digest('hex')}`:uuidv4();
    const requestHash=createHash('sha256').update(JSON.stringify({kind,id,platform,audience,tone,topic,...Object.fromEntries(['durationSeconds','sceneCount','structure','language','cta','creativeBrief','visualStyle'].map(field=>[field,req.body[field]])),imageAssetIds:req.body.imageAssetIds||[]})).digest('hex');

    const content = await Content.findById(id);
    if (!content) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Content not found' } });
    }

    const hasAccess = await hasProjectAccess(content.projectId.toString(), userId);
    if (!hasAccess) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'No access to this content' } });
    }

    const session = await mongoose.startSession();
    let jobRecord: any;
    try { for(let attempt=0;attempt<3;attempt++){try{await session.withTransaction(async () => {
      const previous=key?await Job.findOne({ownerId:userId,idempotencyKey}).session(session):null;
      if(previous){if(previous.payload.requestHash!==requestHash)throw new AiProviderError('IDEMPOTENCY_CONFLICT',409);jobRecord=previous;return;}
      const pinned = await forOwner(userId,session);
      const aiProvider = await reserveAiQueueSlot(session);
      const imageAssetIds = await validateImageIds(userId,content._id as mongoose.Types.ObjectId,req.body.imageAssetIds,session);
      if(imageAssetIds.length && kind!=='AI_CONTENT')throw new AiProviderError('CONTENT_IMAGE_INVALID',400);
      const confirmedOptions = resolveContentOptions(req.body,pinned);
      const inputText = [topic,audience,tone,confirmedOptions.cta,confirmedOptions.creativeBrief,confirmedOptions.visualStyle].join(' ');
      const language = confirmedOptions.language;
      validateRequest(pinned,kind,{input:inputText,scenes:confirmedOptions.sceneCount || pinned.config.scenes.maxScenes,language,mode:confirmedOptions.structure,regenerate:kind==='AI_CONTENT' && content.revision > 0});
      if(await Job.exists({ownerId:userId,'payload.projectId':content.projectId,status:{$in:['QUEUED','PROCESSING']}}).session(session)) throw new PlanError('CONTENT_BUSY',409);
      const fresh=await Content.findById(content._id).session(session);if(!fresh)throw new PlanError('NOT_FOUND',404);
      const sourceScenes=await Scene.find({projectId:content.projectId}).sort({order:1}).select('_id revision').session(session);
      const promptSources=kind==='AI_PROMPT_GEN'?await Scene.find({projectId:content.projectId}).sort({order:1}).session(session):undefined;
      if(promptSources && !promptSources.length) throw new PlanError('SCENE_LIMIT_EXCEEDED');
      if(promptSources) {limit(promptSources.length,pinned.config.scenes.maxScenes,'SCENE_LIMIT_EXCEEDED');confirmedOptions.sceneCount=promptSources.length;confirmedOptions.minScenes=promptSources.length;confirmedOptions.maxScenes=promptSources.length;}
      const outputBudget = pinned.config.content.maxOutputChars ?? pinned.config.content.monthlyChars ?? null;
      const promptBudget = confirmedOptions.maxScenes * (Number(pinned.config.prompts.imageEnabled)+Number(pinned.config.prompts.videoEnabled));
      const entitlementUsage = await reserveUsage(userId,pinned,kind,{...(kind==='AI_PROMPT_GEN'?{}:{contentJobs:1,contentChars:outputBudget ?? 0}),prompts:promptBudget},session);
      [jobRecord] = await Job.create([{ownerId:userId,type:kind,status:'QUEUED',payload:{requestHash,sourceScenes,imageAssetIds,aiProvider,promptSources,contentId:content._id,projectId:content.projectId,sourceContentRevision:fresh.revision,platform,audience,tone,topic,inputText,language,regenerate:kind==='AI_CONTENT' && content.revision > 0,options:confirmedOptions,entitlementSnapshot:pinned,entitlementUsage,outputBudget,priority:pinned.config.limits.queuePriority,cost:pinned.config.credits.contentCost},idempotencyKey}],{session});
      const reservation = await CreditService.reserveUsable(userId,pinned.config.credits.contentCost,jobRecord._id,pinned.config.credits.paidAllowed,session);
      jobRecord.reservationId=reservation._id; await jobRecord.save({session});
    });break;}catch(error:any){if(error?.code!==11000 || attempt===2)throw error;}} } finally { await session.endSession(); }

    // Push to Queue
    try {
      await contentQueue.add('generate', { jobId: jobRecord._id.toString() }, { jobId: jobRecord._id.toString(), priority: jobRecord.payload.priority });
    } catch {
      const failureSession=await mongoose.startSession();
      try {await failureSession.withTransaction(async()=>{
        const owned=await Job.findById(jobRecord._id).session(failureSession);
        if(!owned||owned.status!=='QUEUED')return;
        await reconcileUsage(owned,{},failureSession);await CreditService.release(owned._id as mongoose.Types.ObjectId,failureSession);
        owned.status='FAILED';owned.error='CONTENT_QUEUE_UNAVAILABLE';await owned.save({session:failureSession});
      });}finally{await failureSession.endSession();}
      return res.status(503).json({ success: false, error: { code: 'CONTENT_QUEUE_UNAVAILABLE', message: 'Chưa gửi được tác vụ. Credit đã được giải phóng.' } });
    }

    res.json({ success: true, data: { jobId: jobRecord._id } });
  } catch (error: any) {
    if (error instanceof AiProviderError) return res.status(error.status).json({success:false,error:{code:error.code}});
    if (error instanceof PlanError) return res.status(error.status).json({success:false,error:{code:error.code}});
    if (error.message === 'INSUFFICIENT_CREDITS' || error.message === 'INSUFFICIENT_CREDITS_IN_LOTS') return res.status(402).json({success:false,error:{code:'INSUFFICIENT_CREDIT'}});
    if (error instanceof ContentInputError) return res.status(error.status).json({ success: false, error: { code: error.code, message: error.message } });
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: error.message } });
  }
};


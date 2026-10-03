import { forOwner, limit, characters } from '../services/EntitlementService';
import { PlanError } from '../services/PlanService';
import { Request, Response } from 'express';
import { createTtsJob, TtsJobError } from '../services/TtsJobService';
import { getTtsConfiguration } from '../providers/TtsProvider';
import { getCloudinaryConfiguration } from '../providers/CloudinaryAudioProvider';
import { AudioError } from '../providers/AudioValidation';
import mongoose from 'mongoose';
import { Job } from '../models/Job';
import { Scene } from '../models/Scene';
import { Project } from '../models/Project';
import { Workspace } from '../models/Workspace';
import { SystemSettings } from '../models/SystemSettings';
import { resolveTtsVoice } from '../services/VoiceService';

export async function createStandaloneAudio(req: Request, res: Response) {
  try {
    getTtsConfiguration(); getCloudinaryConfiguration();
    const key = req.get('Idempotency-Key'); const { text, voiceId } = req.body || {};
    if (typeof text !== 'string' || typeof voiceId !== 'string' || typeof key !== 'string' || req.body.voice !== undefined || req.body.providerVoiceId !== undefined) throw new TtsJobError('INVALID_INPUT', 400);
    const result = await createTtsJob((req as any).user._id, '', voiceId, key, { text });
    if (!result) throw new TtsJobError('JOB_CREATION_FAILED', 500);
    if((req as any).developerToken){res.locals.developerJobId=String(result.job._id);if(!result.reused)await Job.updateOne({_id:result.job._id},{$set:{'payload.developerTokenId':(req as any).developerToken}});}
    return res.status(result.reused ? 200 : 202).json({ success: true, data: { jobId: result.job._id, status: result.job.status, reservedCredits: result.job.payload.cost, reused: result.reused } });
  } catch (error) {
    if (error instanceof PlanError) return res.status(error.status).json({success:false,error:{code:error.code}});
    if (error instanceof TtsJobError) return res.status(error.status).json({ success: false, error: { code: error.code, message: error.code } });
    if (error instanceof AudioError) return res.status(503).json({ success: false, error: { code: error.code, message: 'TTS is unavailable' } });
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Unable to create TTS job' } });
  }
}

export async function getTtsConfig(req: Request, res: Response) {
  try {
    const plan=await forOwner((req as any).user._id);
    const rate=plan.config.credits.ttsPer100Chars;
    let available = true; try { getTtsConfiguration(); getCloudinaryConfiguration(); } catch { available = false; }
    return res.json({ success: true, data: { creditsPer100Chars: rate, maxTextLength: plan.config.tts.maxTextChars, maxNarrationChars:plan.config.scenes.maxNarrationChars, available: available && plan.config.tts.enabled, revision:plan.revision } });
  } catch { return res.status(503).json({ success: false, error: { code: 'TTS_PRICING_NOT_CONFIGURED' } }); }
}

export async function getTtsHistory(req: Request, res: Response) {
  try {
    const ownerId = (req as any).user._id; const projectId = req.query.projectId;
    if (projectId !== undefined) {
      if (typeof projectId !== 'string' || !mongoose.isObjectIdOrHexString(projectId)) throw new TtsJobError('INVALID_INPUT', 400);
      const project = await Project.findById(projectId);
      if (!project || !await Workspace.exists({ _id: project.workspaceId, ownerId })) throw new TtsJobError('NOT_FOUND', 404);
    }
    const page=Number(req.query.page||1),limit=10;if(!Number.isSafeInteger(page)||page<1||page>10000)throw new TtsJobError('INVALID_INPUT',400);
    const filter={ownerId,type:'TTS',...(projectId?{'payload.projectId':{$in:[new mongoose.Types.ObjectId(projectId as string),projectId]}}:{'payload.source':'STANDALONE'})};
    // The scene editor needs the latest job for every scene, rather than an unbounded job history.
    const jobs=projectId?await Job.aggregate([{$match:filter},{$sort:{createdAt:-1,_id:-1}},{$group:{_id:'$payload.sceneId',job:{$first:'$$ROOT'}}},{$replaceRoot:{newRoot:'$job'}}]):await Job.find(filter).sort({createdAt:-1,_id:-1}).skip((page-1)*limit).limit(limit).lean();
    const total=projectId?jobs.length:await Job.countDocuments(filter);
    return res.json({ success: true, data: { page,limit,total,jobs: jobs.map((job:any) => ({
      id: job._id, sceneId: job.payload.sceneId || null, voiceId: job.payload.voiceId, sceneRevision: job.payload.sceneRevision,
      text: job.payload.narration, status: job.status, result: job.result || null,
      failedReason: job.error || null, reservedCredits: job.payload.cost, createdAt: (job as any).createdAt,
    })) } });
  } catch (error) {
    if (error instanceof TtsJobError) return res.status(error.status).json({ success: false, error: { code: error.code } });
    return res.status(500).json({ success: false, error: { code: 'HISTORY_UNAVAILABLE' } });
  }
}

export async function saveSceneVoiceover(req: Request, res: Response) {
  try {
    const { narration, voiceId, revision } = req.body || {}; const id = req.params.id;
    if (typeof id !== 'string' || !mongoose.isObjectIdOrHexString(id) || typeof narration !== 'string' || !narration.trim() || typeof voiceId !== 'string' || !mongoose.isObjectIdOrHexString(voiceId) || !Number.isSafeInteger(revision) || revision < 0) throw new TtsJobError('INVALID_INPUT', 400);
    const scene = await Scene.findById(id); if (!scene) throw new TtsJobError('NOT_FOUND', 404);
    const ownerId = (req as any).user._id;
    const project = await Project.findById(scene.projectId);
    if (!project || !await Workspace.exists({ _id: project.workspaceId, ownerId })) throw new TtsJobError('NOT_FOUND', 404);
    await resolveTtsVoice(ownerId, voiceId);
    const plan=await forOwner(ownerId); limit(characters(narration),plan.config.scenes.maxNarrationChars,'SCENE_LIMIT_EXCEEDED');
    const changed = narration.trim() !== scene.narration || String(scene.voiceId) !== String(voiceId);
    const updated = await Scene.findOneAndUpdate({ _id: id, revision }, changed ? {
      $set: { narration: narration.trim(), voiceId: new mongoose.Types.ObjectId(voiceId) }, $inc: { revision: 1 }, $unset: { ttsAudioId: 1 },
    } : { $set: { voiceId: scene.voiceId } }, { new: true });
    if (!updated) throw new TtsJobError('SCENE_EDIT_CONFLICT', 409);
    return res.json({ success: true, data: updated });
  } catch (error) {
    if (error instanceof TtsJobError) return res.status(error.status).json({ success: false, error: { code: error.code } });
    if (error instanceof AudioError) return res.status(403).json({ success: false, error: { code: error.code } });
    return res.status(500).json({ success: false, error: { code: 'SCENE_SAVE_FAILED' } });
  }
}

export async function generateSceneAudio(req: Request, res: Response) {
  try {
    getTtsConfiguration();
    getCloudinaryConfiguration();
    const key = req.get('Idempotency-Key');
    const voiceId = req.body?.voiceId;
    if (req.body?.voice !== undefined || req.body?.providerVoiceId !== undefined || typeof req.params.id !== 'string' || typeof key !== 'string' || typeof voiceId !== 'string') throw new TtsJobError('INVALID_INPUT', 400);
    const result = await createTtsJob((req as any).user._id, req.params.id, voiceId, key);
    if (!result) throw new TtsJobError('JOB_CREATION_FAILED', 500);
    return res.status(result.reused ? 200 : 202).json({ success: true, data: { jobId: result.job._id, status: result.job.status, reservedCredits: result.job.payload.cost, reused: result.reused } });
  } catch (error) {
    if (error instanceof TtsJobError) return res.status(error.status).json({ success: false, error: { code: error.code, message: error.code } });
    if (error instanceof AudioError) return res.status(503).json({ success: false, error: { code: error.code, message: 'TTS integration is unavailable' } });
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Unable to create TTS job' } });
  }
}

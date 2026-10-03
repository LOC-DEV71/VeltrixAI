import { forOwner, validateRequest, reserveUsage } from './EntitlementService';
import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import { Job } from '../models/Job';
import { Scene } from '../models/Scene';
import { Project } from '../models/Project';
import { Workspace } from '../models/Workspace';
import { SystemSettings } from '../models/SystemSettings';
import { CreditService } from './CreditService';
import { Voice } from '../models/Voice';
import { User } from '../models/User';
import { voiceAllowed, voiceOwnedBy, clonePlanAllowed, resolveTtsVoice } from './VoiceService';
import { AudioError } from '../providers/AudioValidation';

export class TtsJobError extends Error {
  constructor(public readonly code: string, public readonly status: number) { super(code); }
}

export async function createTtsJob(ownerId: mongoose.Types.ObjectId, sceneId: string, voiceId: string, key: string, standalone?: { text: string }) {
  if ((!standalone && !mongoose.isObjectIdOrHexString(sceneId)) || !mongoose.isObjectIdOrHexString(voiceId) || !/^[A-Za-z0-9_.-]{8,128}$/.test(key)) throw new TtsJobError('INVALID_INPUT', 400);
  const normalizedSceneId = standalone ? undefined : new mongoose.Types.ObjectId(sceneId).toHexString();
  const normalizedVoiceId = new mongoose.Types.ObjectId(voiceId).toHexString();
  const idempotencyKey = `tts:${ownerId}:${createHash('sha256').update(key).digest('hex')}`;
  const session = await mongoose.startSession();
  try {
    // Unique idempotency index races retry by reading the winner; no second hold.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await session.withTransaction(async () => {
          const previous = await Job.findOne({ idempotencyKey }).session(session);
          if (previous) {
            if (String(previous.payload.sceneId) !== String(normalizedSceneId) || String(previous.payload.voiceId) !== normalizedVoiceId || (standalone && previous.payload.narration !== standalone.text.trim())) throw new TtsJobError('IDEMPOTENCY_CONFLICT', 409);
            return { job: previous, reused: true };
          }
          const scene = standalone ? null : await Scene.findById(normalizedSceneId).session(session);
          if (!standalone) {
            if (!scene) throw new TtsJobError('NOT_FOUND', 404);
            const project = await Project.findById(scene.projectId).session(session);
            const workspace = project && await Workspace.findOne({ _id: project.workspaceId, ownerId }).session(session);
            if (!workspace) throw new TtsJobError('FORBIDDEN', 403);
          }
          const voice = await Voice.findById(normalizedVoiceId).session(session);
          const user = await User.findById(ownerId).session(session);
          if (!user || user.status !== 'ACTIVE') throw new TtsJobError('FORBIDDEN', 403);
          if (voice && !voiceOwnedBy(voice, ownerId)) throw new TtsJobError('TTS_VOICE_NOT_FOUND', 404);
          
          const snapshot = await forOwner(ownerId,session);
          if (voice?.isSystem && !voice.planEntitlements.includes('*') && !snapshot.config.clone.premiumSystemVoices) throw new TtsJobError('TTS_VOICE_PLAN_DENIED',403);
          const narration = (standalone ? standalone.text : scene!.narration).trim();
          if (!narration) throw new TtsJobError('TTS_TEXT_LIMIT', 400);
          validateRequest(snapshot,'TTS',{input:narration,clone:voice?.isSystem === false});
          // Reject unavailable/foreign/plan-restricted voices before reserving credit.
          try {await resolveTtsVoice(ownerId, normalizedVoiceId, session, snapshot);}
          catch (error) {if (error instanceof AudioError) throw new TtsJobError(error.code,error.code==='TTS_VOICE_NOT_FOUND'?404:403);throw error;}
          const rate = snapshot.config.credits.ttsPer100Chars;
          const cost = Math.ceil([...narration].length / 100) * rate;
          const count = [...narration].length;
          const entitlementUsage = await reserveUsage(ownerId,snapshot,'TTS',{ttsChars:count,...(voice?.isSystem === false ? {cloneChars:count,cloneSeconds:Math.ceil(count/3)} : {})},session);
          const [job] = await Job.create([{
            ownerId, type: 'TTS', status: 'QUEUED', idempotencyKey,
            payload: { entitlementSnapshot:snapshot,entitlementUsage,isClone:voice?.isSystem === false,priority:snapshot.config.limits.queuePriority,pipelineVersion: 2, narration, voiceId: new mongoose.Types.ObjectId(normalizedVoiceId), cost,
              ...(standalone ? { source: 'STANDALONE' } : { sceneId: scene!._id, projectId: scene!.projectId, sceneRevision: scene!.revision, sourceContentRevision: scene!.sourceContentRevision }) },
          }], { session });
          let reservation;
          try { reservation = await CreditService.reserveUsable(ownerId,cost,job._id as mongoose.Types.ObjectId,snapshot.config.credits.paidAllowed,session); }
          catch (error) { if (error instanceof Error && error.message === 'INSUFFICIENT_CREDITS') throw new TtsJobError('INSUFFICIENT_CREDIT',402); throw error; }
          job.reservationId = reservation._id as mongoose.Types.ObjectId;
          await job.save({ session });
          return { job, reused: false };
        });
      } catch (error: any) {
        if (error?.code !== 11000 || attempt === 2) throw error;
      }
    }
    throw new TtsJobError('JOB_CREATION_FAILED', 500);
  } finally { await session.endSession(); }
}

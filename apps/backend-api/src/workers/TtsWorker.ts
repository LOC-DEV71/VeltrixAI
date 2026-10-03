import { verifyJobEntitlements, reconcileUsage, limit, claimPlanJob } from '../services/EntitlementService';
import mongoose from 'mongoose';
import { createHash, randomUUID } from 'node:crypto';
import { Job, IJob } from '../models/Job';
import { Scene } from '../models/Scene';
import { Project } from '../models/Project';
import { Workspace } from '../models/Workspace';
import { MediaAsset } from '../models/MediaAsset';
import { CreditService } from '../services/CreditService';
import { TtsProvider, validateClonedReference } from '../providers/TtsProvider';
import { CloudinaryAudioProvider } from '../providers/CloudinaryAudioProvider';
import { AudioError } from '../providers/AudioValidation';
import { resolveTtsVoice } from '../services/VoiceService';
import { Voice } from '../models/Voice';
import { User } from '../models/User';
import { storeCachedAudio } from '../services/AudioCache';

const LEASE_MS = 120_000;
export async function claimTtsJob(jobId?: string) {
  return claimPlanJob({ ...(jobId ? { _id: jobId } : {}), type: 'TTS', 'payload.pipelineVersion': 2, reservationId: { $type: 'objectId' } }, LEASE_MS);
}

async function assertSceneCurrent(job: IJob, session?: mongoose.ClientSession) {
  if (job.payload.source === 'STANDALONE') return;
  const query = Scene.findOne({ _id: job.payload.sceneId, projectId: job.payload.projectId,
    revision: job.payload.sceneRevision, sourceContentRevision: job.payload.sourceContentRevision,
  });
  if (session) query.session(session);
  const scene = await query;
  if (!scene || scene.narration.trim() !== job.payload.narration) throw new AudioError('TTS_STALE_SCENE');
  const projectQuery = Project.findById(scene.projectId);
  if (session) projectQuery.session(session);
  const project = await projectQuery;
  const ownerQuery = project && Workspace.findOne({ _id: project.workspaceId, ownerId: job.ownerId });
  if (ownerQuery && session) ownerQuery.session(session);
  if (!ownerQuery || !await ownerQuery) throw new AudioError('TTS_PROJECT_UNAVAILABLE');
}

export async function processTtsJob(job: IJob, tts: TtsProvider, cloudinary: CloudinaryAudioProvider) {
  const fence = { _id: job._id, type: 'TTS', status: 'PROCESSING', executionClaim: job.executionClaim };
  if (!job.executionClaim || !await Job.exists(fence)) return;
  const publicId = `creatorai/tts/${job.ownerId}/${job._id}`;
  let leaseValid = true;
  let uploadAttempted = false;
  const heartbeat = setInterval(() => {
    Job.updateOne(fence, { $set: { leaseExpiresAt: new Date(Date.now() + LEASE_MS) } })
      .then(result => { if (!result.matchedCount) leaseValid = false; })
      .catch(() => { leaseValid = false; });
  }, 30_000);
  heartbeat.unref();
  try {
    if (job.attempts > 3) throw new AudioError('TTS_RETRY_EXHAUSTED');
    const snapshot = await verifyJobEntitlements(job);
    await assertSceneCurrent(job);
    const voice = await resolveTtsVoice(job.ownerId, job.payload.voiceId, undefined, snapshot);
    let reference;
    if (voice.isSystem === false || voice.providerVoiceId.startsWith('clone:')) {
      const enrolled = await Voice.findById(voice._id).select('+clonedReference');
      reference = validateClonedReference(enrolled?.clonedReference);
    }
    const synthesized = await tts.synthesize(job.payload.narration, voice.providerVoiceId, reference);
    if (!leaseValid) return;
    await assertSceneCurrent(job);
    const currentVoice = await resolveTtsVoice(job.ownerId, job.payload.voiceId, undefined, snapshot);
    if (currentVoice.providerVoiceId !== voice.providerVoiceId) throw new AudioError('TTS_VOICE_CHANGED');
    uploadAttempted = true;
    const uploaded = await cloudinary.upload(synthesized.audio, publicId);
    // Verify the actual protected object, including when overwrite=false reused a previous upload.
    const delivered = await cloudinary.download(uploaded.publicId);
    await storeCachedAudio(createHash('sha256').update(delivered.audio).digest('hex'), delivered.audio).catch(() => {});
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const owned = await Job.findOne(fence).session(session);
        if (!owned || !leaseValid) throw new AudioError('TTS_CLAIM_LOST');
        await assertSceneCurrent(owned, session);
        const publishingVoice = await resolveTtsVoice(owned.ownerId, owned.payload.voiceId, session, snapshot);
        if (publishingVoice.isSystem === false) {
          const eligibility = await User.updateOne({ _id: owned.ownerId, status: 'ACTIVE',  }, { $set: { updatedAt: new Date() } }, { session });
          if (!eligibility.matchedCount) throw new AudioError('TTS_VOICE_PLAN_DENIED');
        }
        if (publishingVoice.providerVoiceId !== voice.providerVoiceId) throw new AudioError('TTS_VOICE_CHANGED');
        // Write the voice document so a concurrent revocation conflicts with publication.
        const voiceFence = await Voice.updateOne({ _id: publishingVoice._id, status: 'ACTIVE', provider: voice.provider, providerVoiceId: voice.providerVoiceId }, { $inc: { usageVersion: 1 } }, { session });
        if (!voiceFence.matchedCount) throw new AudioError('TTS_VOICE_REVOKED');
        if (owned.payload.isClone) limit(Math.ceil(delivered.duration),snapshot.config.clone.monthlySeconds);
        await reconcileUsage(owned,{ttsChars:[...owned.payload.narration.trim()].length,...(owned.payload.isClone ? {cloneChars:[...owned.payload.narration.trim()].length,cloneSeconds:Math.ceil(delivered.duration)} : {})},session);
        const [asset] = await MediaAsset.create([{
          ownerId: owned.ownerId, projectId: owned.payload.projectId, sceneId: owned.payload.sceneId, jobId: owned._id,
          source: owned.payload.source === 'STANDALONE' ? 'STANDALONE' : 'SCENE',
          publicId: uploaded.publicId, cloudinaryAssetId: uploaded.assetId, deliveryType: 'authenticated', resourceType: 'video', format: 'wav',
          bytes: delivered.bytes, duration: delivered.duration, sampleRate: delivered.sampleRate, channels: delivered.channels,
          sha256: createHash('sha256').update(delivered.audio).digest('hex'),
        }], { session });
        if (owned.payload.source !== 'STANDALONE') {
          const update = await Scene.updateOne({ _id: owned.payload.sceneId, revision: owned.payload.sceneRevision, sourceContentRevision: owned.payload.sourceContentRevision }, { $set: { ttsAudioId: asset._id, voiceId: publishingVoice._id } }, { session });
          if (!update.matchedCount) throw new AudioError('TTS_STALE_SCENE');
        }
        await CreditService.settle(owned._id as mongoose.Types.ObjectId, owned.payload.cost, session);
        owned.status = 'COMPLETED';
        owned.result = { audioId: asset._id, sceneId: owned.payload.sceneId, audioUrl: `/api/media/${asset._id}/audio`, contentType: 'audio/wav', duration: asset.duration, bytes: asset.bytes, chargedCredits: owned.payload.cost };
        owned.leaseExpiresAt = undefined;
        await owned.save({ session });
      });
    } finally { await session.endSession(); }
  } catch (error) {
    if (error instanceof AudioError && error.code === 'TTS_CLAIM_LOST') return;
    const code = error instanceof AudioError || error instanceof Error && 'code' in error && typeof error.code === 'string' ? String((error as any).code) : 'TTS_PROCESSING_FAILED';
    const session = await mongoose.startSession();
    let failed = false;
    try {
      await session.withTransaction(async () => {
        failed = false;
        const owned = await Job.findOne(fence).session(session);
        if (!owned || !leaseValid) return;
        await reconcileUsage(owned,{},session);
        await CreditService.release(owned._id as mongoose.Types.ObjectId, session);
        owned.status = 'FAILED'; owned.error = code; owned.leaseExpiresAt = undefined;
        await owned.save({ session });
        failed = true;
      });
    } finally { await session.endSession(); }
    if (failed && uploadAttempted) {
      try { await cloudinary.destroy(publicId); }
      catch { await Job.updateOne({ _id: job._id, status: 'FAILED' }, { $set: { 'payload.cleanupPending': true, 'payload.cleanupAttempts': 0 } }); }
    }
  } finally { clearInterval(heartbeat); }
}

export async function cleanupFailedTtsAudio(cloudinary: CloudinaryAudioProvider) {
  const job = await Job.findOne({ type: 'TTS', status: 'FAILED', 'payload.cleanupPending': true, 'payload.cleanupAttempts': { $lt: 3 } });
  if (!job) return;
  await Job.updateOne({ _id: job._id }, { $inc: { 'payload.cleanupAttempts': 1 } });
  try {
    await cloudinary.destroy(`creatorai/tts/${job.ownerId}/${job._id}`);
    await Job.updateOne({ _id: job._id }, { $set: { 'payload.cleanupPending': false } });
  } catch { /* Bounded cleanup remains visible on the failed job for reconciliation. */ }
}

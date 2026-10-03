import { forOwner, validateRequest, reserveUsage, limit } from './EntitlementService';
import type { PlanSnapshot } from './PlanService';
import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import { Voice } from '../models/Voice';
import { VoiceEnrollment } from '../models/VoiceEnrollment';
import { Job } from '../models/Job';
import { User } from '../models/User';
import { clonePlanAllowed } from './VoiceService';
import { TtsJobError } from './TtsJobService';
import { inspectReferenceAudio, stageReference, deleteStagedReference } from './VoiceEnrollmentStorage';

export const CONSENT_VERSION = 'voice-cloning-v1';
export async function assertClonePlan(ownerId: mongoose.Types.ObjectId, session?: mongoose.ClientSession, snapshot?: PlanSnapshot) {
  const query = User.findById(ownerId); if (session) query.session(session);
  const user = await query;
  if (!user || user.status !== 'ACTIVE' || !(snapshot || await forOwner(ownerId,session)).config.clone.enabled) throw new TtsJobError('CLONE_PLAN_REQUIRED', 403);
  return user;
}
export async function createEnrollment(ownerId: mongoose.Types.ObjectId, input: any, key: string) {
  if (input?.consentToClone !== true || input?.hasVoiceRights !== true || input?.consentVersion !== CONSENT_VERSION) throw new TtsJobError('CLONE_CONSENT_REQUIRED', 400);
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 50 || typeof input.audioBase64 !== 'string' || input.audioBase64.length > 5592408 || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.audioBase64) || !/^[A-Za-z0-9_.-]{8,128}$/.test(key)) throw new TtsJobError('INVALID_INPUT', 400);
  const audio = Buffer.from(input.audioBase64, 'base64');
  if (audio.toString('base64') !== input.audioBase64) throw new TtsJobError('INVALID_INPUT', 400);
  const info = inspectReferenceAudio(audio); const name = input.name.trim();
  const sha256 = createHash('sha256').update(audio).digest('hex');
  const requestHash = createHash('sha256').update(JSON.stringify({ name, sha256, consentVersion: CONSENT_VERSION })).digest('hex');
  const idempotencyKey = `clone:${ownerId}:${createHash('sha256').update(key).digest('hex')}`;
  const enrollmentId = new mongoose.Types.ObjectId(); const voiceId = new mongoose.Types.ObjectId();
  const jobId = new mongoose.Types.ObjectId(); let committed = false;
  const existing=await Job.findOne({idempotencyKey});
  if(existing){if(existing.payload.requestHash!==requestHash)throw new TtsJobError('IDEMPOTENCY_CONFLICT',409);return {enrollmentId:existing.payload.enrollmentId,voiceId:existing.payload.voiceId,jobId:existing._id,reused:true};}
  validateRequest(await forOwner(ownerId),'VOICE_ENROLLMENT',{duration:info.duration,bytes:audio.length});
  await stageReference(String(enrollmentId), audio);
  const session = await mongoose.startSession();
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await session.withTransaction(async () => {
          const previous = await Job.findOne({ idempotencyKey }).session(session);
          if (previous) {
            if (previous.payload.requestHash !== requestHash) throw new TtsJobError('IDEMPOTENCY_CONFLICT', 409);
            return { enrollmentId: previous.payload.enrollmentId, voiceId: previous.payload.voiceId, jobId: previous._id, reused: true };
          }
          const snapshot = await forOwner(ownerId,session);
          await assertClonePlan(ownerId, session, snapshot);
          validateRequest(snapshot,'VOICE_ENROLLMENT',{duration:info.duration,bytes:audio.length});
          limit(await Voice.countDocuments({ownerId,isSystem:false,status:{$in:['ACTIVE','PENDING']}}).session(session)+1,snapshot.config.clone.maxVoices,'CLONE_VOICE_LIMIT_EXCEEDED');
          const entitlementUsage = await reserveUsage(ownerId,snapshot,'VOICE_ENROLLMENT',{enrollments:1},session);
          await Voice.create([{ _id: voiceId, ownerId, enrollmentId, provider: 'VIENEU_LOCAL', providerVoiceId: `clone:${enrollmentId}`, name, language: 'vi-VN', gender: 'unknown', isSystem: false, isDefault: false, planEntitlements: ['*'], status: 'PENDING' }], { session });
          await VoiceEnrollment.create([{ _id: enrollmentId, ownerId, voiceId, jobId, status: 'PENDING', requestHash,
            consent: { acceptedAt: new Date(), version: CONSENT_VERSION, hasVoiceRights: true, consentToClone: true },
            sample: { sha256, duration: info.duration, publicId: `creatorai/voice-references/${ownerId}/${enrollmentId}`, deliveryType: 'authenticated' },
          }], { session });
          // Enrollment has no separate credit fee; speech uses the existing TTS ledger.
          await Job.create([{ _id: jobId, ownerId, type: 'VOICE_ENROLLMENT', status: 'QUEUED', idempotencyKey, payload: { entitlementSnapshot:snapshot,entitlementUsage,referenceDuration:info.duration,referenceBytes:audio.length,priority:snapshot.config.limits.queuePriority,enrollmentId, voiceId, requestHash, cost: 0 } }], { session });
          return { enrollmentId, voiceId, jobId, reused: false };
        });
        committed = !result!.reused; return result!;
      } catch (error: any) { if (error?.code !== 11000 || attempt === 2) throw error; }
    }
    throw new TtsJobError('CLONE_ENROLLMENT_FAILED', 500);
  } finally {
    await session.endSession();
    if (!committed) {
      // A lost commit acknowledgement must not remove a committed job's sample.
      const persisted = await VoiceEnrollment.exists({ _id: enrollmentId }).catch(() => true);
      if (!persisted) await deleteStagedReference(String(enrollmentId));
    }
  }
}

export async function stopEnrollment(ownerId: mongoose.Types.ObjectId, id: string, status: 'REVOKED' | 'DELETED') {
  if (!mongoose.isObjectIdOrHexString(id)) throw new TtsJobError('INVALID_INPUT', 400);
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(async () => {
      const enrollment = await VoiceEnrollment.findOne({ _id: id, ownerId }).session(session);
      if (!enrollment) throw new TtsJobError('NOT_FOUND', 404);
      if (enrollment.status === 'DELETED' || enrollment.status === status) {
        if (enrollment.cleanupPending && enrollment.cleanupAttempts >= 3) { enrollment.cleanupAttempts = 0; await enrollment.save({ session }); }
        return { status: enrollment.status };
      }
      enrollment.status = status; enrollment.cleanupPending = true; enrollment.cleanupAttempts = 0;
      await enrollment.save({ session });
      await Voice.updateOne({ _id: enrollment.voiceId, ownerId, isSystem: false }, { $set: { status }, $unset: { clonedReference: 1 }, $inc: { usageVersion: 1 } }, { session });
      await Job.updateOne({ _id: enrollment.jobId, ownerId, status: { $in: ['QUEUED', 'PROCESSING'] } }, { $set: { status: 'CANCELLED' }, $unset: { leaseExpiresAt: 1 } }, { session });
      return { status };
    });
  } finally { await session.endSession(); }
}

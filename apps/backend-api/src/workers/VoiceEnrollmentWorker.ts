import { verifyJobEntitlements, claimPlanJob } from '../services/EntitlementService';
import mongoose from 'mongoose';
import { createHash, randomUUID } from 'node:crypto';
import { Job, IJob } from '../models/Job';
import { Voice } from '../models/Voice';
import { VoiceEnrollment } from '../models/VoiceEnrollment';
import { AdminVoiceJob } from '../models/AdminVoiceJob';
import { User } from '../models/User';
import { TtsProvider } from '../providers/TtsProvider';
import { CloudinaryAudioProvider } from '../providers/CloudinaryAudioProvider';
import { AudioError } from '../providers/AudioValidation';
import { assertClonePlan } from '../services/VoiceEnrollmentService';
import { readStagedReference, deleteStagedReference, sweepStagedReferences } from '../services/VoiceEnrollmentStorage';

export async function claimEnrollmentJob(jobId?: string) {
  return claimPlanJob({ ...(jobId ? { _id: jobId } : {}), type: 'VOICE_ENROLLMENT' },120000);
}
export async function processEnrollmentJob(job: IJob, tts: TtsProvider, cloud: CloudinaryAudioProvider) {
  const fence = { _id: job._id, status: 'PROCESSING', type: 'VOICE_ENROLLMENT', executionClaim: job.executionClaim };
  if (!job.executionClaim || !await Job.exists(fence)) return;
  let leaseValid = true;
  const heartbeat = setInterval(() => {
    Job.updateOne(fence, { $set: { leaseExpiresAt: new Date(Date.now() + 120000) } }).then(r => { if (!r.matchedCount) leaseValid = false; }).catch(() => { leaseValid = false; });
  }, 30000); heartbeat.unref();
  try {
    if (job.attempts > 3) throw new AudioError('CLONE_RETRY_EXHAUSTED');
    const snapshot = await verifyJobEntitlements(job);
    await assertClonePlan(job.ownerId,undefined,snapshot);
    const enrollment = await VoiceEnrollment.findOne({ _id: job.payload.enrollmentId, ownerId: job.ownerId, status: 'PENDING' });
    if (!enrollment || enrollment.consent?.hasVoiceRights !== true || enrollment.consent?.consentToClone !== true) throw new AudioError('CLONE_ENROLLMENT_UNAVAILABLE');
    const audio = await readStagedReference(String(enrollment._id), enrollment.sample.sha256);
    await cloud.upload(audio, enrollment.sample.publicId);
    const stored = await cloud.download(enrollment.sample.publicId);
    if (createHash('sha256').update(stored.audio).digest('hex') !== enrollment.sample.sha256) throw new AudioError('CLONE_SAMPLE_INVALID');
    const reference = await tts.enroll(stored.audio);
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        if (!leaseValid || !await Job.exists(fence).session(session)) throw new AudioError('CLONE_CLAIM_LOST');
        const user = await assertClonePlan(job.ownerId, session,snapshot);
        // A plan downgrade must conflict with this publication transaction.
        const eligible = await User.updateOne({ _id: user._id, status: 'ACTIVE', plan: user.plan }, { $set: { plan: user.plan } }, { session });
        if (!eligible.matchedCount) throw new AudioError('CLONE_PLAN_REQUIRED');
        const updated = await VoiceEnrollment.updateOne({ _id: enrollment._id, ownerId: job.ownerId, status: 'PENDING' }, { $set: { status: 'ACTIVE' } }, { session });
        if (!updated.matchedCount) throw new AudioError('CLONE_ENROLLMENT_UNAVAILABLE');
        const voice = await Voice.updateOne({ _id: enrollment.voiceId, ownerId: job.ownerId, enrollmentId: enrollment._id, status: 'PENDING' }, { $set: { status: 'ACTIVE', clonedReference: reference }, $inc: { usageVersion: 1 } }, { session });
        if (!voice.matchedCount) throw new AudioError('CLONE_ENROLLMENT_UNAVAILABLE');
        await Job.updateOne(fence, { $set: { status: 'COMPLETED', result: { voiceId: enrollment.voiceId, enrollmentId: enrollment._id, chargedCredits: 0 } }, $unset: { leaseExpiresAt: 1 } }, { session });
      });
    } finally { await session.endSession(); }
    await deleteStagedReference(String(enrollment._id));
  } catch (error: any) {
    if (error?.code === 'CLONE_CLAIM_LOST') return;
    const code = typeof error?.code === 'string' ? error.code : 'CLONE_ENROLLMENT_FAILED';
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        if (!leaseValid || !await Job.exists(fence).session(session)) return;
        await Job.updateOne(fence, { $set: { status: 'FAILED', error: code }, $unset: { leaseExpiresAt: 1 } }, { session });
        await VoiceEnrollment.updateOne({ _id: job.payload.enrollmentId, status: 'PENDING' }, { $set: { status: 'REVOKED', error: code, cleanupPending: true, cleanupAttempts: 0 } }, { session });
        await Voice.updateOne({ _id: job.payload.voiceId, status: 'PENDING' }, { $set: { status: 'REVOKED' }, $unset: { clonedReference: 1 }, $inc: { usageVersion: 1 } }, { session });
      });
    } finally { await session.endSession(); }
  } finally {
    clearInterval(heartbeat);
    // Revoke/delete may have raced the upload. Re-arm cleanup after it finishes.
    await VoiceEnrollment.updateOne({ _id: job.payload.enrollmentId, status: { $in: ['REVOKED', 'DELETED'] } }, { $set: { cleanupPending: true, cleanupAttempts: 0 } });
  }
}
export async function cleanupEnrollmentFiles(cloud: CloudinaryAudioProvider) {
  const item = await VoiceEnrollment.findOneAndUpdate({ cleanupPending: true, cleanupAttempts: { $lt: 3 }, status: { $in: ['REVOKED', 'DELETED'] } }, { $inc: { cleanupAttempts: 1 } }, { new: true });
  if (item) {
    try {
      await cloud.destroy(item.sample.publicId);
      await deleteStagedReference(String(item._id));
      await Voice.updateOne({ _id: item.voiceId, status: { $in: ['REVOKED', 'DELETED'] } }, { $unset: { clonedReference: 1 } });
      await VoiceEnrollment.updateOne({ _id: item._id }, { $set: { cleanupPending: false } });
    } catch { /* Visible cleanupPending after three attempts; operator can retry. */ }
  }
  // Recover a crash between successful DB publication and deletion of the spool.
  const active = await VoiceEnrollment.find({ status: 'ACTIVE' }).select('_id').limit(100);
  for (const entry of active) await deleteStagedReference(String(entry._id)).catch(() => {});
}
let lastSweep = 0;
export async function sweepEnrollmentSpool() {
  if (Date.now() - lastSweep < 60000) return; lastSweep = Date.now();
  await sweepStagedReferences(async id => !!await VoiceEnrollment.exists({ _id: id, status: 'PENDING' }) || !!await AdminVoiceJob.exists({ _id: id, status: { $in: ['QUEUED','PROCESSING'] } }));
}

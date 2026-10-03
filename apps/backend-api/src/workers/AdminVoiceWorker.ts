import mongoose from 'mongoose';
import { createHash, randomUUID } from 'node:crypto';
import { AdminVoiceJob } from '../models/AdminVoiceJob';
import { AdminAuditLog } from '../models/AdminAuditLog';
import { Voice } from '../models/Voice';
import { TtsProvider, validateClonedReference, ClonedReference } from '../providers/TtsProvider';
import { CloudinaryAudioProvider } from '../providers/CloudinaryAudioProvider';
import { CloudinaryImageProvider, decodeAvatarImage } from '../providers/CloudinaryImageProvider';
import { AudioError, inspectWave } from '../providers/AudioValidation';
import { assertVoiceAdmin, adminVoiceCapabilities } from '../services/AdminVoiceProvisioning';
import { readStagedReference, deleteStagedReference } from '../services/VoiceEnrollmentStorage';
import { storeCachedAudio } from '../services/AudioCache';

const LEASE = 120000;
export async function claimAdminVoiceJob(id?: string) {
  return AdminVoiceJob.findOneAndUpdate({ ...(id ? { _id: id } : {}), $or: [{ status: 'QUEUED' }, { status: 'PROCESSING', leaseExpiresAt: { $lt: new Date() } }] },
    { $set: { status: 'PROCESSING', claim: randomUUID(), leaseExpiresAt: new Date(Date.now() + LEASE) }, $inc: { attempts: 1 } }, { new: true, sort: { createdAt: 1 } }).select('+payload');
}
export async function processAdminVoiceJob(job: any, tts: TtsProvider, cloud: CloudinaryAudioProvider, images?: CloudinaryImageProvider) {
  const fence = { _id: job._id, status: 'PROCESSING', claim: job.claim };
  if (!job.claim || !await AdminVoiceJob.exists(fence)) return;
  const previewId = `veltrixai/voice-previews/${job.voiceId}/${job._id}`;
  const avatarId = `veltrixai/voice-avatars/${job.voiceId}/${job._id}`;
  let valid = true;
  const heartbeat = setInterval(() => { AdminVoiceJob.updateOne(fence, { $set: { leaseExpiresAt: new Date(Date.now() + LEASE) } }).then(r => { if (!r.matchedCount) valid = false; }).catch(() => { valid = false; }); }, 30000);
  heartbeat.unref();
  try {
    if (job.attempts > 3) throw new AudioError('TTS_RETRY_EXHAUSTED');
    await assertVoiceAdmin(job.adminId);
    const voice = await Voice.findById(job.voiceId).select('+clonedReference');
    const creating = job.type === 'SYSTEM_VOICE_CREATE';
    if (!voice?.isSystem || voice.status !== (creating ? 'PENDING' : 'ACTIVE')) throw new AudioError('TTS_VOICE_REVOKED');
    if (voice.provider !== 'VIENEU_LOCAL') throw new AudioError('TTS_VOICE_PROVIDER_UNSUPPORTED');
    if (!creating && voice.usageVersion !== job.payload.version) throw new AudioError('VOICE_VERSION_CONFLICT');
    if (typeof job.payload.text !== 'string' || !job.payload.text.trim() || [...job.payload.text].length > adminVoiceCapabilities.maxPreviewCharacters) throw new AudioError('VOICE_PREVIEW_TEXT_INVALID');
    let reference: ClonedReference | undefined;
    if (creating) {
      if (!job.payload.consent?.hasVoiceRights || !job.payload.consent?.consentToClone || !job.payload.consent?.allowSystemUse) throw new AudioError('SYSTEM_VOICE_CONSENT_REQUIRED');
      const sample = await readStagedReference(String(job._id), job.payload.sample.sha256);
      await cloud.upload(sample, job.payload.sample.publicId);
      const stored = await cloud.download(job.payload.sample.publicId);
      if (createHash('sha256').update(stored.audio).digest('hex') !== job.payload.sample.sha256) throw new AudioError('CLONE_SAMPLE_INVALID');
      reference = validateClonedReference(await tts.enroll(stored.audio));
    } else if (voice.providerVoiceId.startsWith('clone:')) reference = validateClonedReference(voice.clonedReference);
    let avatar: { url: string; publicId: string } | undefined;
    if (creating && job.payload.avatarUpload) {
      const decoded = decodeAvatarImage(job.payload.avatarUpload.base64);
      images ||= new CloudinaryImageProvider();
      avatar = await images.upload(decoded.bytes, decoded.mime, avatarId);
    }
    const synthesized = await tts.synthesize(job.payload.text, voice.providerVoiceId, reference);
    inspectWave(synthesized.audio);
    if (!valid) return;
    await cloud.upload(synthesized.audio, previewId);
    const delivered = await cloud.download(previewId);
    const sha256 = createHash('sha256').update(delivered.audio).digest('hex');
    await storeCachedAudio(sha256, delivered.audio).catch(() => {});
    const session = await mongoose.startSession();
    try { await session.withTransaction(async () => {
      if (!valid || !await AdminVoiceJob.exists(fence).session(session)) throw new AudioError('TTS_CLAIM_LOST');
      await assertVoiceAdmin(job.adminId, session);
      const filter: any = { _id: voice._id, isSystem: true, status: creating ? 'PENDING' : 'ACTIVE', usageVersion: voice.usageVersion };
      const update: any = { preview: { fileName: `${sha256}.wav`, sha256, duration: delivered.duration, text: job.payload.text, publicId: previewId } };
      if (creating) {
        update.status = job.payload.metadata.status; update.isDefault = job.payload.metadata.isDefault; update.clonedReference = reference;
        if (avatar) { update.avatarUrl = avatar.url; update.avatarPublicId = avatar.publicId; }
        if (update.isDefault) await Voice.updateMany({ isSystem: true, isDefault: true, _id: { $ne: voice._id } }, { $set: { isDefault: false }, $inc: { usageVersion: 1 } }, { session });
      }
      const published = await Voice.updateOne(filter, { $set: update, $inc: { usageVersion: 1 } }, { session });
      if (!published.matchedCount) throw new AudioError('VOICE_VERSION_CONFLICT');
      await AdminVoiceJob.updateOne(fence, { $set: { status: 'COMPLETED', cleanupPending: creating || !!voice.preview?.publicId, 'payload.retiredPreview': voice.preview?.publicId || null }, $unset: { leaseExpiresAt: 1, 'payload.avatarUpload': 1 } }, { session });
      await AdminAuditLog.create([{ adminId: job.adminId, action: creating ? 'ACTIVATE_SYSTEM_VOICE' : 'PUBLISH_VOICE_PREVIEW', resource: 'Voice', resourceId: String(voice._id), changes: { jobId: String(job._id), text: job.payload.text, duration: delivered.duration, reason: job.payload.reason } }], { session });
    }); } finally { await session.endSession(); }
    // The embedding/codes are sufficient for future synthesis; retain no reference recording.
    if (creating) await AdminVoiceJob.updateOne({ _id: job._id }, { $set: { cleanupPending: true, cleanupAttempts: 0 } });
    await deleteStagedReference(String(job._id));
  } catch (e: any) {
    if (e?.code === 'TTS_CLAIM_LOST') return;
    const code = typeof e?.code === 'string' && /^[A-Z_]+$/.test(e.code) ? e.code : 'VOICE_PROVISIONING_FAILED';
    const session = await mongoose.startSession();
    try { await session.withTransaction(async () => {
      if (!valid || !await AdminVoiceJob.exists(fence).session(session)) return;
      await AdminVoiceJob.updateOne(fence, { $set: { status: 'FAILED', error: code, cleanupPending: true, cleanupAttempts: 0 }, $unset: { leaseExpiresAt: 1, 'payload.avatarUpload': 1 } }, { session });
      if (job.type === 'SYSTEM_VOICE_CREATE') await Voice.updateOne({ _id: job.voiceId, status: 'PENDING' }, { $set: { status: 'REVOKED', isDefault: false }, $unset: { clonedReference: 1 }, $inc: { usageVersion: 1 } }, { session });
      await AdminAuditLog.create([{ adminId: job.adminId, action: 'VOICE_PROVISIONING_FAILED', resource: 'Voice', resourceId: String(job.voiceId), changes: { jobId: String(job._id), error: code, reason: job.payload.reason } }], { session });
    }); } finally { await session.endSession(); }
  } finally { clearInterval(heartbeat); }
}
export async function cleanupAdminVoiceJobs(cloud: CloudinaryAudioProvider, images?: CloudinaryImageProvider) {
  const job = await AdminVoiceJob.findOneAndUpdate({ cleanupPending: true, cleanupAttempts: { $lt: 3 }, status: { $in: ['COMPLETED','FAILED'] } }, { $inc: { cleanupAttempts: 1 } }, { new: true }).select('+payload');
  if (!job) return;
  try {
    if (job.type === 'SYSTEM_VOICE_CREATE') await cloud.destroy(job.payload.sample.publicId);
    if (job.payload.retiredPreview && /^veltrixai\/voice-previews\/[a-f0-9]{24}\/[a-f0-9]{24}$/.test(job.payload.retiredPreview) && !await Voice.exists({ 'preview.publicId': job.payload.retiredPreview })) await cloud.destroy(job.payload.retiredPreview);
    if (job.status === 'FAILED') {
      const previewId = `veltrixai/voice-previews/${job.voiceId}/${job._id}`;
      if (!await Voice.exists({ 'preview.publicId': previewId })) await cloud.destroy(previewId);
      const avatarId = `veltrixai/voice-avatars/${job.voiceId}/${job._id}`;
      if (!await Voice.exists({ avatarPublicId: avatarId })) await (images || new CloudinaryImageProvider()).destroy(avatarId);
    }
    await deleteStagedReference(String(job._id));
    await AdminVoiceJob.updateOne({ _id: job._id }, { $set: { cleanupPending: false } });
  } catch { /* Three bounded attempts, visible to operations; retain the durable cleanup task. */ }
}

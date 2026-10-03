import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import { Voice } from '../models/Voice';
import { Plan } from '../models/Plan';
import { AdminVoiceJob } from '../models/AdminVoiceJob';
import { AdminAuditLog } from '../models/AdminAuditLog';
import { AdminAccount } from '../models/AdminAccount';
import { AdminVoiceError } from './AdminVoiceService';
import { stageReference, deleteStagedReference, inspectReferenceAudio } from './VoiceEnrollmentStorage';
import { decodeAvatarImage } from '../providers/CloudinaryImageProvider';

export const adminVoiceCapabilities = { minSeconds: 3, maxSeconds: 8, maxBytes: 4 * 1024 * 1024, maxPreviewCharacters: 1000, languages: ['vi-VN'] };
export function adminJobView(job: any) {
  return { id: String(job._id), voiceId: String(job.voiceId), type: job.type, status: job.status, error: job.error || null, createdAt: job.createdAt };
}
export async function assertVoiceAdmin(id: mongoose.Types.ObjectId, session?: mongoose.ClientSession) {
  const query = AdminAccount.findOne({ _id: id, status: 'ACTIVE' }).populate('roleId');
  if (session) query.session(session);
  const admin = await query;
  const role: any = admin?.roleId;
  if (!role || role.name !== 'OWNER' && !role.permissions.includes('voices.revoke')) throw new AdminVoiceError('FORBIDDEN', 403);
  return admin;
}
function reason(body: any) {
  if (typeof body?.reason !== 'string' || body.reason.trim().length < 5 || body.reason.length > 1000) throw new AdminVoiceError('INVALID_INPUT');
  return body.reason.trim();
}
function previewText(body: any) {
  if (typeof body.text !== 'string' || !body.text.trim() || [...body.text.trim()].length > adminVoiceCapabilities.maxPreviewCharacters) throw new AdminVoiceError('VOICE_PREVIEW_TEXT_INVALID');
  return body.text.trim();
}
function requestKey(actor: mongoose.Types.ObjectId, type: string, key: unknown) {
  if (typeof key !== 'string' || !/^[\w-]{16,100}$/.test(key)) throw new AdminVoiceError('INVALID_INPUT');
  return `${actor}:${type}:${key}`;
}
async function reused(key: string, hash: string, session?: mongoose.ClientSession) {
  const query = AdminVoiceJob.findOne({ key }); if (session) query.session(session);
  const previous = await query;
  if (!previous) return null;
  if (previous.requestHash !== hash) throw new AdminVoiceError('IDEMPOTENCY_CONFLICT', 409);
  return { ...adminJobView(previous), reused: true };
}
export async function enqueueVoicePreview(actor: mongoose.Types.ObjectId, id: string, body: any, key: unknown) {
  if (!mongoose.isObjectIdOrHexString(id) || Object.keys(body || {}).some(k => !['text', 'expectedVersion', 'reason'].includes(k))) throw new AdminVoiceError('INVALID_INPUT');
  const text = previewText(body), why = reason(body), scopedKey = requestKey(actor, 'preview', key);
  const hash = createHash('sha256').update(JSON.stringify({ id, text, version: body.expectedVersion, reason: why })).digest('hex');
  const session = await mongoose.startSession();
  try { return await session.withTransaction(async () => {
    await assertVoiceAdmin(actor, session);
    const previous = await reused(scopedKey, hash, session); if (previous) return previous;
    const voice = await Voice.findOne({ _id: id, isSystem: true, status: 'ACTIVE' }).session(session);
    if (!voice) throw new AdminVoiceError('VOICE_NOT_EDITABLE', 409);
    if (voice.usageVersion !== body.expectedVersion) throw new AdminVoiceError('VOICE_VERSION_CONFLICT', 409);
    // Serializes competing requests on this voice without changing the client revision.
    await Voice.updateOne({ _id: id }, { $set: { updatedAt: new Date() } }, { session });
    if (await AdminVoiceJob.exists({ voiceId: id, status: { $in: ['QUEUED', 'PROCESSING'] } }).session(session)) throw new AdminVoiceError('VOICE_JOB_IN_PROGRESS', 409);
    const [job] = await AdminVoiceJob.create([{ adminId: actor, voiceId: id, type: 'VOICE_PREVIEW', key: scopedKey, requestHash: hash, payload: { text, version: voice.usageVersion, reason: why } }], { session });
    await AdminAuditLog.create([{ adminId: actor, action: 'QUEUE_VOICE_PREVIEW', resource: 'Voice', resourceId: id, changes: { jobId: String(job._id), text, reason: why } }], { session });
    return { ...adminJobView(job), reused: false };
  }); } finally { await session.endSession(); }
}
export async function createSystemVoice(actor: mongoose.Types.ObjectId, body: any, key: unknown) {
  const allowed = ['name','language','gender','tags','avatarUrl','avatarUpload','position','planEntitlements','isDefault','status','audioBase64','text','reason','consent'];
  if (!body || Object.keys(body).some(k => !allowed.includes(k))) throw new AdminVoiceError('INVALID_INPUT');
  if (body.consent?.hasVoiceRights !== true || body.consent?.consentToClone !== true || body.consent?.allowSystemUse !== true) throw new AdminVoiceError('SYSTEM_VOICE_CONSENT_REQUIRED');
  if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 100 || !adminVoiceCapabilities.languages.includes(body.language) || !['male','female','unknown'].includes(body.gender)) throw new AdminVoiceError('INVALID_INPUT');
  if (!Number.isSafeInteger(body.position) || body.position < 1 || body.position > 100000) throw new AdminVoiceError('INVALID_VOICE_POSITION');
  if (!Array.isArray(body.tags) || body.tags.length > 20 || body.tags.some((t: any) => typeof t !== 'string' || !t.trim() || t.trim().length > 40)) throw new AdminVoiceError('INVALID_VOICE_TAGS');
  if (typeof body.isDefault !== 'boolean' || !['ACTIVE','REVOKED'].includes(body.status)) throw new AdminVoiceError('INVALID_INPUT');
  if (body.avatarUrl && (typeof body.avatarUrl !== 'string' || body.avatarUrl.length > 2048 || !/^https:\/\/[^\s]+$|^\/voice-avatars\/[\w-]+\.svg$/.test(body.avatarUrl))) throw new AdminVoiceError('INVALID_INPUT');
  if (body.avatarUpload) { if (Object.keys(body.avatarUpload).some(k => k !== 'base64')) throw new AdminVoiceError('INVALID_INPUT'); decodeAvatarImage(body.avatarUpload.base64); }
  if (!Array.isArray(body.planEntitlements) || !body.planEntitlements.length || body.planEntitlements.some((p: any) => typeof p !== 'string')) throw new AdminVoiceError('INVALID_INPUT');
  const tiers = await Plan.distinct('tier'); if (body.planEntitlements.some((p: string) => p !== '*' && !tiers.includes(p))) throw new AdminVoiceError('INVALID_INPUT');
  if (body.isDefault && (body.status !== 'ACTIVE' || !body.planEntitlements.includes('*'))) throw new AdminVoiceError('VOICE_DEFAULT_REQUIRED', 409);
  const text = previewText(body), why = reason(body), scopedKey = requestKey(actor, 'system', key);
  if (typeof body.audioBase64 !== 'string' || body.audioBase64.length > 5592408 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.audioBase64) || body.audioBase64.length % 4) throw new AdminVoiceError('CLONE_SAMPLE_FORMAT_INVALID');
  const audio = Buffer.from(body.audioBase64, 'base64'), info = inspectReferenceAudio(audio);
  const sha256 = createHash('sha256').update(audio).digest('hex');
  const metadata = { name: body.name.trim(), language: body.language, gender: body.gender, tags: [...new Set(body.tags.map((t: string) => t.trim().normalize('NFC')))], position: body.position, avatarUrl: body.avatarUrl || '', planEntitlements: [...new Set(body.planEntitlements)], isDefault: body.isDefault, status: body.status };
  const hash = createHash('sha256').update(JSON.stringify({ metadata, sha256, text, why, avatar: body.avatarUpload?.base64 || '' })).digest('hex');
  await assertVoiceAdmin(actor);
  const existing = await reused(scopedKey, hash); if (existing) return existing;
  const voiceId = new mongoose.Types.ObjectId(), jobId = new mongoose.Types.ObjectId();
  await stageReference(String(jobId), audio);
  const session = await mongoose.startSession();
  try { return await session.withTransaction(async () => {
    await assertVoiceAdmin(actor, session);
    const previous = await reused(scopedKey, hash, session); if (previous) return previous;
    await Voice.create([{ _id: voiceId, ...metadata, isDefault: false, status: 'PENDING', isSystem: true, provider: 'VIENEU_LOCAL', providerVoiceId: `clone:${voiceId}` }], { session });
    const [job] = await AdminVoiceJob.create([{ _id: jobId, adminId: actor, voiceId, type: 'SYSTEM_VOICE_CREATE', key: scopedKey, requestHash: hash,
      payload: { text, reason: why, metadata, avatarUpload: body.avatarUpload, sample: { sha256, duration: info.duration, publicId: `veltrixai/voice-references/system/${voiceId}` }, consent: { ...body.consent, acceptedAt: new Date(), version: 'system-voice-v1' } } }], { session });
    await AdminAuditLog.create([{ adminId: actor, action: 'CREATE_SYSTEM_VOICE', resource: 'Voice', resourceId: String(voiceId), changes: { after: metadata, consent: { hasVoiceRights: true, consentToClone: true, allowSystemUse: true }, jobId: String(jobId), reason: why } }], { session });
    return { ...adminJobView(job), reused: false };
  }); } catch (error: any) {
    if (error?.code === 11000) { const previous = await reused(scopedKey, hash); if (previous) return previous; }
    throw error;
  } finally {
    await session.endSession();
    if (!await AdminVoiceJob.exists({ _id: jobId }).catch(() => true)) await deleteStagedReference(String(jobId));
  }
}
export async function reorderSystemVoices(actor: mongoose.Types.ObjectId, body: any) {
  const why = reason(body), items = body.items;
  if (!Array.isArray(items) || !items.length || items.length > 1000 || items.some((v: any) => !mongoose.isObjectIdOrHexString(v.id) || !Number.isSafeInteger(v.version) || v.version < 0) || new Set(items.map((v: any) => v.id)).size !== items.length) throw new AdminVoiceError('INVALID_INPUT');
  const session = await mongoose.startSession();
  try { return await session.withTransaction(async () => {
    await assertVoiceAdmin(actor, session);
    const voices = await Voice.find({ isSystem: true, status: { $ne: 'DELETED' } }).sort({position:1,isDefault:-1,name:1,_id:1}).session(session);
    let reordered=items;const page=body.page===undefined?null:Number(body.page);if(page!==null){if(!Number.isSafeInteger(page)||page<1||page>10000||items.length>10)throw new AdminVoiceError('INVALID_INPUT');const slice=voices.slice((page-1)*10,page*10);if(slice.length!==items.length||items.some((v:any)=>!slice.some(voice=>String(voice._id)===v.id&&voice.usageVersion===v.version)))throw new AdminVoiceError('VOICE_VERSION_CONFLICT',409);reordered=voices.map(v=>({id:String(v._id),version:v.usageVersion}));reordered.splice((page-1)*10,slice.length,...items);}
    if (voices.length !== reordered.length || reordered.some((v: any) => !voices.some(voice => String(voice._id) === v.id && voice.usageVersion === v.version))) throw new AdminVoiceError('VOICE_VERSION_CONFLICT', 409);
    for (const [index, item] of reordered.entries()) await Voice.updateOne({ _id: item.id, usageVersion: item.version }, { $set: { position: index + 1 }, $inc: { usageVersion: 1 } }, { session });
    await AdminAuditLog.create([{ adminId: actor, action: 'REORDER_SYSTEM_VOICES', resource: 'VoiceCollection', changes: { before: voices.map(v => ({ id: String(v._id), position: v.position })), after: reordered.map((v: any, i: number) => ({ id: v.id, position: i + 1 })), reason: why } }], { session });
    return { updated: items.length };
  }); } finally { await session.endSession(); }
}

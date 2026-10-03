import { PlanSnapshot } from './PlanService';
import { getPlanSnapshot } from './PlanService';
import mongoose from 'mongoose';
import { Voice, IVoice } from '../models/Voice';
import { User } from '../models/User';
import { AudioError } from '../providers/AudioValidation';

export function voiceAllowed(voice: Pick<IVoice, 'planEntitlements'>, plan: string) {
  return voice.planEntitlements.includes('*') || voice.planEntitlements.includes(plan);
}
export async function clonePlanAllowed(plan: string) { return (await getPlanSnapshot(plan)).config.clone.enabled; }
export function voiceOwnedBy(voice: Pick<IVoice, 'isSystem' | 'ownerId'>, ownerId: mongoose.Types.ObjectId) {
  return voice.isSystem !== false || !!voice.ownerId && String(voice.ownerId) === String(ownerId);
}
export async function resolveTtsVoice(ownerId: mongoose.Types.ObjectId, voiceId: unknown, session?: mongoose.ClientSession, snapshot?: PlanSnapshot) {
  if (typeof voiceId !== 'string' && !(voiceId instanceof mongoose.Types.ObjectId)) throw new AudioError('TTS_VOICE_NOT_FOUND');
  if (!mongoose.isObjectIdOrHexString(voiceId)) throw new AudioError('TTS_VOICE_NOT_FOUND');
  const voiceQuery = Voice.findById(voiceId); const userQuery = User.findById(ownerId);
  if (session) { voiceQuery.session(session); userQuery.session(session); }
  const voice = await voiceQuery;
  if (!voice) throw new AudioError('TTS_VOICE_NOT_FOUND');
  if (!voiceOwnedBy(voice, ownerId)) throw new AudioError('TTS_VOICE_NOT_FOUND');
  if (voice.status !== 'ACTIVE') throw new AudioError('TTS_VOICE_REVOKED');
  const user = await userQuery;
  if (!user || user.status !== 'ACTIVE') throw new AudioError('TTS_VOICE_PLAN_DENIED');
  const pinned = snapshot || await getPlanSnapshot(user.plan,session);
  if (voice.isSystem === false ? !pinned.config.clone.enabled : !voiceAllowed(voice,pinned.tier) || !voice.planEntitlements.includes('*') && !voice.planEntitlements.includes('FREE') && !pinned.config.clone.premiumSystemVoices) throw new AudioError('TTS_VOICE_PLAN_DENIED');
  if (voice.provider !== 'VIENEU_LOCAL') throw new AudioError('TTS_VOICE_PROVIDER_UNSUPPORTED');
  return voice;
}

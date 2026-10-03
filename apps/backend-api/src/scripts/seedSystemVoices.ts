import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { Voice } from '../models/Voice';
import { User } from '../models/User';
import { Job } from '../models/Job';
import { SYSTEM_VOICE_AVATARS, fillMissingSystemVoiceAvatars } from '../services/SystemVoiceAvatars';

const COMMIT = '85344322b7258b4e25479b692e8e3396baf9db34';
const PRESET_SHA256 = 'e1f13cd2c2e0d29fdab5e15bfd7a30f3d7b768e6132bb43dd2b853f8efefdce9';
export async function seedSystemVoices(additionalPresetIds: string[] = []) {
  const bundle = process.env.TTS_BUNDLE_PATH || resolve(__dirname, '../../../../services/tts/artifacts');
  const raw = await readFile(resolve(bundle, `source/VieNeu-TTS-${COMMIT}/src/vieneu/assets/voices_v3_turbo.json`));
  if (createHash('sha256').update(raw).digest('hex') !== PRESET_SHA256) throw new Error('VOICE_ARTIFACT_CHECKSUM_MISMATCH');
  const artifact = JSON.parse(raw.toString('utf8'));
  const id = 'Hải Đăng'; const preset = artifact.presets[id];
  if (artifact.default_voice !== id || preset?.gender !== 'male' || !preset.speaker_emb?.length || !preset.codes?.length) throw new Error('VOICE_PRESET_INVALID');
  await Voice.init();
  for (const extraId of new Set(additionalPresetIds)) {
    if (extraId === id) continue;
    const extra = artifact.presets[extraId];
    if (!extra || !['male', 'female'].includes(extra.gender) || !extra.speaker_emb?.length || !extra.codes?.length) throw new Error('VOICE_PRESET_INVALID');
    await Voice.findOneAndUpdate({ provider: 'VIENEU_LOCAL', providerVoiceId: extraId }, { $setOnInsert: {
      provider: 'VIENEU_LOCAL', providerVoiceId: extraId, name: extraId, language: 'vi-VN', gender: extra.gender,
      avatarUrl: SYSTEM_VOICE_AVATARS[extraId],
      planEntitlements: ['*'], status: 'ACTIVE', isSystem: true, isDefault: false, usageVersion: 0,
    } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  }
  // Existing entitlement/status is deliberately preserved, including REVOKED.
  const voice = await Voice.findOneAndUpdate({ provider: 'VIENEU_LOCAL', providerVoiceId: id }, { $setOnInsert: {
    provider: 'VIENEU_LOCAL', providerVoiceId: id, name: id, language: 'vi-VN', gender: preset.gender,
    avatarUrl: SYSTEM_VOICE_AVATARS[id],
    planEntitlements: ['*'], status: 'ACTIVE', isSystem: true, isDefault: true, usageVersion: 0,
  } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  await fillMissingSystemVoiceAvatars();
  return voice;
}

export async function migrateLegacyTtsVoices() {
  // Stop old workers first; never rewrite the payload of an active lease.
  const legacy = { type: 'TTS', 'payload.pipelineVersion': 1, status: { $in: ['QUEUED', 'PROCESSING'] } };
  if (await Job.exists({ ...legacy, status: 'PROCESSING', leaseExpiresAt: { $gt: new Date() } })) throw new Error('STOP_LEGACY_TTS_WORKER_FIRST');
  const voices = await Voice.find({ provider: 'VIENEU_LOCAL', isSystem: true });
  for (const voice of voices) {
    await Job.updateMany({ ...legacy, 'payload.voice': voice.providerVoiceId }, {
      $set: { 'payload.voiceId': voice._id, 'payload.pipelineVersion': 2 }, $unset: { 'payload.voice': 1 },
    });
  }
  // Unmapped legacy requests are claimed by v2 and fail/refund as VOICE_NOT_FOUND.
  await Job.updateMany(legacy, { $set: { 'payload.pipelineVersion': 2 }, $unset: { 'payload.voice': 1 } });
  await User.updateMany({ $or: [{ plan: { $exists: false } }, { plan: null }, { plan: '' }] }, { $set: { plan: 'FREE' } });
}
if (require.main === module) {
  dotenv.config({ path: resolve(__dirname, '../../.env'), quiet: true });
  (async () => {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_NOT_CONFIGURED');
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    await seedSystemVoices();
    if (process.argv.includes('--migrate')) await migrateLegacyTtsVoices();
    console.log('SYSTEM_VOICES_SEED_PASS');
  })().catch(() => { console.error('SYSTEM_VOICES_SEED_FAILED'); process.exitCode = 1; }).finally(() => mongoose.disconnect());
}

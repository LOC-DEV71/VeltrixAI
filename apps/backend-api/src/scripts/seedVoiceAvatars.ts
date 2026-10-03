import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { resolve } from 'node:path';
import { fillMissingSystemVoiceAvatars } from '../services/SystemVoiceAvatars';

dotenv.config({ path: resolve(__dirname, '../../.env'), quiet: true });
(async () => {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_NOT_CONFIGURED');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  console.log(JSON.stringify({ success: true, updated: await fillMissingSystemVoiceAvatars() }));
})().catch(() => { console.error('VOICE_AVATAR_SEED_FAILED'); process.exitCode = 1; }).finally(() => mongoose.disconnect());

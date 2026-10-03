import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { resolve } from 'node:path';
import { SystemSettings } from '../models/SystemSettings';

dotenv.config({ path: resolve(__dirname, '../../.env'), quiet: true });
(async () => {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_NOT_CONFIGURED');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  await SystemSettings.updateOne({ key: 'TTS_CREDITS_PER_100_CHARS' }, { $set: { value: 100 } }, { upsert: true, runValidators: true });
  console.log(JSON.stringify({ success: true, creditsPer100Chars: 100 }));
})().catch(() => { console.error('TTS_PRICING_UPDATE_FAILED'); process.exitCode = 1; }).finally(() => mongoose.disconnect());

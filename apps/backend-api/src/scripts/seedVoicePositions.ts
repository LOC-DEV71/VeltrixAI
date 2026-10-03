import dotenv from 'dotenv';
import { resolve } from 'node:path';
import mongoose from 'mongoose';
import { Voice } from '../models/Voice';

// Backfill only legacy records; never overwrite order already chosen by admin.
export async function seedVoicePositions() {
  const existing = await Voice.find({ isSystem: true, position: { $exists: true } }).select('position').lean();
  let next = existing.reduce((max, v) => Math.max(max, v.position || 0), 0);
  const legacy = await Voice.find({ isSystem: true, position: { $exists: false } }).sort({ isDefault: -1, name: 1 });
  let updated = 0;
  for (const voice of legacy) {
    const result = await Voice.updateOne({ _id: voice._id, position: { $exists: false } }, { $set: { position: ++next }, $inc: { usageVersion: 1 } });
    updated += result.modifiedCount;
  }
  return updated;
}
if (require.main === module) {
  dotenv.config({ path: resolve(__dirname, '../../.env'), quiet: true });
  mongoose.connect(process.env.MONGODB_URI!).then(async () => { console.log(JSON.stringify({ updated: await seedVoicePositions() })); }).catch(() => { console.error('VOICE_POSITION_SEED_FAILED'); process.exitCode = 1; }).finally(() => mongoose.disconnect());
}

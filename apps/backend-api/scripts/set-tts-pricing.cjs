// Explicit idempotent update of one TTS pricing setting, no .env edits.
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
const mongoose = require('mongoose'); const { SystemSettings } = require('../dist/models/SystemSettings');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  await SystemSettings.findOneAndUpdate({ key: 'TTS_CREDITS_PER_100_CHARS' }, { $set: { value: 20 } }, { upsert: true, new: true });
  console.log('TTS_PRICING_UPDATED: 20 credits per started 100 characters');
})().catch(() => { console.error('TTS_PRICING_UPDATE_FAILED'); process.exitCode = 1; }).finally(() => mongoose.disconnect());

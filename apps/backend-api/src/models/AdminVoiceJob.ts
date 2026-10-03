import mongoose, { Schema } from 'mongoose';

// Admin provisioning is separate from paid user jobs and never spends user credits.
const schema = new Schema({
  adminId: { type: Schema.Types.ObjectId, ref: 'AdminAccount', required: true },
  voiceId: { type: Schema.Types.ObjectId, ref: 'Voice', required: true },
  type: { type: String, enum: ['SYSTEM_VOICE_CREATE', 'VOICE_PREVIEW'], required: true },
  status: { type: String, enum: ['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED'], default: 'QUEUED' },
  key: { type: String, required: true, unique: true }, requestHash: { type: String, required: true },
  payload: { type: Schema.Types.Mixed, required: true, select: false },
  claim: String, leaseExpiresAt: Date, attempts: { type: Number, default: 0 },
  error: String, cleanupPending: { type: Boolean, default: false }, cleanupAttempts: { type: Number, default: 0 },
}, { timestamps: true, collection: 'admin_voice_jobs' });
schema.index({ status: 1, leaseExpiresAt: 1, createdAt: 1 });
export const AdminVoiceJob = mongoose.models.AdminVoiceJob || mongoose.model('AdminVoiceJob', schema);

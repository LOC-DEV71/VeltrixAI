import mongoose, { Schema } from 'mongoose';

const schema = new Schema({
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  voiceId: { type: Schema.Types.ObjectId, ref: 'Voice', required: true, unique: true },
  jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true, unique: true },
  status: { type: String, enum: ['PENDING', 'ACTIVE', 'REVOKED', 'DELETED'], required: true },
  consent: { acceptedAt: { type: Date, required: true }, version: { type: String, required: true }, hasVoiceRights: { type: Boolean, required: true }, consentToClone: { type: Boolean, required: true } },
  sample: { sha256: { type: String, required: true }, duration: { type: Number, required: true }, publicId: { type: String, required: true }, deliveryType: { type: String, enum: ['authenticated'], required: true } },
  requestHash: { type: String, required: true },
  cleanupPending: { type: Boolean, default: false }, cleanupAttempts: { type: Number, default: 0 },
  error: String,
}, { timestamps: true, collection: 'voice_enrollments' });
schema.index({ status: 1, cleanupPending: 1 });
schema.index({ownerId:1,createdAt:-1,_id:-1});
export const VoiceEnrollment = mongoose.models.VoiceEnrollment || mongoose.model('VoiceEnrollment', schema);

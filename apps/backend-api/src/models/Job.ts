import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IJob extends Document {
  createdAt: Date;
  updatedAt: Date;
  ownerId: mongoose.Types.ObjectId;
  type: 'VOICE_ENROLLMENT' | 'TTS' | 'AI_CONTENT' | 'AI_SPLIT' | 'AI_PROMPT_GEN' | 'AI_ANALYSIS' | 'VIDEO_RENDER' | 'YOUTUBE_PUBLISH' | 'IMAGE_GEN';
  status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  payload: any;
  reservationId?: mongoose.Types.ObjectId;
  idempotencyKey: string;
  executionClaim?: string;
  attempts: number;
  leaseExpiresAt?: Date;
  result?: any;
  error?: any;
  // User-visible progress. Only safe stage codes and Vietnamese messages; never prompts or provider details.
  progress?: { stage: string; step: number; totalSteps: number; message: string; percent?: number; updatedAt: Date };
  startedAt?: Date; // set when a worker claims the job
}

const JobSchema = new Schema<IJob>({
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, enum: ['VOICE_ENROLLMENT', 'TTS', 'AI_CONTENT', 'AI_SPLIT', 'AI_PROMPT_GEN', 'AI_ANALYSIS', 'VIDEO_RENDER', 'YOUTUBE_PUBLISH', 'IMAGE_GEN'], required: true },
  status: { type: String, enum: ['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'], default: 'QUEUED', index: true },
  payload: { type: Schema.Types.Mixed },
  reservationId: { type: Schema.Types.ObjectId, ref: 'CreditReservation' },
  idempotencyKey: { type: String, required: true, unique: true },
  executionClaim: { type: String },
  attempts: { type: Number, default: 0 },
  leaseExpiresAt: { type: Date },
  result: { type: Schema.Types.Mixed },
  error: { type: Schema.Types.Mixed },
  progress: { type: new Schema({ stage: String, step: Number, totalSteps: Number, message: String, percent: Number, updatedAt: Date }, { _id: false }) },
  startedAt: { type: Date },
}, { timestamps: true });

JobSchema.index({ type: 1, status: 1, leaseExpiresAt: 1 });
JobSchema.index({ownerId:1,type:1,'payload.source':1,createdAt:-1,_id:-1});
JobSchema.index({ownerId:1,type:1,'payload.projectId':1,createdAt:-1,_id:-1});
export const Job: Model<IJob> = mongoose.models.Job || mongoose.model('Job', JobSchema);

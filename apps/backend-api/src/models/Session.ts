import mongoose, { Schema, Document, Model } from 'mongoose';

export interface ISession extends Document {
  userId: mongoose.Types.ObjectId;
  tokenFamily: string;
  refreshTokenHash: string;
  deviceInfo?: string;
  expiresAt: Date;
  revokedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const SessionSchema = new Schema<ISession>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  tokenFamily: { type: String, required: true },
  refreshTokenHash: { type: String, required: true },
  deviceInfo: { type: String },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  revokedAt: { type: Date },
}, { timestamps: true });

export const Session: Model<ISession> = mongoose.models.Session || mongoose.model<ISession>('Session', SessionSchema);

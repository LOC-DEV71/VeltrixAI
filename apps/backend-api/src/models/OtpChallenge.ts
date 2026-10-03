import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IOtpChallenge extends Document {
  email: string;
  purpose: 'LOGIN' | 'LINK_ACCOUNT';
  codeHash: string;
  attempts: number;
  expiresAt: Date;
  consumedAt?: Date;
}

const OtpChallengeSchema = new Schema<IOtpChallenge>({
  email: { type: String, required: true, index: true },
  purpose: { type: String, enum: ['LOGIN', 'LINK_ACCOUNT'], required: true },
  codeHash: { type: String, required: true },
  attempts: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  consumedAt: { type: Date },
}, { timestamps: true });

export const OtpChallenge: Model<IOtpChallenge> = mongoose.models.OtpChallenge || mongoose.model<IOtpChallenge>('OtpChallenge', OtpChallengeSchema);

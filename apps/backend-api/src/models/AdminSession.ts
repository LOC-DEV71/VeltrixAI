import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IAdminSession extends Document {
  adminId: mongoose.Types.ObjectId;
  tokenFamily: string;
  refreshTokenHash: string;
  deviceInfo?: string;
  expiresAt: Date;
  revokedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AdminSessionSchema = new Schema<IAdminSession>({
  adminId: { type: Schema.Types.ObjectId, ref: 'AdminAccount', required: true, index: true },
  tokenFamily: { type: String, required: true },
  refreshTokenHash: { type: String, required: true },
  deviceInfo: { type: String },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  revokedAt: { type: Date },
}, { timestamps: true });

export const AdminSession: Model<IAdminSession> = mongoose.models.AdminSession || mongoose.model<IAdminSession>('AdminSession', AdminSessionSchema);

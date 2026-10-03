import mongoose, { Schema, Document, Model } from 'mongoose';
import './AdminRole';

export interface IAdminAccount extends Document {
  email: string;
  passwordHash: string;
  displayName: string;
  roleId: mongoose.Types.ObjectId;
  status: 'ACTIVE' | 'SUSPENDED';
  controlRevision: number;
  createdAt: Date;
  updatedAt: Date;
}

const AdminAccountSchema = new Schema<IAdminAccount>({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  displayName: { type: String, required: true },
  roleId: { type: Schema.Types.ObjectId, ref: 'AdminRole', required: true },
  status: { type: String, enum: ['ACTIVE', 'SUSPENDED'], default: 'ACTIVE' },
  controlRevision:{type:Number,default:0},
}, { timestamps: true });

export const AdminAccount: Model<IAdminAccount> = mongoose.models.AdminAccount || mongoose.model<IAdminAccount>('AdminAccount', AdminAccountSchema);

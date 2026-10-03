import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IAdminRole extends Document {
  name: string;
  permissions: string[];
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const AdminRoleSchema = new Schema<IAdminRole>({
  name: { type: String, required: true, unique: true, uppercase: true, trim: true },
  permissions: { type: [String], required: true },
  isSystem: { type: Boolean, default: false }
}, { timestamps: true });

export const AdminRole: Model<IAdminRole> = mongoose.models.AdminRole || mongoose.model<IAdminRole>('AdminRole', AdminRoleSchema);

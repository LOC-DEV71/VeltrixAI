import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IAdminAuditLog extends Document {
  adminId: mongoose.Types.ObjectId;
  action: string;
  resource: string;
  resourceId?: string;
  changes?: any;
  ipAddress?: string;
  createdAt: Date;
}

const AdminAuditLogSchema = new Schema<IAdminAuditLog>({
  adminId: { type: Schema.Types.ObjectId, ref: 'AdminAccount', required: true, index: true },
  action: { type: String, required: true },
  resource: { type: String, required: true },
  resourceId: { type: String },
  changes: { type: Schema.Types.Mixed },
  ipAddress: { type: String },
}, { timestamps: { createdAt: true, updatedAt: false } });

AdminAuditLogSchema.index({resource:1,resourceId:1,createdAt:-1,_id:-1});
AdminAuditLogSchema.index({createdAt:-1,_id:-1});
AdminAuditLogSchema.pre('save',function(){if(!this.isNew)throw new Error('IMMUTABLE_ADMIN_AUDIT');});
AdminAuditLogSchema.pre(['updateOne','updateMany','findOneAndUpdate','replaceOne','deleteOne','deleteMany','findOneAndDelete'],function(){throw new Error('IMMUTABLE_ADMIN_AUDIT');});
export const AdminAuditLog: Model<IAdminAuditLog> = mongoose.models.AdminAuditLog || mongoose.model<IAdminAuditLog>('AdminAuditLog', AdminAuditLogSchema);

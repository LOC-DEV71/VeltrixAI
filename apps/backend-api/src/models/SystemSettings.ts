import mongoose, { Schema, Document } from 'mongoose';

export interface ISystemSettings extends Document {
  key: string;
  value: any;
}

const SystemSettingsSchema = new Schema({
  key: { type: String, required: true, unique: true },
  value: { type: Schema.Types.Mixed, required: true },
}, { timestamps: true });

export const SystemSettings = mongoose.model<ISystemSettings>('SystemSettings', SystemSettingsSchema);

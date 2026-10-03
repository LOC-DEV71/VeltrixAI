import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IVoice extends Document {
  provider: string; providerVoiceId: string; name: string; language: string;
  avatarUrl?: string;
  avatarPublicId?: string;
  tags: string[];
  position: number;
  gender: 'male' | 'female' | 'unknown'; planEntitlements: string[];
  status: 'PENDING' | 'ACTIVE' | 'REVOKED' | 'DELETED'; isSystem: boolean; isDefault: boolean;
  ownerId?: mongoose.Types.ObjectId; enrollmentId?: mongoose.Types.ObjectId;
  clonedReference?: { speakerEmbedding: number[]; codes: number[][] };
  usageVersion: number;
  preview?: { fileName: string; sha256: string; duration: number; text: string; publicId?: string };
}
const schema = new Schema<IVoice>({
  provider: { type: String, required: true }, providerVoiceId: { type: String, required: true },
  name: { type: String, required: true }, language: { type: String, required: true },
  avatarUrl: { type: String, trim: true, maxlength: 2048 },
  avatarPublicId: { type: String, select: false },
  tags: {type:[String],default:[],validate:{validator:(v:string[])=>v.length<=20&&v.every(t=>t.trim().length>0&&t.length<=40),message:'INVALID_VOICE_TAGS'}},
  position: { type: Number, default: 1000, min: 1, validate: Number.isSafeInteger },
  gender: { type: String, enum: ['male', 'female', 'unknown'], required: true },
  planEntitlements: { type: [String], required: true, validate: (values: string[]) => values.length > 0 },
  status: { type: String, enum: ['PENDING', 'ACTIVE', 'REVOKED', 'DELETED'], required: true },
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  enrollmentId: { type: Schema.Types.ObjectId, ref: 'VoiceEnrollment' },
  clonedReference: { type: Schema.Types.Mixed, select: false },
  isSystem: { type: Boolean, default: true }, isDefault: { type: Boolean, default: false },
  usageVersion: { type: Number, default: 0 },
  preview: { type: new Schema({ fileName: { type: String, required: true }, sha256: { type: String, required: true }, duration: { type: Number, required: true }, text: { type: String, required: true }, publicId: String }, { _id: false }), required: false },
}, { timestamps: true, collection: 'voices' });
schema.index({ provider: 1, providerVoiceId: 1 }, { unique: true });
schema.index({isSystem:1,status:1,position:1,isDefault:-1,name:1,_id:1});
export const Voice: Model<IVoice> = mongoose.models.Voice || mongoose.model<IVoice>('Voice', schema);

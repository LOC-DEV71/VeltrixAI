import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IMediaAsset extends Document {
  ownerId: mongoose.Types.ObjectId; projectId?: mongoose.Types.ObjectId; sceneId?: mongoose.Types.ObjectId;
  source?: 'SCENE' | 'STANDALONE';
  jobId: mongoose.Types.ObjectId; publicId: string; cloudinaryAssetId: string;
  deliveryType: 'authenticated'; resourceType: 'video'; format: 'wav'; bytes: number;
  duration: number; sampleRate: number; channels: number; sha256: string;
}
const schema = new Schema<IMediaAsset>({
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', index: true, required: function() { return this.source !== 'STANDALONE'; } },
  sceneId: { type: Schema.Types.ObjectId, ref: 'Scene', required: function() { return this.source !== 'STANDALONE'; } },
  source: { type: String, enum: ['SCENE', 'STANDALONE'], default: 'SCENE' },
  jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true, unique: true },
  publicId: { type: String, required: true, unique: true }, cloudinaryAssetId: { type: String, required: true },
  deliveryType: { type: String, enum: ['authenticated'], required: true }, resourceType: { type: String, enum: ['video'], required: true },
  format: { type: String, enum: ['wav'], required: true }, bytes: { type: Number, required: true, min: 1 },
  duration: { type: Number, required: true, min: 0.1, max: 300 }, sampleRate: { type: Number, required: true },
  channels: { type: Number, required: true }, sha256: { type: String, required: true },
}, { timestamps: true, collection: 'media_assets' });
export const MediaAsset: Model<IMediaAsset> = mongoose.models.MediaAsset || mongoose.model<IMediaAsset>('MediaAsset', schema);

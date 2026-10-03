import mongoose, { Schema, Document, Model } from 'mongoose';
import type { GenerationSettings } from '../utils/generationSettings';

export interface IContent extends Document {
  projectId: mongoose.Types.ObjectId;
  rawText: string;
  metadata?: any;
  generationSettings?: Partial<GenerationSettings>;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

const ContentSchema = new Schema<IContent>({
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, unique: true },
  rawText: { type: String, default: '' },
  metadata: { type: Schema.Types.Mixed },
  generationSettings: {
    type: new Schema({ language:String,topic: String, platform: String, audience: String, tone: String, durationSeconds: Number, sceneCount: Number, structure: String, cta: String, creativeBrief: String, visualStyle: String }, { _id: false }),
    default: undefined,
  },
  revision: { type: Number, default: 0 },
}, { timestamps: true });

export const Content: Model<IContent> = mongoose.models.Content || mongoose.model<IContent>('Content', ContentSchema);

import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IScene extends Document {
  projectId: mongoose.Types.ObjectId;
  order: number;
  title: string;
  narration: string;
  visualDescription: string;
  imagePrompt?: string;
  videoPrompt?: string;
  videoSegments?: import('../utils/videoSegments').VideoSegment[];
  estimatedDuration: number;
  sourceContentRevision: number;
  revision: number;
  voiceId?: mongoose.Types.ObjectId;
  ttsAudioId?: mongoose.Types.ObjectId;
  /** Visual plan from VideoStoryboard (type, title, icon, data...), valid while storyboardRevision === revision. */
  storyboard?: Record<string, any> | null;
  storyboardRevision?: number;
  createdAt: Date;
  updatedAt: Date;
}

const SceneSchema = new Schema<IScene>({
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  order: { type: Number, required: true },
  title: { type: String, default: '' },
  narration: { type: String, required: true },
  visualDescription: { type: String, required: true },
  imagePrompt: { type: String },
  videoPrompt: { type: String },
  videoSegments: { type: [new Schema({order:Number,startSeconds:Number,durationSeconds:Number,narration:String,prompt:String},{_id:false})], default: undefined },
  estimatedDuration: { type: Number, required: true },
  sourceContentRevision: { type: Number, required: true },
  revision: { type: Number, default: 0 },
  voiceId: { type: Schema.Types.ObjectId, ref: 'Voice' },
  ttsAudioId: { type: Schema.Types.ObjectId, ref: 'MediaAsset' },
  storyboard: { type: Schema.Types.Mixed, default: null },
  storyboardRevision: { type: Number },
}, { timestamps: true });

export const Scene: Model<IScene> = mongoose.models.Scene || mongoose.model<IScene>('Scene', SceneSchema);

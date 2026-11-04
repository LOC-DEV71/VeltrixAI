import mongoose, { Schema, Document, Model } from 'mongoose';

/**
 * The AI background image of one scene (packages/image-gen). One document per scene; regenerating
 * replaces the image in place. `prompt` is the scene's imagePrompt unless the user edited it here
 * (editing never touches the Scene, so its revision and voice audio stay valid).
 */
export interface ISceneImage extends Document {
  ownerId: mongoose.Types.ObjectId;
  projectId: mongoose.Types.ObjectId;
  sceneId: mongoose.Types.ObjectId;
  order: number;
  status: 'PENDING' | 'GENERATING' | 'READY' | 'FAILED' | 'SKIPPED';
  prompt: string;
  promptEdited: boolean;
  preset: string;
  seed: number;
  attempt: number; // bumps the seed on "Tạo lại"
  file?: string | null; // absolute path inside packages/image-gen/cache
  seconds?: number | null;
  /** Denoising step of the image being generated, for the live progress bar. */
  step?: number | null;
  steps?: number | null;
  startedAt?: Date | null;
  cached?: boolean;
  downgradedFrom?: string | null;
  error?: string | null;
  /** Real photo (preset "wikimedia"): attribution and source page, shown in the UI and the video description. */
  credit?: string | null;
  sourceUrl?: string | null;
  jobId?: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const SceneImageSchema = new Schema<ISceneImage>({
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
  sceneId: { type: Schema.Types.ObjectId, ref: 'Scene', required: true, unique: true },
  order: { type: Number, required: true },
  status: { type: String, enum: ['PENDING', 'GENERATING', 'READY', 'FAILED', 'SKIPPED'], default: 'PENDING' },
  prompt: { type: String, default: '' },
  promptEdited: { type: Boolean, default: false },
  preset: { type: String, required: true },
  seed: { type: Number, required: true },
  attempt: { type: Number, default: 0 },
  file: { type: String, default: null },
  seconds: { type: Number, default: null },
  step: { type: Number, default: null },
  steps: { type: Number, default: null },
  startedAt: { type: Date, default: null },
  cached: { type: Boolean, default: false },
  downgradedFrom: { type: String, default: null },
  error: { type: String, default: null },
  credit: { type: String, default: null },
  sourceUrl: { type: String, default: null },
  jobId: { type: Schema.Types.ObjectId, ref: 'Job', default: null },
}, { timestamps: true, collection: 'scene_images' });

SceneImageSchema.index({ projectId: 1, order: 1 });
export const SceneImage: Model<ISceneImage> = mongoose.models.SceneImage || mongoose.model<ISceneImage>('SceneImage', SceneImageSchema);

/** Running average of real generation time per preset, for the estimates shown in the form. */
export interface IImageGenStat extends Document { preset: string; count: number; avgSeconds: number }
const ImageGenStatSchema = new Schema<IImageGenStat>({
  preset: { type: String, required: true, unique: true },
  count: { type: Number, default: 0 },
  avgSeconds: { type: Number, default: 0 },
}, { collection: 'image_gen_stats' });
export const ImageGenStat: Model<IImageGenStat> = mongoose.models.ImageGenStat || mongoose.model<IImageGenStat>('ImageGenStat', ImageGenStatSchema);

import mongoose, { Schema, Document, Model } from 'mongoose';

export type AutoVideoStep = 'CREATE' | 'WRITE' | 'IMAGES' | 'VOICE' | 'RENDER' | 'PUBLISH' | 'DONE';

// One "topic -> video" run. Each step creates or waits on ordinary jobs, so credit,
// quota and permission checks are exactly those of the manual flow.
export interface IAutoVideoRun extends Document {
  ownerId: mongoose.Types.ObjectId;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  step: AutoVideoStep;
  input: {
    topic: string; platform: string; audience: string; tone: string; durationSeconds?: number;
    voiceId: mongoose.Types.ObjectId; aspectRatio: '9:16' | '16:9'; publishYoutube: boolean;
    youtubePrivacy?: 'private' | 'unlisted' | 'public';
    youtubePlaylistId?: string;
    youtubeCategoryId?: string;
    youtubePublishAt?: Date | null; // scheduled publish time, null = right after rendering
    imagePreset?: string; // packages/image-gen preset id; 'off' skips AI images
    theme?: string; // 'auto' or a fixed visual theme (services/VideoTheme.ts)
  };
  projectId?: mongoose.Types.ObjectId;
  contentId?: mongoose.Types.ObjectId;
  contentJobId?: mongoose.Types.ObjectId;
  ttsJobIds: mongoose.Types.ObjectId[];
  storyboardPlanned?: boolean;
  resolvedTheme?: string;
  /** Set by "Dựng lại video": the next render must not reuse a finished one. */
  forceRender?: boolean;
  themeSource?: string;
  thumbnailPrompt?: string;
  thumbnailHook?: string;
  thumbnailSceneId?: mongoose.Types.ObjectId;
  imageJobId?: mongoose.Types.ObjectId;
  videoJobId?: mongoose.Types.ObjectId;
  videoId?: mongoose.Types.ObjectId;
  publishJobId?: mongoose.Types.ObjectId;
  error?: string | null;
  failedStep?: AutoVideoStep | null;
  retries: number;
  leaseUntil?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const AutoVideoRunSchema = new Schema<IAutoVideoRun>({
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['RUNNING', 'COMPLETED', 'FAILED'], default: 'RUNNING' },
  step: { type: String, enum: ['CREATE', 'WRITE', 'IMAGES', 'VOICE', 'RENDER', 'PUBLISH', 'DONE'], default: 'CREATE' },
  input: {
    type: new Schema({
      topic: { type: String, required: true }, platform: String, audience: String, tone: String, durationSeconds: Number,
      voiceId: { type: Schema.Types.ObjectId, ref: 'Voice', required: true },
      aspectRatio: { type: String, enum: ['9:16', '16:9'], default: '9:16' },
      publishYoutube: { type: Boolean, default: false },
      youtubePrivacy: { type: String, enum: ['private', 'unlisted', 'public'], default: 'private' },
      youtubePlaylistId: { type: String, default: null },
      youtubeCategoryId: { type: String, default: null },
      youtubePublishAt: { type: Date, default: null },
      imagePreset: { type: String, default: 'off' },
      theme: { type: String, default: 'auto' },
    }, { _id: false }),
    required: true,
  },
  projectId: { type: Schema.Types.ObjectId, ref: 'Project' },
  contentId: { type: Schema.Types.ObjectId, ref: 'Content' },
  contentJobId: { type: Schema.Types.ObjectId, ref: 'Job' },
  ttsJobIds: { type: [Schema.Types.ObjectId], default: [] },
  storyboardPlanned: { type: Boolean, default: false },
  resolvedTheme: { type: String, default: null },
  forceRender: { type: Boolean, default: false },
  themeSource: { type: String, default: null },
  thumbnailPrompt: { type: String, default: null },
  thumbnailHook: { type: String, default: null },
  thumbnailSceneId: { type: Schema.Types.ObjectId, default: null },
  imageJobId: { type: Schema.Types.ObjectId, ref: 'Job' },
  videoJobId: { type: Schema.Types.ObjectId, ref: 'Job' },
  videoId: { type: Schema.Types.ObjectId, ref: 'Video' },
  publishJobId: { type: Schema.Types.ObjectId, ref: 'Job' },
  error: { type: String, default: null },
  failedStep: { type: String, default: null },
  retries: { type: Number, default: 0 },
  leaseUntil: { type: Date, default: null },
}, { timestamps: true, collection: 'auto_video_runs' });

AutoVideoRunSchema.index({ ownerId: 1, createdAt: -1 });
AutoVideoRunSchema.index({ status: 1, leaseUntil: 1 });
export const AutoVideoRun: Model<IAutoVideoRun> = mongoose.models.AutoVideoRun || mongoose.model<IAutoVideoRun>('AutoVideoRun', AutoVideoRunSchema);

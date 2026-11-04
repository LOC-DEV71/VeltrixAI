import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IVideoScene {
  sceneId: mongoose.Types.ObjectId;
  order: number;
  type?: string; // storyboard scene type (hook, stat, ...)
  highlightWord: string;
  imageQuery: string;
  imageSource: 'AI_IMAGE' | 'WIKIMEDIA' | 'PEXELS_VIDEO' | 'PEXELS' | 'GENERATED';
  credit?: { photographer: string; photographerUrl: string; pageUrl: string };
  durationSeconds: number;
}

// A rendered mp4. Files live on local storage under VIDEO_STORAGE_DIR; clients download through the API.
export interface IVideo extends Document {
  ownerId: mongoose.Types.ObjectId;
  projectId: mongoose.Types.ObjectId;
  contentId: mongoose.Types.ObjectId;
  jobId: mongoose.Types.ObjectId;
  contentRevision: number;
  aspectRatio: '9:16' | '16:9';
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  bytes: number;
  storageKey: string; // file name inside VIDEO_STORAGE_DIR, never a client-supplied path
  scenes: IVideoScene[];
  youtube?: { videoId: string; url: string; privacy: string; channelId: string; uploadedAt: Date } | null;
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const VideoSchema = new Schema<IVideo>({
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
  contentId: { type: Schema.Types.ObjectId, ref: 'Content', required: true },
  jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true, unique: true },
  contentRevision: { type: Number, required: true },
  aspectRatio: { type: String, enum: ['9:16', '16:9'], required: true },
  width: { type: Number, required: true },
  height: { type: Number, required: true },
  fps: { type: Number, required: true },
  durationSeconds: { type: Number, required: true },
  bytes: { type: Number, required: true, min: 1 },
  storageKey: { type: String, required: true, unique: true, match: /^[a-f0-9]{24}\.mp4$/ },
  scenes: [new Schema({
    sceneId: { type: Schema.Types.ObjectId, ref: 'Scene', required: true },
    order: Number, type: String, highlightWord: String, imageQuery: String,
    imageSource: { type: String, enum: ['AI_IMAGE', 'WIKIMEDIA', 'PEXELS_VIDEO', 'PEXELS', 'GENERATED'] },
    credit: { type: new Schema({ photographer: String, photographerUrl: String, pageUrl: String }, { _id: false }) },
    durationSeconds: Number,
  }, { _id: false })],
  youtube: { type: new Schema({ videoId: String, url: String, privacy: String, channelId: String, uploadedAt: Date }, { _id: false }), default: null },
  deletedAt: { type: Date, default: null },
}, { timestamps: true, collection: 'videos' });

VideoSchema.index({ ownerId: 1, contentId: 1, createdAt: -1 });
export const Video: Model<IVideo> = mongoose.models.Video || mongoose.model<IVideo>('Video', VideoSchema);

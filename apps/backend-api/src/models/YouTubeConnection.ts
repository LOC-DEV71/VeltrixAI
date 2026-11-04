import mongoose, { Schema, Document, Model } from 'mongoose';

// One YouTube channel per user. The refresh token is encrypted at rest and never returned by the API.
export interface IYouTubeConnection extends Document {
  ownerId: mongoose.Types.ObjectId;
  channelId: string;
  channelTitle: string;
  channelAvatar?: string;
  refreshTokenEncrypted: string;
  scopes: string[];
  status: 'ACTIVE' | 'NEEDS_REAUTH';
  connectedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const YouTubeConnectionSchema = new Schema<IYouTubeConnection>({
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  channelId: { type: String, required: true },
  channelTitle: { type: String, default: '' },
  channelAvatar: { type: String, default: '' },
  refreshTokenEncrypted: { type: String, required: true, select: false },
  scopes: { type: [String], default: [] },
  status: { type: String, enum: ['ACTIVE', 'NEEDS_REAUTH'], default: 'ACTIVE' },
  connectedAt: { type: Date, required: true },
}, { timestamps: true, collection: 'youtube_connections' });

export const YouTubeConnection: Model<IYouTubeConnection> = mongoose.models.YouTubeConnection || mongoose.model<IYouTubeConnection>('YouTubeConnection', YouTubeConnectionSchema);

// One-time OAuth state, bound to the user who started the flow. Expires after 10 minutes.
export interface IYouTubeOAuthState extends Document {
  stateHash: string;
  ownerId: mongoose.Types.ObjectId;
  codeVerifier: string;
  returnPath: string;
  expiresAt: Date;
}
const YouTubeOAuthStateSchema = new Schema<IYouTubeOAuthState>({
  stateHash: { type: String, required: true, unique: true },
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  codeVerifier: { type: String, required: true },
  returnPath: { type: String, default: '/auto-video' },
  expiresAt: { type: Date, required: true },
}, { collection: 'youtube_oauth_states' });
YouTubeOAuthStateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const YouTubeOAuthState: Model<IYouTubeOAuthState> = mongoose.models.YouTubeOAuthState || mongoose.model<IYouTubeOAuthState>('YouTubeOAuthState', YouTubeOAuthStateSchema);

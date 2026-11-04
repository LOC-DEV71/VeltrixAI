import mongoose, { Schema, Document, Model } from 'mongoose';

// Daily counter for free idea suggestions. One row per owner per UTC day.
export interface IIdeaSuggestionUsage extends Document {
  ownerId: mongoose.Types.ObjectId;
  day: string; // YYYY-MM-DD (UTC)
  count: number;
  inFlightUntil?: Date | null; // one suggestion at a time per user
  createdAt: Date;
  updatedAt: Date;
}

const IdeaSuggestionUsageSchema = new Schema<IIdeaSuggestionUsage>({
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  day: { type: String, required: true },
  count: { type: Number, default: 0 },
  inFlightUntil: { type: Date, default: null },
  // Rows expire after a few days; only today's row matters.
}, { timestamps: true });

IdeaSuggestionUsageSchema.index({ ownerId: 1, day: 1 }, { unique: true });
IdeaSuggestionUsageSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 3600 });

export const IdeaSuggestionUsage: Model<IIdeaSuggestionUsage> = mongoose.models.IdeaSuggestionUsage || mongoose.model<IIdeaSuggestionUsage>('IdeaSuggestionUsage', IdeaSuggestionUsageSchema);

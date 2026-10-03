import mongoose, { Schema, Document, Model } from 'mongoose';

export interface ILinkingContext extends Document {
  email: string;
  googleSub: string;
  expiresAt: Date;
}

const LinkingContextSchema = new Schema<ILinkingContext>({
  email: { type: String, required: true },
  googleSub: { type: String, required: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, { timestamps: true });

export const LinkingContext: Model<ILinkingContext> = mongoose.models.LinkingContext || mongoose.model<ILinkingContext>('LinkingContext', LinkingContextSchema);

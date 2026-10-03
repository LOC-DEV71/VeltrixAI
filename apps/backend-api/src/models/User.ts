import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IUser extends Document {
  email: string;
  googleId?: string;
  displayName: string;
  avatarAssetId?: mongoose.Types.ObjectId;
  profile?: { bio: string; occupation: string };
  preferences?: { platform: string; audience: string; tone: string };
  accountRevision: number;
  developerApiDisabled: boolean;
  controlRevision: number;
  billingOrderId?: mongoose.Types.ObjectId;
  planPeriod?: { billingCycle: 'MONTHLY' | 'YEARLY'; startsAt: Date; endsAt: Date };
  plan: string;
  status: 'ACTIVE' | 'BANNED';
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  googleId: { type: String, sparse: true, index: { unique: true, partialFilterExpression: { googleId: { $type: "string" } } } },
  displayName: { type: String, required: true },
  avatarAssetId: { type: Schema.Types.ObjectId, ref: 'MediaAsset' },
  profile: { bio: { type: String, default: '', maxlength: 500 }, occupation: { type: String, default: '', maxlength: 100 } },
  preferences: {
    platform: { type: String, enum: ['tiktok', 'shorts', 'reels'], default: 'tiktok' },
    audience: { type: String, default: 'Gen Z, thích hài hước', maxlength: 300 },
    tone: { type: String, enum: ['funny', 'pro', 'drama'], default: 'funny' },
  },
  accountRevision: { type: Number, default: 0, min: 0 },
  developerApiDisabled: {type:Boolean,default:false},
  controlRevision: {type:Number,default:0},
  billingOrderId: {type:Schema.Types.ObjectId,ref:'BillingOrder'},
  planPeriod: { type: new Schema({
    billingCycle: { type: String, enum: ['MONTHLY','YEARLY'], required: true },
    startsAt: { type: Date, required: true }, endsAt: { type: Date, required: true },
  }, { _id: false }), default: undefined },
  plan: { type: String, default: 'FREE', trim: true, uppercase: true },
  status: { type: String, enum: ['ACTIVE', 'BANNED'], default: 'ACTIVE' },
}, { timestamps: true });

export const User: Model<IUser> = mongoose.models.User || mongoose.model<IUser>('User', UserSchema);

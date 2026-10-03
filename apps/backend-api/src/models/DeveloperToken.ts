import mongoose, {Schema} from 'mongoose';

const schema = new Schema({
  ownerId: {type: Schema.Types.ObjectId, ref: 'User', required: true, index: true},
  name: {type: String, required: true}, prefix: {type: String, required: true},
  tokenHash: {type: String, required: true, unique: true, select: false},
  scopes: {type: [String], required: true}, expiresAt: {type: Date, required: true},
  revokedAt: Date, lastUsedAt: Date,
}, {timestamps: true});
schema.index({ownerId: 1, createdAt: -1, _id: -1});
export const DeveloperToken = mongoose.models.DeveloperToken || mongoose.model('DeveloperToken', schema);

const audit = new Schema({
  ownerId: {type: Schema.Types.ObjectId, required: true, immutable: true},
  tokenId: {type: Schema.Types.ObjectId, required: true, immutable: true},
  action: {type: String, enum: ['CREATE', 'REVOKE'], required: true, immutable: true},
}, {timestamps: {createdAt: true, updatedAt: false}});
audit.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany', 'findOneAndDelete'], function () {throw new Error('IMMUTABLE_TOKEN_AUDIT');});
export const DeveloperTokenAudit = mongoose.models.DeveloperTokenAudit || mongoose.model('DeveloperTokenAudit', audit);

const usage = new Schema({ownerId: {type: Schema.Types.ObjectId, required: true}, minute: {type: String, required: true}, count: {type: Number, default: 0}, expiresAt: {type: Date, required: true}});
usage.index({ownerId: 1, minute: 1}, {unique: true});
usage.index({expiresAt: 1}, {expireAfterSeconds: 0});
export const DeveloperRateUsage = mongoose.models.DeveloperRateUsage || mongoose.model('DeveloperRateUsage', usage);

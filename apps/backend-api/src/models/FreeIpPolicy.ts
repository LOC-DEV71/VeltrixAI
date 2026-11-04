import mongoose, {Schema, Model, InferSchemaType} from 'mongoose';

const windowSchema = new Schema({
  _id: {type: String, required: true},
  ip: {type: String, required: true},
  month: {type: String, required: true},
  accountIds: {type: [Schema.Types.ObjectId], default: []},
  suspicious: {type: Boolean, default: false},
  lastDeniedAt: Date,
  fence: {type: Number, default: 0},
}, {timestamps: true});
windowSchema.index({ip: 1, month: -1});
windowSchema.index({accountIds: 1, month: -1});
windowSchema.index({month: 1, suspicious: -1, updatedAt: -1, _id: -1});
export const FreeIpWindow: Model<InferSchemaType<typeof windowSchema>> = mongoose.models.FreeIpWindow || mongoose.model('FreeIpWindow', windowSchema);

const denialSchema = new Schema({
  // Stable, secret-free ID also deduplicates retries and socket delivery.
  _id: {type: String, required: true},
  ip: {type: String, required: true},
  month: {type: String, required: true},
  userId: {type: Schema.Types.ObjectId, ref: 'User'},
  verifiedEmail: {type: String, required: true},
  linkedCount: {type: Number, required: true},
  reason: {type: String, enum: ['FREE_IP_ACCOUNT_LIMIT'], required: true},
  kind: {type: String, enum: ['LOGIN', 'REGISTRATION'], required: true},
  occurredAt: {type: Date, required: true},
});
denialSchema.index({ip: 1, month: 1, occurredAt: -1, _id: -1});
denialSchema.index({occurredAt: -1, _id: -1});
export const FreeIpDenial: Model<InferSchemaType<typeof denialSchema>> = mongoose.models.FreeIpDenial || mongoose.model('FreeIpDenial', denialSchema);

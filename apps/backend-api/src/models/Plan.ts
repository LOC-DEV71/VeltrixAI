import mongoose, { Schema } from 'mongoose';
const head = new Schema({ tier: { type: String, required: true, unique: true }, slug: { type: String, required: true, unique: true }, revision: { type: Number, required: true }, archived: { type: Boolean, default: false } }, { timestamps: true });
const version = new Schema({ planId: { type: Schema.Types.ObjectId, required: true }, revision: { type: Number, required: true }, tier: { type: String, required: true }, config: { type: Schema.Types.Mixed, required: true }, changedBy: { type: Schema.Types.ObjectId, default: null }, changedAt: { type: Date, required: true }, reason: { type: String, required: true } }, { versionKey: false });
version.index({ planId: 1, revision: 1 }, { unique: true });
const audit = new Schema({ planId: { type: Schema.Types.ObjectId, required: true }, revision: Number, changedBy: { type: Schema.Types.ObjectId, default: null }, changedAt: Date, reason: String, action: String, diff: Schema.Types.Mixed }, { versionKey: false });
audit.index({ planId: 1, revision: 1 }, { unique: true });
function appendOnly(schema: Schema) {
  schema.pre('save', function() { if (!this.isNew) throw new Error('IMMUTABLE_PLAN_RECORD'); });
  for (const op of ['updateOne','updateMany','findOneAndUpdate','replaceOne','deleteOne','deleteMany','findOneAndDelete'] as const) schema.pre(op, function() { throw new Error('IMMUTABLE_PLAN_RECORD'); });
}
appendOnly(version); appendOnly(audit);
export const Plan = mongoose.models.Plan || mongoose.model('Plan', head);
export const PlanRevision = mongoose.models.PlanRevision || mongoose.model('PlanRevision', version);
export const PlanAudit = mongoose.models.PlanAudit || mongoose.model('PlanAudit', audit);
const usage = new Schema({ ownerId: { type: Schema.Types.ObjectId, required: true }, period: { type: String, required: true }, counts: { type: Schema.Types.Mixed, default: {} }, fence: { type: Number, default: 0 } }, { minimize: false });
usage.index({ ownerId: 1, period: 1 }, { unique: true });
export const PlanUsage = mongoose.models.PlanUsage || mongoose.model('PlanUsage', usage);
const history = new Schema({ contentId: { type: Schema.Types.ObjectId, required: true }, revision: Number, rawText: String, scenes: Schema.Types.Mixed, createdAt: { type: Date, default: Date.now } });
history.index({ contentId: 1, revision: 1 }, { unique: true });
export const ContentRevision = mongoose.models.ContentRevision || mongoose.model('ContentRevision', history);

import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IProject extends Document {
  workspaceId: mongoose.Types.ObjectId;
  name: string;
  deletedAt?: Date | null;
  visualBible?: string;
  thumbnailPrompt?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ProjectSchema = new Schema<IProject>({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
  name: { type: String, required: true },
  deletedAt: { type: Date, default: null },
  visualBible: { type: String },
  thumbnailPrompt: { type: String },
}, { timestamps: true });

// Deleted projects are excluded from lists and ownership checks everywhere.
ProjectSchema.pre(['find', 'findOne', 'findOneAndUpdate', 'countDocuments'], function () {
  this.where({ deletedAt: null });
});

ProjectSchema.index({workspaceId:1,createdAt:-1,_id:-1});
export const Project: Model<IProject> = mongoose.models.Project || mongoose.model<IProject>('Project', ProjectSchema);

import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IWorkspace extends Document {
  ownerId: mongoose.Types.ObjectId;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

const WorkspaceSchema = new Schema<IWorkspace>({
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true },
}, { timestamps: true });

export const Workspace: Model<IWorkspace> = mongoose.models.Workspace || mongoose.model<IWorkspace>('Workspace', WorkspaceSchema);

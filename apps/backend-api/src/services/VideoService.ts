import { SceneImage } from '../models/SceneImage';
import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import { Job } from '../models/Job';
import { Content } from '../models/Content';
import { Scene } from '../models/Scene';
import { Project } from '../models/Project';
import { Workspace } from '../models/Workspace';
import { MediaAsset } from '../models/MediaAsset';
import { User } from '../models/User';
import { CreditService } from './CreditService';
import { forOwner } from './EntitlementService';

export class VideoError extends Error {
  constructor(public readonly code: string, public readonly status = 400, public readonly details?: Record<string, unknown>) { super(code); }
}

export const ASPECT_RATIOS = { '9:16': { width: 1080, height: 1920 }, '16:9': { width: 1920, height: 1080 } } as const;
export type AspectRatio = keyof typeof ASPECT_RATIOS;
export const VIDEO_FPS = 30;
export const MAX_VIDEO_SCENES = 40;
export const videoRenderCost = (env: NodeJS.ProcessEnv = process.env) => {
  const value = Number(env.VIDEO_RENDER_CREDITS);
  return Number.isSafeInteger(value) && value > 0 ? value : 50;
};

export interface VideoSceneSource { sceneId: mongoose.Types.ObjectId; revision: number; audioId: mongoose.Types.ObjectId; order: number }

/** Owner check: content -> project -> workspace owned by the user. */
export async function loadOwnedContent(ownerId: mongoose.Types.ObjectId, contentId: string, session?: mongoose.ClientSession) {
  if (!mongoose.isObjectIdOrHexString(contentId)) throw new VideoError('NOT_FOUND', 404);
  const content = await Content.findById(contentId).session(session ?? null);
  const project = content && await Project.findById(content.projectId).session(session ?? null);
  const owned = project && await Workspace.exists({ _id: project.workspaceId, ownerId }).session(session ?? null);
  if (!content || !project || !owned) throw new VideoError('NOT_FOUND', 404);
  return { content, project };
}

/**
 * Collects the scenes of a content and their current TTS audio. A scene's audio counts
 * only if it was synthesized from the scene's current revision and narration.
 */
export async function collectSceneAudio(ownerId: mongoose.Types.ObjectId, projectId: mongoose.Types.ObjectId, session?: mongoose.ClientSession) {
  const scenes = await Scene.find({ projectId }).sort({ order: 1 }).session(session ?? null);
  const ready: Array<{ scene: typeof scenes[number]; asset: any }> = [];
  const missing: number[] = [];
  for (const scene of scenes) {
    const asset = scene.ttsAudioId ? await MediaAsset.findOne({ _id: scene.ttsAudioId, ownerId, sceneId: scene._id }).session(session ?? null) : null;
    const tts = asset ? await Job.findOne({ _id: asset.jobId, ownerId, type: 'TTS', status: 'COMPLETED' }).select('payload.sceneRevision payload.narration').session(session ?? null) : null;
    const current = tts && tts.payload?.sceneRevision === scene.revision && String(tts.payload?.narration ?? '').trim() === scene.narration.trim();
    if (asset && current) ready.push({ scene, asset }); else missing.push(scene.order);
  }
  return { scenes, ready, missing };
}

export async function createVideoJob(ownerId: mongoose.Types.ObjectId, contentId: string, input: { aspectRatio?: unknown; force?: boolean }) {
  const aspectRatio = (input.aspectRatio ?? '9:16') as AspectRatio;
  if (!(aspectRatio in ASPECT_RATIOS)) throw new VideoError('VIDEO_INVALID_INPUT');
  const cost = videoRenderCost();
  const session = await mongoose.startSession();
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await session.withTransaction(async () => {
          const user = await User.findById(ownerId).session(session);
          if (!user || user.status !== 'ACTIVE') throw new VideoError('FORBIDDEN', 403);
          const { content, project } = await loadOwnedContent(ownerId, contentId, session);
          const { scenes, ready, missing } = await collectSceneAudio(ownerId, project._id as mongoose.Types.ObjectId, session);
          if (!scenes.length) throw new VideoError('VIDEO_NO_SCENES', 409);
          if (scenes.length > MAX_VIDEO_SCENES) throw new VideoError('VIDEO_TOO_MANY_SCENES', 409);
          if (missing.length) throw new VideoError('VIDEO_AUDIO_MISSING', 409, { sceneOrders: missing });

          const snapshot = await forOwner(ownerId, session);
          const totalSeconds = ready.reduce((sum, r) => sum + Number(r.asset.duration || 0), 0);
          // Narration speed varies by voice; allow 25% over the plan's target maximum.
          const maxSeconds = Math.ceil(Number(snapshot.config.content.maxDurationSeconds || 60) * 1.25);
          if (totalSeconds > maxSeconds) throw new VideoError('VIDEO_DURATION_LIMIT', 403, { maxSeconds });

          const sources: VideoSceneSource[] = ready.map(({ scene, asset }) => ({ sceneId: scene._id as mongoose.Types.ObjectId, revision: scene.revision, audioId: asset._id, order: scene.order }));
          // Scene images are part of the render: a regenerated image (or real photo) must give a new video.
          const images = await SceneImage.find({ projectId: project._id, status: 'READY' }).select('sceneId file updatedAt').sort({ sceneId: 1 }).session(session).lean();
          const imageKey = images.map((i) => [String(i.sceneId), String(i.file || ''), new Date(i.updatedAt).getTime()]);
          const fingerprint = createHash('sha256').update(JSON.stringify({ contentId: String(content._id), revision: content.revision, aspectRatio, sources: sources.map(s => [String(s.sceneId), s.revision, String(s.audioId)]), images: imageKey })).digest('hex');
          const baseKey = `video:${ownerId}:${fingerprint}`;
          // Same inputs: reuse a running or finished render. After a failure, allow a new attempt.
          const previous = await Job.findOne({ ownerId, type: 'VIDEO_RENDER', 'payload.fingerprint': fingerprint }).sort({ createdAt: -1 }).session(session);
          // `force` (user asked to render again): only a render still in flight is reused.
          if (previous && (input.force ? ['QUEUED', 'PROCESSING'] : ['QUEUED', 'PROCESSING', 'COMPLETED']).includes(previous.status)) return { job: previous, reused: true };
          const idempotencyKey = previous ? `${baseKey}:${Date.now()}` : baseKey;

          const [job] = await Job.create([{
            ownerId, type: 'VIDEO_RENDER', status: 'QUEUED', idempotencyKey,
            payload: {
              contentId: content._id, projectId: project._id, contentRevision: content.revision, aspectRatio, fingerprint,
              scenes: sources, totalSeconds, cost, entitlementSnapshot: snapshot, priority: snapshot.config.limits.queuePriority,
            },
          }], { session });
          try { job.reservationId = (await CreditService.reserveUsable(ownerId, cost, job._id as mongoose.Types.ObjectId, snapshot.config.credits.paidAllowed, session))._id as mongoose.Types.ObjectId; }
          catch (error) { if (error instanceof Error && error.message === 'INSUFFICIENT_CREDITS') throw new VideoError('INSUFFICIENT_CREDIT', 402, { cost }); throw error; }
          await job.save({ session });
          return { job, reused: false };
        });
      } catch (error: any) {
        if (error?.code !== 11000 || attempt === 2) throw error;
      }
    }
    throw new VideoError('JOB_CREATION_FAILED', 500);
  } finally { await session.endSession(); }
}

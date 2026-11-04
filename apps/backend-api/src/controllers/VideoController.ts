import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Video } from '../models/Video';
import { Job } from '../models/Job';
import { PlanError } from '../services/PlanSchema';
import { VideoError, createVideoJob, loadOwnedContent, collectSceneAudio, videoRenderCost } from '../services/VideoService';
import { publicProgress } from '../services/JobProgress';
import { defaultStorageDir } from '../workers/VideoWorker';

const owner = (req: Request) => (req as any).user._id as mongoose.Types.ObjectId;
const fail = (res: Response, status: number, code: string, details?: unknown) => res.status(status).json({ success: false, error: { code, ...(details ? { details } : {}) } });
const handle = (res: Response, error: any, label: string) => {
  if (error instanceof VideoError) return fail(res, error.status, error.code, error.details);
  if (error instanceof PlanError) return fail(res, error.status, error.code);
  console.error(`[${label}]`, error?.message);
  return fail(res, 500, 'INTERNAL_SERVER_ERROR');
};

const videoView = (video: any) => ({
  id: video._id, contentId: video.contentId, aspectRatio: video.aspectRatio, width: video.width, height: video.height,
  durationSeconds: video.durationSeconds, bytes: video.bytes, createdAt: video.createdAt, url: `/api/videos/${video._id}/file`,
  credits: (video.scenes || []).filter((s: any) => (s.imageSource === 'PEXELS' || s.imageSource === 'PEXELS_VIDEO') && s.credit?.photographer).map((s: any) => ({ order: s.order, ...s.credit })),
  youtube: video.youtube ? { url: video.youtube.url, privacy: video.youtube.privacy, uploadedAt: video.youtube.uploadedAt } : null,
});

/** POST /api/contents/:id/video { aspectRatio } -> { jobId, reused } */
export const startVideo = async (req: Request, res: Response) => {
  try {
    const { job, reused } = await createVideoJob(owner(req), String(req.params.id), { aspectRatio: req.body?.aspectRatio });
    return res.status(reused ? 200 : 202).json({ success: true, data: { jobId: job._id, status: job.status, reused, cost: job.payload.cost } });
  } catch (error) { return handle(res, error, 'POST /contents/:id/video'); }
};

/** GET /api/contents/:id/video -> readiness (scenes missing audio), cost, latest job and videos */
export const getContentVideo = async (req: Request, res: Response) => {
  try {
    const ownerId = owner(req);
    const { content, project } = await loadOwnedContent(ownerId, String(req.params.id));
    const { scenes, missing, ready } = await collectSceneAudio(ownerId, project._id as mongoose.Types.ObjectId);
    const latestJob = await Job.findOne({ ownerId, type: 'VIDEO_RENDER', 'payload.contentId': content._id }).sort({ createdAt: -1 }).lean();
    const videos = await Video.find({ ownerId, contentId: content._id, deletedAt: null }).sort({ createdAt: -1 }).limit(5).lean();
    const publishJob = videos[0] ? await Job.findOne({ ownerId, type: 'YOUTUBE_PUBLISH', 'payload.videoId': videos[0]._id }).sort({ createdAt: -1 }).lean() : null;
    return res.json({ success: true, data: {
      sceneCount: scenes.length, missingAudioSceneOrders: missing, audioSeconds: Math.round(ready.reduce((s, r) => s + Number(r.asset.duration || 0), 0)),
      cost: videoRenderCost(),
      latestJob: latestJob ? { id: latestJob._id, status: latestJob.status, failedReason: latestJob.error ?? null, progress: publicProgress(latestJob), result: latestJob.result ?? null } : null,
      videos: videos.map(videoView),
      publishJob: publishJob ? { id: publishJob._id, status: publishJob.status, failedReason: publishJob.error ?? null, progress: publicProgress(publishJob), result: publishJob.result ?? null } : null,
    } });
  } catch (error) { return handle(res, error, 'GET /contents/:id/video'); }
};

/** GET /api/videos/:id/file -> mp4, owner only, supports Range for seeking */
export const downloadVideo = async (req: Request, res: Response) => {
  try {
    if (!mongoose.isObjectIdOrHexString(req.params.id)) return fail(res, 404, 'NOT_FOUND');
    const video = await Video.findOne({ _id: req.params.id, ownerId: owner(req), deletedAt: null }).lean();
    if (!video || !/^[a-f0-9]{24}\.mp4$/.test(video.storageKey)) return fail(res, 404, 'NOT_FOUND');
    const path = join(defaultStorageDir(), video.storageKey);
    let size: number;
    try { size = (await stat(path)).size; } catch { return fail(res, 404, 'VIDEO_FILE_MISSING'); }
    // Played in a <video> on the web app (another port/subdomain): allow same-site embedding.
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=0, no-store');
    if (req.query.download === '1') res.setHeader('Content-Disposition', `attachment; filename="veltrix-${video._id}.mp4"`);
    const range = req.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      const start = match && match[1] ? Number(match[1]) : match && match[2] ? Math.max(0, size - Number(match[2])) : NaN;
      const end = match && match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
      if (!Number.isSafeInteger(start) || start < 0 || start >= size || end < start) return res.status(416).setHeader('Content-Range', `bytes */${size}`).end();
      res.status(206).setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      res.setHeader('Content-Length', end - start + 1);
      return createReadStream(path, { start, end }).pipe(res);
    }
    res.setHeader('Content-Length', size);
    return createReadStream(path).pipe(res);
  } catch (error) { return handle(res, error, 'GET /videos/:id/file'); }
};

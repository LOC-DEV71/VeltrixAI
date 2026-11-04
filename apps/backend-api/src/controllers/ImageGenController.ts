import { imagesEditable } from '../services/AutoVideoService';
import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { AutoVideoRun } from '../models/AutoVideoRun';
import { Job } from '../models/Job';
import { SceneImage } from '../models/SceneImage';
import { cancelImageJob, createImageJob, editImagePrompt, imageCacheDir, ImageGenError, listPresets, projectImages } from '../services/ImageGenService';

const owner = (req: Request) => (req as any).user._id as mongoose.Types.ObjectId;
const handle = (res: Response, error: any, label: string) => {
  if (error instanceof ImageGenError) return res.status(error.status).json({ success: false, error: { code: error.code } });
  console.error(`[${label}]`, error?.message);
  return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR' } });
};
const ownedRun = async (req: Request) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) throw new ImageGenError('NOT_FOUND', 404);
  const run = await AutoVideoRun.findOne({ _id: req.params.id, ownerId: owner(req) });
  if (!run || !run.projectId) throw new ImageGenError('NOT_FOUND', 404);
  return run;
};

/** GET /api/images/presets: quality presets with measured time estimates and download needs. */
export const getImagePresets = async (_req: Request, res: Response) => {
  try { return res.json({ success: true, data: await listPresets() }); }
  catch (error) { return handle(res, error, 'GET /images/presets'); }
};

/** GET /api/images/:imageId/file: the generated image, owner only. */
export const getImageFile = async (req: Request, res: Response) => {
  try {
    if (!mongoose.isObjectIdOrHexString(req.params.imageId)) throw new ImageGenError('NOT_FOUND', 404);
    const image = await SceneImage.findOne({ _id: req.params.imageId, ownerId: owner(req), status: 'READY' }).select('file').lean();
    const file = image?.file ? resolve(image.file) : '';
    // Only files inside the image cache are ever served.
    if (!file || !file.startsWith(imageCacheDir() + sep) || !existsSync(file)) throw new ImageGenError('NOT_FOUND', 404);
    // The web app (another port/subdomain) embeds this in <img>; helmet's default same-origin CORP blocks that.
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    res.setHeader('Content-Type', /\.jpe?g$/i.test(file) ? 'image/jpeg' : 'image/png');
    res.setHeader('Content-Length', String(statSync(file).size));
    res.setHeader('Cache-Control', 'private, max-age=86400');
    createReadStream(file).pipe(res);
  } catch (error) { return handle(res, error, 'GET /images/:id/file'); }
};

/** POST /api/auto-videos/:id/images/cancel: stop the image step; unfinished scenes use the fallback. */
export const cancelRunImages = async (req: Request, res: Response) => {
  try {
    const run = await ownedRun(req);
    const jobs = await Job.find({ ownerId: owner(req), type: 'IMAGE_GEN', 'payload.projectId': run.projectId, status: { $in: ['QUEUED', 'PROCESSING'] } }).select('_id').lean();
    for (const job of jobs) await cancelImageJob(owner(req), job._id as mongoose.Types.ObjectId);
    return res.json({ success: true, data: { cancelled: jobs.length } });
  } catch (error) { return handle(res, error, 'POST /auto-videos/:id/images/cancel'); }
};

/** POST /api/auto-videos/:id/scenes/:sceneId/image { preset? }: make this scene's image again (new seed). */
export const regenerateSceneImage = async (req: Request, res: Response) => {
  try {
    const run = await ownedRun(req);
    if (!imagesEditable(run)) throw new ImageGenError('IMAGE_TOO_LATE', 409);
    const job = await createImageJob({ ownerId: owner(req), projectId: run.projectId as mongoose.Types.ObjectId, preset: req.body?.preset || run.input.imagePreset || 'balanced', theme: run.resolvedTheme || run.input.theme, sceneIds: [String(req.params.sceneId)], regenerate: true, runId: run._id as mongoose.Types.ObjectId });
    if (!job) throw new ImageGenError('IMAGE_NO_PROMPT', 409);
    return res.status(202).json({ success: true, data: { jobId: job._id } });
  } catch (error) { return handle(res, error, 'POST /auto-videos/:id/scenes/:sceneId/image'); }
};

/** PATCH /api/auto-videos/:id/scenes/:sceneId/image-prompt { prompt }: edit the prompt used for this image. */
export const updateSceneImagePrompt = async (req: Request, res: Response) => {
  try {
    const run = await ownedRun(req);
    if (!imagesEditable(run)) throw new ImageGenError('IMAGE_TOO_LATE', 409);
    await editImagePrompt(owner(req), String(req.params.sceneId), req.body?.prompt);
    return res.json({ success: true, data: await projectImages(run.projectId as mongoose.Types.ObjectId) });
  } catch (error) { return handle(res, error, 'PATCH /auto-videos/:id/scenes/:sceneId/image-prompt'); }
};

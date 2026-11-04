import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { AutoVideoRun } from '../models/AutoVideoRun';
import { AutoVideoError, createAutoVideoRun, retryAutoVideoRun, rerenderAutoVideoRun, cancelAutoVideoRun, revoiceAutoVideoRun, runView } from '../services/AutoVideoService';

const owner = (req: Request) => (req as any).user._id as mongoose.Types.ObjectId;
const handle = (res: Response, error: any, label: string) => {
  if (error instanceof AutoVideoError) return res.status(error.status).json({ success: false, error: { code: error.code } });
  console.error(`[${label}]`, error?.message);
  return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR' } });
};

/** POST /api/auto-videos { topic, voiceId, aspectRatio?, platform?, audience?, tone?, durationSeconds?, publishYoutube?, youtubePrivacy? } */
export const startAutoVideo = async (req: Request, res: Response) => {
  try { return res.status(202).json({ success: true, data: await runView(await createAutoVideoRun(owner(req), req.body)) }); }
  catch (error) { return handle(res, error, 'POST /auto-videos'); }
};

export const listAutoVideos = async (req: Request, res: Response) => {
  try {
    const runs = await AutoVideoRun.find({ ownerId: owner(req) }).sort({ createdAt: -1 }).limit(200);
    return res.json({ success: true, data: await Promise.all(runs.map(runView)) });
  } catch (error) { return handle(res, error, 'GET /auto-videos'); }
};

export const getAutoVideo = async (req: Request, res: Response) => {
  try {
    if (!mongoose.isObjectIdOrHexString(req.params.id)) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
    const run = await AutoVideoRun.findOne({ _id: req.params.id, ownerId: owner(req) });
    if (!run) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
    return res.json({ success: true, data: await runView(run) });
  } catch (error) { return handle(res, error, 'GET /auto-videos/:id'); }
};

/** POST /api/auto-videos/:id/retry: resume a failed run from its failed step. */
export const retryAutoVideo = async (req: Request, res: Response) => {
  try { return res.status(202).json({ success: true, data: await runView(await retryAutoVideoRun(owner(req), String(req.params.id))) }); }
  catch (error) { return handle(res, error, 'POST /auto-videos/:id/retry'); }
};

/** POST /api/auto-videos/:id/cancel: "Dừng" a running workflow (see cancelAutoVideoRun). */
export const cancelAutoVideo = async (req: Request, res: Response) => {
  try { const { run, stopped } = await cancelAutoVideoRun(owner(req), String(req.params.id)); return res.json({ success: true, data: { ...(await runView(run)), stopped } }); }
  catch (error) { return handle(res, error, 'POST /auto-videos/:id/cancel'); }
};

/** POST /api/auto-videos/:id/voice { voiceId }: read the whole video again with another voice. */
export const revoiceAutoVideo = async (req: Request, res: Response) => {
  try { return res.status(202).json({ success: true, data: await runView(await revoiceAutoVideoRun(owner(req), String(req.params.id), req.body?.voiceId)) }); }
  catch (error) { return handle(res, error, 'POST /auto-videos/:id/voice'); }
};

/** POST /api/auto-videos/:id/rerender: render the finished video again with the current images. */
export const rerenderAutoVideo = async (req: Request, res: Response) => {
  try { return res.status(202).json({ success: true, data: await runView(await rerenderAutoVideoRun(owner(req), String(req.params.id))) }); }
  catch (error) { return handle(res, error, 'POST /auto-videos/:id/rerender'); }
};

/** GET /api/auto-videos/:id/details: data for the workflow card (nodes, scenes, activity). */
export const getAutoVideoDetails = async (req: Request, res: Response) => {
  try {
    if (!mongoose.isObjectIdOrHexString(req.params.id)) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
    const run = await AutoVideoRun.findOne({ _id: req.params.id, ownerId: owner(req) });
    if (!run) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
    const { runDetails } = await import('../services/AutoVideoDetails');
    return res.json({ success: true, data: await runDetails(run, { allEvents: req.query.events === 'all' }) });
  } catch (error) { return handle(res, error, 'GET /auto-videos/:id/details'); }
};

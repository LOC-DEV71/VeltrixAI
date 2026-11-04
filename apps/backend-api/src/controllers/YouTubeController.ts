import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { YouTubeError } from '../providers/YouTubeProvider';
import { PlanError } from '../services/PlanSchema';
import { startConnect, completeConnect, getConnection, disconnect, createYouTubePublishJob, getPlaylistsAndCategories } from '../services/YouTubePublishService';

const owner = (req: Request) => (req as any).user._id as mongoose.Types.ObjectId;
const handle = (res: Response, error: any, label: string) => {
  if (error instanceof YouTubeError || error instanceof PlanError) return res.status(error.status).json({ success: false, error: { code: error.code } });
  console.error(`[${label}]`, error?.message);
  return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR' } });
};

export const status = async (req: Request, res: Response) => {
  try { return res.json({ success: true, data: await getConnection(owner(req)) }); } catch (error) { return handle(res, error, 'GET /youtube/status'); }
};
export const authUrl = async (req: Request, res: Response) => {
  try {
    const returnPath = req.query.returnPath || req.body?.returnPath;
    return res.json({ success: true, data: await startConnect(owner(req), returnPath) });
  } catch (error) { return handle(res, error, 'GET /youtube/auth-url'); }
};
export const connection = status;
export const connect = authUrl;

/** Google redirects the browser here. No session needed: the one-time state identifies the user. */
export const callback = async (req: Request, res: Response) => {
  try {
    return res.redirect(302, await completeConnect(req.query.state, req.query.code, req.query.error));
  } catch {
    const clientUrl = process.env.YOUTUBE_CLIENT_URL || 'http://localhost:5173';
    return res.redirect(302, `${clientUrl}/auto-video?youtube=error&reason=callback_exception`);
  }
};
export const playlists = async (req: Request, res: Response) => {
  try { return res.json({ success: true, data: await getPlaylistsAndCategories(owner(req)) }); } catch (error) { return handle(res, error, 'GET /youtube/playlists'); }
};

export const disconnectEndpoint = async (req: Request, res: Response) => {
  try { await disconnect(owner(req)); return res.json({ success: true, data: { connected: false } }); } catch (error) { return handle(res, error, 'POST /youtube/disconnect'); }
};
export const removeConnection = disconnectEndpoint;

export const publish = async (req: Request, res: Response) => {
  try {
    const { job, reused } = await createYouTubePublishJob(owner(req), String(req.params.id), { privacy: req.body?.privacy, title: req.body?.title, playlistId: req.body?.playlistId, categoryId: req.body?.categoryId, publishAt: req.body?.publishAt });
    return res.status(reused ? 200 : 202).json({ success: true, data: { jobId: job._id, status: job.status, reused } });
  } catch (error) { return handle(res, error, 'POST /videos/:id/youtube'); }
};

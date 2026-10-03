import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { getCachedAudio } from '../services/AudioCache';
import { MediaAsset } from '../models/MediaAsset';
import { Project } from '../models/Project';
import { Job } from '../models/Job';
import { CloudinaryAudioProvider, getCloudinaryConfiguration } from '../providers/CloudinaryAudioProvider';

export async function playAudio(req: Request, res: Response) {
  try {
    if (typeof req.params.id !== 'string' || !mongoose.isObjectIdOrHexString(req.params.id)) return res.status(400).json({ success: false, error: { code: 'INVALID_INPUT' } });
    const asset = await MediaAsset.findOne({ _id: req.params.id, ownerId: (req as any).user._id }).lean();
    if (!asset) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
    const accessible = asset.source === 'STANDALONE'
      ? await Job.exists({ _id: asset.jobId, ownerId: asset.ownerId, status: 'COMPLETED', 'result.audioId': asset._id, 'payload.source': 'STANDALONE' })
      : await Project.findById(asset.projectId);
    if (!accessible) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
    const audio = await getCachedAudio(asset.sha256, async () => {
      const provider = new CloudinaryAudioProvider(getCloudinaryConfiguration());
      return (await provider.download(asset.publicId)).audio;
    });
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const range = req.get('Range');
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) return res.status(416).setHeader('Content-Range', `bytes */${audio.length}`).end();
      const start = match[1] ? Number(match[1]) : Math.max(0, audio.length - Number(match[2]));
      const end = match[1] ? (match[2] ? Math.min(Number(match[2]), audio.length - 1) : audio.length - 1) : audio.length - 1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= audio.length || end < start) return res.status(416).setHeader('Content-Range', `bytes */${audio.length}`).end();
      res.status(206); res.setHeader('Content-Range', `bytes ${start}-${end}/${audio.length}`);
      res.setHeader('Content-Length', end - start + 1); return res.send(audio.subarray(start, end + 1));
    }
    res.setHeader('Content-Length', audio.length); return res.send(audio);
  } catch { return res.status(502).json({ success: false, error: { code: 'AUDIO_DELIVERY_UNAVAILABLE' } }); }
}

import dotenv from 'dotenv';
import { resolve } from 'node:path';
import mongoose from 'mongoose';
import { Job } from '../models/Job';
import { Video } from '../models/Video';
import { MediaAsset } from '../models/MediaAsset';
import { ServiceHeartbeat } from '../models/ServiceHeartbeat';
import { CloudinaryAudioProvider, getCloudinaryConfiguration } from '../providers/CloudinaryAudioProvider';
import { createContentAiProvider } from '../providers/AiProvider';
import { createStockProvider } from '../providers/StockMediaProvider';
import { getCachedAudio } from '../services/AudioCache';
import { claimVideoJob, processVideoJob, renderWithRemotion, defaultStorageDir, type VideoWorkerDeps } from './VideoWorker';
import { claimPublishJob, processPublishJob } from '../services/YouTubePublishService';
import { getYouTubeConfig } from '../providers/YouTubeProvider';
import { claimImageJob, processImageJob } from './ImageWorker';

// Separate process: rendering runs headless Chrome and is CPU heavy. One video at a time.
export async function runVideoWorker(options: { jobId?: string; once?: boolean } = {}) {
  dotenv.config({ path: resolve(__dirname, '../../.env'), quiet: true });
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_NOT_CONFIGURED');
  const cloudinary = new CloudinaryAudioProvider(getCloudinaryConfiguration());
  let ai = null;
  try { ai = createContentAiProvider(); } catch { console.log('Video worker: AI not configured, using heuristic storyboards'); }
  const stock = createStockProvider(process.env, resolve(defaultStorageDir(), '..', 'media-cache'));
  if (!stock) console.log('Video worker: PEXELS_API_KEY not set, using animated gradient backgrounds');
  const deps: VideoWorkerDeps = {
    audio: (asset) => getCachedAudio(asset.sha256, async () => (await cloudinary.download(asset.publicId)).audio),
    ai, stock, render: (manifest, onProgress, signal) => renderWithRemotion(manifest, onProgress, signal), storageDir: defaultStorageDir(),
  };
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
  await Job.init(); await Video.init(); await MediaAsset.init();
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  const heartbeat = () => ServiceHeartbeat.updateOne({ name: 'VIDEO_WORKER' }, { $set: { seenAt: new Date() } }, { upsert: true }).catch(() => {});
  await heartbeat(); const heartbeatTimer = setInterval(() => void heartbeat(), 20000); heartbeatTimer.unref();
  console.log('Video worker ready');
  try {
    while (!stopping) {
      try {
        // Images first: a render of the same video waits for them.
        const imageJob = await claimImageJob(options.jobId);
        const job = imageJob ? null : await claimVideoJob(options.jobId);
        if (imageJob) await processImageJob(imageJob);
        else if (job) await processVideoJob(job, deps);
        else {
          const publishJob = await claimPublishJob(options.jobId);
          if (publishJob) await processPublishJob(publishJob, { config: getYouTubeConfig(), storageDir: deps.storageDir });
          else if (!options.once) await new Promise((r) => setTimeout(r, 2000));
        }
        if (options.once) break;
      } catch { console.error('VIDEO_WORKER_DATABASE_UNAVAILABLE'); await new Promise((r) => setTimeout(r, 2000)); }
    }
  } finally {
    clearInterval(heartbeatTimer);
    process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop);
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  const index = process.argv.indexOf('--job-id');
  const jobId = index >= 0 ? process.argv[index + 1] : undefined;
  if (index >= 0 && (!jobId || !mongoose.isObjectIdOrHexString(jobId))) { console.error('INVALID_JOB_ID'); process.exitCode = 1; }
  else runVideoWorker({ jobId, once: index >= 0 }).catch(() => { console.error('VIDEO_WORKER_STARTUP_FAILED'); process.exitCode = 1; });
}

import dotenv from 'dotenv';
import { resolve } from 'node:path';
import mongoose from 'mongoose';
import { TtsProvider, getTtsConfiguration } from '../providers/TtsProvider';
import { CloudinaryAudioProvider, getCloudinaryConfiguration } from '../providers/CloudinaryAudioProvider';
import { claimTtsJob, processTtsJob, cleanupFailedTtsAudio } from './TtsWorker';
import { Job } from '../models/Job';
import { MediaAsset } from '../models/MediaAsset';
import { Voice } from '../models/Voice';
import { VoiceEnrollment } from '../models/VoiceEnrollment';
import { AdminVoiceJob } from '../models/AdminVoiceJob';
import {ServiceHeartbeat} from '../models/ServiceHeartbeat';
import { claimAdminVoiceJob, processAdminVoiceJob, cleanupAdminVoiceJobs } from './AdminVoiceWorker';
import { claimEnrollmentJob, processEnrollmentJob, cleanupEnrollmentFiles, sweepEnrollmentSpool } from './VoiceEnrollmentWorker';

export async function runTtsWorker(options: { jobId?: string; once?: boolean } = {}) {
  // Respect process/worker .env overrides; never log configuration values.
  dotenv.config({ path: resolve(__dirname, '../../.env'), quiet: true });
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_NOT_CONFIGURED');
  const tts = new TtsProvider(getTtsConfiguration());
  const cloudinary = new CloudinaryAudioProvider(getCloudinaryConfiguration());
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
  await Job.init(); await MediaAsset.init();
  await Voice.init(); await VoiceEnrollment.init();
  await AdminVoiceJob.init();
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  console.log('TTS worker ready');
  const heartbeat=()=>ServiceHeartbeat.updateOne({name:'TTS_WORKER'},{$set:{seenAt:new Date()}},{upsert:true}).catch(()=>{});
  await heartbeat();const heartbeatTimer=setInterval(()=>void heartbeat(),20000);heartbeatTimer.unref();
  try {
    // Durable Mongo jobs, one synthesis at a time. Redis is not used by this TTS worker.
    while (!stopping) {
      try {
        const job = await claimTtsJob(options.jobId);
        if (job) await processTtsJob(job, tts, cloudinary);
        else {
          const enrollment = await claimEnrollmentJob(options.jobId);
          if (enrollment) await processEnrollmentJob(enrollment, tts, cloudinary);
          else {
            const adminJob = await claimAdminVoiceJob(options.jobId);
            if (adminJob) await processAdminVoiceJob(adminJob, tts, cloudinary);
            else if (!options.once) { await cleanupFailedTtsAudio(cloudinary); await new Promise(resolve => setTimeout(resolve, 1000)); }
          }
        }
        await cleanupEnrollmentFiles(cloudinary);
        await cleanupAdminVoiceJobs(cloudinary);
        await sweepEnrollmentSpool();
        if (options.once) break;
      } catch { console.error('TTS_WORKER_DATABASE_UNAVAILABLE'); await new Promise(resolve => setTimeout(resolve, 1000)); }
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
  else runTtsWorker({ jobId, once: index >= 0 }).catch(() => { console.error('TTS_WORKER_STARTUP_FAILED'); process.exitCode = 1; });
}

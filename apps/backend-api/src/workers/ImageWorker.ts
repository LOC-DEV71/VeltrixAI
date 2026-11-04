// Runs IMAGE_GEN jobs in the GPU worker process. One Python process per job loads the model once,
// makes the images, and exits (which frees the VRAM before voice and render run).
import crypto from 'node:crypto';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import mongoose from 'mongoose';
import { Job, type IJob } from '../models/Job';
import { SceneImage } from '../models/SceneImage';
import { imageCacheDir, presetFile, recordImageTime, runImageWorker, type ImageEvent } from '../services/ImageGenService';
import { setJobProgress, type StageDefinition } from '../services/JobProgress';
import { unloadLocalAi } from '../services/LocalAiControl';

export const IMAGE_STAGES: StageDefinition[] = [
  { stage: 'PREPARING', message: 'Đang chuẩn bị tạo hình ảnh' },
  { stage: 'DOWNLOADING', message: 'Đang tải model ảnh lần đầu' },
  { stage: 'LOADING', message: 'Đang nạp model ảnh vào GPU' },
  { stage: 'GENERATING', message: 'Đang tạo hình ảnh' },
];
const LEASE_MS = 10 * 60_000;

export interface ImageWorkerDeps {
  run?: typeof runImageWorker;
  /** Seconds without any event before an image counts as stuck. */
  stallSeconds?: (preset: string) => number;
  unloadAi?: () => Promise<unknown>;
}

export async function claimImageJob(jobId?: string) {
  const now = new Date();
  return Job.findOneAndUpdate(
    { ...(jobId ? { _id: jobId } : {}), type: 'IMAGE_GEN', $or: [{ status: 'QUEUED' }, { status: 'PROCESSING', leaseExpiresAt: { $lt: now } }] },
    { $set: { status: 'PROCESSING', executionClaim: crypto.randomUUID(), leaseExpiresAt: new Date(now.getTime() + LEASE_MS), startedAt: now }, $inc: { attempts: 1 } },
    { new: true, sort: { createdAt: 1 } },
  );
}

const defaultStall = (preset: string) => {
  const config = presetFile().presets.find((p) => p.id === preset);
  return Math.max(120, (config?.estimateSeconds ?? 60) * 8);
};

export async function processImageJob(job: IJob, deps: ImageWorkerDeps = {}) {
  const run = deps.run ?? runImageWorker;
  const fence = { _id: job._id, type: 'IMAGE_GEN', status: 'PROCESSING', executionClaim: job.executionClaim };
  const progress = (stage: string, message?: string, percent?: number) => setJobProgress(job._id as mongoose.Types.ObjectId, job.executionClaim, IMAGE_STAGES, stage, message, percent);
  const sceneIds = (job.payload.sceneIds as string[]).map((id) => new mongoose.Types.ObjectId(id));
  const workDir = join(tmpdir(), 'creatorai-images', String(job._id));
  const total = sceneIds.length;
  const result = { ready: 0, failed: 0, skipped: 0, cancelled: false, peakVramMB: 0, peakRamMB: 0, minFreeRamMB: null as number | null, downgrades: [] as string[], loadSeconds: null as number | null, loadedAt: null as Date | null, loadingAt: null as Date | null };
  let lastStepWrite = 0;
  try {
    if (job.attempts > 3) throw new Error('IMAGE_RETRY_EXHAUSTED');
    await progress('PREPARING');
    // The image model needs the whole 6 GB card: make sure the local LLM is not holding VRAM.
    await (deps.unloadAi ?? unloadLocalAi)().catch(() => undefined);
    await mkdir(workDir, { recursive: true });
    let preset = String(job.payload.preset);
    // The dedicated thumbnail (order 0) gets the run's hook drawn on it as a banner.
    let thumbHook: { sceneId: string; hook: string } | null = null;
    if (job.payload.runId) {
      const { AutoVideoRun } = await import('../models/AutoVideoRun');
      const owner = await AutoVideoRun.findById(job.payload.runId).select('thumbnailHook thumbnailSceneId').lean();
      if (owner?.thumbnailSceneId && owner.thumbnailHook) thumbHook = { sceneId: String(owner.thumbnailSceneId), hook: String(owner.thumbnailHook) };
    }
    // Loop so that a stuck image (killed on stall) does not stop the remaining scenes.
    while (true) {
      const pending = await SceneImage.find({ sceneId: { $in: sceneIds }, jobId: job._id, status: { $in: ['PENDING', 'GENERATING'] } }).sort({ order: 1 }).lean();
      if (!pending.length) break;
      const jobFile = join(workDir, `job-${Date.now()}.json`);
      await writeFile(jobFile, JSON.stringify({
        preset, theme: job.payload.theme, cacheDir: imageCacheDir(), allowFallback: true,
        items: pending.map((p) => ({ id: String(p._id), imagePrompt: p.prompt, seed: p.seed, ...(thumbHook && String(p.sceneId) === thumbHook.sceneId ? { hook: thumbHook.hook } : {}) })),
      }));
      const controller = new AbortController();
      let lastEvent = Date.now(), current: string | null = String(pending[0]._id), stalled = false, cancelled = false;
      const done = new Set<string>();
      const watch = setInterval(async () => {
        try {
          const live = await Job.findOneAndUpdate(fence, { $set: { leaseExpiresAt: new Date(Date.now() + LEASE_MS) } }, { new: true }).select('payload.cancelRequested').lean();
          if (!live || live.payload?.cancelRequested) { cancelled = true; controller.abort(); }
          else if (Date.now() - lastEvent > (deps.stallSeconds ?? defaultStall)(preset) * 1000) { stalled = true; controller.abort(); }
        } catch { /* keep going; the next tick retries */ }
      }, 1500);
      const onEvent = async (event: ImageEvent) => {
        lastEvent = Date.now();
        if (event.type === 'download') {
          await progress('DOWNLOADING', `Đang tải model ảnh ${event.downloadedGB ?? 0}/${event.totalGB} GB`, event.percent);
        } else if (event.type === 'step') {
          // Throttled: one write per ~300 ms is enough for a smooth bar.
          if (Date.now() - lastStepWrite < 300 && event.step < event.total) return;
          lastStepWrite = Date.now();
          await SceneImage.updateOne({ _id: event.id, jobId: job._id }, { $set: { step: event.step, steps: event.total } });
          const fraction = (result.ready + result.failed + event.step / event.total) / total;
          await progress('GENERATING', `Đang tạo ảnh ${result.ready + result.failed + 1}/${total} · bước ${event.step}/${event.total}`, Math.round(fraction * 100));
        } else if (event.type === 'loaded') {
          result.loadSeconds = event.seconds; result.loadedAt = new Date();
          await Job.updateOne(fence, { $set: { 'result.loadSeconds': event.seconds, 'result.loadedAt': result.loadedAt } });
        } else if (event.type === 'loading') {
          preset = event.preset;
          result.loadingAt = result.loadingAt ?? new Date();
          await Job.updateOne(fence, { $set: { 'result.loadingAt': result.loadingAt } });
          await progress('LOADING', `Đang nạp model ảnh (${presetFile().presets.find((p) => p.id === event.preset)?.label ?? event.preset})`);
        } else if (event.type === 'image') {
          done.add(event.id);
          await SceneImage.updateOne({ _id: event.id, jobId: job._id }, { $set: { status: 'READY', file: event.path, seconds: event.seconds, cached: !!event.cached, preset: event.preset, downgradedFrom: event.downgradedFrom ?? null, error: null, step: null, steps: null } });
          if (!event.cached) await recordImageTime(event.preset, event.seconds);
          if (event.downgradedFrom) result.downgrades.push(`${event.downgradedFrom}->${event.preset}`);
          result.ready++;
          const next = pending.find((p) => !done.has(String(p._id)));
          current = next ? String(next._id) : null;
          if (next) await SceneImage.updateOne({ _id: next._id }, { $set: { status: 'GENERATING', startedAt: new Date(), step: 0 } });
          await progress('GENERATING', `Đang tạo hình ảnh ${result.ready + result.failed}/${total}`, Math.round(((result.ready + result.failed) / total) * 100));
        } else if (event.type === 'error' && event.id) {
          done.add(event.id);
          console.error('[image-gen]', event.code, String(event.message || '').slice(0, 300));
          await SceneImage.updateOne({ _id: event.id, jobId: job._id }, { $set: { status: 'FAILED', error: String(event.code || 'IMAGE_GENERATION_FAILED') } });
          result.failed++;
          const next = pending.find((p) => !done.has(String(p._id)));
          current = next ? String(next._id) : null;
        } else if (event.type === 'done') {
          result.peakVramMB = Math.max(result.peakVramMB, event.peakVramMB || 0);
          result.peakRamMB = Math.max(result.peakRamMB, event.peakRamMB || 0);
          result.minFreeRamMB = result.minFreeRamMB === null ? event.minFreeRamMB : Math.min(result.minFreeRamMB, event.minFreeRamMB);
        }
      };
      // Serialize event handling so database writes happen in order.
      let chain = Promise.resolve();
      await SceneImage.updateOne({ _id: pending[0]._id }, { $set: { status: 'GENERATING', startedAt: new Date(), step: 0 } });
      const code = await run(['run', jobFile], (event) => { chain = chain.then(() => onEvent(event)).catch(() => undefined); }, controller.signal);
      clearInterval(watch);
      await chain;
      if (cancelled) {
        result.cancelled = true;
        await SceneImage.updateMany({ jobId: job._id, status: { $in: ['PENDING', 'GENERATING'] } }, { $set: { status: 'SKIPPED', error: 'IMAGE_CANCELLED' } });
        break;
      }
      if (stalled && current) {
        await SceneImage.updateOne({ _id: current }, { $set: { status: 'FAILED', error: 'IMAGE_TIMEOUT' } });
        result.failed++;
        continue;
      }
      if (code !== 0) {
        // Worker crashed (e.g. not installed or out of RAM): the remaining scenes use the fallback.
        const left = await SceneImage.updateMany({ jobId: job._id, status: { $in: ['PENDING', 'GENERATING'] } }, { $set: { status: 'FAILED', error: 'IMAGE_WORKER_FAILED' } });
        result.failed += left.modifiedCount;
        break;
      }
    }
    result.skipped = await SceneImage.countDocuments({ jobId: job._id, status: 'SKIPPED' });
    await Job.updateOne(fence, { $set: { status: 'COMPLETED', result, leaseExpiresAt: undefined } });
  } catch (error: any) {
    await SceneImage.updateMany({ jobId: job._id, status: { $in: ['PENDING', 'GENERATING'] } }, { $set: { status: 'FAILED', error: 'IMAGE_WORKER_FAILED' } });
    await Job.updateOne(fence, { $set: { status: 'FAILED', error: /^IMAGE_/.test(error?.message) ? error.message : 'IMAGE_WORKER_FAILED', result } });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

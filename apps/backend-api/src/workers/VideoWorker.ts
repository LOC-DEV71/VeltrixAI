import mongoose from 'mongoose';
import { spawn } from 'node:child_process';
import { mkdir, rename, rm, writeFile, copyFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Job, IJob } from '../models/Job';
import { Scene, type IScene } from '../models/Scene';
import { MediaAsset, type IMediaAsset } from '../models/MediaAsset';
import { Video } from '../models/Video';
import { CreditService } from '../services/CreditService';
import { verifyJobEntitlements, claimPlanJob } from '../services/EntitlementService';
import { VIDEO_STAGES, setJobProgress } from '../services/JobProgress';
import { planStoryboard, type StoryboardPlan } from '../services/VideoStoryboard';
import { chooseTheme, THEME_BG_KEYWORDS, THEME_IDS, themeSeed, type ThemeId } from '../services/VideoTheme';
import { SceneImage } from '../models/SceneImage';
import { alignWords } from '../services/WordTiming';
import { ASPECT_RATIOS, VIDEO_FPS, type AspectRatio } from '../services/VideoService';
import type { Orientation, PexelsProvider } from '../providers/StockMediaProvider';
import type { ContentAiProvider } from '../providers/AiProvider';

export const VIDEO_LEASE_MS = 45 * 60_000;

interface SceneBackground {
  manifest: { kind: 'video' | 'image'; file: string; real?: boolean; credit?: string } | { kind: 'gradient' };
  source: 'AI_IMAGE' | 'WIKIMEDIA' | 'PEXELS_VIDEO' | 'PEXELS' | 'GENERATED';
  credit?: { photographer: string; photographerUrl: string; pageUrl: string };
}

/** The scene's generated AI image, when one is ready and its file still exists. */
async function aiImageBackground(sceneId: unknown, workDir: string, index: number): Promise<SceneBackground | null> {
  const image = await SceneImage.findOne({ sceneId, status: 'READY' }).select('file preset credit sourceUrl').lean();
  if (!image?.file) return null;
  const real = image.preset === 'wikimedia';
  const file = `bg-${index}${real && /\.jpe?g$/i.test(image.file) ? '.jpg' : '.png'}`;
  try {
    await copyFile(image.file, join(workDir, file));
    return { manifest: { kind: 'image', file, ...(real ? { real: true, credit: String(image.credit || 'Wikimedia Commons').slice(0, 160) } : {}) }, source: real ? 'WIKIMEDIA' : 'AI_IMAGE', ...(real && image.credit ? { credit: { photographer: image.credit, photographerUrl: '', pageUrl: image.sourceUrl || '' } } : {}) };
  } catch { return null; }
}

/** Finds and stores one scene background. Stock failures are not fatal: the gradient always works. */
/** Scene keywords first (they carry the content), then the theme's look words. Pexels caps queries, so stay short. */
export const themedQuery = (query: string, theme: ThemeId) => `${query} ${THEME_BG_KEYWORDS[theme]}`.split(/\s+/).filter(Boolean).slice(0, 7).join(' ');

async function findBackground(stock: PexelsProvider | null, query: string, orientation: Orientation, size: { width: number; height: number }, used: Set<string>, workDir: string, index: number): Promise<SceneBackground> {
  if (!stock) return { manifest: { kind: 'gradient' }, source: 'GENERATED' };
  try {
    const video = await stock.searchVideo(query, orientation, size.width, used);
    if (video) {
      used.add(video.providerId);
      await writeFile(join(workDir, `bg-${index}.mp4`), video.bytes);
      return { manifest: { kind: 'video', file: `bg-${index}.mp4` }, source: 'PEXELS_VIDEO', credit: video.credit };
    }
  } catch { /* try a photo */ }
  try {
    const image = await stock.search(query, orientation, size.width, size.height, used);
    if (image && image.extension !== 'svg') {
      if (image.providerId) used.add(image.providerId);
      await writeFile(join(workDir, `bg-${index}.${image.extension}`), image.bytes);
      return { manifest: { kind: 'image', file: `bg-${index}.${image.extension}` }, source: 'PEXELS', credit: image.credit };
    }
  } catch { /* fall through */ }
  return { manifest: { kind: 'gradient' }, source: 'GENERATED' };
}

export class VideoJobError extends Error { constructor(public readonly code: string) { super(code); } }

export interface RenderResult { bytes: number; durationInFrames: number }
export interface VideoWorkerDeps {
  audio: (asset: { publicId: string; sha256: string }) => Promise<Buffer>;
  ai: ContentAiProvider | null;
  stock: PexelsProvider | null;
  render: (manifestPath: string, onProgress: (fraction: number) => void, signal?: AbortSignal) => Promise<RenderResult>;
  storageDir: string;
  workRoot?: string;
}

export const defaultStorageDir = () => resolve(process.env.VIDEO_STORAGE_DIR || resolve(__dirname, '../../.runtime/videos'));
export const rendererScript = () => resolve(process.env.VIDEO_RENDERER_DIR || resolve(__dirname, '../../../../packages/video-renderer'), 'scripts', 'render-job.mjs');

/** Runs packages/video-renderer in a child process and parses its line protocol. */
export function renderWithRemotion(manifestPath: string, onProgress: (fraction: number) => void, signal?: AbortSignal, timeoutMs = 45 * 60_000): Promise<RenderResult> {
  return new Promise((ok, fail) => {
    if (signal?.aborted) return fail(new VideoJobError('VIDEO_CANCELLED'));
    const child = spawn(process.execPath, [rendererScript(), '--manifest', manifestPath], { cwd: resolve(__dirname, '../..'), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let buffer = '', errorLine = '', done: RenderResult | null = null;
    const timer = setTimeout(() => { child.kill(); fail(new VideoJobError('VIDEO_RENDER_TIMEOUT')); }, timeoutMs);
    let aborted = false;
    signal?.addEventListener('abort', () => { aborted = true; child.kill(); }, { once: true });
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim(); buffer = buffer.slice(index + 1);
        if (line.startsWith('PROGRESS ')) onProgress(Math.max(0, Math.min(1, Number(line.slice(9)) || 0)));
        else if (line.startsWith('DONE ')) { try { done = JSON.parse(line.slice(5)); } catch { /* ignore */ } }
      }
    });
    child.stderr.on('data', (chunk) => { const lines = String(chunk).split('\n').filter((l) => l.startsWith('ERROR ')); if (lines.length) errorLine = lines[lines.length - 1]; });
    child.on('error', () => { clearTimeout(timer); fail(new VideoJobError('VIDEO_RENDERER_UNAVAILABLE')); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (aborted) fail(new VideoJobError('VIDEO_CANCELLED'));
      else if (code === 0 && done) ok(done);
      else { if (errorLine) console.error('[video-render]', errorLine.slice(0, 400)); fail(new VideoJobError('VIDEO_RENDER_FAILED')); }
    });
  });
}

export async function claimVideoJob(jobId?: string) {
  return claimPlanJob({ ...(jobId ? { _id: jobId } : {}), type: 'VIDEO_RENDER', reservationId: { $type: 'objectId' } }, VIDEO_LEASE_MS);
}

export async function processVideoJob(job: IJob, deps: VideoWorkerDeps) {
  const fence = { _id: job._id, type: 'VIDEO_RENDER', status: 'PROCESSING', executionClaim: job.executionClaim };
  if (!job.executionClaim || !await Job.exists(fence)) return;
  let leaseValid = true;
  const heartbeat = setInterval(() => {
    Job.updateOne(fence, { $set: { leaseExpiresAt: new Date(Date.now() + VIDEO_LEASE_MS) } })
      .then((r) => { if (!r.matchedCount) leaseValid = false; }).catch(() => { leaseValid = false; });
  }, 30_000);
  heartbeat.unref();
  const progress = (stage: string, message?: string, percent?: number) => setJobProgress(job._id as mongoose.Types.ObjectId, job.executionClaim, VIDEO_STAGES, stage, message, percent);
  // "Dừng" (auto video): poll the cancel flag; abort the renderer and fail the job (credits released below).
  const abort = new AbortController();
  const cancelPoll = setInterval(() => {
    Job.exists({ ...fence, 'payload.cancelRequested': true }).then((hit) => { if (hit) abort.abort(); }).catch(() => undefined);
  }, 2000);
  cancelPoll.unref();
  const assertLease = () => { if (!leaseValid) throw new VideoJobError('VIDEO_CLAIM_LOST'); if (abort.signal.aborted) throw new VideoJobError('VIDEO_CANCELLED'); };
  const workDir = join(deps.workRoot || join(tmpdir(), 'creatorai-video'), String(job._id));
  const videoId = new mongoose.Types.ObjectId();
  const storageKey = `${videoId.toHexString()}.mp4`;
  let finalPath = '';
  let stored = false;

  try {
    // Inside try: a misconfigured storage dir must still fail the job and refund.
    if (!deps.storageDir) throw new VideoJobError('VIDEO_STORAGE_UNAVAILABLE');
    finalPath = join(deps.storageDir, storageKey);
    await progress('PREPARING');
    if (job.attempts > 3) throw new VideoJobError('VIDEO_RETRY_EXHAUSTED');
    await verifyJobEntitlements(job);
    const aspectRatio = job.payload.aspectRatio as AspectRatio;
    const size = ASPECT_RATIOS[aspectRatio];
    if (!size) throw new VideoJobError('VIDEO_INVALID_INPUT');
    const sources = job.payload.scenes as Array<{ sceneId: string; revision: number; audioId: string; order: number }>;
    const items: Array<{ scene: IScene; asset: IMediaAsset }> = [];
    for (const source of sources) {
      const scene = await Scene.findOne({ _id: source.sceneId, projectId: job.payload.projectId, revision: source.revision, ttsAudioId: source.audioId });
      const asset = scene && await MediaAsset.findOne({ _id: source.audioId, ownerId: job.ownerId, sceneId: scene._id });
      if (!scene || !asset) throw new VideoJobError('VIDEO_STALE_SCENES');
      items.push({ scene, asset });
    }
    await mkdir(workDir, { recursive: true });

    await progress('PLANNING');
    // The auto pipeline plans the storyboard right after writing (then stops the LLM). Reuse it
    // when every scene still has a plan for its current revision; otherwise plan now.
    const planned = items.every(({ scene }) => scene.storyboard && scene.storyboardRevision === scene.revision);
    const plan: StoryboardPlan = planned
      ? { scenes: items.map(({ scene }) => { const { bgQuery, ...rest } = scene.storyboard as any; return rest; }), bgQueries: items.map(({ scene }) => String((scene.storyboard as any).bgQuery || '')), usedAi: true, attempts: 0, repaired: false }
      : await planStoryboard(deps.ai, items.map(({ scene }) => ({ narration: scene.narration, title: scene.title, imagePrompt: scene.imagePrompt, visualDescription: scene.visualDescription })));
    assertLease();
    // Theme: stored with the storyboard (auto runs pick it while the LLM is loaded), else chosen now.
    const stored0 = items[0].scene.storyboard as any;
    const picked = planned && stored0?.theme && (THEME_IDS as readonly string[]).includes(stored0.theme)
      ? { theme: stored0.theme as ThemeId, source: String(stored0.themeSource || 'ai') }
      : await chooseTheme(deps.ai, { topic: String(job.payload.topic || items[0].scene.title || ''), narrations: items.map(({ scene }) => scene.narration), choice: job.payload.theme });
    const theme = picked.theme;
    const seed = themeSeed(String(job.payload.projectId));

    // Backgrounds: Pexels vertical video -> Pexels photo -> the renderer's animated gradient.
    const orientation = aspectRatio === '9:16' ? 'portrait' : 'landscape';
    const backgrounds: SceneBackground[] = [];
    const used = new Set<string>();
    for (let i = 0; i < items.length; i++) {
      await progress('MEDIA', `Đang tìm nền video cho cảnh ${i + 1}/${items.length}`);
      backgrounds.push(await aiImageBackground(items[i].scene._id, workDir, i) ?? await findBackground(deps.stock, themedQuery(plan.bgQueries[i], theme), orientation, size, used, workDir, i));
    }
    assertLease();

    const manifestScenes = [];
    for (let i = 0; i < items.length; i++) {
      await progress('AUDIO', `Đang căn thời gian từng từ ${i + 1}/${items.length}`);
      const { asset } = items[i];
      const wav = await deps.audio(asset);
      await writeFile(join(workDir, `audio-${i}.wav`), wav);
      const audioSeconds = Math.max(0.2, Number(asset.duration) || 0.2);
      const words = alignWords(plan.scenes[i].voice, wav, audioSeconds);
      const prompts = { ...(items[i].scene.imagePrompt ? { imagePrompt: String(items[i].scene.imagePrompt).slice(0, 1200) } : {}), ...(items[i].scene.videoPrompt ? { videoPrompt: String(items[i].scene.videoPrompt).slice(0, 1200) } : {}) };
      manifestScenes.push({ scene: { ...plan.scenes[i], ...prompts, words }, audio: `audio-${i}.wav`, audioSeconds, background: backgrounds[i].manifest });
    }
    assertLease();

    await progress('RENDERING', 'Đang dựng video 0%', 0);
    const outputPath = join(workDir, 'output.mp4');
    const manifestPath = join(workDir, 'manifest.json');
    await writeFile(manifestPath, JSON.stringify({ assetsDir: workDir, outputPath, fps: VIDEO_FPS, width: size.width, height: size.height, music: true, theme, seed, scenes: manifestScenes }));
    let lastPercent = -1;
    const rendered = await deps.render(manifestPath, (fraction) => {
      const percent = Math.floor(fraction * 100);
      if (percent !== lastPercent) { lastPercent = percent; void progress('RENDERING', `Đang dựng video ${percent}%`, percent); }
    }, abort.signal);
    assertLease();

    await progress('SAVING');
    await mkdir(deps.storageDir, { recursive: true });
    try { await rename(outputPath, finalPath); } catch { await copyFile(outputPath, finalPath); }
    stored = true;
    const durationSeconds = Math.round((rendered.durationInFrames / VIDEO_FPS) * 100) / 100;
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const owned = await Job.findOne(fence).session(session);
        if (!owned || !leaseValid) throw new VideoJobError('VIDEO_CLAIM_LOST');
        await Video.create([{
          _id: videoId, ownerId: owned.ownerId, projectId: owned.payload.projectId, contentId: owned.payload.contentId, jobId: owned._id,
          contentRevision: owned.payload.contentRevision, aspectRatio, width: size.width, height: size.height, fps: VIDEO_FPS,
          durationSeconds, bytes: rendered.bytes, storageKey,
          scenes: items.map(({ scene, asset }, i) => ({ sceneId: scene._id, order: scene.order, type: plan.scenes[i].type, highlightWord: plan.scenes[i].emphasis[0] || '', imageQuery: plan.bgQueries[i], imageSource: backgrounds[i].source, credit: backgrounds[i].credit, durationSeconds: asset.duration })),
        }], { session });
        await CreditService.settle(owned._id as mongoose.Types.ObjectId, owned.payload.cost, session);
        owned.status = 'COMPLETED';
        owned.leaseExpiresAt = undefined;
        owned.result = { videoId, url: `/api/videos/${videoId}/file`, durationSeconds, bytes: rendered.bytes, chargedCredits: owned.payload.cost };
        await owned.save({ session });
      });
    } finally { await session.endSession(); }
  } catch (error) {
    if (stored) await unlink(finalPath).catch(() => undefined);
    if (error instanceof VideoJobError && error.code === 'VIDEO_CLAIM_LOST') return;
    const code = error instanceof VideoJobError ? error.code : typeof (error as any)?.code === 'string' && /^(PLAN_|VIDEO_)/.test((error as any).code) ? (error as any).code : 'VIDEO_PROCESSING_FAILED';
    if (code === 'VIDEO_PROCESSING_FAILED') console.error('[video-worker]', (error as any)?.message);
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const owned = await Job.findOne(fence).session(session);
        if (!owned || !leaseValid) return;
        await CreditService.release(owned._id as mongoose.Types.ObjectId, session);
        owned.status = 'FAILED'; owned.error = code; owned.leaseExpiresAt = undefined;
        await owned.save({ session });
      });
    } finally { await session.endSession(); }
  } finally {
    clearInterval(heartbeat);
    clearInterval(cancelPoll);
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

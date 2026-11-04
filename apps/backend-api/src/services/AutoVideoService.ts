import mongoose from 'mongoose';
import type { Request, Response } from 'express';
import { AutoVideoRun, type IAutoVideoRun, type AutoVideoStep } from '../models/AutoVideoRun';
import { Job } from '../models/Job';
import { Scene } from '../models/Scene';
import { createProject } from '../controllers/ProjectController';
import { createContent, generateContent } from '../controllers/ContentController';
import { createTtsJob, TtsJobError } from './TtsJobService';
import { createVideoJob, VideoError, ASPECT_RATIOS } from './VideoService';
import { resolveTtsVoice } from './VoiceService';
import { forOwner } from './EntitlementService';
import { publicProgress } from './JobProgress';
import { PlanError } from './PlanSchema';
import { parsePublishAt } from './YouTubePublishService';
import { AudioError } from '../providers/AudioValidation';
import { createContentAiProvider } from '../providers/AiProvider';
import { cancelImageJob, createImageJob, ImageGenError, localStackReady, presetFile, validPreset } from './ImageGenService';
import { CreditService } from './CreditService';
import { chooseTheme, themeChoice } from './VideoTheme';
import { attachRealPhotos } from './RealPhotos';
import { ensureLocalAi, unloadLocalAi } from './LocalAiControl';
import { planStoryboard } from './VideoStoryboard';
import { appendLive, finishLive, startLive } from './LiveText';

export class AutoVideoError extends Error {
  constructor(public readonly code: string, public readonly status = 400) { super(code); }
}

export const MAX_RUNNING_PER_USER = 2;
const LEASE_MS = 60_000;
const TONES = ['funny', 'pro', 'drama'];
const PLATFORMS = ['tiktok', 'shorts', 'reels', 'video'];
const PRIVACY = ['private', 'unlisted', 'public'];

/**
 * Calls an Express handler in-process so the auto pipeline goes through exactly the same
 * validation, quota, credit and idempotency code as the HTTP API.
 */
async function callHandler(handler: (req: Request, res: Response) => unknown, req: { user: { _id: mongoose.Types.ObjectId }; params?: any; body?: any; headers?: Record<string, string> }) {
  let status = 200, body: any = null;
  const res: any = { status(code: number) { status = code; return res; }, json(payload: any) { body = payload; return res; }, setHeader() { return res; } };
  const headers = Object.fromEntries(Object.entries(req.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  await handler({ params: {}, body: {}, query: {}, ...req, headers, get: (name: string) => headers[name.toLowerCase()] } as any, res);
  if (status >= 400 || !body?.success) throw new AutoVideoError(body?.error?.code || 'AUTO_VIDEO_STEP_FAILED', status);
  return body.data;
}

export async function createAutoVideoRun(ownerId: mongoose.Types.ObjectId, input: any) {
  const topic = typeof input?.topic === 'string' ? input.topic.normalize('NFC').trim() : '';
  if (topic.length < 5 || topic.length > 500) throw new AutoVideoError('AUTO_VIDEO_INVALID_INPUT');
  const platform = PLATFORMS.includes(input?.platform) ? input.platform : 'shorts';
  const tone = TONES.includes(input?.tone) ? input.tone : 'pro';
  const audience = typeof input?.audience === 'string' && input.audience.trim() ? input.audience.trim().slice(0, 120) : 'Người xem Việt Nam';
  const aspectRatio = input?.aspectRatio ?? (platform === 'video' ? '16:9' : '9:16');
  if (!(aspectRatio in ASPECT_RATIOS)) throw new AutoVideoError('AUTO_VIDEO_INVALID_INPUT');
  const durationSeconds = input?.durationSeconds === undefined ? undefined : Number(input.durationSeconds);
  if (durationSeconds !== undefined && !Number.isSafeInteger(durationSeconds)) throw new AutoVideoError('AUTO_VIDEO_INVALID_INPUT');
  const publishYoutube = input?.publishYoutube === true;
  const youtubePlaylistId = typeof input?.youtubePlaylistId === 'string' && input.youtubePlaylistId.trim() ? input.youtubePlaylistId.trim() : undefined;
  const youtubeCategoryId = typeof input?.youtubeCategoryId === 'string' && input.youtubeCategoryId.trim() ? input.youtubeCategoryId.trim() : undefined;
  const youtubePrivacy = PRIVACY.includes(input?.youtubePrivacy) ? input.youtubePrivacy : 'private';
  let youtubePublishAt: Date | null = null;
  if (publishYoutube && input?.scheduledAt) {
    try { youtubePublishAt = parsePublishAt(input.scheduledAt); }
    catch { throw new AutoVideoError('YOUTUBE_PUBLISH_AT_INVALID'); }
  }
  if (!mongoose.isObjectIdOrHexString(input?.voiceId)) throw new AutoVideoError('AUTO_VIDEO_VOICE_REQUIRED');
  // AI images are opt-in per run; 'off' (or no preset) keeps the Pexels / gradient backgrounds.
  let imagePreset = 'off';
  if (input?.imagePreset !== undefined && input.imagePreset !== 'off') {
    try { imagePreset = validPreset(input.imagePreset); }
    catch (error) { if (error instanceof ImageGenError) throw new AutoVideoError(error.code, error.status); throw error; }
  }
  const theme = themeChoice(input?.theme);

  // Fail fast on a voice the plan cannot use, before anything is charged.
  try { await resolveTtsVoice(ownerId, String(input.voiceId), undefined, await forOwner(ownerId)); }
  catch (error) { if (error instanceof AudioError) throw new AutoVideoError(error.code, 403); if (error instanceof PlanError) throw new AutoVideoError(error.code, error.status); throw error; }
  if (publishYoutube) {
    const { YouTubeConnection } = await import('../models/YouTubeConnection');
    if (!await YouTubeConnection.exists({ ownerId, status: 'ACTIVE' })) throw new AutoVideoError('YOUTUBE_NOT_CONNECTED', 409);
  }
  if (await AutoVideoRun.countDocuments({ ownerId, status: 'RUNNING' }) >= MAX_RUNNING_PER_USER) throw new AutoVideoError('AUTO_VIDEO_BUSY', 409);

  return AutoVideoRun.create({
    ownerId, status: 'RUNNING', step: 'CREATE',
    input: { topic, platform, audience, tone, durationSeconds, voiceId: new mongoose.Types.ObjectId(String(input.voiceId)), aspectRatio, publishYoutube, youtubePrivacy, youtubePlaylistId, youtubeCategoryId, youtubePublishAt, imagePreset, theme },
  });
}

const fail = async (run: IAutoVideoRun, code: string) => {
  run.status = 'FAILED'; run.failedStep = run.step; run.error = code;
  await run.save();
};
const codeOf = (error: any) =>
  error instanceof AutoVideoError || error instanceof VideoError || error instanceof TtsJobError || error instanceof PlanError || error instanceof AudioError || error instanceof ImageGenError ? String(error.code) : 'AUTO_VIDEO_STEP_FAILED';

/**
 * Plans the visual storyboard once, right after the script is written, while the LLM is loaded.
 * The video worker reuses it (no second LLM call), so the LLM can be stopped to free VRAM.
 */
export async function planAndStoreStoryboard(projectId: mongoose.Types.ObjectId, run?: IAutoVideoRun) {
  const scenes = await Scene.find({ projectId }).sort({ order: 1 });
  if (!scenes.length) return;
  let provider = null;
  try { if (await ensureLocalAi()) provider = createContentAiProvider(); } catch { provider = null; }
  const liveKey = `storyboard:${projectId}`;
  const plan = await planStoryboard(provider, scenes.map((s) => ({ narration: s.narration, title: s.title, imagePrompt: s.imagePrompt, visualDescription: s.visualDescription })), {
    onAttempt: () => startLive(liveKey, 'storyboard'), onToken: (chunk) => appendLive(liveKey, chunk),
  });
  finishLive(liveKey);
  // One theme for the whole video, chosen while the LLM is still loaded.
  const { theme, source } = await chooseTheme(provider, { topic: run?.input.topic || scenes[0].title || '', narrations: scenes.map((s) => s.narration), choice: run?.input.theme });
  await Promise.all(scenes.map((scene, i) => Scene.updateOne({ _id: scene._id, revision: scene.revision }, {
    $set: { storyboard: { ...plan.scenes[i], bgQuery: plan.bgQueries[i], subject: plan.subjects?.[i] || '', theme, themeSource: source }, storyboardRevision: scene.revision },
  })));
  if (run) { run.resolvedTheme = theme; run.themeSource = source; }
  return { theme, source };
}

const THUMBNAIL_LAYOUT = ', main subject in the lower half, dark clean empty negative space in the upper third reserved for a title banner, no text, no letters, no words, no logo, no watermark';

/** Banner text: one line of plain words, at most ~6 words / 32 characters, cut on a word boundary. */
export function cleanHook(raw: string) {
  const text = String(raw || '').normalize('NFC').replace(/["“”«»]/g, '').replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '').replace(/\s+/g, ' ').trim();
  const words = text.split(' ').filter(Boolean).slice(0, 6);
  while (words.length > 1 && words.join(' ').length > 32) words.pop();
  return words.join(' ').slice(0, 40);
}

export async function planAndStoreThumbnail(run: IAutoVideoRun) {
  if (!run.projectId) return;
  const scenes = await Scene.find({ projectId: run.projectId }).sort({ order: 1 }).lean();
  const topic = run.input.topic;
  const isShorts = run.input.aspectRatio === '9:16';

  let provider = null;
  try {
    const { createContentAiProvider } = await import('../providers/AiProvider');
    provider = createContentAiProvider();
  } catch {
    provider = null;
  }

  const instruction = `Bạn là chuyên gia thiết kế YouTube Thumbnail triệu view (CTR chuyên nghiệp).
Nhiệm vụ: Tạo một Image Prompt bằng tiếng Anh và câu Hook bằng tiếng Việt cho Ảnh bìa Thumbnail độc lập của video.
Yêu cầu:
1. Thumbnail là ảnh bìa đại diện thu hút lượt click (CTR cực cao), KHÔNG PHẢI là một phân cảnh video thông thường.
2. Phải có yếu tố gây sốc (Shocking element), bí ẩn (Mystery), tò mò tột đỉnh (Curiosity gap), độ tương phản ánh sáng cinematic cao, chủ thể trung tâm kịch tính.
3. thumbnailPrompt BẮT BUỘC bằng tiếng Anh, phong cách Midjourney/Flux: mô tả chủ thể với biểu cảm kịch tính, góc máy mạnh mẽ, ánh sáng rim lighting / neon moody, độ chi tiết 8k, phong cách photorealistic, khung hình ${isShorts ? 'dọc 9:16 cho YouTube Shorts' : 'ngang 16:9 cho YouTube Video'}. Chủ thể đặt ở nửa dưới khung hình; 1/3 phía trên phải là nền tối, trống, ít chi tiết để đặt banner chữ hook. Ảnh KHÔNG được chứa chữ, ký tự, logo hay watermark (chữ sẽ được chèn sau). Nếu chủ đề nói về người có thật: KHÔNG ghi tên, KHÔNG vẽ chân dung hay khuôn mặt người đó (mô hình không vẽ đúng mặt người thật); dùng biểu tượng, bối cảnh, đồ vật, bóng người ngược sáng không thấy mặt.
4. thumbnailHook: Câu chữ ngắn gọn bằng tiếng Việt (3-6 từ, tối đa 32 ký tự) gây tò mò, BÁM SÁT chủ đề video, sẽ được in lớn trên banner của thumbnail (VD: "BÍ MẬT BỊ GIẤU?", "SỰ THẬT KINH HOÀNG?", "BẠN ĐÃ BỊ LỪA?"). Không dùng emoji, không dùng dấu ngoặc kép.`;

  const prompt = `Chủ đề video: ${topic}
Tóm tắt kịch bản: ${scenes.map((s) => s.narration).filter(Boolean).join(' ').slice(0, 400)}
Định dạng: ${isShorts ? 'YouTube Shorts (9:16)' : 'YouTube Video (16:9)'}

Trả về JSON:
{
  "thumbnailPrompt": "Detailed English prompt for YouTube Thumbnail...",
  "thumbnailHook": "Câu hook tiếng Việt ngắn gọn..."
}`;

  let thumbnailPrompt = '';
  let thumbnailHook = '';

  if (provider) {
    try {
      const res = await provider.generate({
        instruction,
        prompt,
        schema: {
          type: 'object',
          properties: {
            thumbnailPrompt: { type: 'string' },
            thumbnailHook: { type: 'string' },
          },
          required: ['thumbnailPrompt', 'thumbnailHook'],
        },
        maxOutputTokens: 512,
        timeoutMs: 15000,
      });
      const parsed = JSON.parse(res.text);
      if (parsed?.thumbnailPrompt) thumbnailPrompt = String(parsed.thumbnailPrompt).trim();
      if (parsed?.thumbnailHook) thumbnailHook = String(parsed.thumbnailHook).trim();
    } catch (err: any) {
      console.warn('[planThumbnail] AI generation fallback:', err?.message);
    }
  }

  if (!thumbnailPrompt) {
    thumbnailPrompt = `Cinematic YouTube thumbnail cover art for topic "${topic}", hyper-detailed, extremely dramatic focal subject, intense neon and moody cinematic rim lighting, shocking expression, curiosity gap composition, 8k resolution, photorealistic`;
  }

  // The hook is drawn on afterwards as a banner, so the picture must leave room for it and hold no text.
  if (!/banner/i.test(thumbnailPrompt)) thumbnailPrompt += THUMBNAIL_LAYOUT;
  thumbnailHook = cleanHook(thumbnailHook) || cleanHook(topic);

  run.thumbnailPrompt = thumbnailPrompt;
  run.thumbnailHook = thumbnailHook;
  if (!run.thumbnailSceneId) {
    run.thumbnailSceneId = new mongoose.Types.ObjectId();
  }
  await run.save();
}

/** Moves a run forward by at most one step. Safe to call repeatedly; every action is idempotent. */
export async function advanceRun(run: IAutoVideoRun) {
  if (run.status !== 'RUNNING') return;
  const user = { _id: run.ownerId };
  try {
    if (run.step === 'CREATE') {
      if (!run.projectId) {
        const name = run.input.topic.split(/\s+/).slice(0, 12).join(' ').slice(0, 200);
        const project = await callHandler(createProject as any, { user, body: { name } });
        run.projectId = project._id; await run.save();
      }
      if (!run.contentId) {
        const content = await callHandler(createContent as any, { user, body: { projectId: String(run.projectId), rawText: '' } });
        run.contentId = content._id; await run.save();
      }
      const generated = await callHandler(generateContent as any, {
        user, params: { id: String(run.contentId) }, headers: { 'Idempotency-Key': `auto-${run._id}${run.retries ? `-r${run.retries}` : ''}` },
        body: { topic: run.input.topic, platform: run.input.platform, audience: run.input.audience, tone: run.input.tone, language: 'vi-VN', ...(run.input.durationSeconds ? { durationSeconds: run.input.durationSeconds } : {}), sceneCount: 0 },
      });
      run.contentJobId = generated.jobId; run.step = 'WRITE'; await run.save();
      return;
    }

    if (run.step === 'WRITE') {
      const job = await Job.findById(run.contentJobId).select('status error').lean();
      if (!job) return fail(run, 'AUTO_VIDEO_JOB_MISSING');
      if (job.status === 'FAILED' || job.status === 'CANCELLED') return fail(run, String(job.error || 'CONTENT_GENERATION_FAILED'));
      if (job.status === 'COMPLETED') {
        if (!run.storyboardPlanned) {
          await planAndStoreStoryboard(run.projectId as mongoose.Types.ObjectId, run);
          await planAndStoreThumbnail(run);
          // Real people/events/places named by the storyboard get real archival photos (Wikimedia Commons).
          await attachRealPhotos(run.projectId as mongoose.Types.ObjectId, run.ownerId as mongoose.Types.ObjectId).catch(() => 0);
          run.storyboardPlanned = true; await run.save();
        }
        // The LLM is done for this run: stop it so the image model gets the whole GPU.
        if (run.input.imagePreset && run.input.imagePreset !== 'off') await unloadLocalAi().catch(() => undefined);
        run.step = 'IMAGES'; await run.save();
      }
      return;
    }

    if (run.step === 'IMAGES') {
      if (!run.input.imagePreset || run.input.imagePreset === 'off') { run.step = 'VOICE'; await run.save(); return; }
      if (!run.imageJobId) {
        const kind = presetFile().presets.find((p) => p.id === run.input.imagePreset)?.kind;
        if (kind === 'local' && !await localStackReady()) {
          console.warn('[auto-video] image generator not installed; using fallback backgrounds');
          run.step = 'VOICE'; await run.save(); return;
        }
        const job = await createImageJob({ ownerId: run.ownerId, projectId: run.projectId as mongoose.Types.ObjectId, preset: run.input.imagePreset, theme: run.resolvedTheme || run.input.theme, runId: run._id as mongoose.Types.ObjectId });
        if (!job) { run.step = 'VOICE'; await run.save(); return; } // no scene has an image prompt
        run.imageJobId = job._id as mongoose.Types.ObjectId; await run.save();
        return;
      }
      // Image failures never fail the run: those scenes fall back to Pexels or the gradient.
      const job = await Job.findById(run.imageJobId).select('status').lean();
      if (!job || ['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status)) { run.step = 'VOICE'; await run.save(); }
      return;
    }

    if (run.step === 'VOICE') {
      const scenes = await Scene.find({ projectId: run.projectId }).sort({ order: 1 });
      if (!scenes.length) return fail(run, 'VIDEO_NO_SCENES');
      const jobs = await Job.find({ _id: { $in: run.ttsJobIds } }).select('status error payload.sceneId').lean();
      const failed = jobs.find((j) => j.status === 'FAILED' || j.status === 'CANCELLED');
      if (failed) return fail(run, String(failed.error || 'TTS_PROCESSING_FAILED'));
      const covered = new Set(jobs.map((j) => String(j.payload?.sceneId)));
      const remaining = scenes.filter((s) => !covered.has(String(s._id)));
      if (remaining.length) {
        // The plan caps concurrent jobs per user (e.g. 4). Queue only as many TTS jobs as
        // there are free slots; the rest are queued on later ticks as earlier ones finish.
        const max = (await forOwner(run.ownerId)).config.limits.concurrentJobs;
        const pending = await Job.countDocuments({ ownerId: run.ownerId, status: { $in: ['QUEUED', 'PROCESSING'] } });
        const slots = max === null ? remaining.length : Math.max(0, max - pending);
        for (const scene of remaining.slice(0, slots)) {
          try {
            // Keys are stable per run and scene, so a retry after a crash reuses the same job.
            const { job } = await createTtsJob(run.ownerId, String(scene._id), String(run.input.voiceId), `auto-${run._id}-${scene._id}${run.retries ? `-r${run.retries}` : ''}`);
            run.ttsJobIds.push(job._id as mongoose.Types.ObjectId);
            await run.save();
          } catch (error: any) {
            // Another request took the free slot first: wait for the next tick. Any other
            // limit (e.g. the monthly TTS quota on lower plans) is a real failure.
            const busyNow = max !== null && await Job.countDocuments({ ownerId: run.ownerId, status: { $in: ['QUEUED', 'PROCESSING'] } }) >= max;
            if (error?.code === 'PLAN_LIMIT_EXCEEDED' && busyNow) return;
            throw error;
          }
        }
        return;
      }
      if (jobs.every((j) => j.status === 'COMPLETED')) { run.step = 'RENDER'; await run.save(); }
      return;
    }

    if (run.step === 'RENDER') {
      if (!run.videoJobId) {
        // A "Tạo lại" image may still be running: render only once it is finished.
        if (await Job.exists({ type: 'IMAGE_GEN', 'payload.projectId': run.projectId, status: { $in: ['QUEUED', 'PROCESSING'] } })) return;
        const { job } = await createVideoJob(run.ownerId, String(run.contentId), { aspectRatio: run.input.aspectRatio, force: !!run.forceRender });
        run.videoJobId = job._id as mongoose.Types.ObjectId; run.forceRender = false; await run.save();
        return;
      }
      const job = await Job.findById(run.videoJobId).select('status error result').lean();
      if (!job) return fail(run, 'AUTO_VIDEO_JOB_MISSING');
      if (job.status === 'FAILED' || job.status === 'CANCELLED') return fail(run, String(job.error || 'VIDEO_PROCESSING_FAILED'));
      if (job.status === 'COMPLETED') {
        run.videoId = job.result?.videoId;
        // A re-render of an already published video does not upload a second copy.
        run.step = run.input.publishYoutube && !run.publishJobId ? 'PUBLISH' : 'DONE';
        if (run.step === 'DONE') run.status = 'COMPLETED';
        await run.save();
      }
      return;
    }

    if (run.step === 'PUBLISH') {
      const { createYouTubePublishJob } = await import('./YouTubePublishService');
      if (!run.publishJobId) {
        const { job } = await createYouTubePublishJob(run.ownerId, String(run.videoId), {
          privacy: run.input.youtubePrivacy ?? 'private',
          title: run.input.topic,
          playlistId: (run.input as any).youtubePlaylistId,
          categoryId: (run.input as any).youtubeCategoryId,
          publishAt: run.input.youtubePublishAt ?? undefined, lateOk: true,
        });
        run.publishJobId = job._id as mongoose.Types.ObjectId; await run.save();
        return;
      }
      const job = await Job.findById(run.publishJobId).select('status error').lean();
      if (!job) return fail(run, 'AUTO_VIDEO_JOB_MISSING');
      if (job.status === 'FAILED' || job.status === 'CANCELLED') return fail(run, String(job.error || 'YOUTUBE_UPLOAD_FAILED'));
      if (job.status === 'COMPLETED') { run.step = 'DONE'; run.status = 'COMPLETED'; await run.save(); }
    }
  } catch (error) {
    if (codeOf(error) === 'AUTO_VIDEO_STEP_FAILED') console.error('[auto-video]', (error as any)?.message);
    await fail(run, codeOf(error));
  }
}

export const MAX_RETRIES = 3;

/** A finished (or stopped/failed after the script) run whose voice can be replaced. */
export const canRevoice = (run: IAutoVideoRun) => run.status !== 'RUNNING' && !!run.projectId && !!run.contentId && ['IMAGES', 'VOICE', 'RENDER', 'PUBLISH', 'DONE'].includes(run.step);

/**
 * "Đổi giọng": reads every scene again with another voice, then renders the video again.
 * Script, images and thumbnail are kept. A video already on YouTube is not uploaded twice.
 */
export async function revoiceAutoVideoRun(ownerId: mongoose.Types.ObjectId, runId: string, voiceId: unknown) {
  if (!mongoose.isObjectIdOrHexString(runId)) throw new AutoVideoError('NOT_FOUND', 404);
  if (typeof voiceId !== 'string' || !mongoose.isObjectIdOrHexString(voiceId)) throw new AutoVideoError('AUTO_VIDEO_INVALID_INPUT');
  const run = await AutoVideoRun.findOne({ _id: runId, ownerId });
  if (!run) throw new AutoVideoError('NOT_FOUND', 404);
  if (!canRevoice(run)) throw new AutoVideoError('AUTO_VIDEO_NOT_FINISHED', 409);
  if (String(run.input.voiceId) === voiceId) throw new AutoVideoError('AUTO_VIDEO_SAME_VOICE', 409);
  // Same checks as a new run: the plan must allow this voice (clone, premium...).
  try { await resolveTtsVoice(ownerId, voiceId, undefined, await forOwner(ownerId)); }
  catch (error) { if (error instanceof AudioError) throw new AutoVideoError(error.code, 403); if (error instanceof PlanError) throw new AutoVideoError(error.code, error.status); throw error; }
  if (await AutoVideoRun.countDocuments({ ownerId, status: 'RUNNING' }) >= MAX_RUNNING_PER_USER) throw new AutoVideoError('AUTO_VIDEO_BUSY', 409);
  if (run.publishJobId) {
    const publish = await Job.findById(run.publishJobId).select('status').lean();
    if (publish?.status !== 'COMPLETED') run.publishJobId = undefined;
  }
  run.input.voiceId = new mongoose.Types.ObjectId(voiceId);
  run.markModified('input');
  // New TTS jobs for every scene (their keys include `retries`), then a fresh render.
  run.ttsJobIds = []; run.retries += 1; run.videoJobId = undefined; run.forceRender = true;
  run.step = 'VOICE'; run.status = 'RUNNING'; run.error = null; run.failedStep = null; run.leaseUntil = null;
  await run.save();
  return run;
}

export const CANCELLED = 'AUTO_VIDEO_CANCELLED';

/**
 * "Dừng": stops a running workflow now. Queued jobs are cancelled and their held credits released;
 * image generation and a running render are aborted by their workers (credits released there).
 * A content or voice job already running finishes on its own (seconds); its result is kept, so
 * "Chạy lại" continues from the stopped step without paying twice.
 */
export async function cancelAutoVideoRun(ownerId: mongoose.Types.ObjectId, runId: string) {
  if (!mongoose.isObjectIdOrHexString(runId)) throw new AutoVideoError('NOT_FOUND', 404);
  // Atomic: the orchestrator only advances RUNNING runs, so after this it queues nothing new.
  const run = await AutoVideoRun.findOneAndUpdate(
    { _id: runId, ownerId, status: 'RUNNING' },
    [{ $set: { status: 'FAILED', error: CANCELLED, failedStep: '$step', leaseUntil: null } }],
    { new: true },
  );
  if (!run) {
    if (await AutoVideoRun.exists({ _id: runId, ownerId })) throw new AutoVideoError('AUTO_VIDEO_NOT_RUNNING', 409);
    throw new AutoVideoError('NOT_FOUND', 404);
  }
  const ids = [run.contentJobId, ...(run.ttsJobIds || []), run.videoJobId, run.publishJobId].filter(Boolean) as mongoose.Types.ObjectId[];
  let stopped = 0;
  for (const job of await Job.find({ _id: { $in: ids }, status: 'QUEUED' }).select('_id reservationId').lean()) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const updated = await Job.updateOne({ _id: job._id, status: 'QUEUED' }, { $set: { status: 'CANCELLED', error: CANCELLED } }, { session });
        if (updated.modifiedCount && job.reservationId) await CreditService.release(job._id as mongoose.Types.ObjectId, session);
        if (updated.modifiedCount) stopped++;
      });
    } catch (error) { console.warn('[auto-video] cancel job', String(job._id), (error as any)?.message); }
    finally { await session.endSession(); }
  }
  // A render in progress: its worker polls this flag, kills the renderer and releases the credits.
  if (run.videoJobId) stopped += (await Job.updateOne({ _id: run.videoJobId, status: 'PROCESSING' }, { $set: { 'payload.cancelRequested': true } })).modifiedCount;
  if (run.projectId) {
    for (const job of await Job.find({ ownerId, type: 'IMAGE_GEN', 'payload.projectId': run.projectId, status: { $in: ['QUEUED', 'PROCESSING'] } }).select('_id').lean()) {
      await cancelImageJob(ownerId, job._id as mongoose.Types.ObjectId).catch(() => undefined);
      stopped++;
    }
  }
  return { run, stopped };
}

/**
 * Images can be changed while nothing is reading them: before the render starts, or once the run
 * has finished (then "Dựng lại video" puts the new images in).
 */
export const imagesEditable = (run: IAutoVideoRun) =>
  run.status !== 'RUNNING' || (!run.videoJobId && !['RENDER', 'PUBLISH', 'DONE'].includes(run.step));

/** A finished run whose video can be rendered again (e.g. after regenerating images). */
export const canRerender = (run: IAutoVideoRun) => run.status !== 'RUNNING' && !!run.projectId && !!run.contentId && ['RENDER', 'PUBLISH', 'DONE'].includes(run.step);

/** Renders the video again from the current scenes and images. Voice audio is reused. */
export async function rerenderAutoVideoRun(ownerId: mongoose.Types.ObjectId, runId: string) {
  if (!mongoose.isObjectIdOrHexString(runId)) throw new AutoVideoError('NOT_FOUND', 404);
  const run = await AutoVideoRun.findOne({ _id: runId, ownerId });
  if (!run) throw new AutoVideoError('NOT_FOUND', 404);
  if (!canRerender(run)) throw new AutoVideoError('AUTO_VIDEO_NOT_FINISHED', 409);
  if (await AutoVideoRun.countDocuments({ ownerId, status: 'RUNNING' }) >= MAX_RUNNING_PER_USER) throw new AutoVideoError('AUTO_VIDEO_BUSY', 409);
  // Keep a finished upload so the new render does not publish twice; a failed one is retried.
  if (run.publishJobId) {
    const publish = await Job.findById(run.publishJobId).select('status').lean();
    if (publish?.status !== 'COMPLETED') run.publishJobId = undefined;
  }
  run.step = 'RENDER'; run.videoJobId = undefined; run.status = 'RUNNING'; run.forceRender = true;
  run.error = null; run.failedStep = null; run.leaseUntil = null;
  await run.save();
  return run;
}

/**
 * Resumes a failed run from the step that failed. Finished work is kept (content, audio
 * already made); only the failed job is replaced, so nothing is charged twice.
 */
export async function retryAutoVideoRun(ownerId: mongoose.Types.ObjectId, runId: string) {
  if (!mongoose.isObjectIdOrHexString(runId)) throw new AutoVideoError('NOT_FOUND', 404);
  const run = await AutoVideoRun.findOne({ _id: runId, ownerId });
  if (!run) throw new AutoVideoError('NOT_FOUND', 404);
  if (run.status !== 'FAILED') throw new AutoVideoError('AUTO_VIDEO_NOT_FAILED', 409);
  const wasCancelled = run.error === CANCELLED;
  if (!wasCancelled && run.retries >= MAX_RETRIES) throw new AutoVideoError('AUTO_VIDEO_RETRY_LIMIT', 409);
  if (await AutoVideoRun.countDocuments({ ownerId, status: 'RUNNING' }) >= MAX_RUNNING_PER_USER) throw new AutoVideoError('AUTO_VIDEO_BUSY', 409);
  const step = run.failedStep ?? run.step;
  const contentJob = wasCancelled && step === 'WRITE' && run.contentJobId ? await Job.findById(run.contentJobId).select('status').lean() : null;
  if (contentJob && ['QUEUED', 'PROCESSING', 'COMPLETED'].includes(contentJob.status)) {
    // Stopped while the script was being written and that job went on: keep its result.
  } else if (step === 'CREATE' || step === 'WRITE') {
    // Script failed: write it again in the same project/content with a new request key.
    run.step = 'CREATE'; run.contentJobId = undefined;
  } else if (step === 'IMAGES') {
    run.imageJobId = undefined;
  } else if (step === 'VOICE') {
    // Drop only failed TTS jobs; their scenes get new jobs (new keys via `retries`).
    const failed = await Job.find({ _id: { $in: run.ttsJobIds }, status: { $in: ['FAILED', 'CANCELLED'] } }).select('_id').lean();
    const drop = new Set(failed.map((j) => String(j._id)));
    run.ttsJobIds = run.ttsJobIds.filter((id) => !drop.has(String(id)));
  } else if (step === 'RENDER') {
    run.videoJobId = undefined;
  } else if (step === 'PUBLISH') {
    run.publishJobId = undefined;
  }
  run.step = step === 'WRITE' && !(contentJob && ['QUEUED', 'PROCESSING', 'COMPLETED'].includes(contentJob.status)) ? 'CREATE' : step;
  run.status = 'RUNNING'; run.error = null; run.failedStep = null; run.leaseUntil = null;
  // New request keys (they include `retries`); a stop does not count against MAX_RETRIES above.
  run.retries += 1;
  await run.save();
  return run;
}

/** Claims due runs with a short lease and advances each by one step. */
export async function tickAutoVideos(limit = 10) {
  for (let i = 0; i < limit; i++) {
    const now = new Date();
    const run = await AutoVideoRun.findOneAndUpdate(
      { status: 'RUNNING', $or: [{ leaseUntil: null }, { leaseUntil: { $lt: now } }] },
      { $set: { leaseUntil: new Date(now.getTime() + LEASE_MS) } },
      { new: true, sort: { updatedAt: 1 } },
    );
    if (!run) return;
    const before = `${run.step}:${run.status}`;
    try { await advanceRun(run); }
    finally {
      // Release the lease; if nothing changed, wait a few seconds before checking again.
      const changed = `${run.step}:${run.status}` !== before;
      await AutoVideoRun.updateOne({ _id: run._id }, { $set: { leaseUntil: changed ? null : new Date(Date.now() + 3000) } });
    }
  }
}

let ticker: NodeJS.Timeout | null = null;
export function startAutoVideoTicker(intervalMs = 3000) {
  if (ticker) return;
  let busy = false;
  ticker = setInterval(() => {
    if (busy || mongoose.connection.readyState !== 1) return;
    busy = true;
    tickAutoVideos().catch(() => undefined).finally(() => { busy = false; });
  }, intervalMs);
  ticker.unref();
}

const STEP_LABELS: Record<AutoVideoStep, string> = { CREATE: 'Tạo dự án', WRITE: 'AI viết kịch bản', IMAGES: 'Tạo hình ảnh', VOICE: 'Tạo giọng đọc', RENDER: 'Dựng video', PUBLISH: 'Đăng YouTube', DONE: 'Hoàn tất' };

/** Public view with a progress message composed from the underlying jobs. */
export async function runView(run: IAutoVideoRun) {
  let message = STEP_LABELS[run.step];
  if (run.status === 'RUNNING') {
    if (run.step === 'WRITE' && run.contentJobId) {
      const job = await Job.findById(run.contentJobId).select('status progress').lean();
      message = (job && publicProgress(job)?.message) || message;
    } else if (run.step === 'IMAGES' && run.imageJobId) {
      const job = await Job.findById(run.imageJobId).select('status progress').lean();
      message = (job && publicProgress(job)?.message) || message;
    } else if (run.step === 'VOICE' && run.projectId) {
      const done = await Job.countDocuments({ _id: { $in: run.ttsJobIds }, status: 'COMPLETED' });
      const total = await Scene.countDocuments({ projectId: run.projectId });
      message = `Đang tạo giọng đọc ${done}/${total} cảnh`;
    } else if (run.step === 'RENDER' && run.videoJobId) {
      const job = await Job.findById(run.videoJobId).select('status progress').lean();
      message = (job && publicProgress(job)?.message) || message;
    } else if (run.step === 'PUBLISH' && run.publishJobId) {
      const job = await Job.findById(run.publishJobId).select('status progress').lean();
      message = (job && publicProgress(job)?.message) || message;
    }
  }
  return {
    id: run._id, status: run.status, step: run.step, message, error: run.error ?? null, failedStep: run.failedStep ?? null,
    canRetry: run.status === 'FAILED' && (run.error === CANCELLED || run.retries < MAX_RETRIES),
    topic: run.input.topic, aspectRatio: run.input.aspectRatio, publishYoutube: run.input.publishYoutube,
    imagePreset: run.input.imagePreset ?? 'off', imageJobId: run.imageJobId ?? null,
    contentId: run.contentId ?? null, videoId: run.videoId ?? null, videoUrl: run.videoId ? `/api/videos/${run.videoId}/file` : null,
    createdAt: run.createdAt, updatedAt: run.updatedAt,
  };
}

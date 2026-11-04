import { canRerender, canRevoice, imagesEditable } from './AutoVideoService';
import { THEME_LABELS, type ThemeId } from './VideoTheme';
import mongoose from 'mongoose';
import type { IAutoVideoRun } from '../models/AutoVideoRun';
import { Job } from '../models/Job';
import { Scene } from '../models/Scene';
import { MediaAsset } from '../models/MediaAsset';
import { Video } from '../models/Video';
import { Voice } from '../models/Voice';
import { runView } from './AutoVideoService';
import { SceneImage } from '../models/SceneImage';
import { IMAGE_URL_REV, presetFile } from './ImageGenService';
import { completedObjects, readLive } from './LiveText';

export type NodeStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED' | 'SKIPPED';
export type NodeKey = 'write' | 'images' | 'voice' | 'render' | 'publish';
export type EventCategory = 'ai' | 'model' | 'image' | 'voice' | 'render' | 'publish' | 'system';
export interface ActivityEvent { at: Date; seconds: number; kind: 'ok' | 'run' | 'fail' | 'info'; cat: EventCategory; text: string; code?: string }

const NODE_OF_STEP: Record<string, NodeKey | null> = { CREATE: 'write', WRITE: 'write', IMAGES: 'images', VOICE: 'voice', RENDER: 'render', PUBLISH: 'publish', DONE: null };
const ORDER: NodeKey[] = ['write', 'images', 'voice', 'render', 'publish'];
const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
const MAX_EVENTS = 12;
const ALL_EVENTS = 300;
const THINKING_CHARS = 4000;

/**
 * Everything the workflow card shows, derived from the run and its real jobs.
 * Activity times come from stored job timestamps, so the log survives page reloads.
 */
export async function runDetails(run: IAutoVideoRun, options: { allEvents?: boolean } = {}) {
  // Independent reads in parallel: the database is remote, so sequential awaits cost ~45 ms each
  // and this endpoint is polled every 0.7-1.5 s while a run is going.
  const [view, contentJob, scenes, images, imageJob, liveImageJob, ttsJobs, videoJob, video, publishJob, voice] = await Promise.all([
    runView(run),
    run.contentJobId ? Job.findById(run.contentJobId).select('status error progress startedAt updatedAt createdAt').lean() : null,
    run.projectId ? Scene.find({ projectId: run.projectId }).sort({ order: 1 }).select('order title narration ttsAudioId storyboard').lean() : [],
    run.projectId ? SceneImage.find({ projectId: run.projectId }).sort({ order: 1 }).lean() : [],
    run.imageJobId ? Job.findById(run.imageJobId).select('status progress startedAt updatedAt result').lean() : null,
    run.projectId ? Job.findOne({ type: 'IMAGE_GEN', 'payload.projectId': run.projectId, status: { $in: ['QUEUED', 'PROCESSING'] } }).sort({ createdAt: -1 }).select('status progress').lean() : null,
    run.ttsJobIds.length ? Job.find({ _id: { $in: run.ttsJobIds } }).select('status error startedAt updatedAt createdAt payload.sceneId payload.narration').lean() : [],
    run.videoJobId ? Job.findById(run.videoJobId).select('status error progress startedAt updatedAt').lean() : null,
    run.videoId ? Video.findById(run.videoId).select('width height bytes durationSeconds aspectRatio youtube').lean() : null,
    run.publishJobId ? Job.findById(run.publishJobId).select('status error progress startedAt updatedAt').lean() : null,
    Voice.findById(run.input.voiceId).select('name').lean().catch(() => null),
  ]);
  const start = run.createdAt.getTime();
  const events: ActivityEvent[] = [];
  let cat: EventCategory = 'system'; // category of the section being read, used as the log icon
  const push = (at: Date | undefined | null, kind: ActivityEvent['kind'], text: string, code?: string) => {
    if (at) events.push({ at, seconds: Math.max(0, Math.round((at.getTime() - start) / 1000)), kind, cat, text, ...(code ? { code } : {}) });
  };
  push(run.createdAt, 'info', 'Bắt đầu workflow');

  // Node statuses: everything before the current step is done.
  const currentNode = run.status === 'COMPLETED' ? null : NODE_OF_STEP[run.failedStep || run.step];
  const currentIndex = currentNode ? ORDER.indexOf(currentNode) : ORDER.length;
  const status = (key: NodeKey): NodeStatus => {
    if (key === 'publish' && !run.input.publishYoutube) return 'SKIPPED';
    if (key === 'images' && (!run.input.imagePreset || run.input.imagePreset === 'off')) return 'SKIPPED';
    const index = ORDER.indexOf(key);
    if (index < currentIndex) return 'DONE';
    if (index > currentIndex) return 'PENDING';
    return run.status === 'FAILED' ? 'FAILED' : 'RUNNING';
  };

  // Write node.
  const totalWords = scenes.reduce((n, s) => n + words(s.narration), 0);
  cat = 'ai';
  if (contentJob) {
    push(contentJob.startedAt, 'run', 'AI bắt đầu viết kịch bản');
    if (contentJob.status === 'COMPLETED') push(contentJob.updatedAt, 'ok', `Kịch bản xong: ${scenes.length} cảnh, ${totalWords} từ`);
    if (contentJob.status === 'FAILED') push(contentJob.updatedAt, 'fail', 'Viết kịch bản lỗi', String(contentJob.error || ''));
  }

  // Images node: one thumbnail per scene, with time, preset and whether it fell back.
  const labels = new Map(presetFile().presets.map((p) => [p.id, p.label]));
  labels.set('wikimedia', 'Ảnh thật');
  const imageByScene = new Map(images.map((i) => [String(i.sceneId), i]));
  cat = 'model';
  if (imageJob?.result?.loadingAt) push(imageJob.result.loadingAt, 'run', `Nạp model ảnh ${labels.get(String(run.input.imagePreset)) ?? run.input.imagePreset}`);
  if (imageJob?.result?.loadedAt) push(imageJob.result.loadedAt, 'ok', `Model ảnh sẵn sàng (${Number(imageJob.result.loadSeconds || 0).toFixed(1)}s)`);
  cat = 'image';
  if (imageJob?.startedAt) push(imageJob.startedAt, 'run', `Bắt đầu tạo hình ảnh (${labels.get(String(run.input.imagePreset)) ?? run.input.imagePreset})`);
  for (const image of images) {
    const isThumb = image.order === 0;
    const name = isThumb ? 'Ảnh bìa (Thumbnail)' : `Cảnh ${image.order}`;
    if (image.status === 'READY') push(image.updatedAt, 'ok', `${name}: ảnh AI (${labels.get(image.preset) ?? image.preset}${image.cached ? ', từ cache' : `, ${Number(image.seconds || 0).toFixed(1)}s`})${image.downgradedFrom ? ` – hạ từ ${labels.get(image.downgradedFrom) ?? image.downgradedFrom} vì hết VRAM` : ''}`);
    if (image.status === 'FAILED') push(image.updatedAt, 'fail', `${name}: không tạo được ảnh, dùng nền dự phòng`, String(image.error || ''));
    if (image.status === 'SKIPPED') push(image.updatedAt, 'info', `${name}: đã hủy tạo ảnh, dùng nền dự phòng`);
  }
  const imagesReady = images.filter((i) => i.status === 'READY').length;
  const timed = images.filter((i) => i.status === 'READY' && !i.cached && Number(i.seconds) > 0);
  const presetEstimate = presetFile().presets.find((p) => p.id === run.input.imagePreset)?.estimateSeconds ?? 20;
  const avgImageSeconds = timed.length ? timed.reduce((n, i) => n + Number(i.seconds), 0) / timed.length : null;
  const current = images.find((i) => i.status === 'GENERATING');
  const currentFraction = current?.steps ? Math.min(1, Number(current.step || 0) / current.steps) : 0;
  const leftImages = images.filter((i) => i.status === 'PENDING' || i.status === 'GENERATING').length - currentFraction;
  const imagePhase = liveImageJob?.progress?.stage === 'DOWNLOADING' ? 'download' : liveImageJob?.progress?.stage === 'LOADING' || (liveImageJob && !imageJob?.result?.loadedAt && !current) ? 'loading' : liveImageJob ? 'generating' : null;
  const imagesSettled = images.filter((i) => ['READY', 'FAILED', 'SKIPPED'].includes(i.status)).length;

  // Voice node and per-scene rows.
  const jobByScene = new Map(ttsJobs.map((j) => [String(j.payload?.sceneId), j]));
  const assetIds = ttsJobs.filter((j) => j.status === 'COMPLETED').map((j) => j._id);
  const assets = assetIds.length ? await MediaAsset.find({ jobId: { $in: assetIds } }).select('jobId duration').lean() : [];
  const assetByJob = new Map(assets.map((a) => [String(a.jobId), a]));
  let audioSeconds = 0;
  cat = 'voice';
  const sceneRows = scenes.map((scene) => {
    const job = jobByScene.get(String(scene._id));
    const image = imageByScene.get(String(scene._id));
    const asset = job ? assetByJob.get(String(job._id)) : undefined;
    if (asset) audioSeconds += Number(asset.duration || 0);
    if (job?.startedAt) push(job.startedAt, 'run', `Đang đọc cảnh ${scene.order}`);
    if (job?.status === 'COMPLETED' && asset) push(job.updatedAt, 'ok', `Giọng đọc cảnh ${scene.order} xong (${Number(asset.duration).toFixed(1)}s)`);
    if (job?.status === 'FAILED') push(job.updatedAt, 'fail', `Giọng đọc cảnh ${scene.order} lỗi`, String(job.error || ''));
    return {
      sceneId: String(scene._id), order: scene.order, title: scene.title, words: words(scene.narration), chars: [...scene.narration].length,
      status: (job?.status ?? 'PENDING') as string,
      startedAt: job?.startedAt ?? null, completedAt: job?.status === 'COMPLETED' ? job.updatedAt : null,
      audioSeconds: asset ? Number(asset.duration) : null,
      audioUrl: asset ? `/api/media/${asset._id}/audio` : null,
      image: image ? {
        status: image.status, preset: image.preset, presetLabel: labels.get(image.preset) ?? image.preset, seconds: image.seconds ?? null,
        cached: !!image.cached, downgradedFrom: image.downgradedFrom ?? null, error: image.error ?? null,
        step: image.status === 'GENERATING' ? image.step ?? 0 : null, steps: image.status === 'GENERATING' ? image.steps ?? null : null,
        prompt: image.prompt, promptEdited: !!image.promptEdited, credit: image.credit ?? null, sourceUrl: image.sourceUrl ?? null,
        url: image.status === 'READY' && image.file ? `/api/images/${image._id}/file?v=${image.attempt}-${new Date(image.updatedAt).getTime()}-${IMAGE_URL_REV}` : null,
      } : null,
    };
  });
  const voicesDone = sceneRows.filter((s) => s.audioSeconds !== null).length;

  // Render node.
  cat = 'render';
  if (videoJob) {
    push(videoJob.startedAt, 'run', 'Bắt đầu dựng video');
    if (videoJob.status === 'PROCESSING' && videoJob.progress) push(videoJob.progress.updatedAt, 'run', videoJob.progress.message);
    if (videoJob.status === 'COMPLETED' && video) push(videoJob.updatedAt, 'ok', `Video xong ${video.width}×${video.height}`);
    if (videoJob.status === 'FAILED') push(videoJob.updatedAt, 'fail', 'Dựng video lỗi', String(videoJob.error || ''));
  }

  // Publish node.
  cat = 'publish';
  if (publishJob) {
    push(publishJob.startedAt, 'run', 'Bắt đầu tải lên YouTube');
    if (publishJob.status === 'COMPLETED') push(publishJob.updatedAt, 'ok', 'Đã đăng YouTube');
    if (publishJob.status === 'FAILED') push(publishJob.updatedAt, 'fail', 'Đăng YouTube lỗi', String(publishJob.error || ''));
  }
  cat = 'system';
  if (run.status === 'COMPLETED') push(run.updatedAt, 'ok', 'Workflow hoàn tất');
  if (run.status === 'FAILED') push(run.updatedAt, 'fail', 'Workflow dừng vì lỗi', run.error ?? undefined);

  const writeProgress = contentJob?.progress ? { step: contentJob.progress.step, totalSteps: contentJob.progress.totalSteps, message: contentJob.progress.message } : null;
  return {
    ...view,
    platform: run.input.platform,
    // Scripts run about one scene per 6 seconds of narration; used for the writing progress bar.
    voiceId: String(run.input.voiceId || ''),
    canRevoice: canRevoice(run),
    expectedScenes: Math.max(3, Math.round((run.input.durationSeconds || 60) / 6)),
    theme: run.resolvedTheme ? { id: run.resolvedTheme, label: THEME_LABELS[run.resolvedTheme as ThemeId] || run.resolvedTheme, source: run.themeSource || 'ai' } : null,
    voiceName: voice?.name ?? null,
    finishedAt: run.status === 'RUNNING' ? null : run.updatedAt,
    nodes: {
      write: { status: status('write'), progress: writeProgress, stats: scenes.length ? { scenes: scenes.length, words: totalWords } : null, error: status('write') === 'FAILED' ? run.error : null },
      images: {
        status: status('images'), done: imagesSettled, ready: imagesReady, total: images.length,
        preset: run.input.imagePreset ?? 'off', presetLabel: labels.get(String(run.input.imagePreset)) ?? null,
        progress: liveImageJob?.progress ? { stage: liveImageJob.progress.stage, message: liveImageJob.progress.message, percent: liveImageJob.progress.percent ?? null } : null,
        busy: !!liveImageJob,
        phase: imagePhase, avgSeconds: avgImageSeconds !== null ? Math.round(avgImageSeconds * 10) / 10 : null,
        remainingSeconds: liveImageJob && imagePhase === 'generating' ? Math.max(0, Math.round(leftImages * (avgImageSeconds ?? presetEstimate))) : null,
        loadSeconds: imageJob?.result?.loadSeconds ?? null,
        stats: imageJob?.result ? { ready: imageJob.result.ready, failed: imageJob.result.failed, skipped: imageJob.result.skipped, peakVramMB: imageJob.result.peakVramMB } : null,
        canEdit: imagesEditable(run),
        canRerender: canRerender(run),
        error: null,
      },
      voice: { status: status('voice'), done: voicesDone, total: scenes.length, stats: voicesDone ? { audioSeconds: Math.round(audioSeconds * 10) / 10 } : null, error: status('voice') === 'FAILED' ? run.error : null },
      render: { status: status('render'), percent: videoJob?.status === 'COMPLETED' ? 100 : videoJob?.progress?.percent ?? null, message: videoJob?.progress?.message ?? null, stats: video ? { width: video.width, height: video.height, bytes: video.bytes, durationSeconds: video.durationSeconds } : null, error: status('render') === 'FAILED' ? run.error : null },
      publish: { status: status('publish'), percent: publishJob?.status === 'COMPLETED' ? 100 : publishJob?.progress?.percent ?? null, stats: video?.youtube ? { url: video.youtube.url, privacy: video.youtube.privacy } : null, error: status('publish') === 'FAILED' ? run.error : null },
    },
    scenes: sceneRows,
    thumbnail: (() => {
      const thumbImage = images.find((i) => i.order === 0);
      if (!run.thumbnailPrompt && !thumbImage) return null;
      return {
        id: thumbImage?.sceneId ? String(thumbImage.sceneId) : run.thumbnailSceneId ? String(run.thumbnailSceneId) : '',
        prompt: thumbImage?.promptEdited ? thumbImage.prompt : (thumbImage?.prompt || run.thumbnailPrompt || ''),
        promptEdited: thumbImage?.promptEdited ?? false,
        hook: run.thumbnailHook || '',
        status: thumbImage ? thumbImage.status : (['CREATE', 'WRITE'].includes(run.step) ? 'PENDING' : 'PENDING'),
        url: thumbImage?.status === 'READY' ? `/api/images/${thumbImage._id}/file?rev=${IMAGE_URL_REV}` : null,
        seconds: thumbImage?.seconds ?? null,
        step: thumbImage?.step ?? null,
        steps: thumbImage?.steps ?? null,
        error: thumbImage?.error ?? null,
        preset: thumbImage?.preset || run.input.imagePreset || 'balanced',
        presetLabel: labels.get(thumbImage?.preset || run.input.imagePreset || 'balanced') ?? 'Nhanh',
      };
    })(),
    thinking: thinkingView(run, scenes),
    eventsTotal: events.length,
    events: events.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, options.allEvents ? ALL_EVENTS : MAX_EVENTS),
  };
}

/**
 * What the LLM is writing right now (script, then storyboard), plus the scenes finished so far.
 * Scenes come from the live JSON while it streams, then from the database with their scene type.
 */
function thinkingView(run: IAutoVideoRun, scenes: Array<{ order: number; title: string; storyboard?: any }>) {
  const script = run.contentJobId ? readLive(String(run.contentJobId)) : null;
  const storyboard = run.projectId ? readLive(`storyboard:${run.projectId}`) : null;
  const active = storyboard && !storyboard.done ? storyboard : script && !script.done ? script : storyboard ?? script;
  const liveTypes = storyboard ? completedObjects(storyboard.text).map((o) => (typeof o?.type === 'string' ? o.type : null)) : [];
  const rows = scenes.length
    ? scenes.map((s, i) => ({ order: s.order, title: s.title, type: (s.storyboard?.type as string | undefined) ?? liveTypes[i] ?? null }))
    : script ? completedObjects(script.text).map((o, i) => ({ order: i + 1, title: String(o?.title || `Cảnh ${i + 1}`).slice(0, 120), type: null })) : [];
  return {
    phase: active && !active.done ? active.phase : null,
    streaming: !!active && !active.done,
    text: active ? active.text.slice(-THINKING_CHARS) : '',
    scenes: rows,
  };
}

export const isObjectId = (value: unknown) => typeof value === 'string' && mongoose.isObjectIdOrHexString(value);

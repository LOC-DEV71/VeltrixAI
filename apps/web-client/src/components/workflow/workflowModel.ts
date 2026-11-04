// Pure helpers for the workflow card. No React, so they are easy to test.

export type NodeStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED' | 'SKIPPED';
export type NodeKey = 'write' | 'images' | 'voice' | 'render' | 'publish';
export type EventCategory = 'ai' | 'model' | 'image' | 'voice' | 'render' | 'publish' | 'system';

export interface SceneImageInfo {
  status: 'PENDING' | 'GENERATING' | 'READY' | 'FAILED' | 'SKIPPED'; preset: string; presetLabel: string; seconds: number | null;
  cached: boolean; downgradedFrom: string | null; error: string | null; prompt: string; promptEdited: boolean; url: string | null;
  step?: number | null; steps?: number | null;
  credit?: string | null; sourceUrl?: string | null;
}
export interface SceneRow {
  sceneId?: string; order: number; title: string; words: number; chars: number; status: string;
  startedAt: string | null; completedAt: string | null; audioSeconds: number | null; audioUrl: string | null;
  image?: SceneImageInfo | null;
}
export interface ActivityEvent { at: string; seconds: number; kind: 'ok' | 'run' | 'fail' | 'info'; cat?: EventCategory; text: string; code?: string }
export interface ThinkingScene { order: number; title: string; type: string | null }
export interface Thinking { phase: 'script' | 'storyboard' | null; streaming: boolean; text: string; scenes: ThinkingScene[] }
export interface ThumbnailInfo {
  id: string;
  prompt: string;
  promptEdited: boolean;
  hook: string;
  status: 'PENDING' | 'GENERATING' | 'READY' | 'FAILED' | 'SKIPPED';
  url: string | null;
  seconds: number | null;
  step: number | null;
  steps: number | null;
  error: string | null;
  preset: string;
  presetLabel: string;
}

export interface RunDetails {
  id: string; status: 'RUNNING' | 'COMPLETED' | 'FAILED'; step: string; message: string;
  error: string | null; failedStep: string | null; canRetry: boolean; topic: string;
  aspectRatio: '9:16' | '16:9'; publishYoutube: boolean; contentId: string | null; videoId: string | null; videoUrl: string | null;
  createdAt: string; finishedAt: string | null; platform: string; voiceName: string | null; voiceId?: string; canRevoice?: boolean; expectedScenes?: number;
  thumbnail?: ThumbnailInfo | null;
  theme?: { id: string; label: string; source: 'user' | 'ai' | 'keywords' | 'default' | string } | null;
  nodes: {
    write: { status: NodeStatus; progress: { step: number; totalSteps: number; message: string } | null; stats: { scenes: number; words: number } | null; error: string | null };
    images: {
      status: NodeStatus; done: number; ready: number; total: number; preset: string; presetLabel: string | null; busy: boolean; canEdit: boolean; canRerender?: boolean;
      progress: { stage: string; message: string; percent: number | null } | null;
      phase?: 'download' | 'loading' | 'generating' | null; avgSeconds?: number | null; remainingSeconds?: number | null; loadSeconds?: number | null;
      stats: { ready: number; failed: number; skipped: number; peakVramMB: number } | null; error: string | null;
    };
    voice: { status: NodeStatus; done: number; total: number; stats: { audioSeconds: number } | null; error: string | null };
    render: { status: NodeStatus; percent: number | null; message: string | null; stats: { width: number; height: number; bytes: number; durationSeconds: number } | null; error: string | null };
    publish: { status: NodeStatus; percent: number | null; stats: { url: string; privacy: string } | null; error: string | null };
  };
  scenes: SceneRow[];
  thinking?: Thinking;
  events: ActivityEvent[];
  eventsTotal?: number;
}

export const NODE_ORDER: NodeKey[] = ['write', 'images', 'voice', 'render', 'publish'];
/** Weights of the overall bar. "model" (loading the image model) is part of the images node visually. */
const WEIGHTS = { write: 15, model: 5, images: 25, voice: 25, render: 25, publish: 5 } as const;
const DEFAULT_MS_PER_CHAR = 80;

/** "05s", "1m05s", "1h02m". */
export function formatElapsed(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const pad = (n: number) => String(n).padStart(2, '0');
  if (s < 60) return `${pad(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${pad(s % 60)}s`;
  return `${Math.floor(s / 3600)}h${pad(Math.floor((s % 3600) / 60))}m`;
}

/** "Còn khoảng 40 giây" / "Còn khoảng 2 phút". */
export function formatRemaining(seconds: number) {
  const s = Math.max(1, Math.round(seconds));
  if (s < 60) return `Còn khoảng ${s} giây`;
  return `Còn khoảng ${Math.round(s / 60)} phút`;
}

export const formatSeconds = (s: number) => `${s.toFixed(1).replace('.', ',')}s`;

export function formatBytes(bytes: number) {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Speed learnt from finished scenes of this run (ms per character), or a default. */
export function msPerChar(scenes: SceneRow[]) {
  const finished = scenes.filter((s) => s.startedAt && s.completedAt && s.chars > 0);
  if (!finished.length) return DEFAULT_MS_PER_CHAR;
  const total = finished.reduce((n, s) => n + (Date.parse(s.completedAt!) - Date.parse(s.startedAt!)) / s.chars, 0);
  return Math.max(5, total / finished.length);
}

/**
 * Voicing progress of one scene in 0..100. Finished = 100. Running is an estimate from
 * elapsed time and this run's speed, capped at 95 until the job really finishes.
 */
export function scenePercent(scene: SceneRow, now: number, speed: number) {
  if (scene.status === 'COMPLETED') return 100;
  if (scene.status !== 'PROCESSING' || !scene.startedAt) return 0;
  const expected = Math.max(1500, scene.chars * speed);
  return Math.min(95, Math.round(((now - Date.parse(scene.startedAt)) / expected) * 100));
}

/** Script writing: job stages, then scenes streamed so far against the expected count, then storyboard. */
function writeFraction(run: RunDetails) {
  const p = run.nodes.write.progress;
  const thinking = run.thinking;
  if (thinking?.phase === 'storyboard') return 0.9;
  if (run.step !== 'CREATE' && run.step !== 'WRITE') return 1;
  const streamed = thinking?.phase === 'script' ? thinking.scenes.length : 0;
  const expected = Math.max(1, run.expectedScenes ?? 8);
  if (streamed) return Math.min(0.85, 0.12 + 0.73 * Math.min(1, streamed / expected));
  return p && p.totalSteps ? Math.min(0.85, (p.step - 1) / p.totalSteps * 0.5 + 0.05) : 0.03;
}

/** Model loading part of the images step: download %, then loading, then done. */
function modelFraction(run: RunDetails) {
  const node = run.nodes.images;
  if (node.status === 'DONE' || node.status === 'SKIPPED' || node.loadSeconds != null || node.phase === 'generating') return 1;
  if (node.status === 'PENDING') return 0;
  if (node.phase === 'download') return 0.8 * ((node.progress?.percent ?? 0) / 100);
  return node.phase === 'loading' ? 0.85 : 0.05;
}

function imagesFraction(run: RunDetails) {
  const node = run.nodes.images;
  if (node.status === 'DONE' || node.status === 'SKIPPED') return 1;
  if (node.status === 'PENDING' || !node.total) return 0;
  const current = run.scenes.find((s) => s.image?.status === 'GENERATING')?.image;
  const partial = current?.steps ? (current.step ?? 0) / current.steps : 0;
  return Math.min(0.99, (node.done + partial) / node.total);
}

/** Fraction 0..1 of one node's own work (images includes loading the model). */
export function nodeFraction(run: RunDetails, key: NodeKey, now: number) {
  const node = run.nodes[key];
  if (node.status === 'DONE' || node.status === 'SKIPPED') return 1;
  if (node.status === 'PENDING') return 0;
  if (key === 'write') return writeFraction(run);
  if (key === 'images') return (WEIGHTS.model * modelFraction(run) + WEIGHTS.images * imagesFraction(run)) / (WEIGHTS.model + WEIGHTS.images);
  if (key === 'voice') {
    const total = run.nodes.voice.total || run.scenes.length;
    if (!total) return 0;
    const speed = msPerChar(run.scenes);
    return Math.min(0.99, run.scenes.reduce((n, s) => n + scenePercent(s, now, speed) / 100, 0) / total);
  }
  const percent = key === 'render' ? run.nodes.render.percent : run.nodes.publish.percent;
  return percent === null ? 0.02 : Math.min(0.99, percent / 100);
}

/** Overall 0..100 from the weighted steps. Skipped steps (images off, no publishing) are left out. */
export function overallPercent(run: RunDetails, now: number) {
  if (run.status === 'COMPLETED') return 100;
  const imagesOn = run.nodes.images?.status !== 'SKIPPED';
  const parts: Array<[number, number]> = [
    [WEIGHTS.write, nodeFraction(run, 'write', now)],
    ...(imagesOn ? [[WEIGHTS.model, run.nodes.images.status === 'PENDING' ? 0 : modelFraction(run)], [WEIGHTS.images, run.nodes.images.status === 'PENDING' ? 0 : imagesFraction(run)]] as Array<[number, number]> : []),
    [WEIGHTS.voice, nodeFraction(run, 'voice', now)],
    [WEIGHTS.render, nodeFraction(run, 'render', now)],
    ...(run.publishYoutube ? [[WEIGHTS.publish, nodeFraction(run, 'publish', now)]] as Array<[number, number]> : []),
  ];
  const weight = parts.reduce((n, [w]) => n + w, 0);
  return Math.min(99, Math.floor((parts.reduce((n, [w, f]) => n + w * f, 0) / weight) * 100));
}

export type ConnectorState = 'done' | 'running' | 'idle' | 'failed';
/** Line between node i and i+1. */
export function connectorState(run: RunDetails, index: number): ConnectorState {
  const from = run.nodes[NODE_ORDER[index]]?.status ?? 'PENDING', to = run.nodes[NODE_ORDER[index + 1]]?.status ?? 'PENDING';
  // A skipped step (e.g. images turned off) passes the flow through like a finished one.
  const passed = from === 'DONE' || from === 'SKIPPED';
  if (passed && (to === 'DONE' || to === 'SKIPPED')) return 'done';
  if (passed && to === 'RUNNING') return 'running';
  if (passed && to === 'FAILED') return 'failed';
  return 'idle';
}

export const PLATFORM_LABELS: Record<string, string> = { shorts: 'YouTube Shorts', tiktok: 'TikTok', reels: 'Facebook Reels', video: 'YouTube' };

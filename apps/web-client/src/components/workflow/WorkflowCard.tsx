import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MotionConfig, motion } from 'framer-motion';
import { Zap, PenLine, ImageIcon, AudioLines, Clapperboard, CloudUpload, X, LoaderCircle, Play, Pause, Eye, Download, RotateCcw, CircleMinus, ExternalLink, ChevronDown, Square, MonitorPlay as Youtube } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../api';
import { audioUrl, downloadAudio } from '../../hooks/useTtsData';
import { errorMessage } from '../../utils/userMessages';
import { waitForContentJob } from '../../utils/pollContentJob';
import { useYouTube } from '../YouTubeConnect';
import { ActivityTimeline } from './ActivityTimeline';
import { ImagesPanel } from './ImagesPanel';
import { ThinkingPanel } from './ThinkingPanel';
import { VoiceSwitcher } from './VoiceSwitcher';
import { PublishDialog, type PublishSettings } from './PublishDialog';
import {
  NODE_ORDER, PLATFORM_LABELS, connectorState, formatBytes, formatElapsed, formatRemaining, formatSeconds, msPerChar, nodeFraction, overallPercent, scenePercent,
  type NodeKey, type NodeStatus, type RunDetails, type SceneRow,
} from './workflowModel';
import './WorkflowCard.css';

const POLL_MS = 1500;
const POLL_WRITING_MS = 700; // faster while the LLM streams, so the text keeps flowing
const POLL_IDLE_MS = 10_000; // nothing running: a light check so changes from another tab show up
const EASE = [0.16, 1, 0.3, 1] as const;
const NODE_META: Record<NodeKey, { label: string; Icon: typeof PenLine }> = {
  write: { label: 'Viết kịch bản', Icon: PenLine },
  images: { label: 'Tạo hình ảnh', Icon: ImageIcon },
  voice: { label: 'Giọng đọc', Icon: AudioLines },
  render: { label: 'Dựng video', Icon: Clapperboard },
  publish: { label: 'Xuất bản', Icon: CloudUpload },
};
const SHORT_ERRORS: Record<string, string> = {
  PLAN_LIMIT_EXCEEDED: 'Vượt giới hạn gói', INSUFFICIENT_CREDIT: 'Không đủ Credit', TTS_PROCESSING_FAILED: 'TTS lỗi',
  VIDEO_RENDER_FAILED: 'Dựng thất bại', VIDEO_STALE_SCENES: 'Cảnh đã đổi', YOUTUBE_NOT_CONNECTED: 'Cần kết nối YouTube',
  YOUTUBE_REAUTH_REQUIRED: 'Cần kết nối lại', IMAGE_GEN_NOT_INSTALLED: 'Chưa cài bộ tạo ảnh',
  YOUTUBE_QUOTA_EXCEEDED: 'Hết quota YouTube', CONTENT_GENERATION_FAILED: 'AI viết lỗi',
  YOUTUBE_NOT_CONFIGURED: 'Chưa cấu hình YouTube', YOUTUBE_UPLOAD_FAILED: 'Đăng YouTube lỗi',
  YOUTUBE_DAILY_LIMIT: 'Hết lượt đăng hôm nay',
};
const shortError = (code: string | null) => (code && SHORT_ERRORS[code]) || 'Có lỗi xảy ra';

/** Check mark that draws itself (stroke-dashoffset) when a step finishes. */
const DrawnTick: React.FC = () => (
  <svg className="wf-tick" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

interface NodeView { status: NodeStatus; title: React.ReactNode; sub?: React.ReactNode; fraction: number; indeterminate?: boolean }

/** One step of the workflow: status, its own progress bar, a short line and an optional ETA. */
const WorkflowNode: React.FC<{ nodeKey: NodeKey; view: NodeView }> = ({ nodeKey, view }) => {
  const { label, Icon } = NODE_META[nodeKey];
  const { status } = view;
  const frame = {
    PENDING: 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900',
    RUNNING: 'border-violet-500 bg-violet-50/60 wf-glow dark:bg-violet-950/40',
    DONE: 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/30',
    FAILED: 'border-red-500 bg-red-50/60 dark:bg-red-950/30',
    SKIPPED: 'border-dashed border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/60',
  }[status];
  const iconTone = {
    PENDING: 'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500',
    RUNNING: 'bg-violet-600 text-white',
    DONE: 'bg-emerald-500 text-white',
    FAILED: 'bg-red-500 text-white',
    SKIPPED: 'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500',
  }[status];
  const statusText = { PENDING: 'Chờ', RUNNING: 'Đang chạy', DONE: 'Xong', FAILED: 'Lỗi', SKIPPED: 'Bỏ qua' }[status];
  const percent = Math.round(view.fraction * 100);
  return (
    <div className={`relative flex-1 min-w-0 rounded-xl border-2 p-2.5 transition-colors duration-300 ${frame}`} aria-label={`${label}: ${statusText}`}>
      <div className="flex items-center gap-2">
        <span className={`w-7 h-7 shrink-0 rounded-lg flex items-center justify-center transition-colors duration-300 ${iconTone}`}>
          {status === 'RUNNING' ? <LoaderCircle size={15} className="wf-spin" /> : status === 'DONE' ? <DrawnTick /> : status === 'FAILED' ? <X size={15} /> : status === 'SKIPPED' ? <CircleMinus size={15} /> : <Icon size={15} />}
        </span>
        <p className="min-w-0 text-[13px] font-semibold leading-tight text-slate-800 dark:text-slate-100">{label}</p>
      </div>
      <p className={`mt-1.5 text-[13px] font-medium whitespace-nowrap tabular-nums ${status === 'RUNNING' ? 'text-violet-600 dark:text-violet-300' : status === 'DONE' ? 'text-emerald-600 dark:text-emerald-400' : status === 'FAILED' ? 'text-red-600 dark:text-red-400' : 'text-slate-400'}`}>
        {statusText}{status === 'RUNNING' && !view.indeterminate ? ` · ${percent}%` : ''}
      </p>
      <div className="mt-1 text-[13px] text-slate-600 dark:text-slate-300 min-h-[38px] leading-snug break-words">
        <div className="line-clamp-2" title={typeof view.title === 'string' ? view.title : undefined}>{view.title}</div>
        {view.sub ? <div className="text-slate-400 dark:text-slate-500 line-clamp-2">{view.sub}</div> : null}
      </div>
      {(status === 'RUNNING' || status === 'DONE') && (
        <div className="mt-2 h-1.5 rounded-full bg-slate-200/70 dark:bg-slate-800 overflow-hidden relative" role="progressbar" aria-valuenow={view.indeterminate ? undefined : percent} aria-valuemin={0} aria-valuemax={100} aria-label={`Tiến độ ${label}`}>
          {view.indeterminate && status === 'RUNNING'
            ? <div className="wf-shimmer absolute inset-y-0 w-1/3 rounded-full bg-violet-500/80" />
            : <div className={`wf-bar h-full rounded-full ${status === 'DONE' ? 'bg-emerald-500' : 'bg-violet-600'}`} style={{ width: `${status === 'DONE' ? 100 : percent}%` }} />}
        </div>
      )}
    </div>
  );
};

/** SVG line between nodes. Running: flowing dashes with light dots travelling to the next step. */
const Connector: React.FC<{ state: ReturnType<typeof connectorState> }> = ({ state }) => {
  const tone = state === 'done' ? 'text-emerald-500' : state === 'running' ? 'text-violet-600 dark:text-violet-400' : state === 'failed' ? 'text-red-500' : 'text-slate-300 dark:text-slate-600';
  return (
    <svg className={`hidden sm:block w-5 xl:w-8 shrink-0 self-center overflow-visible ${tone}`} height="12" viewBox="0 0 48 12" preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" y1="6" x2="40" y2="6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
        className={state === 'running' ? 'wf-dash' : undefined} strokeDasharray={state === 'idle' ? '3 5' : undefined} />
      <path d="M40 1.5 L47 6 L40 10.5 Z" fill="currentColor" />
      {state === 'running' && (
        <>
          <circle className="wf-dot" cx="3" cy="6" r="3" fill="#c4b5fd" style={{ filter: 'drop-shadow(0 0 3px #8b5cf6)' }} />
          <circle className="wf-dot wf-dot-2" cx="3" cy="6" r="3" fill="#c4b5fd" style={{ filter: 'drop-shadow(0 0 3px #8b5cf6)' }} />
        </>
      )}
    </svg>
  );
};

/** One scene: voicing bar, then audio length and a play button. */
const SceneLine: React.FC<{ scene: SceneRow; percent: number; playing: boolean; onToggle: () => void }> = ({ scene, percent, playing, onToggle }) => {
  const done = scene.status === 'COMPLETED' && scene.audioSeconds !== null;
  const failed = scene.status === 'FAILED';
  const waiting = scene.status === 'QUEUED';
  return (
    <motion.li layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24, ease: EASE }} className="flex items-center gap-3 py-2">
      <span className={`w-7 h-7 shrink-0 rounded-md text-[13px] font-bold flex items-center justify-center ${done ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300' : failed ? 'bg-red-100 text-red-700' : 'bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300'}`}>{scene.order}</span>
      <div className="flex-1 min-w-0">
        <div className="flex justify-between gap-2 text-[13px]">
          <span className="font-medium text-slate-700 dark:text-slate-200 truncate">{scene.title || `Cảnh ${scene.order}`}</span>
          <span className="shrink-0 text-slate-400 tabular-nums">{done ? formatSeconds(scene.audioSeconds!) : failed ? 'Lỗi' : waiting ? 'Đang chờ' : scene.status === 'PROCESSING' ? `${percent}%` : `${scene.words} từ`}</span>
        </div>
        <div className="mt-1.5 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden relative" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={`Giọng đọc cảnh ${scene.order}`}>
          {waiting && <div className="absolute inset-y-0 w-1/3 bg-violet-300/60 wf-shimmer" />}
          <div className={`wf-bar h-full rounded-full ${done ? 'bg-emerald-500' : failed ? 'bg-red-500' : 'bg-violet-500'}`} style={{ width: `${failed ? 100 : percent}%` }} />
        </div>
      </div>
      <button type="button" disabled={!done} onClick={onToggle} aria-label={playing ? `Dừng nghe cảnh ${scene.order}` : `Nghe thử cảnh ${scene.order}`}
        className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center border border-slate-200 text-slate-600 hover:border-violet-400 hover:text-violet-600 disabled:opacity-30 disabled:hover:border-slate-200 disabled:hover:text-slate-600 dark:border-slate-700 dark:text-slate-300">
        {playing ? <Pause size={14} /> : <Play size={14} />}
      </button>
    </motion.li>
  );
};

/** Title, short line, ETA and progress for every node, from the real job data. */
function nodeViews(run: RunDetails, now: number, fetchedAt: number): Record<NodeKey, NodeView> {
  const n = run.nodes;
  const t = run.thinking;
  const speed = msPerChar(run.scenes);
  const writing: NodeView = n.write.status === 'DONE' && n.write.stats
    ? { status: 'DONE', title: <><strong>{n.write.stats.scenes}</strong> cảnh · <strong>{n.write.stats.words}</strong> từ</>, fraction: 1 }
    : n.write.status === 'FAILED' ? { status: 'FAILED', title: <span className="text-red-600 dark:text-red-400">{shortError(n.write.error)}</span>, fraction: 0 }
    : n.write.status === 'RUNNING'
      ? t?.phase === 'storyboard'
        ? { status: 'RUNNING', title: 'Lên storyboard…', sub: 'Chọn kiểu cảnh, icon, từ khóa', fraction: nodeFraction(run, 'write', now) }
        : t?.phase === 'script'
          ? { status: 'RUNNING', title: `Đang viết · ${t.scenes.length} cảnh`, sub: run.expectedScenes ? `Dự kiến ~${run.expectedScenes} cảnh` : undefined, fraction: nodeFraction(run, 'write', now) }
          : { status: 'RUNNING', title: n.write.progress?.message ?? 'Đang chuẩn bị', fraction: nodeFraction(run, 'write', now), indeterminate: !n.write.progress }
      : { status: n.write.status, title: 'Gemma viết và tách cảnh', fraction: 0 };

  const img = n.images;
  const remaining = img.remainingSeconds != null ? Math.max(0, img.remainingSeconds - (now - fetchedAt) / 1000) : null;
  const images: NodeView = img.status === 'SKIPPED' ? { status: 'SKIPPED', title: 'Không tạo ảnh AI', fraction: 1 }
    : img.status === 'DONE' ? { status: 'DONE', title: <><strong>{img.ready}</strong>/{img.total} ảnh AI</>, sub: img.total - img.ready > 0 ? `${img.total - img.ready} dùng nền dự phòng` : img.avgSeconds ? `${formatSeconds(img.avgSeconds)}/ảnh` : undefined, fraction: 1 }
    : img.status === 'RUNNING'
      ? img.phase === 'download' ? { status: 'RUNNING', title: `Tải model ${img.progress?.percent ?? 0}%`, sub: img.progress?.message?.replace('Đang tải model ảnh ', ''), fraction: nodeFraction(run, 'images', now) }
        : img.phase === 'loading' || (!img.done && img.phase !== 'generating') ? { status: 'RUNNING', title: `Nạp model ${img.presetLabel ?? ''}…`, sub: 'Đưa model ảnh lên GPU', fraction: nodeFraction(run, 'images', now) }
        : { status: 'RUNNING', title: `Ảnh ${Math.min(img.total, img.done + 1)}/${img.total}${img.avgSeconds ? ` · ${formatSeconds(img.avgSeconds)}/ảnh` : ''}`, sub: remaining !== null ? formatRemaining(remaining) : undefined, fraction: nodeFraction(run, 'images', now) }
      : { status: img.status, title: img.presetLabel ?? 'Ảnh nền từ prompt', fraction: 0 };

  const voiceLeft = run.scenes.reduce((sum, s) => s.status === 'COMPLETED' ? sum : sum + Math.max(0, s.chars * speed - (s.status === 'PROCESSING' && s.startedAt ? now - Date.parse(s.startedAt) : 0)), 0) / 1000;
  const voice: NodeView = n.voice.status === 'DONE' && n.voice.stats ? { status: 'DONE', title: <>Tổng <strong>{formatSeconds(n.voice.stats.audioSeconds)}</strong> audio</>, fraction: 1 }
    : n.voice.status === 'FAILED' ? { status: 'FAILED', title: <span className="text-red-600 dark:text-red-400">{shortError(n.voice.error)}</span>, fraction: 0 }
    : n.voice.status === 'RUNNING' ? { status: 'RUNNING', title: `Cảnh ${n.voice.done}/${n.voice.total || '…'}`, sub: voiceLeft > 1 ? formatRemaining(voiceLeft) : undefined, fraction: nodeFraction(run, 'voice', now) }
    : { status: n.voice.status, title: run.voiceName ? `Giọng ${run.voiceName}` : 'Tạo audio từng cảnh', fraction: 0 };

  const render: NodeView = n.render.status === 'DONE' && n.render.stats ? { status: 'DONE', title: <><strong>{n.render.stats.width}×{n.render.stats.height}</strong> · {formatBytes(n.render.stats.bytes)}</>, fraction: 1 }
    : n.render.status === 'FAILED' ? { status: 'FAILED', title: <span className="text-red-600 dark:text-red-400">{shortError(n.render.error)}</span>, fraction: 0 }
    : n.render.status === 'RUNNING' ? { status: 'RUNNING', title: n.render.percent !== null ? `Dựng khung hình ${n.render.percent}%` : (n.render.message ?? 'Đang chuẩn bị'), sub: n.render.percent === null ? n.render.message ?? undefined : undefined, fraction: nodeFraction(run, 'render', now), indeterminate: n.render.percent === null }
    : { status: n.render.status, title: run.aspectRatio === '9:16' ? 'MP4 dọc 9:16' : 'MP4 ngang 16:9', fraction: 0 };

  const publish: NodeView = n.publish.status === 'SKIPPED' ? { status: 'SKIPPED', title: 'Không tự đăng', fraction: 1 }
    : n.publish.status === 'DONE' && n.publish.stats ? { status: 'DONE', title: <a href={n.publish.stats.url} target="_blank" rel="noreferrer" className="text-red-600 hover:underline inline-flex items-center gap-1">YouTube <ExternalLink size={12} /></a>, fraction: 1 }
    : n.publish.status === 'FAILED' ? {
        status: n.publish.error === 'YOUTUBE_NOT_CONNECTED' ? 'SKIPPED' : 'FAILED',
        title: n.publish.error === 'YOUTUBE_NOT_CONNECTED' ? <span className="text-amber-600 dark:text-amber-400 font-medium">Cần kết nối YouTube</span> : <span className="text-red-600 dark:text-red-400">{shortError(n.publish.error)}</span>,
        fraction: 0
      }
    : n.publish.status === 'RUNNING' ? { status: 'RUNNING', title: n.publish.percent !== null ? `Tải lên ${n.publish.percent}%` : 'Đang chuẩn bị', fraction: nodeFraction(run, 'publish', now), indeterminate: n.publish.percent === null }
    : { status: n.publish.status, title: 'Đăng YouTube', fraction: 0 };

  return { write: writing, images, voice, render, publish };
}

interface Props { runId: string; onChanged: () => void; defaultExpanded?: boolean }

const PRIVACY_LABEL: Record<PublishSettings['privacy'], string> = { private: 'riêng tư', unlisted: 'không công khai', public: 'công khai' };
const THEME_SOURCE: Record<string, string> = { user: 'Bạn chọn', ai: 'AI chọn theo chủ đề', keywords: 'Chọn theo từ khóa chủ đề', default: 'Không nhận ra chủ đề, dùng phong cách chung' };

export const WorkflowCard: React.FC<Props> = ({ runId, onChanged, defaultExpanded = true }) => {
  const [run, setRun] = useState<RunDetails | null>(null);
  const [fetchedAt, setFetchedAt] = useState(() => Date.now());
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
  const expanded = userExpanded ?? defaultExpanded;
  const [now, setNow] = useState(() => Date.now());
  const [previewOpen, setPreviewOpen] = useState(false);
  const [playing, setPlaying] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const { youtube, reloadYouTube } = useYouTube();
  const lastStatus = useRef<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    const data: RunDetails = (await api.get(`/auto-videos/${runId}/details`, { signal })).data.data;
    setRun(data);
    setFetchedAt(Date.now());
    if (lastStatus.current && lastStatus.current !== data.status) onChanged();
    lastStatus.current = data.status;
    return data;
  }, [runId, onChanged]);

  // Poll details for as long as the card is mounted. Never stops on its own: a finished run can
  // start again ("Thử lại", "Dựng lại", "Đổi giọng") or regenerate images while it shows COMPLETED.
  // `kick()` refreshes right away after any action, so the card never looks frozen.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const kickRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    const controller = new AbortController();
    let inFlight = false;
    const delayFor = (data: RunDetails | null) => {
      if (!data) return POLL_MS * 2;
      const active = data.status === 'RUNNING' || data.nodes.images?.busy || data.thumbnail?.status === 'PENDING' || data.thumbnail?.status === 'GENERATING'
        || data.scenes.some((s) => s.image?.status === 'PENDING' || s.image?.status === 'GENERATING');
      if (!active) return POLL_IDLE_MS;
      const fast = data.thinking?.streaming || data.step === 'WRITE' || data.step === 'CREATE' ? POLL_WRITING_MS : POLL_MS;
      return typeof document !== 'undefined' && document.hidden ? Math.max(fast, 5000) : fast;
    };
    const schedule = (ms: number) => { if (timer.current) clearTimeout(timer.current); if (!controller.signal.aborted) timer.current = setTimeout(tick, ms); };
    async function tick() {
      if (inFlight) return;
      inFlight = true;
      let data: RunDetails | null = null;
      try { data = await load(controller.signal); } catch { /* network blip: retry below */ }
      finally { inFlight = false; }
      schedule(delayFor(data));
    }
    kickRef.current = () => { if (timer.current) clearTimeout(timer.current); void tick(); };
    // Coming back to the tab: refresh at once instead of waiting for a slow tick.
    const onVisible = () => { if (!document.hidden) kickRef.current(); };
    document.addEventListener('visibilitychange', onVisible);
    void tick();
    return () => { controller.abort(); if (timer.current) clearTimeout(timer.current); document.removeEventListener('visibilitychange', onVisible); kickRef.current = () => undefined; };
  }, [load]);
  const kick = useCallback(() => kickRef.current(), []);

  // Clock for the timer, ETAs and estimated bars.
  const running = run?.status === 'RUNNING';
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [running]);
  useEffect(() => () => { audio.current?.pause(); }, []);

  const speed = useMemo(() => (run ? msPerChar(run.scenes) : 80), [run]);
  // "Dừng" confirm state. Hooks must stay above the loading early return below.
  const [confirmStop, setConfirmStop] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false); // "Đăng YouTube" settings dialog
  useEffect(() => { if (!confirmStop) return; const t = setTimeout(() => setConfirmStop(false), 4000); return () => clearTimeout(t); }, [confirmStop]);
  if (!run) {
    return <div className={`rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 ${expanded ? 'h-48' : 'h-20'} animate-pulse`} aria-busy="true" />;
  }

  const toggleExpand = () => {
    if (expanded) { audio.current?.pause(); setPlaying(null); setPreviewOpen(false); }
    setUserExpanded(!expanded);
  };

  const elapsed = ((run.finishedAt ? Date.parse(run.finishedAt) : now) - Date.parse(run.createdAt)) / 1000;
  const percent = overallPercent(run, now);
  const views = nodeViews(run, now, fetchedAt);
  const voicedCount = run.scenes.filter((s) => s.audioSeconds !== null).length;

  const toggleAudio = (scene: SceneRow) => {
    if (!scene.audioUrl) return;
    if (playing === scene.order) { audio.current?.pause(); setPlaying(null); return; }
    audio.current?.pause();
    const element = new Audio(audioUrl(scene.audioUrl));
    element.onended = () => setPlaying(null);
    element.play().then(() => setPlaying(scene.order)).catch(() => toast.error('Không phát được audio.'));
    audio.current = element;
  };

  const retry = async () => {
    setBusy(true);
    try { await api.post(`/auto-videos/${run.id}/retry`); toast.success('Đang chạy lại từ bước bị lỗi'); onChanged(); kick(); }
    catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };

  // "Dừng": two clicks (the first arms it for 4 s) so a stray click does not stop a long run.
  const stop = async () => {
    if (!confirmStop) { setConfirmStop(true); return; }
    setConfirmStop(false); setBusy(true);
    try { await api.post(`/auto-videos/${run.id}/cancel`); toast.success('Đã dừng. Bấm "Chạy tiếp" để làm tiếp từ bước đang dở.'); onChanged(); kick(); }
    catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };

  // "Đăng YouTube": ask for title, visibility, playlist, category and time first; upload on confirm.
  const publish = async () => {
    if (!run.videoId) return;
    // State unknown (e.g. it failed to load while the API restarted): check now instead of hiding the button.
    const state = youtube ?? await reloadYouTube();
    if (!state) { toast.error('Không kiểm tra được kết nối YouTube, thử lại sau ít giây.'); return; }
    if (!state.configured) { toast.error(errorMessage('YOUTUBE_NOT_CONFIGURED')); return; }
    if (!state.connected) {
      try { window.location.assign((await api.get('/youtube/auth-url', { params: { returnPath: '/auto-video' } })).data.data.url); } catch (err) { toast.error(errorMessage(err)); }
      return;
    }
    setPublishOpen(true);
  };
  const doPublish = async (settings: PublishSettings) => {
    if (!run.videoId) return;
    setBusy(true);
    try {
      const jobId = (await api.post(`/videos/${run.videoId}/youtube`, settings)).data.data.jobId;
      setPublishOpen(false);
      toast.success(settings.publishAt ? 'Đang tải lên, video sẽ tự công khai đúng giờ hẹn' : 'Đang tải video lên YouTube');
      const controller = new AbortController();
      const job = await waitForContentJob(async () => (await api.get(`/jobs/${jobId}`)).data.data, controller.signal, { intervalMs: 3000, maxWaitMs: 70 * 60_000 });
      if (job.status === 'COMPLETED') toast.success(settings.publishAt ? `Đã tải lên, hẹn công khai lúc ${new Date(settings.publishAt).toLocaleString('vi-VN')}` : `Đã đăng YouTube (${PRIVACY_LABEL[settings.privacy]})`);
      else toast.error(errorMessage(job.failedReason || 'YOUTUBE_UPLOAD_FAILED'));
      void reloadYouTube(); kick();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };

  const statusLine = run.status === 'COMPLETED' ? `Hoàn tất sau ${formatElapsed(elapsed)}`
    : run.status === 'FAILED' ? (run.error === 'AUTO_VIDEO_CANCELLED' ? 'Bạn đã dừng workflow' : run.error ? errorMessage(run.error) : 'Workflow dừng vì lỗi')
    : run.message;
  const youtubeUrl = run.nodes.publish.stats?.url;
  const footerTone = run.status === 'FAILED' ? 'text-red-700 dark:text-red-400' : run.status === 'COMPLETED' ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-300';
  const showThinking = !!run.thinking && (run.thinking.streaming || run.thinking.text.length > 0 || run.thinking.scenes.length > 0);

  return (
    <MotionConfig reducedMotion="user" transition={{ duration: 0.26, ease: EASE }}>
      <article className="rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900 overflow-hidden" aria-label={`Workflow: ${run.topic}`}>
        <header onClick={!expanded ? toggleExpand : undefined}
          className={`flex items-center justify-between gap-4 px-5 pt-5 ${!expanded ? 'pb-5 cursor-pointer hover:bg-slate-50/50 dark:hover:bg-slate-800/40 transition-colors' : ''}`}>
          <div className="flex gap-3 min-w-0">
            <span className="w-10 h-10 shrink-0 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 text-white flex items-center justify-center shadow-md shadow-violet-200 dark:shadow-none"><Zap size={20} fill="currentColor" /></span>
            <div className="min-w-0">
              <h3 className="font-bold text-slate-800 dark:text-slate-100 truncate" title={run.topic}>{run.topic}</h3>
              <p className="text-[13px] text-slate-500 dark:text-slate-400 truncate">Workflow · {PLATFORM_LABELS[run.platform] || run.platform} · {run.voiceName || 'Giọng đọc'}{run.theme ? <> · <span title={THEME_SOURCE[run.theme.source] || ''}>Phong cách {run.theme.label}{run.theme.source === 'user' ? '' : ' (tự chọn)'}</span></> : null}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="text-right">
              <p className={`text-3xl font-extrabold tabular-nums leading-none ${run.status === 'FAILED' ? 'text-red-600' : run.status === 'COMPLETED' ? 'text-emerald-600' : 'text-violet-600 dark:text-violet-400'}`} aria-label={`Tiến độ ${percent}%`}>{percent}%</p>
              <p className="text-[13px] text-slate-500 dark:text-slate-400 tabular-nums mt-1" aria-label="Thời gian đã chạy">⏱ {formatElapsed(elapsed)}</p>
            </div>
            {run.status === 'RUNNING' && (
              <button type="button" disabled={busy} onClick={(e) => { e.stopPropagation(); void stop(); }}
                aria-label={confirmStop ? 'Bấm lần nữa để dừng workflow' : 'Dừng workflow'} title="Dừng ngay. Credit của bước chưa chạy được hoàn lại."
                className={`inline-flex items-center gap-1.5 h-8 rounded-lg px-2.5 text-[13px] font-semibold transition-colors disabled:opacity-60 ${confirmStop ? 'bg-red-600 text-white hover:bg-red-700' : 'border border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950/40'}`}>
                <Square size={11} fill="currentColor" /> {confirmStop ? 'Bấm lần nữa để dừng' : 'Dừng'}
              </button>
            )}
            <button type="button" onClick={(e) => { e.stopPropagation(); toggleExpand(); }} aria-expanded={expanded}
              aria-label={expanded ? 'Thu gọn chi tiết video' : 'Mở rộng chi tiết video'} title={expanded ? 'Thu gọn' : 'Mở rộng'}
              className="w-8 h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:border-violet-400 hover:text-violet-600 dark:hover:border-violet-400 flex items-center justify-center transition-colors shrink-0">
              <ChevronDown size={18} className={`transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
            </button>
          </div>
        </header>
        {/* Overall bar, weighted by step */}
        <div className={`px-5 ${expanded ? 'pt-3' : 'pb-4 -mt-2'}`}>
          <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Tiến độ tổng">
            <div className={`wf-bar h-full rounded-full ${run.status === 'FAILED' ? 'bg-red-500' : run.status === 'COMPLETED' ? 'bg-emerald-500' : 'bg-gradient-to-r from-violet-600 to-indigo-500'}`} style={{ width: `${percent}%` }} />
          </div>
        </div>

        {expanded && (
          <>
            <div className="flex flex-col sm:flex-row items-stretch gap-2 sm:gap-0 px-5 pt-4">
              {NODE_ORDER.map((key, i) => (
                <React.Fragment key={key}>
                  <WorkflowNode nodeKey={key} view={views[key]} />
                  {i < NODE_ORDER.length - 1 && <Connector state={connectorState(run, i)} />}
                </React.Fragment>
              ))}
            </div>

            <div className="grid lg:grid-cols-[minmax(0,1fr)_340px] gap-5 px-5 pt-5">
              <div className="space-y-5 min-w-0">
                <ImagesPanel run={run} now={now} fetchedAt={fetchedAt} onChanged={kick} />
                <section aria-label="Danh sách cảnh">
                  <h4 className="text-[13px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Giọng đọc · cảnh {voicedCount}/{run.scenes.length || '…'}</h4>
                  {run.scenes.length ? (
                    <ul className="mt-1 divide-y divide-slate-100 dark:divide-slate-800 max-h-72 overflow-y-auto pr-1">
                      {run.scenes.map((scene) => <SceneLine key={scene.order} scene={scene} percent={scenePercent(scene, now, speed)} playing={playing === scene.order} onToggle={() => toggleAudio(scene)} />)}
                    </ul>
                  ) : (
                    <div className="mt-3 space-y-2" aria-busy={run.status === 'RUNNING'}>
                      {run.status === 'RUNNING' ? [0, 1, 2].map((i) => <div key={i} className="h-9 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse motion-reduce:animate-none" />) : null}
                      <p className="text-[13px] text-slate-400">{run.status === 'RUNNING' ? 'Cảnh sẽ hiện khi AI viết xong.' : 'Chưa có cảnh.'}</p>
                    </div>
                  )}
                </section>
              </div>
              <div className="space-y-5 min-w-0">
                {showThinking && <ThinkingPanel thinking={run.thinking} running={run.status === 'RUNNING'} />}
                <ActivityTimeline runId={run.id} events={run.events} total={run.eventsTotal ?? run.events.length} />
              </div>
            </div>

            {previewOpen && run.videoUrl && (
              <div className="px-5 pt-5">
                <video controls autoPlay preload="metadata" src={audioUrl(run.videoUrl)} className={`rounded-xl bg-black mx-auto ${run.aspectRatio === '9:16' ? 'w-[240px] aspect-[9/16]' : 'w-full max-w-[640px] aspect-video'}`} />
              </div>
            )}

            <footer className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 px-5 py-3">
              <p className={`text-sm min-w-0 flex items-center gap-2 ${footerTone}`} role="status">
                {run.status === 'RUNNING' && <span className="w-2 h-2 rounded-full bg-violet-500 animate-pulse motion-reduce:animate-none shrink-0" />}
                <span className="truncate">{statusLine}</span>
              </p>
              <div className="flex flex-wrap gap-2">
                {run.videoUrl && (
                  <>
                    <button type="button" onClick={() => setPreviewOpen((v) => !v)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:border-violet-400"><Eye size={15} /> {previewOpen ? 'Ẩn xem trước' : 'Xem trước'}</button>
                    <button type="button" onClick={() => downloadAudio(`${run.videoUrl}?download=1`, `veltrix-${run.videoId}.mp4`).catch(() => toast.error('Không tải được video.'))} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:border-violet-400"><Download size={15} /> MP4</button>
                    {youtubeUrl ? (
                      <a href={youtubeUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700"><ExternalLink size={15} /> Mở YouTube</a>
                    ) : !youtube || youtube.configured ? (
                      !youtube || youtube.connected ? (
                        <button type="button" disabled={busy} onClick={publish} className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"><CloudUpload size={15} /> {busy ? 'Đang đăng…' : 'Đăng YouTube'}</button>
                      ) : (
                        <Link to="/account/settings" className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 transition-colors"><Youtube size={15} /> Kết nối YouTube</Link>
                      )
                    ) : null}
                  </>
                )}
                {run.canRevoice && (
                  <VoiceSwitcher runId={run.id} currentVoiceId={run.voiceId || ''} sceneCount={run.scenes.length} onStarted={() => { onChanged(); kick(); }} />
                )}
                {run.status === 'FAILED' && run.canRetry && (
                  <button type="button" disabled={busy} onClick={retry} className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60"><RotateCcw size={15} /> {busy ? 'Đang gửi…' : run.error === 'AUTO_VIDEO_CANCELLED' ? 'Chạy tiếp' : 'Thử lại từ bước lỗi'}</button>
                )}
              </div>
            </footer>
          </>
        )}
        <PublishDialog open={publishOpen} defaultTitle={run.topic.slice(0, 100)} busy={busy} onCancel={() => setPublishOpen(false)} onConfirm={(settings) => { void doPublish(settings); }} />
      </article>
    </MotionConfig>
  );
};

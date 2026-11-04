import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Clapperboard, Download, RefreshCw, MonitorPlay as Youtube } from 'lucide-react';
import { YouTubeConnect, useYouTube } from './YouTubeConnect';
import toast from 'react-hot-toast';
import { api } from '../api';
import { Button } from './ui/Button';
import { JobProgressSteps, type StepDefinition } from './JobProgressSteps';
import { waitForContentJob, type JobProgress } from '../utils/pollContentJob';
import { errorMessage } from '../utils/userMessages';
import { audioUrl, downloadAudio } from '../hooks/useTtsData';

// Must match VIDEO_STAGES in backend-api/src/services/JobProgress.ts (plus the queue step).
const VIDEO_STEPS: StepDefinition[] = [
  { stage: 'QUEUED', label: 'Chờ máy dựng video' },
  { stage: 'PREPARING', label: 'Kiểm tra phân cảnh' },
  { stage: 'PLANNING', label: 'AI lên storyboard' },
  { stage: 'MEDIA', label: 'Tìm video nền' },
  { stage: 'AUDIO', label: 'Chuẩn bị giọng đọc' },
  { stage: 'RENDERING', label: 'Dựng video' },
  { stage: 'SAVING', label: 'Lưu video' },
];

interface VideoInfo {
  id: string; aspectRatio: '9:16' | '16:9'; durationSeconds: number; bytes: number; createdAt: string; url: string;
  credits: Array<{ order: number; photographer: string; photographerUrl: string; pageUrl: string }>;
  youtube: { url: string; privacy: string } | null;
}
type JobView = { id: string; status: string; failedReason: string | null; progress: JobProgress | null };
interface VideoState {
  sceneCount: number; missingAudioSceneOrders: number[]; audioSeconds: number; cost: number;
  latestJob: JobView | null;
  publishJob: JobView | null;
  videos: VideoInfo[];
}
const PRIVACY_LABELS: Record<string, string> = { private: 'Riêng tư', unlisted: 'Không công khai', public: 'Công khai' };

/** Publish the latest video to the connected YouTube channel. */
const YouTubePublish: React.FC<{ video: VideoInfo; job: JobView | null; onDone: () => void }> = ({ video, job, onDone }) => {
  const { youtube, reloadYouTube } = useYouTube();
  const [privacy, setPrivacy] = useState<'private' | 'unlisted' | 'public'>('private');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const follow = useCallback(async (jobId: string) => {
    setBusy(true);
    const controller = new AbortController();
    try {
      const result = await waitForContentJob(async () => (await api.get(`/jobs/${jobId}`, { signal: controller.signal })).data.data, controller.signal, { intervalMs: 3000, maxWaitMs: 70 * 60_000, onUpdate: (j) => j.progress && setProgress(j.progress) });
      if (result.status === 'COMPLETED') toast.success('Đã đăng lên YouTube!'); else toast.error(errorMessage(result.failedReason || 'YOUTUBE_UPLOAD_FAILED'));
    } catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(false); setProgress(null); onDone(); void reloadYouTube(); }
  }, [onDone, reloadYouTube]);
  useEffect(() => { if (job && ['QUEUED', 'PROCESSING'].includes(job.status) && !busy) void follow(job.id); }, [job?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (video.youtube) return <a href={video.youtube.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-semibold text-red-600 hover:text-red-700"><Youtube size={16} /> Đã đăng YouTube ({PRIVACY_LABELS[video.youtube.privacy] || video.youtube.privacy})</a>;
  if (!youtube?.configured) return null;
  if (!youtube.connected) return <YouTubeConnect state={youtube} onChange={reloadYouTube} returnPath="/content/scenes" />;
  const publish = async () => {
    try { void follow((await api.post(`/videos/${video.id}/youtube`, { privacy })).data.data.jobId); }
    catch (err) { toast.error(errorMessage(err)); }
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <select aria-label="Chế độ hiển thị trên YouTube" value={privacy} disabled={busy} onChange={(e) => setPrivacy(e.target.value as any)} className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white">
          {Object.entries(PRIVACY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <Button variant="outline" disabled={busy} onClick={publish} className="gap-2 text-red-600 border-red-200 hover:bg-red-50"><Youtube size={16} /> {busy ? 'Đang đăng...' : 'Đăng YouTube'}</Button>
      </div>
      {busy && progress?.message && <p className="text-xs text-slate-500">{progress.message}</p>}
      {job?.status === 'FAILED' && !busy && <p className="text-xs text-red-600">{errorMessage(job.failedReason || 'YOUTUBE_UPLOAD_FAILED')}</p>}
    </div>
  );
};

interface Props {
  contentId: string;
  /** Changes whenever scene audio changes, so readiness is reloaded. */
  refreshKey: string;
  /** True while scenes have unsaved edits or audio jobs running. */
  busy: boolean;
}

const formatSize = (bytes: number) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;

export const VideoPanel: React.FC<Props> = ({ contentId, refreshKey, busy }) => {
  const [state, setState] = useState<VideoState | null>(null);
  const [aspectRatio, setAspectRatio] = useState<'9:16' | '16:9'>('9:16');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const poll = useRef<AbortController | null>(null);
  useEffect(() => () => poll.current?.abort(), []);

  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await api.get(`/contents/${contentId}/video`, { signal });
    setState(response.data.data);
    return response.data.data as VideoState;
  }, [contentId]);

  const follow = useCallback(async (jobId: string) => {
    poll.current?.abort();
    const controller = new AbortController();
    poll.current = controller;
    setRunning(true); setFailure(null); setStartedAt((s) => s ?? Date.now());
    try {
      const job = await waitForContentJob(async () => (await api.get(`/jobs/${jobId}`, { signal: controller.signal })).data.data, controller.signal, {
        intervalMs: 3000, maxWaitMs: 40 * 60_000,
        onUpdate: (polled) => { if (polled.progress) setProgress(polled.progress); },
      });
      if (controller.signal.aborted) return;
      if (job.status === 'COMPLETED') toast.success('Video đã dựng xong!');
      else setFailure(job.failedReason || 'VIDEO_PROCESSING_FAILED');
      await load();
    } catch (err: any) {
      if (!controller.signal.aborted) setFailure(err?.message === 'POLL_TIMEOUT' ? 'POLL_TIMEOUT' : errorMessage(err));
    } finally {
      if (poll.current === controller) { poll.current = null; setRunning(false); setStartedAt(null); }
    }
  }, [load]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal).then((data) => {
      // Resume following a render that is still running (e.g. after a page reload).
      if (data.latestJob && ['QUEUED', 'PROCESSING'].includes(data.latestJob.status) && !poll.current) {
        setProgress(data.latestJob.progress);
        void follow(data.latestJob.id);
      }
    }).catch(() => undefined);
    return () => controller.abort();
  }, [load, follow, refreshKey]);

  const start = async () => {
    setFailure(null);
    setProgress({ stage: 'QUEUED', step: 0, totalSteps: 0, message: 'Đang gửi yêu cầu dựng video' });
    setStartedAt(Date.now());
    try {
      const response = await api.post(`/contents/${contentId}/video`, { aspectRatio });
      void follow(response.data.data.jobId);
    } catch (err: any) {
      setProgress(null); setStartedAt(null);
      toast.error(errorMessage(err));
    }
  };

  if (!state) return null;
  const missing = state.missingAudioSceneOrders;
  const latest = state.videos[0];
  const canStart = !running && !busy && state.sceneCount > 0 && missing.length === 0;

  return (
    <section className="bg-white/80 backdrop-blur-sm rounded-2xl border border-slate-200/60 shadow-xl shadow-slate-200/30 p-6 space-y-5" aria-labelledby="video-panel-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex gap-3 items-start">
          <div className="w-11 h-11 rounded-xl bg-indigo-50 flex items-center justify-center shrink-0"><Clapperboard size={22} className="text-indigo-600" /></div>
          <div>
            <h2 id="video-panel-title" className="text-lg font-bold text-slate-800">Tạo video tự động</h2>
            <p className="text-sm text-slate-500">Phụ đề nổi bật, hình minh họa đổi theo cảnh và giọng đọc đã tạo. Khoảng {state.audioSeconds} giây.</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div role="radiogroup" aria-label="Tỉ lệ khung hình" className="flex rounded-lg border border-slate-200 overflow-hidden text-sm">
            {(['9:16', '16:9'] as const).map((ratio) => (
              <button key={ratio} type="button" role="radio" aria-checked={aspectRatio === ratio} disabled={running}
                onClick={() => setAspectRatio(ratio)}
                className={`px-3 py-1.5 ${aspectRatio === ratio ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                {ratio === '9:16' ? '9:16 Dọc' : '16:9 Ngang'}
              </button>
            ))}
          </div>
          <Button disabled={!canStart} onClick={start} className="gap-2">
            {latest ? <RefreshCw size={16} /> : <Clapperboard size={16} />}
            {running ? 'Đang dựng...' : `${latest ? 'Dựng lại' : 'Tạo video'} (${state.cost} Credit)`}
          </Button>
        </div>
      </div>

      {missing.length > 0 && !running && (
        <p role="status" className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          Còn {missing.length} cảnh chưa có giọng đọc mới nhất: {missing.map((n) => `Cảnh ${n}`).join(', ')}. Hãy tạo audio cho các cảnh này trước.
        </p>
      )}
      {busy && missing.length === 0 && !running && (
        <p role="status" className="text-sm text-slate-500">Đợi audio tạo xong và lưu lời đọc trước khi dựng video.</p>
      )}

      {running && (
        <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-5 max-w-md">
          <JobProgressSteps steps={VIDEO_STEPS} progress={progress} startedAt={startedAt} />
        </div>
      )}

      {failure && !running && (
        <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{errorMessage(failure)}</p>
      )}

      {latest && !running && (
        <div className="flex flex-wrap gap-6 items-start">
          <video
            key={latest.id}
            controls
            preload="metadata"
            src={audioUrl(latest.url)}
            className={`rounded-xl bg-black shadow-lg ${latest.aspectRatio === '9:16' ? 'w-[240px] aspect-[9/16]' : 'w-full max-w-[560px] aspect-video'}`}
          />
          <div className="space-y-3 text-sm text-slate-600">
            <p><span className="font-semibold text-slate-800">{latest.aspectRatio === '9:16' ? 'Video dọc 9:16' : 'Video ngang 16:9'}</span> · {Math.round(latest.durationSeconds)} giây · {formatSize(latest.bytes)}</p>
            <Button variant="outline" className="gap-2" onClick={() => downloadAudio(`${latest.url}?download=1`, `veltrix-${latest.id}.mp4`).catch(() => toast.error('Không tải được video.'))}>
              <Download size={16} /> Tải video MP4
            </Button>
            <YouTubePublish video={latest} job={state.publishJob} onDone={() => void load()} />
            {latest.credits.length > 0 && (
              <p className="text-xs text-slate-500 max-w-sm">
                Ảnh từ <a href="https://www.pexels.com" target="_blank" rel="noreferrer" className="underline">Pexels</a>:{' '}
                {latest.credits.map((c, i) => (
                  <span key={c.order}>{i > 0 && ', '}<a href={c.pageUrl} target="_blank" rel="noreferrer" className="underline">{c.photographer}</a></span>
                ))}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
};

import React, { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Clapperboard, ImageOff, Pencil, RefreshCw, Square, TriangleAlert } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../api';
import { audioUrl } from '../../hooks/useTtsData';
import { errorMessage } from '../../utils/userMessages';
import { useImagePresets } from '../ImageQualityPicker';
import { formatRemaining, formatSeconds, type RunDetails, type SceneRow } from './workflowModel';

const FALLBACK_REASON: Record<string, string> = {
  IMAGE_TIMEOUT: 'quá thời gian', IMAGE_OOM: 'hết VRAM', IMAGE_CANCELLED: 'đã hủy', IMAGE_WORKER_FAILED: 'bộ tạo ảnh lỗi',
  IMAGE_GENERATION_FAILED: 'tạo ảnh lỗi', IMAGE_MODEL_LOAD_FAILED: 'nạp model lỗi', IMAGE_GEN_NOT_INSTALLED: 'chưa cài bộ tạo ảnh',
};
const EASE = [0.16, 1, 0.3, 1] as const;

/** One scene's image, styled by state: waiting, generating, ready, failed / fallback. */
const ImageTile: React.FC<{ run: RunDetails; scene: SceneRow; onChanged: () => void; presets: ReturnType<typeof useImagePresets> }> = ({ run, scene, onChanged, presets }) => {
  const reduce = !!useReducedMotion();
  const image = scene.image!;
  const [editing, setEditing] = useState(false);
  const [prompt, setPrompt] = useState(image.prompt);
  const [preset, setPreset] = useState(image.preset);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const waiting = image.status === 'PENDING';
  const generating = image.status === 'GENERATING';
  const ready = image.status === 'READY';
  const failed = image.status === 'FAILED' || image.status === 'SKIPPED';
  const canEdit = run.nodes.images.canEdit && !waiting && !generating;
  const stepPercent = generating && image.steps ? Math.round(((image.step ?? 0) / image.steps) * 100) : 0;

  const regenerate = async () => {
    setBusy(true);
    try { await api.post(`/auto-videos/${run.id}/scenes/${scene.sceneId}/image`, { preset }); toast.success(`Đang tạo lại ảnh cảnh ${scene.order}`); onChanged(); }
    catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  const savePrompt = async () => {
    setBusy(true);
    try {
      await api.patch(`/auto-videos/${run.id}/scenes/${scene.sceneId}/image-prompt`, { prompt });
      setEditing(false);
      await api.post(`/auto-videos/${run.id}/scenes/${scene.sceneId}/image`, { preset });
      toast.success(`Đã lưu prompt, đang tạo lại ảnh cảnh ${scene.order}`);
      onChanged();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };

  const border = generating ? 'border-violet-500 ring-2 ring-violet-500/20' : ready ? 'border-emerald-500' : failed ? 'border-red-500' : 'border-slate-200 dark:border-slate-700';
  return (
    <li className={`rounded-xl border-2 ${border} bg-white dark:bg-slate-900 overflow-hidden flex flex-col transition-colors duration-300`} aria-label={`Ảnh cảnh ${scene.order}: ${ready ? 'xong' : generating ? 'đang tạo' : waiting ? 'đang chờ' : 'dùng nền dự phòng'}`}>
      <div className={`relative aspect-[9/16] ${waiting ? 'bg-slate-100 dark:bg-slate-800' : 'bg-slate-100 dark:bg-slate-800'}`}>
        {ready && image.url ? (
          <motion.img src={audioUrl(image.url)} alt={`Ảnh AI cảnh ${scene.order}`} loading="lazy" onLoad={() => setLoaded(true)}
            initial={reduce ? false : { opacity: 0, scale: 0.96 }} animate={loaded || reduce ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.3, ease: EASE }} className="absolute inset-0 w-full h-full object-cover" />
        ) : null}
        {generating && (
          <div className="absolute inset-0 overflow-hidden bg-violet-50/70 dark:bg-violet-950/40">
            <div className="wf-shimmer absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-white/70 to-transparent dark:via-violet-400/20" />
            <div className="absolute inset-x-2 bottom-2">
              <p className="text-[13px] font-semibold text-violet-700 dark:text-violet-200 tabular-nums">{image.steps ? `Bước ${image.step ?? 0}/${image.steps}` : 'Đang bắt đầu…'}</p>
              <div className="mt-1 h-1.5 rounded-full bg-violet-200/70 dark:bg-violet-900 overflow-hidden" role="progressbar" aria-valuenow={stepPercent} aria-valuemin={0} aria-valuemax={100} aria-label={`Tiến độ ảnh cảnh ${scene.order}`}>
                <div className="wf-bar h-full bg-violet-600" style={{ width: `${stepPercent}%` }} />
              </div>
            </div>
          </div>
        )}
        {failed && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-red-600 dark:text-red-400 px-2 text-center bg-red-50/60 dark:bg-red-950/30">
            <ImageOff size={18} />
            <span className="text-[13px] leading-tight">Dùng nền dự phòng{image.error && FALLBACK_REASON[image.error] ? ` (${FALLBACK_REASON[image.error]})` : ''}</span>
          </div>
        )}
        <span className={`absolute top-1.5 left-1.5 rounded-md text-[13px] font-bold px-1.5 ${waiting ? 'bg-slate-300/80 text-slate-500 dark:bg-slate-700 dark:text-slate-400' : 'bg-black/60 text-white'}`}>{scene.order}</span>
      </div>
      <div className="p-2 text-[13px] text-slate-600 dark:text-slate-300 space-y-1.5">
        <p className="flex justify-between gap-1">
          <span className="truncate">{image.presetLabel}{image.promptEdited ? ' · đã sửa' : ''}</span>
          <span className={`shrink-0 tabular-nums ${ready ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : ''}`}>{ready ? (image.preset === 'wikimedia' ? 'Tư liệu' : image.cached ? 'cache' : formatSeconds(image.seconds ?? 0)) : waiting ? 'Chờ' : ''}</span>
        </p>
        {image.preset === 'wikimedia' && image.credit && (
          <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-400 line-clamp-2" title={image.credit}>
            © {image.sourceUrl ? <a href={image.sourceUrl} target="_blank" rel="noreferrer" className="underline hover:text-violet-600">{image.credit}</a> : image.credit}
          </p>
        )}
        {image.downgradedFrom && <p className="flex items-center gap-1 text-amber-700 dark:text-amber-400"><TriangleAlert size={12} /> Hạ preset vì hết VRAM</p>}
        {editing ? (
          <div className="space-y-1.5">
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} maxLength={1000} aria-label={`Prompt ảnh cảnh ${scene.order}`}
              className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 p-1.5 text-[13px] leading-snug focus:outline-none focus:ring-1 focus:ring-violet-500" />
            <div className="flex gap-1">
              <button type="button" disabled={busy || prompt.trim().length < 3} onClick={savePrompt} className="flex-1 rounded-md bg-violet-600 text-white py-1 font-semibold disabled:opacity-50">Lưu & tạo lại</button>
              <button type="button" onClick={() => { setEditing(false); setPrompt(image.prompt); }} className="rounded-md border border-slate-200 dark:border-slate-700 px-2">Hủy</button>
            </div>
          </div>
        ) : canEdit ? (
          <div className="space-y-1">
            <select value={preset} onChange={(e) => setPreset(e.target.value)} aria-label={`Preset tạo lại cảnh ${scene.order}`}
              className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 py-0.5 px-1 text-[13px]">
              {(presets?.presets ?? []).map((p) => <option key={p.id} value={p.id}>{p.label} · {Math.round(p.estimateSeconds)}s</option>)}
            </select>
            <div className="flex gap-1">
              <button type="button" disabled={busy} onClick={regenerate} className={`flex-1 inline-flex items-center justify-center gap-1 rounded-md py-1 disabled:opacity-50 ${failed ? 'bg-red-600 text-white hover:bg-red-700' : 'border border-slate-200 dark:border-slate-700 hover:border-violet-400 hover:text-violet-600'}`}><RefreshCw size={12} /> Tạo lại</button>
              <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 px-2 hover:border-violet-400 hover:text-violet-600" aria-label={`Sửa prompt cảnh ${scene.order}`}><Pencil size={12} /></button>
            </div>
          </div>
        ) : null}
      </div>
    </li>
  );
};

const ThumbnailTile: React.FC<{ run: RunDetails; onChanged: () => void; presets: ReturnType<typeof useImagePresets> }> = ({ run, onChanged }) => {
  const reduce = !!useReducedMotion();
  const thumb = run.thumbnail;
  // Hooks before the early return: the thumbnail appears mid-run, and a changing hook count crashes React.
  const [editing, setEditing] = useState(false);
  const [prompt, setPrompt] = useState(thumb?.prompt ?? '');
  const [preset] = useState(thumb?.preset ?? '');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  if (!thumb) return null;
  const waiting = thumb.status === 'PENDING';
  const generating = thumb.status === 'GENERATING';
  const ready = thumb.status === 'READY';
  const failed = thumb.status === 'FAILED' || thumb.status === 'SKIPPED';
  const canEdit = run.nodes.images.canEdit && !waiting && !generating;
  const stepPercent = generating && thumb.steps ? Math.round(((thumb.step ?? 0) / thumb.steps) * 100) : 0;

  const regenerate = async () => {
    setBusy(true);
    try {
      await api.post(`/auto-videos/${run.id}/scenes/${thumb.id}/image`, { preset: preset || thumb.preset });
      toast.success('Đang tạo lại ảnh bìa Thumbnail');
      onChanged();
    } catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };

  const savePrompt = async () => {
    setBusy(true);
    try {
      await api.patch(`/auto-videos/${run.id}/scenes/${thumb.id}/image-prompt`, { prompt });
      setEditing(false);
      await api.post(`/auto-videos/${run.id}/scenes/${thumb.id}/image`, { preset: preset || thumb.preset });
      toast.success('Đã lưu prompt, đang tạo lại Thumbnail');
      onChanged();
    } catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };

  const border = generating
    ? 'border-violet-500 ring-2 ring-violet-500/20'
    : ready ? 'border-amber-400 ring-2 ring-amber-400/20' : failed ? 'border-red-500' : 'border-amber-200 dark:border-amber-800';

  return (
    <div className={`rounded-xl border-2 ${border} bg-amber-50/30 dark:bg-amber-950/20 p-3.5 space-y-2.5 transition-all mb-4`} aria-label="Ảnh bìa YouTube Thumbnail">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-amber-500">⭐</span>
          <h5 className="text-[13px] font-bold text-amber-900 dark:text-amber-200 tracking-wide uppercase">Ảnh bìa YouTube (Thumbnail độc lập)</h5>
        </div>
        <span className={`text-[12px] font-bold px-2 py-0.5 rounded-full ${ready ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : generating ? 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300 animate-pulse' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'}`}>
          {ready ? 'Đã tạo xong' : generating ? 'Đang tạo ảnh bìa…' : 'Đang chờ'}
        </span>
      </div>

      <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-3.5 items-start">
        <div className={`relative aspect-[9/16] rounded-lg overflow-hidden border border-amber-200/60 dark:border-amber-800 ${waiting ? 'bg-slate-100 dark:bg-slate-800' : 'bg-slate-100 dark:bg-slate-800'}`}>
          {ready && thumb.url ? (
            <motion.img src={audioUrl(thumb.url)} alt="Thumbnail AI" loading="lazy" onLoad={() => setLoaded(true)}
              initial={reduce ? false : { opacity: 0, scale: 0.96 }} animate={loaded || reduce ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.3, ease: EASE }} className="absolute inset-0 w-full h-full object-cover" />
          ) : null}
          {generating && (
            <div className="absolute inset-0 overflow-hidden bg-violet-50/70 dark:bg-violet-950/40">
              <div className="wf-shimmer absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-white/70 to-transparent dark:via-violet-400/20" />
              <div className="absolute inset-x-2 bottom-2">
                <p className="text-[11px] font-semibold text-violet-700 dark:text-violet-200 tabular-nums">{thumb.steps ? `${thumb.step ?? 0}/${thumb.steps}` : 'Khởi động…'}</p>
                <div className="mt-1 h-1 rounded-full bg-violet-200 overflow-hidden">
                  <div className="wf-bar h-full bg-violet-600" style={{ width: `${stepPercent}%` }} />
                </div>
              </div>
            </div>
          )}
          {failed && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-red-600 px-1 text-center bg-red-50/60">
              <ImageOff size={16} />
              <span className="text-[11px]">Lỗi</span>
            </div>
          )}
          <span className="absolute top-1 left-1 rounded bg-gradient-to-r from-amber-500 to-rose-500 text-white text-[9px] font-extrabold px-1.5 py-0.5 shadow">
            THUMBNAIL
          </span>
        </div>

        <div className="min-w-0 space-y-2 text-[13px]">
          {thumb.hook && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] font-semibold uppercase text-slate-500">Hook trên bìa:</span>
              <span className="font-extrabold text-amber-700 dark:text-amber-300 bg-amber-100/80 dark:bg-amber-900/50 px-2 py-0.5 rounded text-[12px] border border-amber-300/50">
                "{thumb.hook}"
              </span>
            </div>
          )}

          {editing ? (
            <div className="space-y-1.5">
              <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} maxLength={1000} aria-label="Prompt Thumbnail"
                className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 p-2 text-[12px] leading-snug focus:outline-none focus:ring-1 focus:ring-amber-500" />
              <div className="flex gap-1.5">
                <button type="button" disabled={busy || prompt.trim().length < 3} onClick={savePrompt} className="rounded-md bg-amber-600 text-white px-3 py-1 font-semibold text-[12px] disabled:opacity-50">Lưu & tạo lại</button>
                <button type="button" onClick={() => { setEditing(false); setPrompt(thumb.prompt); }} className="rounded-md border border-slate-200 px-2 text-[12px]">Hủy</button>
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-[12px] text-slate-600 dark:text-slate-300 line-clamp-3 italic bg-white/70 dark:bg-slate-900/70 p-2 rounded border border-amber-100 dark:border-amber-900/40">
                {thumb.prompt}
              </p>
              <div className="flex items-center gap-2 pt-1 flex-wrap">
                {canEdit && (
                  <>
                    <button type="button" disabled={busy} onClick={regenerate} className="inline-flex items-center gap-1 rounded border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-900 px-2.5 py-1 text-[12px] font-medium text-amber-800 dark:text-amber-200 hover:bg-amber-50 disabled:opacity-50">
                      <RefreshCw size={11} /> Tạo lại Thumbnail
                    </button>
                    <button type="button" onClick={() => { setPrompt(thumb.prompt); setEditing(true); }} className="inline-flex items-center gap-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-[12px] text-slate-600 dark:text-slate-300 hover:text-amber-600">
                      <Pencil size={11} /> Sửa prompt
                    </button>
                  </>
                )}
                {ready && thumb.seconds ? (
                  <span className="text-[11px] text-slate-400 tabular-nums">Đã tạo trong {formatSeconds(thumb.seconds)}</span>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const ImagesPanel: React.FC<{ run: RunDetails; onChanged: () => void; now: number; fetchedAt: number }> = ({ run, onChanged, now, fetchedAt }) => {
  const presets = useImagePresets();
  const node = run.nodes.images;
  const scenes = run.scenes.filter((s) => s.image);
  const [cancelling, setCancelling] = useState(false);
  const [rerendering, setRerendering] = useState(false);
  // Hooks above, early return below (React: same hooks on every render).
  if (node.status === 'SKIPPED' || (!scenes.length && node.status === 'PENDING')) return null;
  const cancel = async () => {
    setCancelling(true);
    try { await api.post(`/auto-videos/${run.id}/images/cancel`); toast.success('Đã dừng tạo ảnh. Các cảnh chưa có ảnh sẽ dùng nền dự phòng.'); onChanged(); }
    catch (err) { toast.error(errorMessage(err)); } finally { setCancelling(false); }
  };
  const rerender = async () => {
    setRerendering(true);
    try { await api.post(`/auto-videos/${run.id}/rerender`); toast.success('Đang dựng lại video với ảnh hiện tại'); onChanged(); }
    catch (err) { toast.error(errorMessage(err)); } finally { setRerendering(false); }
  };
  const remaining = node.remainingSeconds != null ? Math.max(0, node.remainingSeconds - (now - fetchedAt) / 1000) : null;
  const downloading = node.phase === 'download';
  return (
    <section aria-label="Hình ảnh">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h4 className="text-[13px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Hình ảnh phân cảnh ({node.ready}/{node.total}) · {node.presetLabel ?? ''}
          {node.avgSeconds ? <span className="normal-case font-medium tracking-normal"> · {formatSeconds(node.avgSeconds)}/ảnh</span> : null}
          {remaining !== null && node.busy ? <span className="normal-case font-medium tracking-normal text-violet-600 dark:text-violet-300"> · {formatRemaining(remaining)}</span> : null}
        </h4>
        {node.canRerender && !node.busy && (
          <button type="button" disabled={rerendering} onClick={rerender} title="Ảnh tạo lại sau khi video xong chỉ có trong video khi dựng lại. Giọng đọc được giữ nguyên."
            className="inline-flex items-center gap-1 rounded-lg bg-violet-600 text-white px-2.5 py-1 text-[13px] font-semibold hover:bg-violet-700 disabled:opacity-50"><Clapperboard size={13} /> Dựng lại video</button>
        )}
        {node.busy && (
          <button type="button" disabled={cancelling} onClick={cancel} className="inline-flex items-center gap-1 rounded-lg border border-red-200 text-red-600 px-2.5 py-1 text-[13px] font-semibold hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:hover:bg-red-950/40"><Square size={11} fill="currentColor" /> Hủy tạo ảnh</button>
        )}
      </div>

      <ThumbnailTile run={run} onChanged={onChanged} presets={presets} />
      {node.busy && (downloading || node.phase === 'loading') && (
        <div className="mt-2">
          <p className="text-[13px] text-violet-700 dark:text-violet-300">{downloading ? node.progress?.message : `Nạp model ${node.presetLabel ?? ''}…`}</p>
          <div className="mt-1 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden relative" role="progressbar" aria-valuenow={downloading ? node.progress?.percent ?? 0 : undefined} aria-valuemin={0} aria-valuemax={100} aria-label={downloading ? 'Tải model ảnh' : 'Nạp model ảnh'}>
            {downloading ? <div className="wf-bar h-full bg-violet-500" style={{ width: `${node.progress?.percent ?? 0}%` }} /> : <div className="wf-shimmer absolute inset-y-0 w-1/3 bg-violet-400/70" />}
          </div>
        </div>
      )}
      {scenes.length > 0 && (
        <ul className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2">
          {scenes.map((scene) => <ImageTile key={`${scene.order}-${scene.image!.url ?? scene.image!.status}`} run={run} scene={scene} onChanged={onChanged} presets={presets} />)}
        </ul>
      )}
    </section>
  );
};

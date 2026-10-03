import { errorMessage } from '../utils/userMessages';
import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Copy, Sparkles, Mic, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '../components/ui/Button';
import { VoiceSelect, voiceGender } from '../components/ui/VoiceSelect';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { audioUrl, downloadAudio, pendingJob, useTtsData } from '../hooks/useTtsData';
import toast from 'react-hot-toast';

const VoicePanel = ({ scene, voices, hasMoreVoices,loadMoreVoices,voicesBusy,defaultVoice, processing, applying, generate, update, config, dirty, job, audioUrl, downloadAudio }: any) => {
  const voiceId = scene.voiceId || defaultVoice;
  const selectedVoice = voices.find((v: any) => v.id === voiceId);
  const voiceLabel = selectedVoice ? `${selectedVoice.name} · ${voiceGender(selectedVoice.gender)}` : 'Đang tải giọng...';

  const [stageIndex, setStageIndex] = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (processing) {
      setStageIndex(0); setProgress(0);
      const stageInterval = setInterval(() => setStageIndex(prev => Math.min(prev + 1, 3)), 2500);
      const progressInterval = setInterval(() => setProgress(prev => (prev < 92 ? prev + Math.random() * 4 : prev)), 400);
      return () => { clearInterval(stageInterval); clearInterval(progressInterval); };
    } else {
      setProgress(100);
    }
  }, [processing]);

  const stages = [ "Đang phân tích lời đọc...", "Đang tổng hợp giọng nói...", "Đang xử lý âm thanh...", "Đang hoàn thiện..." ];
  const hasAudio = scene.ttsAudioId && !dirty;
  const isFailed = job?.status === 'FAILED' && !processing;

  return (
    <motion.div layout className="bg-white rounded-xl border border-slate-100 shadow-sm relative overflow-hidden flex flex-col transition-all mb-4">
      <AnimatePresence mode="popLayout">
        {processing ? (
          <motion.div 
            key="generating"
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="p-5 flex flex-col gap-5 relative"
          >
            {/* Ambient Background Wave */}
            <motion.div 
              animate={{ x: ["-10%", "10%", "-10%"], y: ["-5%", "5%", "-5%"] }}
              transition={{ repeat: Infinity, duration: 8, ease: "easeInOut" }}
              className="absolute inset-0 bg-gradient-to-r from-cyan-400/5 via-indigo-500/5 to-violet-500/5 blur-xl z-0"
            />
            {/* Voice Info */}
            <div className="flex justify-between items-center z-10">
              <div className="text-sm font-semibold text-slate-800 opacity-60 flex items-center gap-2">
                <Mic size={14} /> {voiceLabel}
              </div>
              <div className="text-xs font-medium text-indigo-400 bg-indigo-50 px-2 py-1 rounded-md">
                Đang tạo giọng nói · lời đọc khoảng {scene.estimatedDuration || 5} giây
              </div>
            </div>

            {/* Living Waveform */}
            <div className="flex flex-col items-center justify-center py-2 z-10 gap-5">
              <div className="flex items-center gap-[3px] h-12 w-full justify-center relative overflow-hidden">
                 {/* Scanning line */}
                 <motion.div
                   animate={{ left: ["-10%", "110%"] }}
                   transition={{ repeat: Infinity, duration: 2.5, ease: "linear" }}
                   className="absolute top-0 bottom-0 w-[1px] bg-cyan-300 shadow-[0_0_15px_rgba(34,211,238,0.9)] z-20"
                 />
                 {[...Array(28)].map((_, i) => (
                   <motion.div 
                     key={i}
                     animate={{ height: ["20%", `${30 + Math.random()*70}%`, "20%"] }}
                     transition={{ repeat: Infinity, duration: 1.2 + Math.random(), delay: i * 0.05, ease: "easeInOut" }}
                     className="w-1.5 bg-gradient-to-t from-cyan-400 to-indigo-500 rounded-full opacity-80"
                   />
                 ))}
              </div>
              
              <AnimatePresence mode="wait">
                <motion.div 
                  key={stageIndex}
                  initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }}
                  className="text-sm font-medium text-indigo-600"
                >
                  {stages[stageIndex] || stages[3]}
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Flowing Progress */}
            <div className="h-1 bg-slate-100 rounded-full w-full relative z-10 mt-2">
               <motion.div 
                 animate={{ width: `${progress}%` }}
                 transition={{ ease: "linear", duration: 0.4 }}
                 className="absolute left-0 top-0 bottom-0 bg-gradient-to-r from-cyan-400 via-indigo-500 to-violet-500 rounded-full"
               >
                 <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2 h-2 bg-white rounded-full shadow-[0_0_8px_rgba(99,102,241,0.8)]" />
               </motion.div>
            </div>
          </motion.div>
        ) : isFailed ? (
          <motion.div key="failed" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-4 flex flex-col gap-3">
            <div className="flex justify-between items-center">
              <div className="text-sm font-semibold text-slate-800 opacity-60 flex items-center gap-2"><Mic size={14}/> {voiceLabel}</div>
              <div className="text-xs font-semibold text-red-600 bg-red-50 px-2 py-1 rounded">Lỗi tạo Audio</div>
            </div>
            <div className="text-sm text-slate-600 px-1">{errorMessage(job.failedReason)} · Credit đã được hoàn lại.</div>
            <div className="flex gap-3 mt-2">
              <Button onClick={() => generate(scene)} className="bg-red-50 text-red-600 hover:bg-red-100 border-none">Thử lại</Button>
              <div className="flex-1 min-w-0"><VoiceSelect label="Đổi giọng" value={voiceId} disabled={applying} onChange={id => update(scene._id, { voiceId: id })} voices={voices} hasMoreVoices={hasMoreVoices} loadMoreVoices={loadMoreVoices} voicesBusy={voicesBusy} /></div>
            </div>
          </motion.div>
        ) : hasAudio ? (
          <motion.div key="audio" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-4 flex flex-col gap-3">
            <div className="flex justify-between items-center text-sm font-semibold text-slate-800">
              <div className="flex items-center gap-2"><Mic size={14} className="text-indigo-500" /> <span className="opacity-70">{voiceLabel}</span></div>
              <span className="text-xs text-indigo-600 bg-indigo-50 px-2 py-1 rounded-md flex items-center gap-1"><CheckCircle2 size={12}/> Đã hoàn thành</span>
            </div>
            <div className="flex flex-col gap-3 mt-1">
              <audio onLoadedMetadata={e => {const duration=e.currentTarget.duration;if(Number.isFinite(duration)&&duration>0)update(scene._id,{audioDuration:duration});}} controls preload="metadata" crossOrigin="use-credentials" src={audioUrl(`/api/media/${scene.ttsAudioId}/audio`)} className="w-full h-10 outline-none" />
              <div className="flex justify-between items-center mt-1">
                <button className="text-slate-500 hover:text-indigo-600 text-xs font-semibold transition-colors flex items-center gap-1.5" onClick={() => generate(scene)}>
                  <Sparkles size={12}/> Tạo lại audio
                </button>
                <button className="text-slate-500 hover:text-indigo-600 text-xs font-semibold transition-colors flex items-center gap-1" onClick={() => downloadAudio(`/api/media/${scene.ttsAudioId}/audio`, `canh-${scene.order}.wav`).catch(() => toast.error('Không tải được audio.'))}>
                  Tải tệp WAV
                </button>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div key="default" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-2 flex gap-4 items-center">
            <div className="flex-1">
              <VoiceSelect label={`Giọng cảnh ${scene.order}`} value={voiceId} disabled={applying} onChange={id => update(scene._id, { voiceId: id })} voices={voices} hasMoreVoices={hasMoreVoices} loadMoreVoices={loadMoreVoices} voicesBusy={voicesBusy} />
            </div>
            <Button disabled={applying || selectedVoice?.canUse === false || !voiceId || !scene.narration.trim() || !config?.available} onClick={() => generate(scene)} className="min-w-[140px] shadow-sm bg-slate-900 text-white hover:bg-indigo-600 transition-colors border-none group relative overflow-hidden">
               <span className="relative z-10 flex items-center gap-2 justify-center"><Sparkles size={16}/> Tạo giọng đọc</span>
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export const ScenesPage: React.FC = () => {
  if (typeof document !== 'undefined') document.title = 'Veltrix AI - Chia Cảnh';

  const [params] = useSearchParams(); const contentId = params.get('id'); const navigate = useNavigate();
  const [scenes, setScenes] = useState<any[]>([]); const [projectId, setProjectId] = useState<string>();
  const [loading, setLoading] = useState(true); const [loadError, setLoadError] = useState('');
  const [defaultVoice, setDefaultVoice] = useState(''); const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [applying, setApplying] = useState(false); const [exporting, setExporting] = useState(false);
  const locked = useRef(new Set<string>());
  const { hasMoreVoices,loadMoreVoices,voicesBusy,voices, config, jobs, reload, error, refreshCredits } = useTtsData(projectId);
  useEffect(() => {
    const controller = new AbortController(); setScenes([]); setLoading(Boolean(contentId)); setLoadError('');
    if (contentId) api.get(`/contents/${contentId}`, { signal: controller.signal }).then(response => {
      const data = response.data.data; setProjectId(data.projectId);
      setScenes(data.scenes.map((s: any) => ({ ...s, savedNarration: s.narration, savedVoiceId: s.voiceId })));
    }).catch(() => { if (!controller.signal.aborted) setLoadError('Không tải được phân cảnh.'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [contentId]);
  useEffect(() => { if (!defaultVoice && voices.length) setDefaultVoice((voices.find(v => v.isDefault && v.canUse !== false) || voices.find(v => v.canUse !== false))?.id || ''); }, [voices, defaultVoice]);
  useEffect(() => {
    setScenes(previous => previous.map(scene => {
      const latest = jobs.find(job => job.sceneId === scene._id);
      return latest?.status === 'COMPLETED' && latest.result?.audioId && scene.savedNarration === latest.text && latest.voiceId === scene.voiceId && latest.sceneRevision === scene.revision
        ? { ...scene, ttsAudioId: latest.result.audioId, audioDuration:latest.result.duration } : scene;
    }));
  }, [jobs]);
  const update = (id: string, changes: any) => setScenes(previous => previous.map(s => s._id === id ? {
    ...s, ...changes, ...(typeof changes.narration === 'string' ? {
      estimatedDuration: Math.max(.1, Math.round(changes.narration.trim().split(/\s+/u).filter((unit: string) => /[\p{L}\p{N}]/u.test(unit)).length / 4 * 10) / 10),
    } : {}),
  } : s));
  const save = async (scene: any, voiceId: string) => {
    const response = await api.patch(`/scenes/${scene._id}`, { narration: scene.narration, voiceId, revision: scene.revision });
    const saved = { ...response.data.data, savedNarration: response.data.data.narration, savedVoiceId: response.data.data.voiceId }; update(scene._id, saved); return saved;
  };
  const generate = async (scene: any) => {
    if (locked.current.has(scene._id)) return; locked.current.add(scene._id); setBusy(previous => ({ ...previous, [scene._id]: true }));
    try {
      const voiceId = scene.voiceId || defaultVoice; const saved = await save(scene, voiceId);
      const signature = JSON.stringify([saved.narration, voiceId, saved.revision]); const storageKey = `scene-tts-${scene._id}`;
      let operation: any; try { operation = JSON.parse(sessionStorage.getItem(storageKey) || 'null'); } catch {}
      if (!operation || operation.signature !== signature || (operation.jobId && jobs.some(j => j.id === operation.jobId && !pendingJob(j)))) operation = { signature, key: crypto.randomUUID() };
      sessionStorage.setItem(storageKey, JSON.stringify(operation));
      const result = await api.post(`/scenes/${scene._id}/tts`, { voiceId }, { headers: { 'Idempotency-Key': operation.key } });
      operation.jobId = result.data.data.jobId; sessionStorage.setItem(storageKey, JSON.stringify(operation));
      await reload(); await refreshCredits(); toast.success(`Đang tạo audio cảnh ${scene.order}.`);
    } catch (e: any) { toast.error(e.response?.data?.error?.code === 'SCENE_EDIT_CONFLICT' ? 'Cảnh đã thay đổi. Tải lại trang để cập nhật.' : errorMessage(e)); }
    finally { locked.current.delete(scene._id); setBusy(previous => ({ ...previous, [scene._id]: false })); }
  };
  const applyAll = async () => {
    setApplying(true);
    try { for (const scene of scenes) await save(scene, defaultVoice); toast.success('Đã lưu giọng cho tất cả các cảnh.'); }
    catch (e: any) { toast.error(errorMessage(e)); }
    finally { setApplying(false); }
  };
  const copy = (value: string) => navigator.clipboard.writeText(value).then(() => toast.success('Đã sao chép')).catch(() => toast.error('Không sao chép được.'));
  const allGenerated = scenes.length > 0 && scenes.every(s => s.ttsAudioId && s.narration === s.savedNarration && s.voiceId === s.savedVoiceId);
  const exportAll = async () => {
    setExporting(true);
    try { const { downloadCombinedAudio } = await import('../utils/combineAudio'); await downloadCombinedAudio(scenes.map(s => `/api/media/${s.ttsAudioId}/audio`)); }
    catch { toast.error('Không xuất được audio. Vui lòng thử lại.'); } finally { setExporting(false); }
  };
  const anyPending = jobs.some(pendingJob) || Object.values(busy).some(Boolean);
  const seconds = scenes.reduce((n, s) => n + (s.ttsAudioId && s.narration===s.savedNarration && s.voiceId===s.savedVoiceId ? s.audioDuration ?? s.estimatedDuration ?? 0 : s.estimatedDuration ?? 0), 0);
  return <div className="flex-1 overflow-y-auto bg-gradient-to-br from-[#F7F8FC] to-indigo-50/30 relative">
    <div className="absolute top-0 left-0 w-full h-96 bg-gradient-to-b from-indigo-100/30 to-transparent pointer-events-none -z-10" />
    <div className="max-w-[1400px] mx-auto p-8 space-y-8 z-10">
    <div className="flex flex-wrap justify-between items-start gap-4"><div className="flex gap-5 items-start"><Button variant="outline" className="bg-white/80 backdrop-blur-sm border-gray-200 hover:bg-indigo-50 hover:text-indigo-600 transition-all shadow-sm" onClick={() => navigate(contentId ? `/content?id=${contentId}` : '/content')}><ArrowLeft size={16} /> Quay lại Editor</Button><div><h1 className="text-3xl font-extrabold bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-500 tracking-tight">Chia cảnh &amp; Tạo Audio</h1><p className="text-sm text-slate-500 mt-1.5 font-medium">Lưu lời đọc, chọn giọng thật và tạo audio cho từng phân cảnh của kịch bản.</p></div></div><Button disabled={!allGenerated || exporting || anyPending} onClick={exportAll} className="shadow-lg shadow-indigo-200/50 hover:shadow-indigo-300/50 hover:-translate-y-0.5 transition-all">{exporting ? 'Đang xuất...' : 'Xuất toàn bộ Audio'}</Button></div>
    <div className="bg-white/60 backdrop-blur-xl p-5 rounded-2xl border border-white/60 shadow-lg shadow-indigo-100/20 flex flex-wrap items-center gap-6 text-sm"><span className="font-semibold text-slate-700 bg-white px-4 py-2 rounded-xl shadow-sm border border-slate-100"><span className="text-indigo-600 font-bold">{scenes.length}</span> cảnh · <span className="text-indigo-600 font-bold">{Math.floor(seconds / 60)}</span> phút <span className="text-indigo-600 font-bold">{Math.round(seconds % 60)}</span> giây</span><div className="min-w-[240px] flex-1 lg:flex-none"><VoiceSelect label="Giọng mặc định" value={defaultVoice} disabled={applying || anyPending} onChange={setDefaultVoice} voices={voices} hasMoreVoices={hasMoreVoices} loadMoreVoices={loadMoreVoices} voicesBusy={voicesBusy} /></div><button disabled={!defaultVoice || voices.find(v => v.id === defaultVoice)?.canUse === false || applying || anyPending} className="text-indigo-600 font-medium hover:text-indigo-700 hover:bg-indigo-50 px-4 py-2 rounded-xl transition-all disabled:opacity-40 disabled:hover:bg-transparent" onClick={applyAll}>{applying ? 'Đang lưu...' : 'Áp dụng giọng cho tất cả'}</button></div>
    {(error || loadError) && <p role="alert" className="text-red-600">{loadError || error}</p>}
    {config && !config.available && <p role="alert" className="text-orange-600">Dịch vụ TTS chưa được khởi động.</p>}
    {loading && <p role="status">Đang tải phân cảnh...</p>}
    {!loading && !scenes.length && <p>Chưa có phân cảnh. Mở kịch bản từ dự án để tiếp tục.</p>}
    {scenes.map(scene => {
      const job = jobs.find(j => j.sceneId === scene._id); const processing = busy[scene._id] || pendingJob(job);
      const dirty = scene.narration !== scene.savedNarration || scene.voiceId !== scene.savedVoiceId;
      return <div key={scene._id} className="bg-white/80 backdrop-blur-sm rounded-2xl border border-slate-200/60 overflow-hidden shadow-xl shadow-slate-200/30 hover:shadow-2xl hover:shadow-indigo-100/40 transition-all duration-300">
        <div className="px-6 py-4 bg-gradient-to-r from-indigo-50/50 to-transparent border-b border-slate-100 flex justify-between items-center text-sm">
          <strong className="text-slate-800 text-base">Cảnh {scene.order} <span className="text-slate-400 mx-2">·</span> {scene.title}</strong>
          {processing ? (
            <span className="flex items-center gap-1.5 px-3 py-1 text-xs font-semibold text-indigo-600 bg-indigo-50 rounded-full border border-indigo-100 shadow-sm">
               <span className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse" /> Đang tạo audio
            </span>
          ) : scene.ttsAudioId && !dirty ? (
            <span className="px-3 py-1 rounded-full text-xs font-semibold shadow-sm border bg-emerald-50 text-emerald-700 border-emerald-100">
              Đã tạo audio <span className="opacity-60 ml-1">· {scene.audioDuration ? `${scene.audioDuration.toFixed(1)} giây thực tế` : 'Đang đọc thời lượng'}</span>
            </span>
          ) : (
            <span className="px-3 py-1 rounded-full text-xs font-semibold shadow-sm border bg-amber-50 text-amber-700 border-amber-100">
              Chưa tạo audio <span className="opacity-60 ml-1">· ~{scene.estimatedDuration}s</span>
            </span>
          )}
        </div>
        <div className="p-7 grid lg:grid-cols-12 gap-8"><div className="lg:col-span-7 space-y-5"><h3 className="text-[11px] font-extrabold uppercase tracking-widest text-slate-400">Lời đọc (Voiceover)</h3>
          <textarea aria-label={`Lời đọc cảnh ${scene.order}`} value={scene.narration} maxLength={config?.maxNarrationChars ?? undefined} disabled={processing || applying} onChange={e => update(scene._id, { narration: e.target.value })} className="w-full min-h-[140px] rounded-xl border border-slate-200 bg-slate-50/50 p-4 text-sm leading-relaxed focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 transition-all resize-y shadow-inner" />
          <VoicePanel scene={scene} voices={voices} hasMoreVoices={hasMoreVoices} loadMoreVoices={loadMoreVoices} voicesBusy={voicesBusy} defaultVoice={defaultVoice} processing={processing} applying={applying} generate={generate} update={update} config={config} dirty={dirty} job={job} audioUrl={audioUrl} downloadAudio={downloadAudio} />
          <p className="text-xs text-slate-500 font-medium px-1">Credit dự kiến: <span className="text-slate-700 font-bold">{config ? Math.ceil([...scene.narration.trim()].length / 100) * config.creditsPer100Chars : '—'}</span>{dirty ? ' · Lời đọc sẽ được lưu khi tạo audio.' : ''}</p>
        </div><div className="lg:col-span-5 space-y-6 lg:border-l lg:border-slate-100 lg:pl-8">{[['Hình ảnh', scene.imagePrompt], ...(scene.videoSegments?.length ? scene.videoSegments.map((clip: any) => [`Video · Đoạn ${clip.order} · ${clip.durationSeconds}s (${clip.startSeconds}s–${Math.round((clip.startSeconds + clip.durationSeconds)*10)/10}s)`, clip.prompt]) : [['Video', scene.videoPrompt]])].map(([title, prompt]) => <div key={title} className="group"><div className="flex justify-between items-center mb-3"><h3 className="font-bold text-sm text-slate-700">Prompt {title}</h3><button className="text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50 px-2 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-all focus:opacity-100" onClick={() => copy(prompt || '')}><Copy size={14} /> Sao chép</button></div><div className="relative"><pre className="text-[13px] whitespace-pre-wrap break-words rounded-xl border border-slate-200/60 bg-gradient-to-br from-slate-50 to-white p-4 leading-relaxed text-slate-600 shadow-sm group-hover:shadow-md transition-shadow font-mono">{prompt}</pre><div className="absolute inset-0 rounded-xl ring-1 ring-inset ring-black/5 pointer-events-none" /></div></div>)}</div></div>
      </div>;
    })}
  </div></div>;
};


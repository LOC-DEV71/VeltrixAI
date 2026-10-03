import {Pagination} from 'antd';
import { errorMessage } from '../utils/userMessages';
import React, { useEffect, useRef, useState } from 'react';
import { VoiceSelect } from '../components/ui/VoiceSelect';
import { api } from '../api';
import { audioUrl, downloadAudio, pendingJob, useTtsData } from '../hooks/useTtsData';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, Sparkles, Clock, CheckCircle2, History, Download, AudioLines, Info } from 'lucide-react';

export const TTSPage: React.FC = () => {
  if (typeof document !== 'undefined') document.title = 'Veltrix AI - Text to Speech';

  const { hasMoreVoices,loadMoreVoices,voicesBusy,page,setPage,total,voices, config, jobs, reload, error, refreshCredits } = useTtsData();
  const [text, setText] = useState('Đây là Veltrix TTS, ứng dụng chuyển đổi văn bản thành giọng nói và sáng tạo nội dung.');
  const [voiceId, setVoiceId] = useState(''); 
  const [sending, setSending] = useState(false);
  const lock = useRef(false);
  
  useEffect(() => { if (!voiceId && voices.length) setVoiceId((voices.find(v => v.isDefault && v.canUse !== false) || voices.find(v => v.canUse !== false))?.id || ''); }, [voices, voiceId]);
  
  const selected = voices.find(v => v.id === voiceId);
  const cost = config ? Math.ceil([...text.trim()].length / 100) * config.creditsPer100Chars : null;
  const isGenerating = sending || jobs.some(pendingJob);
  
  const create = async () => {
    if (lock.current || !text.trim() || !voiceId) return; lock.current = true; setSending(true);
    const signature = JSON.stringify([text.trim(), voiceId]);
    let operation: any; try { operation = JSON.parse(sessionStorage.getItem('standalone-tts-operation') || 'null'); } catch {}
    if (!operation || operation.signature !== signature || (operation.jobId && jobs.some(j => j.id === operation.jobId && !pendingJob(j)))) operation = { signature, key: crypto.randomUUID() };
    sessionStorage.setItem('standalone-tts-operation', JSON.stringify(operation));
    try {
      const response = await api.post('/tts', { text, voiceId }, { headers: { 'Idempotency-Key': operation.key } });
      operation.jobId = response.data.data.jobId; sessionStorage.setItem('standalone-tts-operation', JSON.stringify(operation));
      setPage(1);await reload(); await refreshCredits(); toast.success('Đã gửi yêu cầu tạo giọng đọc.');
    } catch (e: any) { toast.error(errorMessage(e)); }
    finally { lock.current = false; setSending(false); }
  };

  // Animation states for generation
  const [stageIndex, setStageIndex] = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (isGenerating) {
      setStageIndex(0); setProgress(0);
      const stageInterval = setInterval(() => setStageIndex(prev => Math.min(prev + 1, 3)), 2000);
      const progressInterval = setInterval(() => setProgress(prev => (prev < 90 ? prev + Math.random() * 3 : prev)), 300);
      return () => { clearInterval(stageInterval); clearInterval(progressInterval); };
    } else {
      setProgress(100);
    }
  }, [isGenerating]);

  const stages = [ "Đang phân tích nội dung...", "Đang chuẩn bị giọng đọc...", "Đang tổng hợp âm thanh...", "Đang hoàn thiện..." ];

  return (
    <div className="flex-1 overflow-y-auto bg-[#F8FAFC]">
      <div className="max-w-[1400px] mx-auto p-4 md:p-8 space-y-8">
        
        {/* Page Header */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
             <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Text to Speech</h1>
             <span className="px-3 py-1 bg-indigo-100 text-indigo-700 text-[10px] sm:text-xs font-bold uppercase tracking-wider rounded-full border border-indigo-200">Veltrix TTS</span>
          </div>
          <p className="text-sm sm:text-base text-slate-500 font-medium">Chuyển văn bản thành giọng đọc tự nhiên và lưu trữ âm thanh của bạn.</p>
        </div>

        {(error || (config && !config.available)) && (
          <div className="bg-orange-50 border border-orange-200 text-orange-700 p-4 rounded-xl flex items-center gap-3 shadow-sm">
            <Info size={20} />
            <p className="text-sm font-medium">{error || 'Dịch vụ TTS chưa được khởi động.'}</p>
          </div>
        )}

        <div className="grid lg:grid-cols-12 gap-6 items-start">
          {/* LEFT: Text Input Panel */}
          <div className="lg:col-span-8 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col min-h-[500px]">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
               <h2 className="font-semibold text-slate-800 flex items-center gap-2">
                 <AudioLines size={18} className="text-indigo-500" /> Nội dung
               </h2>
               <span className="text-xs font-bold text-slate-400 px-3 py-1 bg-white rounded-full border border-slate-200 shadow-sm">
                 {[...text].length} ký tự
               </span>
            </div>
            <textarea 
              aria-label="Nội dung cần chuyển thành giọng nói" 
              value={text} 
              onChange={e => setText(e.target.value)} 
              maxLength={config?.maxTextLength ?? undefined} 
              disabled={isGenerating}
              placeholder="Nhập nội dung vào đây..."
              className="p-6 flex-1 w-full min-h-[400px] resize-y outline-none text-[15px] leading-relaxed text-slate-700 bg-white placeholder-slate-300 disabled:opacity-60 transition-colors" 
            />
            <div className="px-6 py-3 bg-slate-50 border-t border-slate-100 flex items-center gap-2 text-xs text-slate-500 font-medium">
               <Sparkles size={14} className="text-amber-500" /> Hỗ trợ tiếng Việt. Tạo audio rõ ràng hơn với dấu câu đầy đủ.
            </div>
          </div>

          {/* RIGHT: Voice Settings */}
          <div className="lg:col-span-4 bg-white rounded-2xl border border-slate-200 shadow-sm p-6 flex flex-col gap-6 sticky top-8">
            <h2 className="font-semibold text-slate-800 flex items-center gap-2 text-lg">
              <Mic size={20} className="text-indigo-500" /> Tạo giọng đọc
            </h2>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Giọng Đọc</label>
                <VoiceSelect label="Giọng đọc" value={voiceId} disabled={isGenerating} onChange={setVoiceId} voices={voices} hasMoreVoices={hasMoreVoices} loadMoreVoices={loadMoreVoices} voicesBusy={voicesBusy} />
              </div>

              {selected?.previewUrl && (
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Nghe Thử</label>
                  <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 shadow-inner">
                    <audio aria-label="Nghe mẫu giọng đã chọn" controls preload="metadata" crossOrigin="use-credentials" src={audioUrl(selected.previewUrl)} className="w-full h-10" />
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-100">
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-500 font-medium">Chi phí định mức</span>
                <span className="font-semibold text-slate-700">{config ? config.creditsPer100Chars : '—'} Credit / 100 ký tự</span>
              </div>
              <div className="h-[1px] bg-slate-200 w-full" />
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-500 font-medium">Credit dự kiến</span>
                <span className="font-bold text-lg text-indigo-600 bg-indigo-50 px-3 py-1 rounded-lg border border-indigo-100">{cost ?? '—'}</span>
              </div>
            </div>

            <AnimatePresence mode="popLayout">
              {isGenerating ? (
                <motion.div 
                  key="generating"
                  initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                  className="bg-indigo-50/50 border border-indigo-100 rounded-2xl p-5 relative overflow-hidden flex flex-col items-center justify-center gap-4"
                >
                  <motion.div 
                    animate={{ x: ["-10%", "10%", "-10%"], y: ["-5%", "5%", "-5%"] }}
                    transition={{ repeat: Infinity, duration: 6, ease: "easeInOut" }}
                    className="absolute inset-0 bg-gradient-to-r from-cyan-400/10 via-indigo-500/10 to-violet-500/10 blur-xl z-0"
                  />
                  <div className="flex items-center gap-[3px] h-10 w-full justify-center relative z-10">
                     <motion.div
                       animate={{ left: ["-10%", "110%"] }}
                       transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                       className="absolute top-0 bottom-0 w-[1px] bg-cyan-400 shadow-[0_0_15px_rgba(34,211,238,1)] z-20"
                     />
                     {[...Array(24)].map((_, i) => (
                       <motion.div 
                         key={i}
                         animate={{ height: ["20%", `${40 + Math.random()*60}%`, "20%"] }}
                         transition={{ repeat: Infinity, duration: 1 + Math.random(), delay: i * 0.05, ease: "easeInOut" }}
                         className="w-1.5 bg-gradient-to-t from-cyan-400 to-indigo-500 rounded-full opacity-80"
                       />
                     ))}
                  </div>
                  
                  <motion.div 
                    key={stageIndex}
                    initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }}
                    className="text-sm font-semibold text-indigo-600 z-10 text-center"
                  >
                    {stages[stageIndex] || stages[3]}
                  </motion.div>

                  <div className="h-1 bg-slate-200 rounded-full w-full relative z-10 mt-1">
                     <motion.div 
                       animate={{ width: `${progress}%` }}
                       transition={{ ease: "linear", duration: 0.3 }}
                       className="absolute left-0 top-0 bottom-0 bg-gradient-to-r from-cyan-400 via-indigo-500 to-violet-500 rounded-full"
                     >
                       <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2 h-2 bg-white rounded-full shadow-[0_0_5px_rgba(99,102,241,0.8)]" />
                     </motion.div>
                  </div>
                </motion.div>
              ) : (
                <motion.div key="button" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <button 
                    disabled={!text.trim() || !voiceId || selected?.canUse === false || !config?.available} 
                    onClick={create}
                    className="w-full py-4 bg-slate-900 text-white font-semibold rounded-xl hover:bg-indigo-600 hover:-translate-y-0.5 focus:ring-4 focus:ring-indigo-500/20 transition-all disabled:opacity-50 disabled:hover:bg-slate-900 disabled:hover:translate-y-0 shadow-lg shadow-slate-900/10 flex items-center justify-center gap-2"
                  >
                    <Sparkles size={18} /> Tạo giọng đọc
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* BOTTOM: History Section */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 md:p-8 mt-10">
          <div className="flex items-center justify-between mb-8">
             <div className="flex items-center gap-3">
               <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center">
                 <History size={20} />
               </div>
               <div>
                 <h2 className="text-xl font-bold text-slate-900">Lịch sử tạo giọng</h2>
                 <p className="text-sm text-slate-500 font-medium">Các đoạn audio đã được tạo thành công gần đây</p>
               </div>
             </div>
             <div className="text-sm font-bold text-slate-400 bg-slate-50 px-3 py-1 rounded-full border border-slate-200 hidden sm:block">
               {total} mục
             </div>
          </div>

          {!jobs.length && (
             <div className="flex flex-col items-center justify-center py-16 text-slate-400 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
               <History size={48} className="opacity-20 mb-4" />
               <p className="font-medium text-slate-500">Chưa có audio nào.</p>
               <p className="text-sm mt-1 opacity-70">Các audio bạn tạo sẽ xuất hiện tại đây.</p>
             </div>
          )}

          <div className="space-y-5">
            {jobs.map(job => {
              const jobVoice = voices.find(v => v.id === job.voiceId);
              const isPending = pendingJob(job);
              const isFailed = job.status === 'FAILED';
              const isSuccess = job.status === 'COMPLETED' && job.result?.audioUrl;

              return (
                <div key={job.id} className="group rounded-2xl border border-slate-200 bg-white p-5 hover:shadow-lg hover:border-indigo-200 hover:bg-slate-50/50 transition-all duration-300">
                  <div className="flex flex-col lg:flex-row gap-6">
                    
                    {/* Content Area */}
                    <div className="flex-1 space-y-4">
                      <div className="flex flex-wrap justify-between items-start gap-4">
                        <div className="flex flex-wrap items-center gap-2">
                           <Mic size={16} className="text-indigo-500" />
                           <strong className="text-slate-800 font-semibold">{jobVoice?.name || 'Giọng đã lưu'}</strong>
                           <span className="text-xs font-medium text-slate-400 ml-0 sm:ml-2 bg-slate-100 px-2 py-0.5 rounded-md">
                             {new Date(job.createdAt).toLocaleString('vi-VN')}
                           </span>
                        </div>
                        {/* Status Badge */}
                        {isPending && <span className="px-3 py-1 text-xs font-semibold text-indigo-600 bg-indigo-50 rounded-full border border-indigo-100 flex items-center gap-1.5"><span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-pulse" /> Đang xử lý</span>}
                        {isFailed && <span className="px-3 py-1 text-xs font-semibold text-red-600 bg-red-50 rounded-full border border-red-100">Lỗi tạo audio</span>}
                        {isSuccess && <span className="px-3 py-1 text-xs font-semibold text-emerald-600 bg-emerald-50 rounded-full border border-emerald-100 flex items-center gap-1.5"><CheckCircle2 size={12}/> Hoàn tất</span>}
                      </div>
                      
                      <p className="text-sm text-slate-600 leading-relaxed line-clamp-3 bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
                        {job.text}
                      </p>
                      
                      {isFailed && (
                        <p className="text-sm font-medium text-red-600 bg-red-50 p-3 rounded-xl border border-red-100">
                           {errorMessage(job.failedReason)} · Credit giữ cho tác vụ đã được giải phóng.
                        </p>
                      )}
                    </div>

                    {/* Action Area */}
                    {isSuccess && job.result && (
                      <div className="w-full lg:w-[360px] shrink-0 flex flex-col justify-end gap-4 border-t lg:border-t-0 lg:border-l border-slate-100 pt-5 lg:pt-0 lg:pl-6">
                        <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 shadow-inner w-full">
                          <audio controls preload="metadata" crossOrigin="use-credentials" src={audioUrl(job.result.audioUrl)} className="w-full h-10 outline-none" />
                        </div>
                        <div className="flex justify-between items-center px-1">
                          <div className="flex items-center gap-4 text-xs font-semibold text-slate-500">
                             <span className="flex items-center gap-1.5"><Clock size={14} className="text-slate-400" /> {job.result.duration.toFixed(1)}s</span>
                             <span className="flex items-center gap-1.5"><Sparkles size={14} className="text-amber-500" /> {job.result.chargedCredits} cr</span>
                          </div>
                          <button 
                            className="text-indigo-600 hover:text-indigo-800 text-sm font-bold flex items-center gap-1.5 transition-colors bg-indigo-50 hover:bg-indigo-100 px-4 py-2 rounded-lg" 
                            onClick={() => downloadAudio(job.result!.audioUrl, `veltrix-${job.id}.wav`).catch(() => toast.error('Không tải được audio.'))}
                          >
                            <Download size={14} /> Tải WAV
                          </button>
                        </div>
                      </div>
                    )}

                  </div>
                </div>
              );
            })}
          </div><Pagination current={page} total={total} pageSize={10} showSizeChanger={false} onChange={setPage} hideOnSinglePage/>
        </div>

      </div>
    </div>
  );
};

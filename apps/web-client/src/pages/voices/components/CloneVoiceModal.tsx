import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '../../../api';
import { prepareCloneSample, cloneErrorMessage } from '../../../utils/cloneSample';

interface Props { isOpen: boolean; onClose: () => void; onCreated: () => void; consentVersion: string; limits?: {minSeconds:number;maxSeconds:number;maxBytes:number}; }
export const CloneVoiceModal = ({ isOpen, onClose, onCreated, consentVersion, limits }: Props) => {
  const [name, setName] = useState(''); const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false); const [rights, setRights] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [sample, setSample] = useState<{ blob: Blob; duration: number } | null>(null);
  const selection = useRef(0);
  const errorBox = useRef<HTMLDivElement>(null);
  useEffect(() => { if (error) errorBox.current?.scrollIntoView({ block: 'nearest' }); }, [error]);
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  const selectFile = async (chosen: File | null) => {
    const current = ++selection.current;
    setFile(chosen); setSample(null); setError(''); attempt.current = null;
    if (!chosen) { setChecking(false); return; }
    setChecking(true);
    try { const prepared = await prepareCloneSample(chosen); if(limits && (prepared.duration<limits.minSeconds || prepared.duration>limits.maxSeconds || prepared.blob.size>limits.maxBytes)) throw new Error(`Mẫu cần dài từ ${limits.minSeconds} đến ${limits.maxSeconds} giây, dung lượng tối đa ${(limits.maxBytes / 1024 / 1024).toFixed(1)} MB theo gói của bạn.`); if (selection.current === current) setSample(prepared); }
    catch (e: any) { if (selection.current === current) setError(e.message || 'Không kiểm tra được file âm thanh.'); }
    finally { if (selection.current === current) setChecking(false); }
  };
  if (!isOpen) return null;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy || checking || !file || !sample || !consent || !rights || !consentVersion) return;
    setBusy(true); setError('');
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('Không đọc được file.')); reader.readAsDataURL(sample.blob);
      });
      const signature = name.trim() + ':' + data;
      if (attempt.current?.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() };
      await api.post('/voice-enrollments', { name: name.trim(), audioBase64: data, consentToClone: consent, hasVoiceRights: rights, consentVersion }, { headers: { 'Idempotency-Key': attempt.current!.key } });
      attempt.current = null; setName(''); setFile(null); setSample(null); setConsent(false); setRights(false); onCreated(); onClose();
    } catch (e: any) {
      const code = e.response?.data?.error?.code;
      setError(e.response ? cloneErrorMessage(code) : e.message || 'Không kết nối được máy chủ.');
    } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
      <form onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="clone-title" className="w-full max-w-lg bg-white rounded-3xl p-6 sm:p-8 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.3)] relative overflow-y-auto max-h-[calc(100dvh-2rem)]">
        {/* Decorative Top Border */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-cyan-400 via-indigo-500 to-violet-500" />
        
        <div className="flex justify-between items-center mb-6">
          <div>
            <h2 id="clone-title" className="text-2xl font-bold text-slate-900 tracking-tight">Tạo Giọng Nhân Bản</h2>
            <p className="text-sm text-slate-500 mt-1">Tạo giọng đọc riêng từ mẫu âm thanh của bạn.</p>
          </div>
          <button type="button" disabled={busy} onClick={onClose} aria-label="Đóng" className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-6">
          {/* Tên Giọng Đọc */}
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-slate-700 uppercase tracking-wide text-xs">Tên giọng đọc</label>
            <input required maxLength={50} value={name} disabled={busy} onChange={e => setName(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-sm focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none text-slate-900 font-medium" placeholder="VD: Nam - Kể chuyện" />
          </div>

          {/* Tải tệp lên */}
          <div className="space-y-2">
            <label className="block font-semibold text-slate-700 uppercase tracking-wide text-xs">Tải mẫu âm thanh {limits ? `(WAV, ${limits.minSeconds}–${limits.maxSeconds} giây)` : '(WAV)'}</label>
            <div className="relative group cursor-pointer">
              <input type="file" accept=".wav,audio/wav,audio/x-wav" required disabled={busy} onChange={e => void selectFile(e.target.files?.[0] || null)} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
              <div className={`w-full border-2 border-dashed rounded-xl p-6 text-center transition-all ${file ? 'border-indigo-400 bg-indigo-50/50' : 'border-slate-200 bg-slate-50 group-hover:bg-slate-100 group-hover:border-slate-300'}`}>
                {file ? (
                  <div className="flex flex-col items-center gap-2 text-indigo-600">
                    <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center">
                       <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><path d="M8 13h2"/><path d="M8 17h2"/><path d="M14 13h2"/><path d="M14 17h2"/></svg>
                    </div>
                    <span className="font-semibold text-sm truncate max-w-[200px]">{file.name}</span>
                    <span className="text-xs font-medium opacity-70">{(file.size / 1024 / 1024).toFixed(2)} MB</span>
                    {checking && <span role="status" className="text-xs">Đang kiểm tra audio...</span>}
                    {sample && <span className="text-xs text-emerald-700">Hợp lệ · {sample.duration.toFixed(2)} giây · Đã chuẩn hóa PCM16</span>}
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 text-slate-500">
                    <div className="w-10 h-10 bg-white shadow-sm border border-slate-100 rounded-full flex items-center justify-center text-slate-400 group-hover:text-indigo-500 transition-colors">
                       <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>
                    </div>
                    <div className="text-sm">
                      <span className="font-semibold text-indigo-600">Bấm để tải lên</span> hoặc kéo thả tệp vào đây
                    </div>
                    <span className="text-xs font-medium opacity-70">WAV {limits ? `· ${limits.minSeconds}–${limits.maxSeconds} giây · Tối đa ${(limits.maxBytes / 1048576).toFixed(1)} MiB` : ''}</span>
                  </div>
                )}
              </div>
            </div>
            <p className="text-xs text-slate-500 font-medium leading-relaxed mt-2 bg-slate-50 p-3 rounded-lg border border-slate-100">
              💡 <strong className="text-slate-700">Mẹo:</strong> Chọn bản thu một người nói, phát âm rõ ràng, không có nhạc nền hay tạp âm. WAV được chuyển sang PCM16 trên thiết bị trước khi gửi. Mẫu được lưu riêng và xóa khi bạn thu hồi hoặc xóa giọng.
            </p>
          </div>

          {/* Cam kết */}
          <div className="space-y-3 bg-indigo-50/30 border border-indigo-100/50 p-4 rounded-xl">
            <label className="flex gap-3 items-start cursor-pointer">
              <input type="checkbox" checked={consent} disabled={busy} onChange={e => setConsent(e.target.checked)} required className="mt-1 w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer" />
              <span className="text-sm text-slate-700 leading-snug">Tôi đồng ý sử dụng mẫu âm thanh này để hệ thống tạo và lưu trữ giọng nhân bản của riêng tôi.</span>
            </label>
            <label className="flex gap-3 items-start cursor-pointer">
              <input type="checkbox" checked={rights} disabled={busy} onChange={e => setRights(e.target.checked)} required className="mt-1 w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer" />
              <span className="text-sm text-slate-700 leading-snug">Tôi cam kết đây là giọng của chính tôi hoặc tôi đã được chủ sở hữu giọng nói cho phép sử dụng.</span>
            </label>
          </div>
          
          <p className="text-xs text-center text-slate-400 font-medium">Việc tạo giọng không tiêu tốn credit. Phí chỉ tính khi bạn tạo lời đọc (TTS).</p>

          {error && <div ref={errorBox} className="bg-red-50 text-red-600 text-sm p-3 rounded-xl border border-red-100 flex items-center gap-2 font-medium" role="alert"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg> {error}</div>}
        </div>

        <div className="pt-6 mt-4 border-t border-slate-100">
           <button type="submit" disabled={busy || checking || !sample || !consent || !rights || !file || !name.trim() || !consentVersion} className="w-full py-3.5 bg-slate-900 text-white font-semibold rounded-xl hover:bg-indigo-600 focus:ring-4 focus:ring-indigo-500/20 transition-all disabled:opacity-50 disabled:hover:bg-slate-900 flex items-center justify-center gap-2 shadow-md">
             {busy ? (
               <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Đang gửi mẫu...</>
             ) : (
               <><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> Tạo giọng của tôi</>
             )}
           </button>
        </div>
      </form>
    </div>
  );
};


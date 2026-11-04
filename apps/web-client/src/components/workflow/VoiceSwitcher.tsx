import React, { useEffect, useState } from 'react';
import { AudioLines, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../api';
import { errorMessage } from '../../utils/userMessages';
import { VoiceSelect } from '../ui/VoiceSelect';

/**
 * "Đổi giọng" for a finished video: pick another voice, every scene is read again with it and the
 * video is rendered again. Script, images and thumbnail stay as they are.
 */
export const VoiceSwitcher: React.FC<{ runId: string; currentVoiceId: string; sceneCount: number; onStarted: () => void }> = ({ runId, currentVoiceId, sceneCount, onStarted }) => {
  const [open, setOpen] = useState(false);
  const [voices, setVoices] = useState<any[]>([]);
  const [voiceId, setVoiceId] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || voices.length) return;
    api.get('/voices', { params: { page: 1, limit: 50 } }).then((r) => {
      const list = [...r.data.data.systemVoices, ...r.data.data.cloneVoices];
      setVoices(list);
      setVoiceId(list.find((v: any) => v.id !== currentVoiceId && v.canUse !== false)?.id || '');
    }).catch(() => toast.error('Không tải được danh sách giọng đọc.'));
  }, [open, voices.length, currentVoiceId]);

  const start = async () => {
    if (!voiceId || voiceId === currentVoiceId) return;
    setBusy(true);
    try {
      await api.post(`/auto-videos/${runId}/voice`, { voiceId });
      toast.success(`Đang đọc lại ${sceneCount} cảnh bằng giọng mới, sau đó dựng lại video`);
      setOpen(false); onStarted();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:border-violet-400">
        <AudioLines size={15} /> Đổi giọng
      </button>
    );
  }
  return (
    <div className="basis-full w-full min-w-[300px] sm:min-w-[440px] rounded-xl border border-violet-200 dark:border-violet-900 bg-violet-50/60 dark:bg-violet-950/30 p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Đổi giọng đọc cho video này</p>
        <button type="button" onClick={() => setOpen(false)} aria-label="Đóng" className="text-slate-400 hover:text-slate-700"><X size={16} /></button>
      </div>
      <VoiceSelect label="Giọng mới" voices={voices} value={voiceId} onChange={setVoiceId} disabled={busy} />
      <p className="text-[13px] text-slate-500 dark:text-slate-400">
        Đọc lại cả {sceneCount} cảnh rồi dựng lại video (tính phí giọng đọc và dựng như một lần làm mới). Kịch bản, ảnh và thumbnail giữ nguyên; video đã đăng YouTube sẽ không bị đăng lại.
      </p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-sm">Hủy</button>
        <button type="button" disabled={busy || !voiceId || voiceId === currentVoiceId} onClick={start} className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
          {busy ? 'Đang gửi…' : 'Đọc lại & dựng lại'}
        </button>
      </div>
    </div>
  );
};

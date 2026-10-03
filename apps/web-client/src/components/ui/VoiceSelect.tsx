import { useEffect, useId, useRef, useState } from 'react';
import { Popover, Pagination } from 'antd';
import { ChevronDown } from 'lucide-react';
import { VoiceAvatar } from './VoiceAvatar';
import { SystemVoiceCard } from '../../pages/voices/components/SystemVoiceCard';
import { audioUrl } from '../../hooks/useTtsData';

interface VoiceChoice {
  id: string; name: string; gender: 'male' | 'female' | 'unknown';
  tags?: string[]; language?: string; locale?: string; avatarUrl?: string | null;
  previewUrl?: string | null; previewText?: string | null; isSystem?: boolean;
  canUse?: boolean;
}
export const voiceGender = (gender: string) => gender === 'male' ? 'Nam' : gender === 'female' ? 'Nữ' : 'Khác';
const languageLabel = (voice: VoiceChoice) => (voice.language || voice.locale)?.startsWith('vi') ? 'Tiếng Việt' : voice.language || voice.locale || 'Chưa rõ ngôn ngữ';

export function VoiceSelect({ voices, value, onChange, disabled, hasMoreVoices,loadMoreVoices,voicesBusy,label = 'Giọng đọc' }: {
  hasMoreVoices?:boolean;loadMoreVoices?:()=>Promise<void>;voicesBusy?:boolean;voices: VoiceChoice[]; value: string; onChange: (id: string) => void; disabled?: boolean; label?: string;
}) {
  const [page,setPage]=useState(1);
  const [open, setOpen] = useState(false);
  const id = useId(); const trigger = useRef<HTMLButtonElement>(null); const panel = useRef<HTMLDivElement>(null);
  const selected = voices.find(voice => voice.id === value);
  const pause = () => panel.current?.querySelectorAll('audio').forEach(audio => audio.pause());
  const close = () => { pause(); setOpen(false); };
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const choice = panel.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]') || panel.current?.querySelector('button');
      choice?.focus({ preventScroll: true }); choice?.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);
  useEffect(() => { if (disabled) { panel.current?.querySelectorAll('audio').forEach(audio => audio.pause()); setOpen(false); } }, [disabled]);
  const content = <div ref={panel} id={id} role="dialog" aria-label={`Chọn ${label.toLowerCase()}`} className="w-[min(380px,calc(100vw-48px))] max-h-[60dvh] overflow-y-auto space-y-3 p-1"
    onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close(); trigger.current?.focus(); } }}
    onPlayCapture={event => panel.current?.querySelectorAll('audio').forEach(audio => { if (audio !== event.target) audio.pause(); })}>
    <p className="text-xs text-slate-500 px-1">Bấm vào tên để chọn giọng. Có thể nghe mẫu trước khi chọn.</p>
    {voices.slice((page-1)*10,page*10).map(voice => <SystemVoiceCard key={voice.id} name={voice.name} gender={voice.gender} avatarUrl={voice.avatarUrl || undefined}
      tags={[languageLabel(voice), voiceGender(voice.gender), ...(voice.tags || []), ...(voice.isSystem === false ? ['Giọng của bạn'] : [])]}
      previewUrl={voice.previewUrl ? audioUrl(voice.previewUrl) : undefined} previewText={voice.previewText || undefined}
      locked={voice.canUse === false} selected={voice.id === value} onSelect={() => { if (voice.canUse === false) return; onChange(voice.id); close(); trigger.current?.focus(); }} />)}
    <Pagination current={page} total={voices.length} pageSize={10} showSizeChanger={false} onChange={setPage} hideOnSinglePage/>{hasMoreVoices&&<button disabled={voicesBusy} className="text-indigo-600 text-sm p-2" onClick={()=>void loadMoreVoices?.()}>{voicesBusy?'Đang tải...':'Tải thêm 10 giọng'}</button>}
  </div>;
  return <Popover content={content} trigger="click" placement="bottomLeft" open={open && !disabled} destroyOnHidden
    onOpenChange={next => { if (next && !disabled && voices.length) setOpen(true); else close(); }}>
    <button ref={trigger} type="button" aria-label={label} aria-haspopup="dialog" aria-expanded={open && !disabled} aria-controls={open ? id : undefined}
      disabled={disabled || !voices.length} className="flex w-full items-center gap-3 text-left rounded-xl border border-slate-200 bg-white px-3 py-2.5 hover:border-indigo-400 focus-visible:outline-2 focus-visible:outline-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed">
      {selected && <VoiceAvatar name={selected.name} gender={selected.gender} avatarUrl={selected.avatarUrl} />}
      <span className="flex-1 min-w-0">
        <span className="block font-semibold text-sm text-slate-800 truncate">{selected?.name || (voices.length ? 'Chọn giọng đọc' : 'Đang tải giọng đọc...')}</span>
        {selected && <span className="block text-xs text-slate-500 mt-1">{languageLabel(selected)} · {voiceGender(selected.gender)}</span>}
      </span>
      <ChevronDown size={16} aria-hidden="true" className="shrink-0 text-slate-500" />
    </button>
  </Popover>;
}

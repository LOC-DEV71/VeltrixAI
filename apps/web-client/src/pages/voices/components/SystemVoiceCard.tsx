import React, { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { VoiceAvatar } from '../../../components/ui/VoiceAvatar';
import { Link } from 'react-router-dom';

interface SystemVoiceCardProps {
  name: string;
  tags: string[];
  gender: 'male' | 'female' | 'unknown';
  avatarUrl?: string;
  previewUrl?: string;
  previewText?: string;
  selected?: boolean;
  onSelect?: () => void;
  locked?: boolean;
}

export const SystemVoiceCard: React.FC<SystemVoiceCardProps> = ({ name, tags, gender, avatarUrl, previewUrl, previewText, selected, onSelect, locked }) => {
  const [audioError, setAudioError] = useState(false);
  const header = <>
    <VoiceAvatar name={name} gender={gender} avatarUrl={avatarUrl} />
    <span className="min-w-0 flex-1 text-left">
      <span className="block font-bold text-[var(--color-text-main)] mb-1 break-words">{name}</span>
      <span className="flex flex-wrap items-center gap-2">
        {tags.map(tag => <span key={tag} className="px-2 py-0.5 rounded text-[11px] font-medium bg-gray-100 text-gray-600">{tag}</span>)}
      </span>
    </span>
    {selected && <CheckCircle2 aria-hidden="true" size={20} className="shrink-0 text-indigo-600" />}
  </>;
  return (
    <div className={`bg-white rounded-xl border p-5 shadow-sm hover:shadow-md transition-shadow ${selected ? 'border-indigo-400 ring-1 ring-indigo-400' : 'border-[var(--color-border)]'}`}>
      {onSelect && !locked ? <button type="button" aria-label={`Chọn giọng ${name}`} aria-pressed={Boolean(selected)} onClick={onSelect} className="flex w-full items-center gap-4 mb-4 rounded-lg hover:bg-indigo-50/50 focus-visible:outline-2 focus-visible:outline-indigo-500 focus-visible:outline-offset-4">{header}</button>
        : <div className="flex items-center gap-4 mb-4">{header}</div>}
      {previewUrl ? (
        <div className="space-y-2">
          <audio aria-label={`Nghe thử giọng ${name}`} controls preload="none" crossOrigin="use-credentials" src={previewUrl} className="w-full h-10" onError={() => setAudioError(true)} onCanPlay={() => setAudioError(false)} />
          {audioError && <p role="alert" className="text-xs text-red-600">Không tải được mẫu giọng. Vui lòng thử lại sau.</p>}
          <p className="text-xs leading-relaxed text-[var(--color-text-sub)]">{previewText}</p>
        </div>
      ) : <p className="text-xs text-[var(--color-text-sub)]">Chưa có mẫu nghe thử.</p>}
      {locked && <div className="mt-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">Gói hiện tại chưa cho phép sử dụng giọng này. Bạn vẫn có thể nghe mẫu.<Link to="/pricing" className="block mt-2 font-semibold text-indigo-600">Xem gói để nâng cấp →</Link></div>}
    </div>
  );
};

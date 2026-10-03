import React from 'react';
import { Play, Trash2, Mic } from 'lucide-react';

interface CloneVoiceCardProps {
  name: string;
  createdAt: string;
  fileLength: string;
  accuracy: string;
}

export const CloneVoiceCard: React.FC<CloneVoiceCardProps> = ({ name, createdAt, fileLength, accuracy }) => {
  return (
    <div className="bg-white border border-[var(--color-border)] rounded-[12px] p-4 flex items-center justify-between shadow-sm">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-indigo-50 text-[var(--color-primary)] font-bold text-sm flex items-center justify-center border border-[var(--color-border)]">
          <Mic size={20} />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-[var(--color-text-main)]">{name}</h4>
            <span className="text-[10px] bg-indigo-50 text-[var(--color-primary)] font-semibold px-1.5 py-0.5 rounded">Custom Clone</span>
          </div>
          <p className="text-xs text-[var(--color-text-sub)] mt-0.5">Tạo lúc: {createdAt} • File gốc: {fileLength} • Độ khớp {accuracy}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button className="w-8 h-8 rounded-full bg-gray-50 border border-[var(--color-border)] text-[var(--color-text-main)] hover:text-[var(--color-primary)] hover:border-[var(--color-primary)] flex items-center justify-center transition-colors" title="Nghe thử">
          <Play size={14} className="ml-0.5" />
        </button>
        <button className="w-8 h-8 rounded-lg border border-[var(--color-border)] text-[var(--color-text-sub)] hover:text-red-700 hover:bg-red-50 hover:border-red-300 flex items-center justify-center transition-colors" title="Xóa giọng">
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
};

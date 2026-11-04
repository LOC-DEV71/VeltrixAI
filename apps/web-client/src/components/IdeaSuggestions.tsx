import React, { useEffect, useRef, useState } from 'react';
import { Lightbulb, Loader2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../api';
import { errorMessage } from '../utils/userMessages';

export interface IdeaSuggestion {
  topic: string;
  audience: string;
  tone: 'funny' | 'pro' | 'drama';
  platform: 'tiktok' | 'shorts' | 'video' | 'reels';
  durationSeconds: number;
  hook: string;
  reason: string;
}

const TONE_LABELS: Record<IdeaSuggestion['tone'], string> = { funny: 'Hài hước', pro: 'Chuyên gia', drama: 'Kịch tính' };
const PLATFORM_LABELS: Record<IdeaSuggestion['platform'], string> = { tiktok: 'TikTok', shorts: 'Shorts', video: 'YouTube', reels: 'Reels' };
const formatDuration = (seconds: number) => seconds >= 60 ? `${Math.floor(seconds / 60)} phút${seconds % 60 ? ` ${seconds % 60} giây` : ''}` : `${seconds} giây`;

interface Props {
  seed: string;
  disabled?: boolean;
  onApply: (idea: IdeaSuggestion) => void;
}

/** "Gợi ý ý tưởng" button with a list of AI suggestions. Free, limited per day by the backend. */
export const IdeaSuggestions: React.FC<Props> = ({ seed, disabled, onApply }) => {
  const [loading, setLoading] = useState(false);
  const [ideas, setIdeas] = useState<IdeaSuggestion[]>([]);
  const [usage, setUsage] = useState<{ used: number; limit: number } | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  const suggest = async () => {
    if (loading) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    try {
      const res = await api.post('/contents/suggest', { seed: seed.trim().slice(0, 300) }, { signal: controller.signal, timeout: 150000 });
      setIdeas(res.data.data.suggestions);
      setUsage({ used: res.data.data.usedToday, limit: res.data.data.dailyLimit });
    } catch (err: any) {
      if (!controller.signal.aborted) toast.error(errorMessage(err));
    } finally {
      if (request.current === controller) { request.current = null; setLoading(false); }
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={suggest}
        disabled={disabled || loading}
        className="self-start inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-primary)] hover:text-indigo-800 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : <Lightbulb size={16} />}
        {loading ? 'AI đang nghĩ ý tưởng...' : seed.trim() ? 'Gợi ý ý tưởng từ chủ đề này' : 'Gợi ý ý tưởng'}
        <span className="text-xs font-normal text-[var(--color-text-sub)]">(miễn phí)</span>
      </button>

      {ideas.length > 0 && (
        <div className="rounded-lg border border-indigo-100 bg-indigo-50/40 p-2 flex flex-col gap-2">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs text-[var(--color-text-sub)]">
              Bấm để áp vào form{usage ? ` • Đã dùng ${usage.used}/${usage.limit} lượt hôm nay` : ''}
            </span>
            <button type="button" onClick={() => setIdeas([])} className="text-gray-400 hover:text-gray-600" aria-label="Đóng gợi ý">
              <X size={14} />
            </button>
          </div>
          {ideas.map((idea) => (
            <button
              key={idea.topic}
              type="button"
              disabled={disabled}
              onClick={() => { onApply(idea); setIdeas([]); toast.success('Đã áp ý tưởng vào form'); }}
              className="text-left rounded-md bg-white border border-[var(--color-border)] p-3 hover:border-[var(--color-primary)] transition-colors disabled:opacity-50"
            >
              <p className="text-sm font-semibold text-[var(--color-text-main)]">{idea.topic}</p>
              {idea.hook && <p className="text-xs text-[var(--color-text-main)] mt-1">Hook: “{idea.hook}”</p>}
              <p className="text-xs text-[var(--color-text-sub)] mt-1">
                {PLATFORM_LABELS[idea.platform]} • {TONE_LABELS[idea.tone]} • {formatDuration(idea.durationSeconds)} • {idea.audience}
              </p>
              {idea.reason && <p className="text-xs text-[var(--color-text-sub)] mt-1 italic">{idea.reason}</p>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

import React from 'react';
import { Sparkles } from 'lucide-react';

/** Same ids and colors as packages/video-renderer/src/theme.ts. */
export const VIDEO_THEMES = [
  { id: 'auto', label: 'Tự động', hint: 'AI chọn theo chủ đề', colors: [] as string[], font: 'inherit' },
  { id: 'cosmic', label: 'Vũ trụ', hint: 'Thiên văn, vật lý, viễn tưởng', colors: ['#0B0B1A', '#7C5CFF', '#3DE0FF'], font: "'Be Vietnam Pro', sans-serif" },
  { id: 'documentary', label: 'Tư liệu', hint: 'Lịch sử, triết học, chính trị', colors: ['#1A120B', '#B07A3B', '#E9C46A'], font: "'Playfair Display', Georgia, serif" },
  { id: 'finance', label: 'Tài chính', hint: 'Tiền, kinh tế, đầu tư', colors: ['#06142B', '#F2B705', '#22C55E'], font: "Montserrat, sans-serif" },
  { id: 'tech', label: 'Công nghệ', hint: 'AI, phần mềm, internet', colors: ['#030507', '#00E5FF', '#B6FF00'], font: "'Space Grotesk', monospace" },
  { id: 'nature', label: 'Thiên nhiên', hint: 'Động vật, môi trường, sức khỏe', colors: ['#0B2016', '#5FD38D', '#FFB347'], font: "Nunito, sans-serif" },
  { id: 'pop', label: 'Đời sống', hint: 'Tâm lý, mẹo, giải trí', colors: ['#F2545B', '#FFE14D', '#111111'], font: "'Baloo 2', sans-serif" },
] as const;
export type VideoThemeId = (typeof VIDEO_THEMES)[number]['id'];

const KEY = 'creatorai.videoTheme';
export const rememberedTheme = (): VideoThemeId => {
  try { const v = localStorage.getItem(KEY); return VIDEO_THEMES.some((t) => t.id === v) ? v as VideoThemeId : 'auto'; } catch { return 'auto'; }
};

export const ThemePicker: React.FC<{ value: VideoThemeId; onChange: (id: VideoThemeId) => void; disabled?: boolean }> = ({ value, onChange, disabled }) => (
  <fieldset className="space-y-2" disabled={disabled}>
    <legend className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1.5">Phong cách</legend>
    <div role="radiogroup" aria-label="Phong cách video" className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {VIDEO_THEMES.map((t) => {
        const selected = value === t.id;
        return (
          <button key={t.id} type="button" role="radio" aria-checked={selected}
            onClick={() => { onChange(t.id); try { localStorage.setItem(KEY, t.id); } catch { /* private mode */ } }}
            className={`text-left rounded-xl border px-3 py-2 transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${selected ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/40' : 'border-slate-200 dark:border-slate-700 hover:border-violet-300'}`}>
            <span className="flex items-center gap-1.5">
              {t.id === 'auto'
                ? <Sparkles size={14} className="text-violet-600" />
                : <span className="flex -space-x-1" aria-hidden="true">{t.colors.map((c) => <span key={c} className="w-3.5 h-3.5 rounded-full ring-1 ring-white dark:ring-slate-900" style={{ background: c }} />)}</span>}
              <span className="text-[13px] font-bold text-slate-800 dark:text-slate-100" style={{ fontFamily: t.font }}>{t.label}</span>
              {t.id === 'auto' && <span className="ml-auto text-[11px] font-semibold text-violet-700 bg-violet-100 dark:bg-violet-900/60 dark:text-violet-200 rounded px-1.5">Mặc định</span>}
            </span>
            <span className="block text-[12px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">{t.hint}</span>
          </button>
        );
      })}
    </div>
  </fieldset>
);

import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Brain, ChartColumn, Clock, FileText, Layers, List, Megaphone, Quote, Scale, Shapes, Zap } from 'lucide-react';
import type { Thinking } from './workflowModel';

const TYPE_META: Record<string, { label: string; Icon: typeof Zap }> = {
  hook: { label: 'Mở đầu', Icon: Zap }, icon_card: { label: 'Thẻ ý chính', Icon: Shapes }, stat: { label: 'Con số', Icon: ChartColumn },
  list: { label: 'Danh sách', Icon: List }, compare: { label: 'So sánh', Icon: Scale }, scale: { label: 'Thang cấp', Icon: Layers },
  timeline: { label: 'Mốc thời gian', Icon: Clock }, quote: { label: 'Trích dẫn', Icon: Quote }, cta: { label: 'Kêu gọi', Icon: Megaphone },
};
const EASE = [0.16, 1, 0.3, 1] as const;

/**
 * Reveals newly arrived text a few characters per frame so it reads like typing, catching up
 * with the stream within ~0.6 s. Reduced motion shows text immediately.
 */
function useTypedText(text: string, reduce: boolean) {
  const [shown, setShown] = useState(text.length);
  const target = useRef(text.length);
  useEffect(() => {
    target.current = text.length;
    if (reduce || text.length < shown) { setShown(text.length); return; }
    let frame = 0;
    const tick = () => {
      setShown((n) => {
        const gap = target.current - n;
        if (gap <= 0) return n;
        return n + Math.max(1, Math.ceil(gap / 36)); // ~36 frames to catch up
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [text, reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  return text.slice(0, Math.min(shown, text.length));
}

/** JSON from the model is hard to read; show it as plain lines ("Tiêu đề: ...", "Lời đọc: ..."). */
function readable(raw: string) {
  return raw
    .replace(/\\n/g, ' ')
    .replace(/[[\]{}]/g, '')
    .replace(/"(title|narration|visualDescription|imagePrompt|videoPrompt|estimatedDuration|type|subtitle|icon|emphasis|data|bg_keywords)"\s*:\s*/g, (_m, key: string) => `\n${LABELS[key] ?? key}: `)
    .replace(/",[ \t]*/g, ' ') // not \s: that would also eat the line breaks added above
    .replace(/"/g, '')
    .replace(/\n{2,}/g, '\n')
    .trimStart();
}
const LABELS: Record<string, string> = {
  title: '▸ Tiêu đề', narration: 'Lời đọc', visualDescription: 'Hình ảnh', imagePrompt: 'Prompt ảnh', videoPrompt: 'Chuyển động',
  estimatedDuration: 'Thời lượng', type: '▸ Kiểu cảnh', subtitle: 'Phụ đề', icon: 'Icon', emphasis: 'Nhấn mạnh', data: 'Dữ liệu', bg_keywords: 'Nền',
};

export const ThinkingPanel: React.FC<{ thinking: Thinking | undefined; running: boolean }> = ({ thinking, running }) => {
  const reduce = !!useReducedMotion();
  const text = thinking?.text ? readable(thinking.text) : '';
  const typed = useTypedText(text, reduce);
  const box = useRef<HTMLDivElement | null>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [typed]);
  const scenes = thinking?.scenes ?? [];
  const streaming = !!thinking?.streaming;
  const title = thinking?.phase === 'storyboard' ? 'AI đang lên storyboard' : thinking?.phase === 'script' ? 'AI đang viết kịch bản' : 'Agent';
  if (!text && !scenes.length && !running) return null;
  return (
    <section aria-label="Agent đang nghĩ" className="rounded-xl border border-violet-200/70 dark:border-violet-900/60 bg-gradient-to-b from-violet-50/70 to-white dark:from-violet-950/30 dark:to-slate-900 overflow-hidden">
      <header className="flex items-center gap-2 px-3 py-2 border-b border-violet-100 dark:border-violet-900/50">
        <Brain size={16} className={`text-violet-600 dark:text-violet-300 ${streaming ? 'animate-pulse motion-reduce:animate-none' : ''}`} />
        <h4 className="text-[13px] font-bold text-slate-700 dark:text-slate-200">{streaming ? title : 'Agent đã viết'}</h4>
        {streaming && <span className="ml-auto text-[13px] text-violet-600 dark:text-violet-300">đang nghĩ…</span>}
      </header>
      {(text || streaming) && (
        <div ref={box} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24; }}
          className="max-h-40 overflow-y-auto px-3 py-2 font-mono text-[13px] leading-relaxed text-slate-600 dark:text-slate-300 whitespace-pre-wrap" aria-live="off">
          {typed || (streaming ? 'Đang chờ token đầu tiên…' : '')}
          {streaming && <span className="wf-caret inline-block w-[7px] h-[15px] align-[-2px] ml-0.5 bg-violet-500 rounded-sm" aria-hidden="true" />}
        </div>
      )}
      {scenes.length > 0 && (
        <ul className="px-3 py-2 space-y-1.5 border-t border-violet-100 dark:border-violet-900/50" aria-label="Cảnh đã viết">
          <AnimatePresence initial={false}>
            {scenes.map((scene) => {
              const meta = scene.type ? TYPE_META[scene.type] : null;
              const Icon = meta?.Icon ?? FileText;
              return (
                <motion.li key={scene.order} layout
                  initial={reduce ? false : { opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
                  transition={{ duration: 0.26, ease: EASE }}
                  className="flex items-center gap-2 rounded-lg bg-white/80 dark:bg-slate-900/70 border border-slate-200/70 dark:border-slate-700 px-2 py-1.5">
                  <span className="w-6 h-6 shrink-0 rounded-md bg-violet-100 text-violet-700 dark:bg-violet-900/60 dark:text-violet-200 flex items-center justify-center" title={meta?.label ?? 'Chưa chọn kiểu cảnh'}>
                    <Icon size={14} />
                  </span>
                  <span className="text-[13px] font-medium text-slate-700 dark:text-slate-200 truncate">{scene.order}. {scene.title}</span>
                  <span className="ml-auto shrink-0 text-[13px] text-slate-400">{meta?.label ?? (thinking?.phase === 'storyboard' ? 'đang chọn…' : '')}</span>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
    </section>
  );
};

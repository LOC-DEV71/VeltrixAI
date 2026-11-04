import React, { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { AudioLines, Brain, Clapperboard, CloudUpload, Cpu, ImageIcon, Zap } from 'lucide-react';
import { api } from '../../api';
import { formatElapsed, type ActivityEvent, type EventCategory } from './workflowModel';

const CATEGORY: Record<EventCategory, { label: string; Icon: typeof Zap }> = {
  ai: { label: 'AI', Icon: Brain }, model: { label: 'Model', Icon: Cpu }, image: { label: 'Ảnh', Icon: ImageIcon },
  voice: { label: 'Giọng', Icon: AudioLines }, render: { label: 'Render', Icon: Clapperboard }, publish: { label: 'Đăng', Icon: CloudUpload },
  system: { label: 'Hệ thống', Icon: Zap },
};
const TONE = {
  ok: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300',
  run: 'bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300',
  fail: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300',
  info: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};
const EASE = [0.16, 1, 0.3, 1] as const;

const Row: React.FC<{ event: ActivityEvent; reduce: boolean }> = ({ event, reduce }) => {
  const meta = CATEGORY[event.cat ?? 'system'];
  return (
    <motion.li layout initial={reduce ? false : { opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.24, ease: EASE }} className="relative flex gap-2.5 pl-0.5 pb-2.5">
      <span className={`relative z-[1] w-6 h-6 shrink-0 rounded-full flex items-center justify-center ${TONE[event.kind]}`} title={meta.label}>
        <meta.Icon size={13} />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className={`text-[13px] leading-snug ${event.kind === 'fail' ? 'text-red-700 dark:text-red-400' : 'text-slate-700 dark:text-slate-200'}`}>{event.text}</p>
        <p className="text-[13px] text-slate-400 tabular-nums">{formatElapsed(event.seconds)} · {meta.label}</p>
      </div>
    </motion.li>
  );
};

export const ActivityTimeline: React.FC<{ runId: string; events: ActivityEvent[]; total: number }> = ({ runId, events, total }) => {
  const reduce = !!useReducedMotion();
  const [all, setAll] = useState<ActivityEvent[] | null>(null);
  const [loading, setLoading] = useState(false);
  const showAll = async () => {
    if (all) { setAll(null); return; }
    setLoading(true);
    try { setAll((await api.get(`/auto-videos/${runId}/details`, { params: { events: 'all' } })).data.data.events); }
    catch { /* keep the short list */ } finally { setLoading(false); }
  };
  const list = all ?? events;
  return (
    <section aria-label="Hoạt động" aria-live="polite">
      <div className="flex items-center justify-between">
        <h4 className="text-[13px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Hoạt động</h4>
        {total > events.length && (
          <button type="button" onClick={showAll} disabled={loading} className="text-[13px] font-medium text-violet-600 hover:underline dark:text-violet-300 disabled:opacity-50">
            {all ? 'Thu gọn' : loading ? 'Đang tải…' : `Xem tất cả (${total})`}
          </button>
        )}
      </div>
      <ol className={`relative mt-2 ${all ? 'max-h-96 overflow-y-auto pr-1' : ''}`}>
        <span className="absolute left-[12px] top-1 bottom-3 w-px bg-slate-200 dark:bg-slate-700" aria-hidden="true" />
        <AnimatePresence initial={false}>
          {list.map((event) => <Row key={`${event.at}-${event.text}`} event={event} reduce={reduce} />)}
        </AnimatePresence>
      </ol>
    </section>
  );
};

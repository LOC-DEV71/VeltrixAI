import React, { useEffect, useState } from 'react';
import { Check, Loader2, Circle, XCircle } from 'lucide-react';
import type { JobProgress } from '../utils/pollContentJob';

export interface StepDefinition { stage: string; label: string }

interface Props {
  steps: StepDefinition[];
  progress: JobProgress | null;
  failed?: boolean;
  startedAt: number | null;
}

const formatElapsed = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds >= 60 ? `${Math.floor(seconds / 60)} phút ${seconds % 60} giây` : `${seconds} giây`;
};

/**
 * Vertical stepper for a running job. Steps before the current one are done,
 * the current one spins (or shows an error), later ones are pending.
 */
export const JobProgressSteps: React.FC<Props> = ({ steps, progress, failed = false, startedAt }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (failed) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [failed]);

  const currentIndex = progress ? Math.max(0, steps.findIndex((s) => s.stage === progress.stage)) : 0;

  return (
    <div className="w-full text-left" aria-live="polite">
      <ol className="flex flex-col gap-3">
        {steps.map((step, index) => {
          const state = index < currentIndex ? 'done' : index === currentIndex ? (failed ? 'error' : 'active') : 'pending';
          return (
            <li key={step.stage} className="flex items-start gap-3">
              <span className="mt-0.5 shrink-0">
                {state === 'done' && <Check size={18} className="text-green-600" aria-label="Đã xong" />}
                {state === 'active' && <Loader2 size={18} className="text-[var(--color-primary)] animate-spin" aria-label="Đang chạy" />}
                {state === 'error' && <XCircle size={18} className="text-red-600" aria-label="Lỗi" />}
                {state === 'pending' && <Circle size={18} className="text-gray-300" aria-label="Chưa chạy" />}
              </span>
              <div className="min-w-0">
                <p className={`text-sm font-medium ${state === 'pending' ? 'text-gray-400' : state === 'error' ? 'text-red-700' : 'text-[var(--color-text-main)]'}`}>
                  {step.label}
                </p>
                {state === 'active' && progress?.message && (
                  <p className="text-xs text-[var(--color-text-sub)] mt-0.5">{progress.message}</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {startedAt !== null && !failed && (
        <p className="text-xs text-[var(--color-text-sub)] mt-4">Đã chạy {formatElapsed(now - startedAt)}</p>
      )}
    </div>
  );
};

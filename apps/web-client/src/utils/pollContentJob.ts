export interface JobProgress {
  stage: string;
  step: number;
  totalSteps: number;
  message: string;
  updatedAt?: string;
}

export interface ContentJobStatus {
  status: string;
  failedReason?: string | null;
  progress?: JobProgress | null;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(new Error('POLL_ABORTED'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

export async function waitForContentJob<T extends ContentJobStatus>(
  load: () => Promise<T>, signal: AbortSignal,
  { intervalMs = 2000, maxWaitMs = 360000, onUpdate }: { intervalMs?: number; maxWaitMs?: number; onUpdate?: (job: T) => void } = {},
): Promise<T> {
  const started = Date.now();
  while (!signal.aborted) {
    if (Date.now() - started >= maxWaitMs) throw new Error('POLL_TIMEOUT');
    const job = await load();
    if (signal.aborted) throw new Error('POLL_ABORTED');
    onUpdate?.(job);
    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status)) return job;
    if (!['QUEUED', 'PROCESSING'].includes(job.status)) throw new Error('Trạng thái tác vụ không hợp lệ');
    await delay(intervalMs, signal);
  }
  throw new Error('POLL_ABORTED');
}

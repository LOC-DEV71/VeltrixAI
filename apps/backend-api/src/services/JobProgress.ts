import mongoose from 'mongoose';
import { Job } from '../models/Job';

export interface StageDefinition { stage: string; message: string }

// Steps shown to the user for content jobs. Step numbers are 1-based positions in this list.
export const CONTENT_STAGES: Record<'AI_CONTENT' | 'AI_SPLIT' | 'AI_PROMPT_GEN', StageDefinition[]> = {
  AI_CONTENT: [
    { stage: 'PREPARING', message: 'Đang kiểm tra gói và chuẩn bị yêu cầu' },
    { stage: 'WRITING', message: 'AI đang viết kịch bản' },
    { stage: 'VALIDATING', message: 'Đang kiểm tra độ dài và số cảnh' },
    { stage: 'SAVING', message: 'Đang lưu phân cảnh' },
  ],
  AI_SPLIT: [
    { stage: 'PREPARING', message: 'Đang kiểm tra gói và chuẩn bị yêu cầu' },
    { stage: 'WRITING', message: 'AI đang chia cảnh' },
    { stage: 'VALIDATING', message: 'Đang kiểm tra lời đọc giữ nguyên' },
    { stage: 'SAVING', message: 'Đang lưu phân cảnh' },
  ],
  AI_PROMPT_GEN: [
    { stage: 'PREPARING', message: 'Đang kiểm tra gói và chuẩn bị yêu cầu' },
    { stage: 'WRITING', message: 'AI đang tạo prompt hình ảnh/video' },
    { stage: 'VALIDATING', message: 'Đang kiểm tra prompt' },
    { stage: 'SAVING', message: 'Đang lưu prompt' },
  ],
};

export const VIDEO_STAGES: StageDefinition[] = [
  { stage: 'PREPARING', message: 'Đang kiểm tra phân cảnh và giọng đọc' },
  { stage: 'PLANNING', message: 'AI đang lên storyboard: kiểu cảnh, icon, từ khóa' },
  { stage: 'MEDIA', message: 'Đang tìm video nền minh họa' },
  { stage: 'AUDIO', message: 'Đang căn thời gian từng từ của giọng đọc' },
  { stage: 'RENDERING', message: 'Đang dựng video' },
  { stage: 'SAVING', message: 'Đang lưu video' },
];

/**
 * Records progress for a running job. Only writes while this worker still owns the claim,
 * so a stale worker cannot overwrite progress of a newer attempt. Never throws: progress is
 * informational and must not fail the job.
 */
export async function setJobProgress(
  jobId: mongoose.Types.ObjectId | string,
  executionClaim: string | undefined,
  stages: StageDefinition[],
  stage: string,
  message?: string,
  percent?: number,
) {
  const index = stages.findIndex((s) => s.stage === stage);
  if (index < 0) return;
  try {
    await Job.updateOne(
      { _id: jobId, status: 'PROCESSING', executionClaim },
      { $set: { progress: { stage, step: index + 1, totalSteps: stages.length, message: message ?? stages[index].message, ...(percent !== undefined ? { percent: Math.max(0, Math.min(100, Math.round(percent))) } : {}), updatedAt: new Date() } } },
    );
  } catch {
    // Ignore: progress is best effort.
  }
}

/** Public shape returned by GET /jobs/:id. */
export function publicProgress(job: { status: string; progress?: any }) {
  if (job.status === 'QUEUED') return { stage: 'QUEUED', step: 0, totalSteps: job.progress?.totalSteps ?? 0, message: 'Đang chờ trong hàng đợi' };
  if (!job.progress) return null;
  const { stage, step, totalSteps, message, percent, updatedAt } = job.progress;
  return { stage, step, totalSteps, message, ...(percent !== undefined && percent !== null ? { percent } : {}), updatedAt };
}

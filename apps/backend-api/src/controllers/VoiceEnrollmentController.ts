import { forOwner } from '../services/EntitlementService';
import { PlanError } from '../services/PlanService';
import { Request, Response } from 'express';
import { VoiceEnrollment } from '../models/VoiceEnrollment';
import { createEnrollment, stopEnrollment, CONSENT_VERSION } from '../services/VoiceEnrollmentService';
import { clonePlanAllowed } from '../services/VoiceService';
import { TtsJobError } from '../services/TtsJobService';
import { AudioError } from '../providers/AudioValidation';
import { getTtsConfiguration } from '../providers/TtsProvider';
import { getCloudinaryConfiguration } from '../providers/CloudinaryAudioProvider';

function fail(error: unknown, res: Response) {
  const messages: Record<string, string> = {
    CLONE_SAMPLE_DURATION_INVALID: 'Mẫu âm thanh phải dài từ 3 đến 8 giây.',
    CLONE_SAMPLE_FORMAT_INVALID: 'Mẫu phải là WAV PCM16, 1–2 kênh, tần số 16–48 kHz.',
    CLONE_SAMPLE_TOO_LARGE: 'Mẫu âm thanh tối đa 4 MB.',
    INVALID_TTS_WAV: 'File WAV không hợp lệ hoặc không phải PCM.',
    TTS_AUDIO_DURATION_INVALID: 'Thời lượng file WAV không hợp lệ.',
    CLONE_CONSENT_REQUIRED: 'Cần xác nhận đồng ý nhân bản và quyền sử dụng giọng.',
    CLONE_PLAN_REQUIRED: 'Cần gói Plus hoặc Pro.',
    INVALID_INPUT: 'Tên giọng, file âm thanh hoặc thông tin tạo giọng chưa hợp lệ.',
  };
  if (error instanceof PlanError) return res.status(error.status).json({success:false,error:{code:error.code}});
    if (error instanceof TtsJobError) return res.status(error.status).json({ success: false, error: { code: error.code, message: messages[error.code] || 'Không xử lý được yêu cầu tạo giọng.' } });
  if (error instanceof AudioError) return res.status(error.code.startsWith('CLONE_SAMPLE') || error.code === 'INVALID_TTS_WAV' || error.code === 'TTS_AUDIO_DURATION_INVALID' ? 400 : 503).json({ success: false, error: { code: error.code, message: messages[error.code] || 'Dịch vụ tạo giọng chưa sẵn sàng.' } });
  return res.status(500).json({ success: false, error: { code: 'CLONE_ENROLLMENT_UNAVAILABLE' } });
}
export async function enrollVoice(req: Request, res: Response) {
  try {
    getTtsConfiguration(); getCloudinaryConfiguration();
    const key = req.get('Idempotency-Key'); if (typeof key !== 'string') throw new TtsJobError('INVALID_INPUT', 400);
    const result = await createEnrollment((req as any).user._id, req.body, key);
    return res.status(result.reused ? 200 : 202).json({ success: true, data: result });
  } catch (error) { return fail(error, res); }
}
export async function listEnrollments(req: Request, res: Response) {
  try {
    const snapshot=await forOwner((req as any).user._id);
    const page=Number(req.query.page||1),limit=10;if(!Number.isSafeInteger(page)||page<1||page>10000)throw new TtsJobError('INVALID_INPUT',400);
    const filter={ownerId:(req as any).user._id,$or:[{status:{$ne:'DELETED'}},{cleanupPending:true}]};
    const [items,total]=await Promise.all([VoiceEnrollment.find(filter).populate('voiceId','name status avatarUrl tags gender').sort({createdAt:-1,_id:-1}).skip((page-1)*limit).limit(limit),VoiceEnrollment.countDocuments(filter)]);
    return res.json({ success: true, data: { page,limit,total,canClone: snapshot.config.clone.enabled, consentVersion: CONSENT_VERSION,
      minSeconds: snapshot.config.clone.minReferenceSeconds, maxSeconds: snapshot.config.clone.maxReferenceSeconds, maxBytes: snapshot.config.clone.maxFileBytes, enrollmentCredits: 0,
      enrollments: items.map(item => ({ id: item._id, voiceId: item.voiceId?._id, name: item.voiceId?.name || 'Giọng clone', avatarUrl:item.voiceId?.avatarUrl||null,tags:item.voiceId?.tags||[],gender:item.voiceId?.gender||'unknown', status: item.status, duration: item.sample.duration, error: item.error || null, cleanupPending: item.cleanupPending, cleanupAttempts: item.cleanupAttempts, createdAt: item.createdAt })) } });
  } catch (error) { return fail(error, res); }
}
export async function revokeVoice(req: Request, res: Response) {
  try { const result = await stopEnrollment((req as any).user._id, String(req.params.id), 'REVOKED'); return res.json({ success: true, data: result }); }
  catch (error) { return fail(error, res); }
}
export async function deleteVoice(req: Request, res: Response) {
  try { const result = await stopEnrollment((req as any).user._id, String(req.params.id), 'DELETED'); return res.json({ success: true, data: result }); }
  catch (error) { return fail(error, res); }
}

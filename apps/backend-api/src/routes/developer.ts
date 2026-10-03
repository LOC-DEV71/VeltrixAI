import {Router, Request, Response} from 'express';
import mongoose from 'mongoose';
import {requireAuth} from '../middlewares/authMiddleware';
import {csrfProtection} from '../middlewares/csrfMiddleware';
import {requireDeveloperToken} from '../middlewares/developerAuth';
import {DeveloperToken} from '../models/DeveloperToken';
import {createDeveloperToken, revokeDeveloperToken, tokenView, DeveloperError} from '../services/DeveloperTokens';
import {createStandaloneAudio, getTtsConfig} from '../controllers/TtsController';
import {getVoices} from '../controllers/VoicesController';
import {playAudio} from '../controllers/MediaController';
import {Job} from '../models/Job';
const router = Router();
router.use((_req, res, next) => {res.setHeader('Cache-Control', 'no-store'); next();});
const handle = (fn: (req: any, res: Response) => Promise<any>) => (req: Request, res: Response) => fn(req, res).catch(error => {
  res.status(error instanceof DeveloperError ? error.status : 503).json({success: false, error: {code: error instanceof DeveloperError ? error.code : 'API_UNAVAILABLE', message: 'Không thể xử lý yêu cầu API.'}});
});

router.get('/tokens', requireAuth, handle(async (req, res) => {
  const page = Number(req.query.page || 1), limit = 10;
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000) throw new DeveloperError('API_TOKEN_INVALID_INPUT');
  const filter = {ownerId: req.user._id};
  const [items, total] = await Promise.all([DeveloperToken.find(filter).sort({createdAt: -1, _id: -1}).skip((page - 1) * limit).limit(limit), DeveloperToken.countDocuments(filter)]);
  res.json({success: true, data: {items: items.map(tokenView), total, page, limit}});
}));
router.post('/tokens', requireAuth, csrfProtection, handle(async (req, res) => res.status(201).json({success: true, data: await createDeveloperToken(req.user._id, req.body)})));
router.delete('/tokens/:id', requireAuth, csrfProtection, handle(async (req, res) => res.json({success: true, data: await revokeDeveloperToken(req.user._id, req.params.id)})));

router.get('/v1/voices', requireDeveloperToken('voices:read'), getVoices);
router.get('/v1/limits', requireDeveloperToken('tts:read'), getTtsConfig);
router.post('/v1/tts/jobs', requireDeveloperToken('tts:write'), (req, res, next) => {
  if (!req.body || Object.keys(req.body).some(k => !['text', 'voiceId'].includes(k))) return res.status(400).json({success: false, error: {code: 'INVALID_INPUT', message: 'Chỉ gửi text và voiceId.'}});
  next();
}, createStandaloneAudio);

async function ownedJob(req: any) {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) throw new DeveloperError('NOT_FOUND', 404);
  const job = await Job.findOne({_id: req.params.id, ownerId: req.user._id, type: 'TTS', 'payload.source': 'STANDALONE'}).lean();
  if (!job) throw new DeveloperError('NOT_FOUND', 404);
  return job;
}
router.get('/v1/tts/jobs/:id', requireDeveloperToken('tts:read'), handle(async (req, res) => {
  const job = await ownedJob(req);
  res.json({success: true, data: {id: String(job._id), status: job.status, createdAt: job.createdAt, updatedAt: job.updatedAt,
    failedReason: job.error ? (typeof job.error === 'string' && /^[A-Z_]{1,80}$/.test(job.error) ? job.error : 'TTS_JOB_FAILED') : null,
    result: job.status === 'COMPLETED' && job.result ? {audioUrl: `/api/developer/v1/tts/jobs/${job._id}/audio`, format: 'wav', duration: job.result.duration, chargedCredits: job.result.chargedCredits} : null}});
}));
router.get('/v1/tts/jobs/:id/audio', requireDeveloperToken('tts:read'), handle(async (req, res) => {
  const job = await ownedJob(req);
  if (job.status !== 'COMPLETED' || !job.result?.audioId) throw new DeveloperError('AUDIO_NOT_READY', 409);
  req.params.id = String(job.result.audioId);
  return playAudio(req, res);
}));
export default router;

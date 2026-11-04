import {Router, json} from 'express';
import {createHash} from 'node:crypto';
import {answerSupport, SupportError} from '../services/SupportAi';
import type {SupportMessage} from '../services/SupportAi';
import cookieParser from 'cookie-parser';
import {requireAuth} from '../middlewares/authMiddleware';
import {csrfProtection, generateCsrfToken} from '../middlewares/csrfMiddleware';
import {refresh, logout} from '../controllers/AuthController';
import {RefundError,supportBilling,refundRate,checkRenewalRefund,confirmRenewalRefund,getRenewalRefund} from '../services/BillingRefundService';
import {RefundProviderError} from '../services/VNPayRefundProvider';
import {SupportAdmissionError,supportRequestRate,getSharedSupportReply,cacheSharedSupportReply,acquireSupportAdmission,releaseSupportAdmission} from '../services/SupportAdmission';
import {supportIngress} from '../middlewares/supportIngress';
import {normalizeAiImage} from '../services/AiImageAssets';
import {AI_LIMITS, AiProviderError} from '../providers/AiProvider';

const router = Router();
const rates = new Map<string, {count: number; expires: number; active: boolean}>();
const replies = new Map<string, {fingerprint: string; expires: number; data: Awaited<ReturnType<typeof answerSupport>>}>();
const MINUTE = 60000;

router.use((req, res, next) => {
  const origins = (process.env.SUPPORT_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
  if (process.env.NODE_ENV !== 'production') origins.push('http://localhost:5175', 'http://127.0.0.1:5175');
  res.setHeader('Cache-Control', 'no-store');
  res.vary('Origin');
  // Same-origin GETs through a reverse proxy may omit Origin; browser SOP protects reads.
  if (!req.headers.origin && req.method === 'GET') return next();
  if (!req.headers.origin || !origins.includes(req.headers.origin)) return res.status(403).json({success: false, error: {code: 'SUPPORT_ORIGIN_DENIED', message: 'Trang Support này chưa được cho phép kết nối.'}});
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-csrf-token');
  res.setHeader('Access-Control-Expose-Headers', 'Retry-After, x-csrf-token');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
router.use(supportIngress());
router.use(cookieParser());
const smallJson = json({limit: '32kb', inflate: false});
// Only chat accepts an image. Authenticate and rate-limit before parsing its larger body.
router.use((req, res, next) => req.method === 'POST' && /^\/chat\/?$/i.test(req.path) ? next() : smallJson(req, res, next));

// Reuse Creator's HttpOnly cookie and Session; Support never creates a login session.
router.get('/csrf', generateCsrfToken);
router.post('/refresh', csrfProtection, refresh);
router.get('/session', requireAuth, csrfProtection, (req, res) => {
  const user = (req as any).user;
  res.json({success: true, data: {id: String(user._id), email: user.email, displayName: user.displayName || ''}});
});
router.post('/logout', requireAuth, csrfProtection, logout);
const refundRoute=(handler:any)=>async(req:any,res:any)=>{try{res.json({success:true,data:await handler(req)});}catch(error){const safe=error instanceof RefundError||error instanceof RefundProviderError;const status=error instanceof RefundError?error.status:503;if(status===429)res.setHeader('Retry-After','10');res.status(status).json({success:false,error:{code:safe?error.code:'REFUND_UNAVAILABLE',message:'Chưa thực hiện được yêu cầu hoàn tiền. Vui lòng kiểm tra trạng thái hoặc thử lại sau.'}});}};
router.get('/billing',requireAuth,refundRoute(async(req:any)=>{await refundRate(req.user._id,req.ip||'unknown','view');return supportBilling(req.user._id,Number(req.query.page||1));}));
router.post('/billing/:id/check',requireAuth,csrfProtection,refundRoute(async(req:any)=>{if(!req.body||Object.keys(req.body).length)throw new RefundError('REFUND_INVALID_INPUT',400);return checkRenewalRefund(req.user._id,req.params.id,req.ip||'unknown');}));
router.post('/billing/:id/refund',requireAuth,csrfProtection,refundRoute((req:any)=>confirmRenewalRefund(req.user._id,req.params.id,req.body,req.ip||'unknown')));
router.get('/billing/:id/refund',requireAuth,refundRoute((req:any)=>getRenewalRefund(req.user._id,req.params.id,req.ip||'unknown')));

router.post('/chat', requireAuth, csrfProtection, async (req, res, next) => {
  try {
    const ipHash = createHash('sha256').update(req.ip || req.socket.remoteAddress || 'unknown').digest('hex');
    await supportRequestRate(String((req as any).user._id), ipHash);
    next();
  } catch (error) {
    const status = error instanceof SupportAdmissionError ? error.status : 503;
    if (status === 429) res.setHeader('Retry-After', '10');
    res.status(status).json({success:false,error:{code:status === 429 ? 'SUPPORT_RATE_LIMITED' : 'SUPPORT_AI_UNAVAILABLE',message:'Trợ lý đang bận hoặc giới hạn gọi đã đạt. Vui lòng thử lại sau.'}});
  }
}, json({limit: Math.ceil(AI_LIMITS.imageBytes / 3) * 4 + 32768, inflate: false}), async (req, res) => {
  const now = Date.now();
  for (const [id, entry] of rates) if (entry.expires <= now && !entry.active) rates.delete(id);
  for (const [id, entry] of replies) if (entry.expires <= now) replies.delete(id);
  const body = req.body;
  if (body && body.imageBase64 === undefined && Buffer.byteLength(JSON.stringify(body)) > 32768) return res.status(413).json({success:false,error:{code:'SUPPORT_INVALID_INPUT',message:'Nội dung hội thoại quá lớn. Vui lòng rút ngắn câu hỏi.'}});
  if (!body || Object.keys(body).some(key => !['messages', 'requestId', 'memory', 'imageBase64'].includes(key)) || typeof body.requestId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(body.requestId)
    || (body.memory !== undefined && (typeof body.memory !== 'string' || body.memory.length > 1800 || JSON.stringify(body.memory).length > 2200))
    || !Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 8
    || body.messages.some((message: any, index: number) => !message || Object.keys(message).some(key => !['role', 'content'].includes(key)) || message.role !== (index % 2 === 0 ? 'user' : 'assistant') || typeof message.content !== 'string' || !message.content.trim() || message.content.length > (message.role === 'user' ? 1000 : 5000))
    || body.messages.at(-1).role !== 'user' || JSON.stringify(body.messages).length > 6000) {
    return res.status(400).json({success: false, error: {code: 'SUPPORT_INVALID_INPUT', message: 'Câu hỏi tối đa 1.000 ký tự; hãy bắt đầu hội thoại mới nếu đã quá dài.'}});
  }
  if (body.imageBase64 !== undefined && (typeof body.imageBase64 !== 'string' || !body.imageBase64 || body.imageBase64.length > Math.ceil(AI_LIMITS.imageBytes / 3) * 4 || body.imageBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.imageBase64))) {
    return res.status(400).json({success:false,error:{code:'SUPPORT_IMAGE_INVALID',message:'Gửi một ảnh PNG, JPG hoặc WebP, tối đa 3 MB. Không nhận đường dẫn hoặc URL ảnh.'}});
  }
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const key = createHash('sha256').update(ip).digest('hex');
  const requestKey = `${String((req as any).user._id)}:${key}:${body.requestId}`;
  const fingerprint = createHash('sha256').update(JSON.stringify({messages:body.messages,memory:body.memory || '',imageBase64:body.imageBase64 || ''})).digest('hex');
  let cached:any;
  try{cached=replies.get(requestKey)||await getSharedSupportReply(requestKey);}catch{return res.status(503).json({success:false,error:{code:'SUPPORT_AI_UNAVAILABLE',message:'Trợ lý chưa sẵn sàng. Vui lòng thử lại sau.'}});}
  if (cached) return cached.fingerprint === fingerprint ? res.json({success: true, data: cached.data}) : res.status(409).json({success: false, error: {code: 'SUPPORT_REQUEST_CONFLICT', message: 'Mã yêu cầu đã dùng cho câu hỏi khác.'}});
  if (!rates.has(key) && rates.size >= 5000) return res.status(503).json({success: false, error: {code: 'SUPPORT_AI_BUSY', message: 'Trợ lý đang bận. Vui lòng thử lại sau.'}});
  let rate = rates.get(key);
  if (!rate || rate.expires <= now) {rate = {count: 0, expires: now + MINUTE, active: rate?.active || false}; rates.set(key, rate);}
  if (rate.active || rate.count >= 6) {
    res.setHeader('Retry-After', rate.active ? '10' : String(Math.max(1, Math.ceil((rate.expires - now) / 1000))));
    return res.status(429).json({success: false, error: {code: 'SUPPORT_RATE_LIMITED', message: rate.active ? 'Câu hỏi trước đang được xử lý. Vui lòng chờ.' : 'Bạn đã gửi 6 câu hỏi trong phút này. Vui lòng chờ trước khi hỏi tiếp.'}});
  }
  rate.active = true;
  rate.count += 1;
  let admission:string|undefined;
  try {
    const user = (req as any).user;
    admission=await acquireSupportAdmission(String(user._id),key);
    // Decode under the shared admission lease. Never persist the image or fetch a user URL.
    const image = body.imageBase64 === undefined ? undefined : await normalizeAiImage(body.imageBase64,1536);
    const data = await answerSupport(body.messages as SupportMessage[], {displayName: user.displayName || '', email: user.email || '',ownerId:String(user._id)},body.memory || '',image ? {bytes:image.bytes,mime:'image/png'} : undefined);
    if (replies.size >= 200) replies.delete(replies.keys().next().value!);
    replies.set(requestKey, {fingerprint, expires: Date.now() + 2 * MINUTE, data});
    await cacheSharedSupportReply(requestKey,fingerprint,data);
    return res.json({success: true, data});
  } catch (error) {
    const safe = error instanceof SupportError ? error : error instanceof AiProviderError ? new SupportError('SUPPORT_IMAGE_INVALID',400,'Không đọc được ảnh. Dùng PNG, JPG hoặc WebP tĩnh, tối đa 3 MB và 4.096 pixel mỗi chiều.') : error instanceof SupportAdmissionError?new SupportError(error.code,error.status,'Trợ lý đang xử lý yêu cầu hoặc đã đạt giới hạn. Vui lòng chờ rồi thử lại.'):new SupportError('SUPPORT_AI_UNAVAILABLE', 503, 'Trợ lý AI chưa sẵn sàng. Vui lòng thử lại sau.');
    if (safe.status === 429) res.setHeader('Retry-After', '10');
    return res.status(safe.status).json({success: false, error: {code: safe.code, message: safe.message}});
  } finally {
    if(admission)await releaseSupportAdmission(admission).catch(()=>{});
    // The rate bucket can be refreshed while inference is running.
    const current = rates.get(key);
    if (current) current.active = false;
  }
});

router.use((error: any, _req: any, res: any, _next: any) => {
  const status = error?.type === 'entity.too.large' ? 413 : 400;
  res.status(status).json({success: false, error: {code: 'SUPPORT_INVALID_INPUT', message: status === 413 ? 'Yêu cầu quá lớn. Mỗi lượt gửi một ảnh tối đa 3 MB và câu hỏi tối đa 1.000 ký tự.' : 'Nội dung yêu cầu không hợp lệ.'}});
});

export default router;

import { Router } from 'express';
import { googleLogin, requestOtp, verifyOtp, refresh, logout, getMe } from '../controllers/AuthController';
import { generateCsrfToken, csrfProtection } from '../middlewares/csrfMiddleware';
import { requireAuth } from '../middlewares/authMiddleware';

const router = Router();

router.get('/csrf', generateCsrfToken);
router.post('/google', csrfProtection, googleLogin);
router.post('/otp/request', csrfProtection, requestOtp);
router.post('/otp/verify', csrfProtection, verifyOtp);
router.post('/refresh', csrfProtection, refresh);
router.post('/logout', csrfProtection, requireAuth, logout);
router.get('/me', requireAuth, getMe);

export default router;

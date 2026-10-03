import { Router } from 'express';
import { login, logout, getMe } from '../controllers/AdminAuthController';
import { generateCsrfToken, csrfProtection } from '../middlewares/csrfMiddleware';
import { requireAdminAuth } from '../middlewares/adminAuthMiddleware';

const router = Router();

router.get('/csrf', generateCsrfToken);
router.post('/login', csrfProtection, login);
router.post('/logout', csrfProtection, requireAdminAuth, logout);
router.get('/me', requireAdminAuth, getMe);

export default router;

import { Router } from 'express';
import { getMe, patchMe } from '../controllers/UsersController';
import { requireAuth } from '../middlewares/authMiddleware';
import { csrfProtection } from '../middlewares/csrfMiddleware';

const router = Router();

router.get('/me', requireAuth, getMe);
router.patch('/me', requireAuth, csrfProtection, patchMe);

export default router;

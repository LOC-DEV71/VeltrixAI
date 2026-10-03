import { Router } from 'express';
import { requireAuth } from '../middlewares/authMiddleware';
import { csrfProtection } from '../middlewares/csrfMiddleware';
import { createStandaloneAudio, getTtsConfig, getTtsHistory } from '../controllers/TtsController';
const router = Router();
router.get('/config', requireAuth, getTtsConfig);
router.get('/history', requireAuth, getTtsHistory);
router.post('/', requireAuth, csrfProtection, createStandaloneAudio);
export default router;

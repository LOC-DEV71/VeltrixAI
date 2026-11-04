import { Router } from 'express';
import { requireAuth } from '../middlewares/authMiddleware';
import { csrfProtection } from '../middlewares/csrfMiddleware';
import { downloadVideo } from '../controllers/VideoController';
import { publish } from '../controllers/YouTubeController';

const router = Router();
router.get('/:id/file', requireAuth, downloadVideo);
router.post('/:id/youtube', requireAuth, csrfProtection, publish);
export default router;

import { Router } from 'express';
import { requireAuth } from '../middlewares/authMiddleware';
import { playAudio } from '../controllers/MediaController';
const router = Router();
router.get('/:id/audio', requireAuth, playAudio);
export default router;

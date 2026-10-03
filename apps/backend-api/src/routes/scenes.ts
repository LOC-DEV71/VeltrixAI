import { Router } from 'express';
import { requireAuth } from '../middlewares/authMiddleware';
import { csrfProtection } from '../middlewares/csrfMiddleware';
import { generateSceneAudio, saveSceneVoiceover } from '../controllers/TtsController';
const router = Router();
router.post('/:id/tts', requireAuth, csrfProtection, generateSceneAudio);
router.patch('/:id', requireAuth, csrfProtection, saveSceneVoiceover);
export default router;

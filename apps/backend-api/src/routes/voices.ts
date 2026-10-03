import { Router } from 'express';
import { getVoices, getVoicePreview, getVoiceCatalogue } from '../controllers/VoicesController';
import { requireAuth } from '../middlewares/authMiddleware';

const router = Router();

router.get('/', requireAuth, getVoices);
router.get('/catalogue', getVoiceCatalogue);
router.get('/:id/preview', getVoicePreview);

export default router;

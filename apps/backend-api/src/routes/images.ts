import { Router } from 'express';
import { requireAuth } from '../middlewares/authMiddleware';
import { getImageFile, getImagePresets } from '../controllers/ImageGenController';

const router = Router();
router.use(requireAuth);
router.get('/presets', getImagePresets);
router.get('/:imageId/file', getImageFile);
export default router;

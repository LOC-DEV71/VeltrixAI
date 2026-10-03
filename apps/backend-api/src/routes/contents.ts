import { Router } from 'express';
import { createContent, getContent, getContents, getContentScenes, updateContent, generateContent, getGenerationConfig } from '../controllers/ContentController';
import { requireAuth } from '../middlewares/authMiddleware';

import {csrfProtection} from '../middlewares/csrfMiddleware';
const router = Router();
router.use((req,res,next)=>['GET','HEAD','OPTIONS'].includes(req.method)?next():csrfProtection(req,res,next));

router.use(requireAuth);

router.post('/', createContent);
router.get('/', getContents);
router.get('/generation-config', getGenerationConfig);
router.get('/:id', getContent);
router.get('/:id/scenes', getContentScenes);
router.put('/:id', updateContent);
import {operation,revisions} from '../controllers/ContentOperationsController';
router.get('/:id/revisions',revisions);
router.post('/:id/split',operation('AI_SPLIT'));
router.post('/:id/prompts',operation('AI_PROMPT_GEN'));
router.post('/:id/generate', generateContent);
import {uploadContentImage,removeContentImage} from '../controllers/AiImageController';
router.post('/:id/images',uploadContentImage);
router.delete('/:id/images/:imageId',removeContentImage);

export default router;

import { Router } from 'express';
import { getJob } from '../controllers/JobsController';
import { requireAuth } from '../middlewares/authMiddleware';

const router = Router();

router.get('/:id', requireAuth, getJob);

export default router;

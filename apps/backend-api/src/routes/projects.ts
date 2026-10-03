import { Router } from 'express';
import { getProjects, createProject, getProject, updateProject, deleteProject } from '../controllers/ProjectController';
import { requireAuth } from '../middlewares/authMiddleware';
import { csrfProtection } from '../middlewares/csrfMiddleware';

const router = Router();

router.use(requireAuth);

router.get('/', getProjects);
router.post('/', csrfProtection, createProject);
router.get('/:id', getProject);
router.patch('/:id', csrfProtection, updateProject);
router.delete('/:id', csrfProtection, deleteProject);

export default router;

import { Router } from 'express';
import { requireAdminAuth, requirePermission } from '../middlewares/adminAuthMiddleware';
import { getUsers, getUserDetails, updateUserStatus, updateUserPlan, grantCredits } from '../controllers/AdminUserController';

import { csrfProtection } from '../middlewares/csrfMiddleware';
import {getIpHistory, getIpNetworks} from '../controllers/AdminIpPolicyController';
const router = Router();

// Require admin auth for all routes
router.use(requireAdminAuth);

// Only OWNERS or ADMINS with users.manage permission can access this route
router.get('/', requirePermission('users.read'), getUsers);
router.get('/ip-networks', requirePermission('users.read'), getIpNetworks);
router.get('/ip-history', requirePermission('users.read'), getIpHistory);
router.get('/:id', requirePermission('users.read'), getUserDetails);
router.post('/:id/status', csrfProtection, requirePermission('users.manage'), updateUserStatus);
router.put('/:id/plan', csrfProtection, requirePermission('users.manage'), updateUserPlan);
router.post('/:id/credits', csrfProtection, requirePermission('users.manage'), grantCredits);

export default router;

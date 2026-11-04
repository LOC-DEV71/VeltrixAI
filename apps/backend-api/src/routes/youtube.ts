import { Router } from 'express';
import { requireAuth } from '../middlewares/authMiddleware';
import { csrfProtection } from '../middlewares/csrfMiddleware';
import { status, authUrl, callback, disconnectEndpoint, connection, connect, removeConnection, playlists } from '../controllers/YouTubeController';

const router = Router();
router.get('/callback', callback); // public: Google redirect, validated by one-time state
router.get('/status', requireAuth, status);
router.get('/auth-url', requireAuth, authUrl);
router.get('/playlists', requireAuth, playlists);
router.post('/disconnect', requireAuth, csrfProtection, disconnectEndpoint);

// Aliases for compatibility
router.get('/connection', requireAuth, connection);
router.post('/connect', requireAuth, csrfProtection, connect);
router.delete('/connection', requireAuth, csrfProtection, removeConnection);

export default router;

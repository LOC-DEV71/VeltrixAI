import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/jwt';
import { Session } from '../models/Session';
import { User } from '../models/User';

export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.cookies.accessToken;
    if (!token) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Missing token' } });
      return;
    }

    const payload = verifyAccessToken(token);
    const session = await Session.findById(payload.sessionId);

    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Session revoked or expired' } });
      return;
    }

    const user = await User.findById(session.userId);
    if (!user || user.status !== 'ACTIVE') {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'User banned or not found' } });
      return;
    }

    (req as any).user = user;
    (req as any).session = session;
    next();
  } catch (error) {
    res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } });
  }
};



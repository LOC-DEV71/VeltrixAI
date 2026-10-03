import { Request, Response, NextFunction } from 'express';
import { generateOpaqueToken } from '../utils/crypto';

export const csrfProtection = (req: Request, res: Response, next: NextFunction) => {
  // Bỏ qua GET, HEAD, OPTIONS
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    // Send existing CSRF token to frontend if it exists
    if (req.cookies?.csrfToken) {
      res.setHeader('x-csrf-token', req.cookies.csrfToken);
    }
    return next();
  }
  
  const cookieToken = req.cookies?.csrfToken;
  const headerToken = req.headers['x-csrf-token'];

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'CSRF token mismatch' } });
    return;
  }
  
  // Refresh header for next requests
  res.setHeader('x-csrf-token', cookieToken);
  next();
};

export const generateCsrfToken = (req: Request, res: Response) => {
  // Bootstrap reads must not invalidate tokens used by other requests/tabs.
  const existingToken = req.cookies?.csrfToken;
  const token = typeof existingToken === 'string' && /^[a-f0-9]{64}$/.test(existingToken)
    ? existingToken
    : generateOpaqueToken();
  if (token !== existingToken) {
    res.cookie('csrfToken', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    });
  }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('x-csrf-token', token);
  res.json({ success: true, data: { csrfToken: token } });
};

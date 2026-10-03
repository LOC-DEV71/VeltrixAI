import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/jwt';
import { AdminSession } from '../models/AdminSession';
import { AdminAccount } from '../models/AdminAccount';
import { AdminAuditLog } from '../models/AdminAuditLog';
import { AdminRole } from '../models/AdminRole';
import {adminCan} from '../services/AdminAccess';

export const requireAdminAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.cookies.adminAccessToken; // Assuming admin uses separate cookies or we use the same but look up admin session
    if (!token) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Missing token' } });
      return;
    }

    const payload = verifyAccessToken(token);
    const session = await AdminSession.findById(payload.sessionId);

    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Session revoked or expired' } });
      return;
    }

    const admin = await AdminAccount.findById(session.adminId).populate('roleId');
    if (!admin || admin.status !== 'ACTIVE') {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Admin account suspended or not found' } });
      return;
    }

    (req as any).admin = admin;
    (req as any).adminSession = session;
    next();
  } catch (error) {
    res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } });
  }
};

export const requirePermission = (permission: string) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const admin = (req as any).admin;
    if (!admin || !admin.roleId) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
      return;
    }

    const hasPermission = adminCan(admin,permission);
    
    if (!hasPermission) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
      return;
    }
    
    next();
  };
};

export const auditAdminAction = (action: string, getResource: (req: Request) => { type: string, id?: string }) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const originalSend = res.send;
    res.send = function (body) {
      // Restore original send to avoid infinite loop
      res.send = originalSend;
      
      // Async log after request
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const admin = (req as any).admin;
        if (admin) {
          const resource = getResource(req);
          AdminAuditLog.create({
            adminId: admin._id,
            action,
            resource: resource.type,
            resourceId: resource.id,
            changes: {reason:typeof req.body?.reason==='string'?req.body.reason.slice(0,1000):undefined,expectedRevision:req.body?.expectedRevision},
            ipAddress: req.ip,
          }).catch(console.error);
        }
      }
      
      return res.send(body);
    };
    next();
  };
};

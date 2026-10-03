import { Request, Response } from 'express';
import { AdminAccount } from '../models/AdminAccount';
import { AdminRole } from '../models/AdminRole';
import { AdminSession } from '../models/AdminSession';
import { OtpChallenge } from '../models/OtpChallenge';
import { generateOpaqueToken, hashSecret, hmacToken } from '../utils/crypto';
import { signAccessToken } from '../utils/jwt';
import { randomUUID } from 'crypto';
import { generateCsrfToken } from '../middlewares/csrfMiddleware';
import {ROLE_PERMISSIONS} from '../services/AdminAccess';
import {hashAdminPassword,verifyAdminPassword} from '../utils/adminPassword';

const publicAdmin=(admin:any)=>({ _id:admin._id,email:admin.email,displayName:admin.displayName,status:admin.status,roleId:admin.roleId,permissions:admin.roleId?.name==='OWNER'?['*']:[...new Set([...(admin.roleId?.permissions||[]),...(admin.roleId?.name==='ADMIN'?ROLE_PERMISSIONS.ADMIN:[])])] });

const OTP_SECRET = process.env.OTP_SECRET || 'dev-otp-secret';

const setCookies = (res: Response, adminAccessToken: string, adminRefreshToken: string) => {
  const isProd = process.env.NODE_ENV === 'production';
  const cookieOptions = {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'lax' : 'lax',
  } as const;

  res.cookie('adminAccessToken', adminAccessToken, cookieOptions);
  res.cookie('adminRefreshToken', adminRefreshToken, cookieOptions);
};

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (typeof email!=='string'||typeof password!=='string'||!email||!password||email.length>254||password.length>128) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: 'Vui lòng nhập email và mật khẩu.' } });
    }

    const admin = await AdminAccount.findOne({ email: email.toLowerCase().trim() }).populate('roleId');
    if (!admin) {
      return res.status(401).json({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Email hoặc mật khẩu không chính xác.' } });
    }

    if (!verifyAdminPassword(password,admin.passwordHash)) {
      return res.status(401).json({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Email hoặc mật khẩu không chính xác.' } });
    }

    if (admin.status !== 'ACTIVE') {
      return res.status(403).json({ success: false, error: { code: 'ADMIN_SUSPENDED', message: 'Tài khoản quản trị đang bị đình chỉ.' } });
    }
    if(!admin.passwordHash.startsWith('scrypt:'))await AdminAccount.updateOne({_id:admin._id,passwordHash:admin.passwordHash},{$set:{passwordHash:hashAdminPassword(password)}});

    const rawRefresh = generateOpaqueToken();
    const tokenFamily = randomUUID();
    const session = await AdminSession.create({
      adminId: admin._id,
      tokenFamily,
      refreshTokenHash: hashSecret(rawRefresh),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    const accessToken = signAccessToken({ sessionId: session._id });
    setCookies(res, accessToken, rawRefresh);

    res.json({ success: true, data: publicAdmin(admin) });
  } catch (error: any) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: error.message || 'Server error' } });
  }
};

export const logout = async (req: Request, res: Response) => {
  const session = (req as any).adminSession;
  if (session) {
    await AdminSession.updateOne({ _id: session._id }, { $set: { revokedAt: new Date() } });
  }
  const isProd = process.env.NODE_ENV === 'production';
  const cookieOptions = {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'lax' : 'lax',
  } as const;

  res.clearCookie('adminAccessToken', cookieOptions);
  res.clearCookie('adminRefreshToken', cookieOptions);
  delete req.cookies.csrfToken;
  generateCsrfToken(req, res);
};

export const getMe = async (req: Request, res: Response) => {
  res.json({ success: true, data: publicAdmin((req as any).admin) });
};


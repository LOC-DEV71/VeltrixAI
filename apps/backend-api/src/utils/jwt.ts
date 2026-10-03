import jwt, { SignOptions } from 'jsonwebtoken';

if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) throw new Error('JWT_SECRET_NOT_CONFIGURED');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key-123456';

export const signAccessToken = (payload: object, expiresIn = '15m') => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn } as SignOptions);
};

export const verifyAccessToken = (token: string) => {
  return jwt.verify(token, JWT_SECRET) as any;
};

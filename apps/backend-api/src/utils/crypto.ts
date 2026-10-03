import crypto from 'crypto';

export const hashSecret = (secret: string): string => {
  return crypto.createHash('sha256').update(secret).digest('hex');
};

export const generateOpaqueToken = (): string => {
  return crypto.randomBytes(32).toString('hex');
};

export const hmacToken = (data: string, secret: string): string => {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
};

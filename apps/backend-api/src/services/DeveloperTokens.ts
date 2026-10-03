import {createHash, randomBytes} from 'node:crypto';
import mongoose from 'mongoose';
import {DeveloperToken, DeveloperTokenAudit} from '../models/DeveloperToken';

export const DEVELOPER_SCOPES = ['voices:read', 'tts:write', 'tts:read'];
export class DeveloperError extends Error {
  constructor(public code: string, public status = 400) {super(code);}
}
export const tokenDigest = (token: string) => createHash('sha256').update(token).digest('hex');
export const tokenView = (token: any) => ({id: String(token._id), name: token.name, prefix: token.prefix, scopes: token.scopes,
  createdAt: token.createdAt, expiresAt: token.expiresAt, revokedAt: token.revokedAt || null, lastUsedAt: token.lastUsedAt || null});

export async function createDeveloperToken(ownerId: unknown, body: any) {
  if (!body || Object.keys(body).some(k => !['name', 'scopes', 'expiresInDays'].includes(k)) ||
      typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 80 ||
      !Number.isSafeInteger(body.expiresInDays) || body.expiresInDays < 1 || body.expiresInDays > 365 ||
      !Array.isArray(body.scopes) || !body.scopes.length || body.scopes.some((s: any) => !DEVELOPER_SCOPES.includes(s)) || new Set(body.scopes).size !== body.scopes.length) throw new DeveloperError('API_TOKEN_INVALID_INPUT');
  const id = new mongoose.Types.ObjectId(), raw = `vtx_${id}_${randomBytes(32).toString('base64url')}`;
  const session = await mongoose.startSession();
  try {
    const token = await session.withTransaction(async () => {
      const [record] = await DeveloperToken.create([{_id: id, ownerId, name: body.name.trim(), scopes: body.scopes,
        prefix: 'vtx_'+id.toHexString().slice(-8), tokenHash: tokenDigest(raw), expiresAt: new Date(Date.now() + body.expiresInDays * 86400000)}], {session});
      await DeveloperTokenAudit.create([{ownerId, tokenId: id, action: 'CREATE'}], {session});
      return record;
    });
    return {...tokenView(token), token: raw}; // Raw secret is returned only once.
  } finally {await session.endSession();}
}
export async function revokeDeveloperToken(ownerId: unknown, id: string) {
  if (!mongoose.isObjectIdOrHexString(id)) throw new DeveloperError('API_TOKEN_NOT_FOUND', 404);
  const session = await mongoose.startSession();
  try {return await session.withTransaction(async () => {
    const token = await DeveloperToken.findOne({_id: id, ownerId}).session(session);
    if (!token) throw new DeveloperError('API_TOKEN_NOT_FOUND', 404);
    if (!token.revokedAt) {
      token.revokedAt = new Date(); await token.save({session});
      await DeveloperTokenAudit.create([{ownerId, tokenId: token._id, action: 'REVOKE'}], {session});
    }
    return tokenView(token);
  });} finally {await session.endSession();}
}

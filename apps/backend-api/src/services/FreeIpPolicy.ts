import {Request} from 'express';
import {isIP} from 'node:net';
import {createHash} from 'node:crypto';
import mongoose from 'mongoose';
import {FreeIpWindow, FreeIpDenial} from '../models/FreeIpPolicy';
import {User, IUser} from '../models/User';
import {Workspace} from '../models/Workspace';
import {Project} from '../models/Project';
import {BillingOrder} from '../models/BillingOrder';
import {publishFreeIpDenial} from './BillingRealtime';

export const FREE_IP_LIMIT = 3;
export const FREE_IP_TITLE = 'Vi phạm chính sách sử dụng tài khoản Free';
export const FREE_IP_MESSAGE = 'Mạng bạn đang sử dụng đã đạt giới hạn 3 tài khoản Free trong khoảng thời gian áp dụng. Tài khoản này chưa thuộc danh sách được phép trên mạng đó, nên chúng tôi không thể cho phép đăng nhập từ mạng này. Nếu bạn cho rằng đây là nhầm lẫn, vui lòng liên hệ hỗ trợ.';
export class FreeIpError extends Error {
  constructor(public code: string, public status = 403) {super(code);}
}
export function normalizeIp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64 || !isIP(value)) return null;
  if (isIP(value) === 4) return value;
  let canonical: string;
  try {canonical = new URL(`http://[${value}]/`).hostname.slice(1, -1);} catch {return null;}
  // IPv4 mapped addresses must share the same bucket as IPv4 connections.
  const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/i.exec(canonical);
  if (mapped) {const hi = parseInt(mapped[1], 16), lo = parseInt(mapped[2], 16); return [hi >> 8, hi & 255, lo >> 8, lo & 255].join('.');}
  return canonical;
}
export function requestIp(req: Request) {
  // Express applies the configured trust proxy chain. Never read X-Forwarded-For directly.
  const ip = normalizeIp(req.ip || req.socket.remoteAddress);
  if (!ip) throw new FreeIpError('FREE_IP_CHECK_UNAVAILABLE', 503);
  return ip;
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const freeIpMonth = (now = new Date()) => now.toISOString().slice(0, 7);
async function retryUniqueRace<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {return await run();}
    catch (error: any) {if (error.code !== 11000 || attempt >= 2) throw error;}
  }
}
async function hasPaidAccess(user: IUser, now: Date, session?: mongoose.ClientSession) {
  // Match the existing entitlement resolver without granting credits here.
  if (!user.billingOrderId) return user.plan !== 'FREE';
  const term = user.planPeriod;
  return !!await BillingOrder.exists({ownerId: user._id, status: 'PAID', tier: {$ne: 'FREE'}, $or: [
    {startsAt: {$lte: now}, endsAt: {$gt: now}},
    ...(term && term.startsAt <= now && term.endsAt > now ? [{_id: user.billingOrderId, startsAt: {$exists: false}}] : []),
  ]}).session(session || null);
}
function validateAccount(user: IUser | null, identity: {googleId?: string}) {
  if (user?.status === 'BANNED') throw new FreeIpError('FORBIDDEN');
  if (user && identity.googleId && user.googleId !== identity.googleId) throw new FreeIpError('ACCOUNT_EXISTS_REQUIRE_LINK', 400);
}

// Credentials must be verified by the caller. User creation and the membership claim
// commit together; competing logins serialize on the same IP/month document.
export async function admitVerifiedAccount(req: Request, identity: {email: string; googleId?: string; displayName?: string; attempt: string}, now = new Date()) {
  const existing = await User.findOne({email: identity.email});
  validateAccount(existing, identity);
  // Paid logins never depend on the Free-IP window or write its tracking rows.
  if (existing && await hasPaidAccess(existing, now)) return existing;
  const ip = requestIp(req), month = freeIpMonth(now), windowId = digest(`${month}:${ip}`);
  try {await FreeIpWindow.updateOne({_id: windowId}, {$setOnInsert: {ip, month, accountIds: [], fence: 0}}, {upsert: true});}
  catch (error: any) {if (error.code !== 11000 || !await FreeIpWindow.exists({_id: windowId})) throw error;}
  const session = await mongoose.startSession();
  let eventId: string | undefined;
  try {
    const result = await retryUniqueRace(() => session.withTransaction(async () => {
      eventId = undefined;
      let user = await User.findOne({email: identity.email}).session(session);
      validateAccount(user, identity);
      if (!user && req.body.purpose === 'LINK_ACCOUNT') throw new FreeIpError('INVALID_INPUT', 400);

      // Paid periods/orders are inspected without granting or changing any credits.
      const paid = user ? await hasPaidAccess(user, now, session) : false;
      const id = user?._id || new mongoose.Types.ObjectId();
      if (!paid) {
        const row = await FreeIpWindow.findById(windowId).session(session);
        if (!row) throw new FreeIpError('FREE_IP_CHECK_UNAVAILABLE', 503);
        const member = row.accountIds.some((value: mongoose.Types.ObjectId) => value.equals(id));
        if (!member && row.accountIds.length >= FREE_IP_LIMIT) {
          const key = digest(`${windowId}:${identity.email}:${identity.attempt}`);
          if (!await FreeIpDenial.exists({_id: key}).session(session)) {
            await FreeIpDenial.create([{_id: key, ip, month, userId: user?._id, verifiedEmail: identity.email,
              linkedCount: row.accountIds.length, reason: 'FREE_IP_ACCOUNT_LIMIT', kind: user ? 'LOGIN' : 'REGISTRATION', occurredAt: now}], {session});
            row.suspicious = true; row.lastDeniedAt = now; row.fence++; await row.save({session});
            eventId = key;
          }
          return {denied: true as const};
        }
        if (!member) row.accountIds.push(id);
        row.fence++; await row.save({session});
      }
      if (!user) {
        [user] = await User.create([{_id: id, email: identity.email, googleId: identity.googleId, displayName: identity.displayName || identity.email.split('@')[0]}], {session});
        const [workspace] = await Workspace.create([{ownerId: id, name: 'My Workspace'}], {session});
        await Project.create([{workspaceId: workspace._id, name: 'Dự án đầu tiên'}], {session});
      }
      return {denied: false as const, user};
    }));
    if (eventId) await publishFreeIpDenial(eventId).catch(error => console.error('[Free IP realtime]', error));
    if (!result || result.denied) throw new FreeIpError('FREE_IP_ACCOUNT_LIMIT');
    return result.user;
  } catch (error) {
    if (error instanceof FreeIpError) throw error;
    console.error('[Free IP policy database error]', error);
    throw new FreeIpError('FREE_IP_CHECK_UNAVAILABLE', 503);
  } finally {await session.endSession();}
}

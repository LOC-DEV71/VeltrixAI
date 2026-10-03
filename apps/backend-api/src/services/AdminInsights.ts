import mongoose from 'mongoose';
import { User } from '../models/User';
import { Job } from '../models/Job';
import { BillingOrder } from '../models/BillingOrder';
import { ServiceHeartbeat } from '../models/ServiceHeartbeat';
import { CreditLedger } from '../models/Credits';
import { AdminSession } from '../models/AdminSession';
import { AdminAuditLog } from '../models/AdminAuditLog';
import { getTtsConfiguration } from '../providers/TtsProvider';
import { adminCan } from './AdminAccess';

const invalid = (code = 'ADMIN_INVALID_INPUT', status = 400) => Object.assign(new Error(code), { code, status });
let cachedHealth: { expires: number; value: any } | undefined;
let pendingHealth: Promise<any> | undefined;
export async function health() {
  if (cachedHealth && cachedHealth.expires > Date.now()) return cachedHealth.value;
  if (pendingHealth) return pendingHealth;
  pendingHealth = (async () => {
    const [heartbeat, latestAI] = await Promise.all([
      ServiceHeartbeat.findOne({ name: 'TTS_WORKER' }).select('seenAt').lean<{seenAt:Date}>(),
      Job.findOne({ type: { $in: ['AI_CONTENT', 'AI_SPLIT', 'AI_PROMPT_GEN', 'AI_ANALYSIS'] }, status: 'COMPLETED' }).sort({ updatedAt: -1 }).select('updatedAt').lean(),
    ]);
    let tts = 'UNAVAILABLE';
    try { const c = getTtsConfiguration(); tts = (await fetch(c.url + '/health/ready', { signal: AbortSignal.timeout(2000) })).ok ? 'READY' : 'UNAVAILABLE'; } catch { /* distinguish failed readiness from healthy */ }
    const value = { checkedAt: new Date(), tts, worker: heartbeat ? Date.now() - +heartbeat.seenAt < 60000 ? 'READY' : 'STALE' : 'UNKNOWN', workerSeenAt: heartbeat?.seenAt || null,
      gemini: process.env.GEMINI_API_KEY ? 'CONFIGURED' : 'UNCONFIGURED', geminiLastCompletedAt: latestAI?.updatedAt || null, geminiProbe: 'NOT_PROBED' };
    cachedHealth = { expires: Date.now() + 10000, value }; return value;
  })();
  try { return await pendingHealth; } finally { pendingHealth = undefined; }
}
export function overviewPeriod(query: any) {
  const period = query?.period || '24h';
  const hours: Record<string, number> = { '1h': 1, '24h': 24, '7d': 168, '30d': 720 };
  if (!hours[period]) throw invalid();
  return { period, since: new Date(Date.now() - hours[period] * 3600000) };
}
export async function overviewExtras(admin: any, since: Date) {
  const [queue, usage, byPlan, services] = await Promise.all([
    Job.aggregate([{ $match: { status: { $in: ['QUEUED', 'PROCESSING'] } } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    adminCan(admin, 'billing.read') ? CreditLedger.aggregate([{ $match: { transactionType: 'SETTLE', createdAt: { $gte: since } } }, { $group: { _id: null, credits: { $sum: { $max: [0, { $subtract: [{ $multiply: ['$deltaReserved', -1] }, '$deltaAvailable'] }] } } } }]) : Promise.resolve(null),
    adminCan(admin, 'billing.read') ? BillingOrder.aggregate([{ $match: { status: 'PAID', mode: 'production', paidAt: { $gte: since } } }, { $group: { _id: '$tier', orders: { $sum: 1 }, amount: { $sum: '$amount' } } }, { $sort: { amount: -1 } }]) : Promise.resolve(null),
    health(),
  ]);
  return { queue: { queued: queue.find(r => r._id === 'QUEUED')?.count || 0, processing: queue.find(r => r._id === 'PROCESSING')?.count || 0 }, creditUsed: usage === null ? null : usage[0]?.credits || 0, byPlan, services };
}
export async function globalSearch(admin: any, query: any) {
  if (typeof query.q !== 'string' || query.q.trim().length < 2 || query.q.length > 100) throw invalid();
  const q = query.q.trim(), literal = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exactId = mongoose.isObjectIdOrHexString(q) ? new mongoose.Types.ObjectId(q) : null;
  const [users, jobs, orders] = await Promise.all([
    adminCan(admin, 'users.read') ? User.find(exactId ? { _id: exactId } : { $or: [{ email: { $regex: literal, $options: 'i' } }, { displayName: { $regex: literal, $options: 'i' } }] }).select('displayName email').sort({ createdAt: -1, _id: -1 }).limit(4).maxTimeMS(2000).lean() : [],
    adminCan(admin, 'jobs.read') && exactId ? Job.find({ _id: exactId }).select('type status').limit(1).lean() : [],
    adminCan(admin, 'billing.read') && exactId ? BillingOrder.find({ _id: exactId }).select('tier status').limit(1).lean() : [],
  ]);
  return { items: [...users.map(u => ({ id: String(u._id), title: u.displayName || u.email, subtitle: u.email, route: 'USERS', query: q })),
    ...jobs.map(j => ({ id: String(j._id), title: 'Tác vụ ' + j.type, subtitle: j.status, route: 'JOBS', query: String(j._id) })),
    ...orders.map(o => ({ id: String(o._id), title: 'Đơn ' + o.tier, subtitle: o.status, route: 'ORDERS', query: String(o._id) }))].slice(0, 10) };
}
export async function ownSessions(admin: any, currentId: any, query: any) {
  const page = Number(query.page || 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000) throw invalid('INVALID_PAGINATION');
  const filter = { adminId: admin._id };
  const [items, total] = await Promise.all([AdminSession.find(filter).select('createdAt expiresAt revokedAt').sort({ createdAt: -1, _id: -1 }).skip((page - 1) * 10).limit(10).lean(), AdminSession.countDocuments(filter)]);
  return { items: items.map(s => ({ ...s, current: String(s._id) === String(currentId) })), total, page, limit: 10 };
}
export async function revokeOwnSession(admin: any, currentId: any, targetId: string, body: any) {
  if (!mongoose.isObjectIdOrHexString(targetId)) throw invalid('INVALID_ID');
  if (String(currentId) === targetId) throw invalid('CURRENT_SESSION_PROTECTED', 409);
  if (body.confirmed !== true || typeof body.reason !== 'string' || body.reason.trim().length < 5 || body.reason.length > 1000) throw invalid('ADMIN_CONFIRMATION_REQUIRED');
  const session = await mongoose.startSession();
  try { return await session.withTransaction(async () => {
    const target = await AdminSession.findOneAndUpdate({ _id: targetId, adminId: admin._id, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date() } }, { new: true, session });
    if (!target) throw invalid('NOT_FOUND', 404);
    await AdminAuditLog.create([{ adminId: admin._id, action: 'ADMIN_OWN_SESSION_REVOKED', resource: 'AdminSession', resourceId: targetId, changes: { reason: body.reason.trim() } }], { session });
    return { revoked: true };
  }); } finally { await session.endSession(); }
}

import {Request, Response} from 'express';
import {FreeIpWindow, FreeIpDenial} from '../models/FreeIpPolicy';
import {User} from '../models/User';
import {freeIpMonth, normalizeIp} from '../services/FreeIpPolicy';

function params(req: Request) {
  const page = Number(req.query.page || 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000) throw new Error('INVALID_PAGINATION');
  const month = req.query.month === undefined ? freeIpMonth() : req.query.month;
  if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('ADMIN_INVALID_INPUT');
  const ip = req.query.ip === undefined ? undefined : normalizeIp(req.query.ip);
  if (ip === null) throw new Error('ADMIN_INVALID_IP');
  return {page, month, ip};
}
function failed(error: unknown, res: Response) {
  const code = error instanceof Error ? error.message : '';
  const inputError = ['INVALID_PAGINATION', 'ADMIN_INVALID_INPUT', 'ADMIN_INVALID_IP'].includes(code);
  res.status(inputError ? 400 : 503).json({success: false, error: {code: inputError ? code : 'ADMIN_IP_HISTORY_UNAVAILABLE'}});
}
export async function getIpNetworks(req: Request, res: Response) {
  try {
    const {page, month, ip} = params(req);
    const query = {month, ...(ip ? {ip} : {})};
    const [total, items] = await Promise.all([FreeIpWindow.countDocuments(query), FreeIpWindow.find(query)
      .select('ip month accountIds suspicious lastDeniedAt updatedAt').sort({suspicious: -1, updatedAt: -1, _id: -1}).skip((page - 1) * 10).limit(10).lean()]);
    const flagged = new Set(await FreeIpWindow.distinct('ip', {ip: {$in: items.map(item => item.ip)}, suspicious: true}));
    res.json({success: true, data: {items: items.map(item => ({...item, monthSuspicious: item.suspicious, suspicious: flagged.has(item.ip)})), total, page, limit: 10, month}});
  } catch (error) {failed(error, res);}
}
export async function getIpHistory(req: Request, res: Response) {
  try {
    const {page, month, ip} = params(req);
    const query = ip ? {ip, month} : {};
    const [total, events, network, suspicious] = await Promise.all([
      FreeIpDenial.countDocuments(query), FreeIpDenial.find(query).sort({occurredAt: -1, _id: -1}).skip((page - 1) * 10).limit(10).lean(),
      ip ? FreeIpWindow.findOne({ip, month}).lean() : null,
      ip ? FreeIpWindow.exists({ip, suspicious: true}) : null,
    ]);
    const ids = [...(network?.accountIds || []), ...events.map(event => event.userId).filter(Boolean)];
    const accounts = await User.find({_id: {$in: ids}}).select('displayName email plan status').lean();
    const byId = new Map(accounts.map(account => [String(account._id), account]));
    res.json({success: true, data: {ip, month, suspicious: !!suspicious, limit: 10, total, page,
      linkedAccounts: (network?.accountIds || []).map((id: unknown) => byId.get(String(id)) || {_id: id, deleted: true}),
      items: events.map(event => ({...event, account: byId.get(String(event.userId)) || null}))}});
  } catch (error) {failed(error, res);}
}

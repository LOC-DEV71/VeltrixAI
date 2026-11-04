import { User } from '../models/User';

/** One query per page, with only identity fields (no private account details). */
export async function withOwnerIdentities<T extends { ownerId?: unknown }>(rows: T[]) {
  const ids = [...new Set(rows.filter(row => row.ownerId).map(row => String(row.ownerId)))];
  if (!ids.length) return rows;
  const owners = await User.find({ _id: { $in: ids } }).select('displayName email').lean();
  const byId = new Map(owners.map(owner => [String(owner._id), owner]));
  return rows.map(row => ({ ...row, owner: byId.get(String(row.ownerId)) || null }));
}

import { User } from '../models/User';

// Only aggregate counts are public. User identities, photos and subscription data stay private.
export async function currentPlanUserCounts(): Promise<Map<string, number>> {
  const rows = await User.aggregate<{ _id: string; count: number }>([
    { $match: { status: 'ACTIVE' } },
    { $group: { _id: '$plan', count: { $sum: 1 } } },
  ]);
  return new Map(rows.map(row => [row._id, row.count]));
}

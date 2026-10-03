import { User } from '../models/User';

export class AccountError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}
export function accountFields(user: any) {
  return {
    profile: { bio: user.profile?.bio || '', occupation: user.profile?.occupation || '' },
    preferences: { platform: user.preferences?.platform || 'tiktok', audience: user.preferences?.audience ?? 'Gen Z, thích hài hước', tone: user.preferences?.tone || 'funny' },
    accountRevision: user.accountRevision || 0,
  };
}
export function parseAccountPatch(body: any) {
  const invalid = () => { throw new AccountError('ACCOUNT_INVALID_INPUT'); };
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) return invalid();
  if (Object.keys(body).some(k => !['expectedRevision','displayName','profile','preferences'].includes(k))) return invalid();
  const fields: Record<string, string> = {};
  const text = (value: unknown, max: number, required = false) => {
    if (typeof value !== 'string' || value.trim().length > max || required && !value.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) return invalid();
    return value.trim();
  };
  if ('displayName' in body) fields.displayName = text(body.displayName, 100, true);
  if ('profile' in body) {
    if (!body.profile || typeof body.profile !== 'object' || Array.isArray(body.profile) || Object.keys(body.profile).some(k => !['bio','occupation'].includes(k))) return invalid();
    for (const key of ['bio','occupation']) if (key in body.profile) fields['profile.'+key] = text(body.profile[key], key === 'bio' ? 500 : 100);
  }
  if ('preferences' in body) {
    if (!body.preferences || typeof body.preferences !== 'object' || Array.isArray(body.preferences) || Object.keys(body.preferences).some(k => !['platform','audience','tone'].includes(k))) return invalid();
    for (const key of ['platform','audience','tone']) if (key in body.preferences) {
      const value = text(body.preferences[key], key === 'audience' ? 300 : 20);
      if (key === 'platform' && !['tiktok','shorts','reels'].includes(value) || key === 'tone' && !['funny','pro','drama'].includes(value)) return invalid();
      fields['preferences.'+key] = value;
    }
  }
  if (!Object.keys(fields).length) return invalid();
  return { fields, expectedRevision: body.expectedRevision };
}
export async function updateAccount(ownerId: unknown, body: unknown) {
  const { fields, expectedRevision } = parseAccountPatch(body);
  const revisionFilter = expectedRevision === 0 ? { $or: [{accountRevision:0},{accountRevision:{$exists:false}}] } : { accountRevision:expectedRevision };
  const user = await User.findOneAndUpdate({ _id:ownerId, status:'ACTIVE', ...revisionFilter }, { $set:fields, $inc:{accountRevision:1} }, { new:true, runValidators:true });
  if (!user) throw new AccountError('ACCOUNT_REVISION_CONFLICT',409);
  return { displayName:user.displayName, ...accountFields(user) };
}

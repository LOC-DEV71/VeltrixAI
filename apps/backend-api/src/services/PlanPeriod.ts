import { AccountError } from './UserAccount';
const VN_OFFSET = 7 * 60 * 60 * 1000;
export function addPlanMonths(date: Date, months: number) {
  const local = new Date(date.getTime() + VN_OFFSET);
  const target = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth()+months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate();
  return new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth(),Math.min(local.getUTCDate(),lastDay),local.getUTCHours(),local.getUTCMinutes(),local.getUTCSeconds(),local.getUTCMilliseconds()) - VN_OFFSET);
}
export function parsePlanPeriod(raw: any, tier: string) {
  if (raw === null) return null;
  if (tier === 'FREE' || !raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(k=>!['billingCycle','startsAt'].includes(k)) || !['MONTHLY','YEARLY'].includes(raw.billingCycle) || typeof raw.startsAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.startsAt)) throw new AccountError('PLAN_PERIOD_INVALID');
  const startsAt = new Date(raw.startsAt+'T00:00:00+07:00');
  if (!Number.isFinite(startsAt.getTime()) || new Date(startsAt.getTime()+VN_OFFSET).toISOString().slice(0,10) !== raw.startsAt) throw new AccountError('PLAN_PERIOD_INVALID');
  return { billingCycle:raw.billingCycle as 'MONTHLY'|'YEARLY', startsAt, endsAt:addPlanMonths(startsAt,raw.billingCycle === 'YEARLY' ? 12 : 1) };
}
export function planPeriodView(user: any, now = new Date()) {
  const term = user.planPeriod;
  if (user.plan === 'FREE' || !term) return null;
  const startsAt = new Date(term.startsAt), endsAt = new Date(term.endsAt);
  if (!['MONTHLY','YEARLY'].includes(term.billingCycle) || !Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) return null;
  const months = term.billingCycle === 'YEARLY' ? 12 : 1;
  // Calendar months, rather than 365/12 days: exactly one month of an annual term consumes 1/12.
  let elapsedMonths = 0;
  for(let i=0;i<months;i++) {
    const a=addPlanMonths(startsAt,i), b=i === months-1 ? endsAt : addPlanMonths(startsAt,i+1);
    if(now >= b) elapsedMonths=i+1;
    else if(now > a) { elapsedMonths=i+(now.getTime()-a.getTime())/(b.getTime()-a.getTime());break; }
    else break;
  }
  const remainingPercent = now >= endsAt ? 0 : Math.max(0,Math.min(100,(1-elapsedMonths/months)*100));
  const monthIndex=Math.min(Math.floor(elapsedMonths),months-1), monthStart=addPlanMonths(startsAt,monthIndex), monthEnd=monthIndex===months-1 ? endsAt : addPlanMonths(startsAt,monthIndex+1);
  const monthlyRemainingPercent=now>=endsAt ? 0 : Math.max(0,Math.min(100,(monthEnd.getTime()-now.getTime())/(monthEnd.getTime()-monthStart.getTime())*100));
  return {billingCycle:term.billingCycle,startsAt:startsAt.toISOString(),endsAt:endsAt.toISOString(),remainingPercent:Math.round(remainingPercent*100)/100,monthlyRemainingPercent:Math.round(monthlyRemainingPercent*100)/100,monthStartsAt:monthStart.toISOString(),monthEndsAt:monthEnd.toISOString(),totalMonths:months,remainingDays:Math.max(0,Math.ceil((endsAt.getTime()-Math.max(now.getTime(),startsAt.getTime()))/86400000)),status:now < startsAt ? 'SCHEDULED' : now >= endsAt ? 'EXPIRED' : 'ACTIVE',measuredAt:now.toISOString()};
}

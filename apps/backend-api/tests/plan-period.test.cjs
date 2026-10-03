const {test}=require('node:test'),assert=require('node:assert/strict');
const {addPlanMonths,parsePlanPeriod,planPeriodView}=require('../dist/services/PlanPeriod');
const term=(cycle='YEARLY',day='2026-01-01')=>({plan:'PRO',planPeriod:parsePlanPeriod({billingCycle:cycle,startsAt:day},'PRO')});
test('annual period uses 12 calendar months: 100, 91.67, 50, 0 percent',()=>{
 const user=term();for(const [day,expected] of [['2026-01-01',100],['2026-02-01',91.67],['2026-07-01',50],['2027-01-01',0]])assert.equal(planPeriodView(user,new Date(day+'T00:00:00+07:00')).remainingPercent,expected);
 const nextMonth=planPeriodView(user,new Date('2026-02-01T00:00:00+07:00'));assert.equal(nextMonth.monthlyRemainingPercent,100);assert.equal(nextMonth.monthStartsAt,'2026-01-31T17:00:00.000Z');
});
test('end-of-month anchors clamp locally, then return to original day and handle leap year',()=>{
 const start=new Date('2024-01-31T00:00:00+07:00');assert.equal(addPlanMonths(start,1).toISOString(),'2024-02-28T17:00:00.000Z');assert.equal(addPlanMonths(start,2).toISOString(),'2024-03-30T17:00:00.000Z');
 const user=term('YEARLY','2024-01-31');assert.equal(planPeriodView(user,addPlanMonths(start,1)).remainingPercent,91.67);
 assert.equal(parsePlanPeriod({billingCycle:'YEARLY',startsAt:'2024-02-29'},'PLUS').endsAt.toISOString(),'2025-02-27T17:00:00.000Z');
});
test('monthly period, scheduled start and expiry are bounded without fake fallback dates',()=>{
 const user=term('MONTHLY');const half=planPeriodView(user,new Date('2026-01-16T12:00:00+07:00'));assert.equal(half.remainingPercent,50);assert.equal(half.monthlyRemainingPercent,50);
 const before=planPeriodView(user,new Date('2025-12-01T00:00:00+07:00'));assert.equal(before.status,'SCHEDULED');assert.equal(before.remainingPercent,100);
 const after=planPeriodView(user,new Date('2026-03-01T00:00:00+07:00'));assert.equal(after.status,'EXPIRED');assert.equal(after.remainingPercent,0);assert.equal(after.monthlyRemainingPercent,0);assert.equal(after.remainingDays,0);
 assert.equal(planPeriodView({plan:'PRO',createdAt:new Date()}),null);assert.equal(planPeriodView({...user,plan:'FREE'}),null);
});
test('rejects invalid dates, unknown cycles, client expiry and paid period on Free',()=>{
 for(const raw of [{billingCycle:'YEARLY',startsAt:'2026-02-30'},{billingCycle:'DAILY',startsAt:'2026-01-01'},{billingCycle:'YEARLY',startsAt:'invalid'},{billingCycle:'YEARLY',startsAt:'2026-01-01',endsAt:'2030-01-01'}])assert.throws(()=>parsePlanPeriod(raw,'PRO'),e=>e.code==='PLAN_PERIOD_INVALID');
 assert.throws(()=>parsePlanPeriod({billingCycle:'YEARLY',startsAt:'2026-01-01'},'FREE'));assert.equal(parsePlanPeriod(null,'FREE'),null);
});

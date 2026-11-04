import mongoose from 'mongoose';
import { Plan, PlanRevision, PlanAudit } from '../models/Plan';
import { PlanConfig, PlanError, validatePlan, planDiff, PLAN_FIELDS } from './PlanSchema';
import {defaultPlanDescription} from './PlanPresentation';
export { PlanError } from './PlanSchema';
export interface PlanSnapshot { planId: string; tier: string; revision: number; config: PlanConfig; capturedAt: string; }
export async function getPlanSnapshot(tier: string, session?: mongoose.ClientSession, includeArchived = false): Promise<PlanSnapshot> {
  const head = await Plan.findOne({ tier: tier || 'FREE' }).session(session || null);
  if (!head || head.archived && !includeArchived) throw new PlanError('PLAN_FEATURE_DISABLED', 403);
  const record = await PlanRevision.findOne({ planId: head._id, revision: head.revision }).session(session || null);
  if (!record || !record.config.overview.active && !includeArchived) throw new PlanError('PLAN_FEATURE_DISABLED', 403);
  return { planId: String(head._id), tier: head.tier, revision: record.revision, config: record.config, capturedAt: new Date().toISOString() };
}
export async function verifySnapshot(snapshot: PlanSnapshot, session?: mongoose.ClientSession) {
  if (!snapshot || !mongoose.isObjectIdOrHexString(snapshot.planId) || !Number.isSafeInteger(snapshot.revision)) throw new PlanError('PLAN_SNAPSHOT_INVALID', 409);
  const version = await PlanRevision.findOne({ planId: snapshot.planId, revision: snapshot.revision }).session(session || null);
  if (!version || version.tier !== snapshot.tier || JSON.stringify(version.config) !== JSON.stringify(snapshot.config)) throw new PlanError('PLAN_SNAPSHOT_INVALID', 409);
  return snapshot;
}
export async function savePlan(tier: string, raw: unknown, expectedRevision: number, actor: mongoose.Types.ObjectId | null, reason: string, confirmed: boolean, action = 'UPDATE') {
  const config = validatePlan(raw, tier);
  if (typeof reason !== 'string' || reason.trim().length < 5 || reason.length > 1000 || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new PlanError('PLAN_INVALID');
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(async () => {
      let head = await Plan.findOne({ tier }).session(session);
      if ((head?.revision || 0) !== expectedRevision) throw new PlanError('PLAN_REVISION_CONFLICT', 409);
      const previous = head && await PlanRevision.findOne({ planId: head._id, revision: head.revision }).session(session);
      const diff = planDiff(previous?.config, config);
      if (!diff.length && action !== 'ARCHIVE') throw new PlanError('PLAN_NO_CHANGES');
      if ((action === 'ARCHIVE' || diff.some(d => d.restrictive)) && !confirmed) throw new PlanError('PLAN_CONFIRMATION_REQUIRED', 409);
      const next = expectedRevision + 1;
      if (!head) [head] = await Plan.create([{ tier, slug: config.overview.slug, revision: next }], { session });
      else {
        const changed = await Plan.findOneAndUpdate({ _id: head._id, revision: expectedRevision }, { $set: { revision: next, slug: config.overview.slug, archived: action === 'ARCHIVE' } }, { new: true, session });
        if (!changed) throw new PlanError('PLAN_REVISION_CONFLICT', 409);
      }
      const changedAt = new Date();
      await PlanRevision.create([{ planId: head!._id, tier, revision: next, config, changedBy: actor, changedAt, reason: reason.trim() }], { session });
      await PlanAudit.create([{ planId: head!._id, revision: next, changedBy: actor, changedAt, reason: reason.trim(), action, diff }], { session });
      return { tier, revision: next, config, diff, changedAt };
    });
  } catch (error: any) { if (error?.code === 11000) throw new PlanError('PLAN_REVISION_CONFLICT', 409); throw error; }
  finally { await session.endSession(); }
}
export function seedConfig(tier: string, ttsRate = 100): PlanConfig {
  const config: PlanConfig = {};
  for (const f of PLAN_FIELDS) (config[f.section] ||= {})[f.key] = f.type === 'boolean' ? false : f.type === 'text' ? '' : f.type === 'list' ? ['auto'] : f.nullable ? null : f.type === 'number' ? 0 : 1;
  Object.assign(config.overview, { name: tier === 'BASIC_STUDENT' ? 'Basic Student' : tier[0] + tier.slice(1).toLowerCase(), slug: tier.toLowerCase().replace('_','-'), active: true, displayOrder: ['FREE','BASIC_STUDENT','PLUS','PRO'].indexOf(tier) });
  config.overview.description=defaultPlanDescription(tier);
  Object.assign(config.credits, { monthlyGrant:2000, expiresAfterDays:tier==='PLUS'||tier==='PRO'?null:31, paidAllowed: true, rolloverAllowed: tier === 'PLUS' || tier === 'PRO', ttsPer100Chars: ttsRate, contentCost: 20 });
  Object.assign(config.content, { enabled: true, maxInputChars: 2000, maxOutputChars: tier === 'PRO' ? 30000 : tier === 'PLUS' ? 15000 : 4000, maxDurationSeconds: tier === 'PRO' ? 600 : tier === 'PLUS' ? 300 : 60, defaultDurationSeconds: tier === 'PRO' ? 90 : tier === 'PLUS' ? 60 : 30, languages: ['vi-VN'], modes: tier === 'PLUS' || tier === 'PRO' ? ['auto','aida','pas','storytelling'] : ['auto'], advanced: tier === 'PLUS' || tier === 'PRO', creativeDirection: tier === 'PRO' });
  Object.assign(config.scenes, { enabled: true, maxScenes: tier === 'PRO' ? 20 : tier === 'PLUS' ? 12 : 4, maxNarrationChars: 3000 });
  Object.assign(config.prompts, { imageEnabled: true, videoEnabled: true }); config.regeneration.enabled = true;
  Object.assign(config.tts, { enabled: true, maxTextChars: 3000 });
  if (tier === 'PLUS' || tier === 'PRO') Object.assign(config.clone, { enabled: true, maxVoices: 10, monthlyEnrollments: 30, minReferenceSeconds: 3, maxReferenceSeconds: 8, maxFileBytes: 4194304, maxTextChars: 3000, concurrentJobs: 2, premiumSystemVoices: true });
  Object.assign(config.limits, { concurrentJobs: 4, concurrentAiJobs: 2, requestsPerMinute: 20, queuePriority: 1 });
  // PRO: no monthly quotas; usage is bounded only by Credit balance.
  if (tier === 'PRO') {
    Object.assign(config.content, { monthlyChars: null, monthlyJobs: null });
    Object.assign(config.prompts, { monthlyGenerations: null });
    Object.assign(config.tts, { monthlyChars: null });
    Object.assign(config.clone, { monthlyChars: null, monthlySeconds: null, monthlyEnrollments: null });
  }
  return validatePlan(config, tier);
}

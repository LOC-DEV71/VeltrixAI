import mongoose from 'mongoose';
import { PlanUsage } from '../models/Plan';
import { Job, IJob } from '../models/Job';
import { PlanSnapshot, PlanError, verifySnapshot, getPlanSnapshot } from './PlanService';
import { User } from '../models/User';
import { Workspace } from '../models/Workspace';
import { Project } from '../models/Project';
import { Content } from '../models/Content';
import { randomUUID } from 'node:crypto';
import {paidEntitlements} from './BillingService';
export const characters = (text: string) => [...text.trim()].length;
export function limit(value: number, maximum: number | null, code = 'PLAN_LIMIT_EXCEEDED') {
  if (maximum !== null && value > maximum) throw new PlanError(code,403);
}
export function enabled(value: boolean, code = 'PLAN_FEATURE_DISABLED') { if (!value) throw new PlanError(code,403); }
export function validateOutput(snapshot: PlanSnapshot, scenes: Array<{narration:string;imagePrompt:string;videoPrompt:string}>, budget?: number|null) {
  const c=snapshot.config;
  limit(scenes.length,c.scenes.maxScenes,'SCENE_LIMIT_EXCEEDED');
  for(const scene of scenes){limit(characters(scene.narration),c.scenes.maxNarrationChars,'SCENE_LIMIT_EXCEEDED');if(!c.prompts.imageEnabled)scene.imagePrompt='';if(!c.prompts.videoEnabled)scene.videoPrompt='';}
  const length=characters(scenes.map(s=>s.narration).join(' '));limit(length,c.content.maxOutputChars,'CONTENT_QUOTA_EXCEEDED');if(budget!==undefined)limit(length,budget,'CONTENT_QUOTA_EXCEEDED');
  return length;
}
export async function forOwner(ownerId: mongoose.Types.ObjectId, session?: mongoose.ClientSession) {
  const user = await User.findById(ownerId).session(session || null);
  if (!user || user.status !== 'ACTIVE') throw new PlanError('PLAN_FEATURE_DISABLED',403);
  if(user.billingOrderId){
    if(session)return await paidEntitlements(user,session) || getPlanSnapshot(user.plan,session);
    const ownSession=await mongoose.startSession();
    try{return await ownSession.withTransaction(async()=>await paidEntitlements(user,ownSession) || getPlanSnapshot(user.plan,ownSession));}finally{await ownSession.endSession();}
  }
  return getPlanSnapshot(user.plan, session);
}
export function validateRequest(snapshot: PlanSnapshot, kind: string, values: { input?: string; clone?: boolean; scenes?: number; language?: string; mode?: string; regenerate?: boolean; duration?: number; bytes?: number }) {
  const c = snapshot.config, size = characters(values.input || '');
  if (kind === 'AI_CONTENT' || kind === 'AI_SPLIT' || kind === 'AI_PROMPT_GEN') {
    if(kind==='AI_CONTENT')enabled(c.content.enabled,'CONTENT_FEATURE_DISABLED');
    limit(size,c.content.maxInputChars,'CONTENT_INPUT_LIMIT_EXCEEDED');
    if (values.language && !c.content.languages.includes(values.language) || values.mode && !c.content.modes.includes(values.mode)) throw new PlanError('CONTENT_FEATURE_DISABLED',403);
    if (kind==='AI_CONTENT' && values.regenerate) enabled(c.regeneration.enabled,'CONTENT_FEATURE_DISABLED');
    if (kind === 'AI_SPLIT' || kind === 'AI_CONTENT' && c.scenes.enabled && values.scenes !== undefined) { enabled(c.scenes.enabled,'CONTENT_FEATURE_DISABLED'); if (values.scenes) limit(values.scenes,c.scenes.maxScenes,'SCENE_LIMIT_EXCEEDED'); }
    if (kind === 'AI_PROMPT_GEN') enabled(c.prompts.imageEnabled || c.prompts.videoEnabled,'CONTENT_FEATURE_DISABLED');
  }
  if (kind === 'TTS') {
    enabled(c.tts.enabled); limit(size,c.tts.maxTextChars,'TTS_TEXT_LIMIT_EXCEEDED');
    if (values.clone) { enabled(c.clone.enabled); limit(size,c.clone.maxTextChars,'CLONE_TEXT_LIMIT_EXCEEDED'); }
  }
  if (kind === 'VOICE_ENROLLMENT') {
    enabled(c.clone.enabled);
    if (values.duration !== undefined && (values.duration < c.clone.minReferenceSeconds || values.duration > c.clone.maxReferenceSeconds)) throw new PlanError('PLAN_LIMIT_EXCEEDED',403);
    if (values.bytes !== undefined) limit(values.bytes,c.clone.maxFileBytes);
  }
}
// The same owner/month row serializes quota reservations in the job-creation transaction.
export async function reserveUsage(ownerId: mongoose.Types.ObjectId, snapshot: PlanSnapshot, kind: string, amounts: Record<string,number>, session: mongoose.ClientSession) {
  const c = snapshot.config, period = new Date().toISOString().slice(0,7);
  let row = await PlanUsage.findOne({ ownerId,period }).session(session);
  if (!row) [row] = await PlanUsage.create([{ ownerId,period,counts:{} }],{session});
  const ceilings: Record<string,[number|null,string]> = { contentChars:[c.content.monthlyChars,'CONTENT_QUOTA_EXCEEDED'], contentJobs:[c.content.monthlyJobs,'CONTENT_QUOTA_EXCEEDED'], prompts:[c.prompts.monthlyGenerations,'PROMPT_QUOTA_EXCEEDED'], ttsChars:[c.tts.monthlyChars,'PLAN_LIMIT_EXCEEDED'], cloneChars:[c.clone.monthlyChars,'PLAN_LIMIT_EXCEEDED'], cloneSeconds:[c.clone.monthlySeconds,'PLAN_LIMIT_EXCEEDED'], enrollments:[c.clone.monthlyEnrollments,'CLONE_VOICE_LIMIT_EXCEEDED'] };
  for (const [key,value] of Object.entries(amounts)) { if (!Number.isSafeInteger(value) || value < 0 || !ceilings[key]) throw new PlanError('PLAN_INVALID'); limit((row.counts[key] || 0)+value,ceilings[key][0],ceilings[key][1]); row.counts[key]=(row.counts[key] || 0)+value; }
  const pending = { ownerId,status:{$in:['QUEUED','PROCESSING']} };
  limit(await Job.countDocuments(pending).session(session)+1,c.limits.concurrentJobs);
  if (kind.startsWith('AI_')) limit(await Job.countDocuments({...pending,type:{$in:['AI_CONTENT','AI_SPLIT','AI_PROMPT_GEN']}}).session(session)+1,c.limits.concurrentAiJobs);
  if (kind === 'VOICE_ENROLLMENT' || amounts.cloneChars) limit(await Job.countDocuments({...pending,$or:[{type:'VOICE_ENROLLMENT'},{type:'TTS','payload.isClone':true}]}).session(session)+1,c.clone.concurrentJobs);
  row.fence++; row.markModified('counts'); await row.save({session});
  const minute = new Date().toISOString().slice(0,16);
  let rate = await PlanUsage.findOne({ownerId,period:minute}).session(session);
  if (!rate) [rate] = await PlanUsage.create([{ownerId,period:minute,counts:{requests:0}}],{session});
  limit((rate.counts.requests || 0)+1,c.limits.requestsPerMinute); rate.counts.requests=(rate.counts.requests || 0)+1; rate.markModified('counts'); await rate.save({session});
  return {period,amounts};
}
export async function reconcileUsage(job: IJob, actual: Record<string,number>, session: mongoose.ClientSession) {
  const held = job.payload.entitlementUsage;
  if (!held || job.payload.entitlementUsageSettled) return;
  const row = await PlanUsage.findOne({ownerId:job.ownerId,period:held.period}).session(session);
  if (!row) throw new PlanError('PLAN_USAGE_UNAVAILABLE',503);
  for (const [key,value] of Object.entries(held.amounts as Record<string,number>)) if (key.endsWith('Chars') || key === 'cloneSeconds' || key === 'prompts') row.counts[key]=Math.max(0,(row.counts[key] || 0)-value+(actual[key] || 0));
  const c=job.payload.entitlementSnapshot.config;
  for (const [key,max] of Object.entries({contentChars:c.content.monthlyChars,ttsChars:c.tts.monthlyChars,cloneChars:c.clone.monthlyChars,cloneSeconds:c.clone.monthlySeconds,prompts:c.prompts.monthlyGenerations})) if((actual[key] || 0)>(held.amounts[key] || 0))limit(row.counts[key] || 0,max as number|null,key==='contentChars'?'CONTENT_QUOTA_EXCEEDED':key==='prompts'?'PROMPT_QUOTA_EXCEEDED':'PLAN_LIMIT_EXCEEDED');
  row.markModified('counts'); await row.save({session}); job.payload.entitlementUsageSettled=true; job.markModified('payload');
}
export async function verifyJobEntitlements(job: IJob, session?: mongoose.ClientSession) {
  if (!job.payload.entitlementSnapshot) throw new PlanError('PLAN_SNAPSHOT_REQUIRED',409);
  const snapshot = await verifySnapshot(job.payload.entitlementSnapshot,session);
  validateRequest(snapshot,job.type,{input:job.payload.narration || job.payload.inputText || job.payload.topic || '',clone:job.payload.isClone,scenes:job.payload.options?.sceneCount || undefined,language:job.payload.language,mode:job.payload.options?.structure,duration:job.payload.referenceDuration,bytes:job.payload.referenceBytes,regenerate:job.payload.regenerate});
  return snapshot;
}
// Claims share a per-owner write fence across all worker processes. A newer,
// more permissive revision cannot consume a running older job's reserved capacity.
export async function claimPlanJob(filter: Record<string,any>, leaseMs: number): Promise<IJob|null> {
  const candidates = await Job.find({...filter,$or:[{status:'QUEUED'},{status:'PROCESSING',leaseExpiresAt:{$lt:new Date()}}]}).sort({'payload.priority':1,createdAt:1}).limit(20);
  for (const candidate of candidates) {
    const session=await mongoose.startSession();let claimed:IJob|null=null;
    try { await session.withTransaction(async()=>{
      claimed=null;
      await PlanUsage.findOneAndUpdate({ownerId:candidate.ownerId,period:'execution'},{$inc:{fence:1},$setOnInsert:{counts:{}}},{upsert:true,session});
      const job=await Job.findOne({_id:candidate._id,$or:[{status:'QUEUED'},{status:'PROCESSING',leaseExpiresAt:{$lt:new Date()}}]}).session(session);
      if(!job)return;
      const running=await Job.find({ownerId:job.ownerId,_id:{$ne:job._id},status:'PROCESSING',leaseExpiresAt:{$gt:new Date()}}).session(session);
      const prospective=[...running,job];
      for(const item of prospective){
        // Invalid/missing snapshots must reach the worker's terminal failure path.
        let snapshot:PlanSnapshot;try{snapshot=await verifySnapshot(item.payload.entitlementSnapshot,session);}catch{continue;}
        const c=snapshot.config;
        if(c.limits.concurrentJobs!==null&&prospective.length>c.limits.concurrentJobs)return;
        if(item.type.startsWith('AI_')&&c.limits.concurrentAiJobs!==null&&prospective.filter(j=>j.type.startsWith('AI_')).length>c.limits.concurrentAiJobs)return;
        if((item.type==='VOICE_ENROLLMENT'||item.payload.isClone)&&c.clone.concurrentJobs!==null&&prospective.filter(j=>j.type==='VOICE_ENROLLMENT'||j.payload.isClone).length>c.clone.concurrentJobs)return;
      }
      claimed=await Job.findOneAndUpdate({_id:job._id,$or:[{status:'QUEUED'},{status:'PROCESSING',leaseExpiresAt:{$lt:new Date()}}]},{$set:{status:'PROCESSING',executionClaim:randomUUID(),leaseExpiresAt:new Date(Date.now()+leaseMs),startedAt:new Date()},$inc:{attempts:1}},{new:true,session});
    }); } finally {await session.endSession();}
    if(claimed)return claimed;
  }
  return null;
}
export async function reserveStorage(ownerId: mongoose.Types.ObjectId, snapshot: PlanSnapshot, kind:'projects'|'workspaces'|'contents', session: mongoose.ClientSession) {
  // Serialize counts and inserts even when administrators edit limits concurrently.
  await PlanUsage.findOneAndUpdate({ownerId,period:'storage'},{$inc:{fence:1},$setOnInsert:{counts:{}}},{upsert:true,session});
  const workspaces=await Workspace.find({ownerId}).session(session);const ids=workspaces.map(w=>w._id);
  if(kind==='workspaces')limit(workspaces.length+1,snapshot.config.storage.maxWorkspaces);
  if(kind==='projects')limit(await Project.countDocuments({workspaceId:{$in:ids}}).session(session)+1,snapshot.config.storage.maxProjects);
  if(kind==='contents'){const projects=await Project.find({workspaceId:{$in:ids}}).session(session);limit(await Content.countDocuments({projectId:{$in:projects.map(p=>p._id)}}).session(session)+1,snapshot.config.storage.maxContents);}
}

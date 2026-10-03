import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { resolve } from 'node:path';
import { Plan, PlanRevision, PlanAudit, PlanUsage, ContentRevision } from '../models/Plan';
import { seedConfig, savePlan } from '../services/PlanService';
import { SystemSettings } from '../models/SystemSettings';
import { User } from '../models/User';
import { Job } from '../models/Job';
dotenv.config({ path:resolve(__dirname,'../../.env'),quiet:true });
(async()=>{
  await mongoose.connect(process.env.MONGODB_URI!,{serverSelectionTimeoutMS:10000});
  await Promise.all([Plan.init(),PlanRevision.init(),PlanAudit.init(),PlanUsage.init(),ContentRevision.init()]);
  const rate = await SystemSettings.findOne({key:'TTS_CREDITS_PER_100_CHARS'});
  const grant=await SystemSettings.findOne({key:'FREE_GRANT_AMOUNT'});
  for (const tier of ['FREE','BASIC_STUDENT','PLUS','PRO']) {
    const head=await Plan.findOne({tier});
    const config=seedConfig(tier,Number(rate?.value || 100));config.credits.monthlyGrant=Number(grant?.value ?? 2000);
    if(!head)await savePlan(tier,config,0,null,'AG-022 initial configuration',true,'CREATE');
    else if(head.revision===1){const first=await PlanRevision.findOne({planId:head._id,revision:1});if(first?.reason==='AG-022 initial configuration'&&first.config.credits.monthlyGrant===0){const corrected=structuredClone(first.config);corrected.credits.monthlyGrant=config.credits.monthlyGrant;corrected.credits.expiresAfterDays=config.credits.expiresAfterDays;await savePlan(tier,corrected,1,null,'Preserve existing monthly credit grant during migration',true);}}
  }
  let frozen = 0;
  for await (const job of Job.find({'payload.entitlementSnapshot':{$exists:false}}).cursor()) {
    const user = await User.findById(job.ownerId); const tier = user?.plan || 'FREE';
    const head = await Plan.findOne({tier}); if (!head) throw new Error('UNMAPPED_LEGACY_PLAN');
    const version = await PlanRevision.findOne({planId:head._id,revision:1});
    const snapshot = {planId:String(head._id),tier,revision:1,config:version!.config,capturedAt:(job as any).createdAt.toISOString()};
    // Retain old price/cost; this only adds a frozen eligibility policy.
    await Job.updateOne({_id:job._id,'payload.entitlementSnapshot':{$exists:false}},{$set:{'payload.entitlementSnapshot':snapshot,'payload.legacyEntitlements':true,'payload.priority':snapshot.config.limits.queuePriority}}); frozen++;
  }
  console.log(JSON.stringify({success:true,legacyJobsFrozen:frozen}));
})().catch(()=>{console.error('PLAN_SEED_FAILED');process.exitCode=1;}).finally(()=>mongoose.disconnect());

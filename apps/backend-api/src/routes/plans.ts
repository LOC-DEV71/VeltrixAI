import {currentPlanUserCounts} from '../services/PlanPopularity';
﻿import { Router } from 'express';
import { requireAuth } from '../middlewares/authMiddleware';
import { forOwner } from '../services/EntitlementService';
import { PlanError } from '../services/PlanService';
import { Plan } from '../models/Plan';
import { getPlanSnapshot } from '../services/PlanService';
import {planPresentation} from '../services/PlanPresentation';
const router=Router();
router.get('/',async(_req,res)=>{try{const [heads,counts]=await Promise.all([Plan.find({archived:false}),currentPlanUserCounts()]);const plans=await Promise.all(heads.map(async head=>{const snapshot=await getPlanSnapshot(head.tier,undefined,true);return {tier:snapshot.tier,revision:snapshot.revision,config:snapshot.config,popularity:{activeUsers:counts.get(snapshot.tier)||0},presentation:planPresentation(snapshot.tier,snapshot.config)};}));res.json({success:true,data:plans.filter(p=>p.config.overview.active).sort((a,b)=>a.config.overview.displayOrder-b.config.overview.displayOrder)});}catch{res.status(503).json({success:false,error:{code:'PLAN_CONFIGURATION_UNAVAILABLE'}});}});
router.get('/me',requireAuth,async(req,res)=>{
  try {const plan=await forOwner((req as any).user._id);res.json({success:true,data:{tier:plan.tier,revision:plan.revision,config:plan.config}});}
  catch(error){res.status(error instanceof PlanError ? error.status : 503).json({success:false,error:{code:error instanceof PlanError ? error.code : 'PLAN_CONFIGURATION_UNAVAILABLE'}});}
});
export default router;

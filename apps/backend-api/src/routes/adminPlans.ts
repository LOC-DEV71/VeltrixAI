import { Router, Request, Response, NextFunction } from 'express';
import { requireAdminAuth, requirePermission, auditAdminAction } from '../middlewares/adminAuthMiddleware';
import { csrfProtection } from '../middlewares/csrfMiddleware';
import { Plan, PlanRevision, PlanAudit } from '../models/Plan';
import { PLAN_FIELDS, validatePlan, planDiff } from '../services/PlanSchema';
import { getPlanSnapshot, savePlan, PlanError } from '../services/PlanService';
const router = Router();
router.use(requireAdminAuth, requirePermission('plans.read'));
const route = (fn: (req: Request, res: Response) => Promise<any>) => (req: Request, res: Response, next: NextFunction) => fn(req,res).catch((error: any) => {
  if (error instanceof PlanError) return res.status(error.status).json({ success: false, error: { code: error.code, fields: error.fields } });
  return res.status(500).json({ success: false, error: { code: 'PLAN_CONFIGURATION_UNAVAILABLE' } });
});
router.get('/schema', route(async (_req,res) => res.json({ success:true, data: { fields: PLAN_FIELDS, tiers: ['FREE','BASIC_STUDENT','PLUS','PRO'] } })));
router.get('/', route(async (_req,res) => {
  const heads = await Plan.find().lean();
  const records = await Promise.all(heads.map(async head => ({ ...await getPlanSnapshot(head.tier, undefined, true), archived: head.archived, updatedAt: head.updatedAt })));
  return res.json({ success:true, data:records.sort((a,b)=>a.config.overview.displayOrder-b.config.overview.displayOrder) });
}));
router.get('/:tier/history', route(async (req,res) => {
  const head = await Plan.findOne({ tier:req.params.tier }); if (!head) throw new PlanError('PLAN_NOT_FOUND',404);
  const page=Number(req.query.page||1),limit=10;if(!Number.isSafeInteger(page)||page<1||page>10000)throw new PlanError('INVALID_PAGINATION',400);
  const filter={planId:head._id};const [items,total]=await Promise.all([PlanAudit.find(filter).sort({revision:-1}).skip((page-1)*limit).limit(limit).lean(),PlanAudit.countDocuments(filter)]);
  return res.json({success:true,data:{items,total,page,limit}});
}));
router.get('/:tier', route(async (req,res) => res.json({ success:true, data:await getPlanSnapshot(String(req.params.tier),undefined,true) })));
router.post('/:tier/preview', csrfProtection, route(async (req,res) => {
  const head = await Plan.findOne({ tier:req.params.tier });
  if ((head?.revision || 0) !== req.body.expectedRevision) throw new PlanError('PLAN_REVISION_CONFLICT',409);
  const before = head && await getPlanSnapshot(head.tier,undefined,true);
  let target=req.body?.config;
  if(req.body.action==='ROLLBACK'){if(!head || head.revision<2)throw new PlanError('PLAN_ROLLBACK_UNAVAILABLE',409);target=(await PlanRevision.findOne({planId:head._id,revision:head.revision-1}))!.config;}
  if(req.body.action==='ARCHIVE'){if(!before)throw new PlanError('PLAN_NOT_FOUND',404);target=structuredClone(before.config);target.overview.active=false;}
  const config = validatePlan(target,String(req.params.tier));
  const diff = planDiff(before?.config,config);
  return res.json({ success:true, data:{ diff, restrictive:diff.some(d=>d.restrictive), revision:head?.revision || 0 } });
}));
router.put('/:tier', csrfProtection, requirePermission('plans.update'), auditAdminAction('UPDATE_PLAN', req => ({ type: 'Plan', id: req.params.tier })), route(async (req,res) => res.json({ success:true, data:await savePlan(String(req.params.tier),req.body?.config,req.body?.expectedRevision,(req as any).admin._id,req.body?.reason,req.body?.confirmed === true) })));
router.post('/:tier/rollback', csrfProtection, requirePermission('plans.update'), auditAdminAction('ROLLBACK_PLAN', req => ({ type: 'Plan', id: req.params.tier })), route(async (req,res) => {
  const head = await Plan.findOne({ tier:req.params.tier });
  if (!head || head.revision < 2) throw new PlanError('PLAN_ROLLBACK_UNAVAILABLE',409);
  if (req.body?.expectedRevision !== head.revision) throw new PlanError('PLAN_REVISION_CONFLICT',409);
  const previous = await PlanRevision.findOne({ planId:head._id,revision:head.revision-1 });
  return res.json({ success:true,data:await savePlan(head.tier,previous!.config,head.revision,(req as any).admin._id,req.body?.reason,req.body?.confirmed === true,'ROLLBACK') });
}));
router.post('/:tier/archive', csrfProtection, requirePermission('plans.update'), auditAdminAction('ARCHIVE_PLAN', req => ({ type: 'Plan', id: req.params.tier })), route(async (req,res) => {
  const snapshot = await getPlanSnapshot(String(req.params.tier),undefined,true);
  snapshot.config.overview.active = false;
  return res.json({ success:true,data:await savePlan(snapshot.tier,snapshot.config,req.body?.expectedRevision,(req as any).admin._id,req.body?.reason,req.body?.confirmed === true,'ARCHIVE') });
}));
export default router;

import {Router} from 'express';
import mongoose from 'mongoose';
import {requireAdminAuth,requirePermission} from '../middlewares/adminAuthMiddleware';
import {csrfProtection} from '../middlewares/csrfMiddleware';
import {Voice} from '../models/Voice';
import {Plan} from '../models/Plan';
import {AdminAuditLog} from '../models/AdminAuditLog';
import {adminVoiceView,AdminVoiceError} from '../services/AdminVoiceService';
import {readSystemVoicePreview} from '../controllers/VoicesController';
import {updateVoiceWithAvatar} from '../services/VoiceAvatarUpload';
import {ImageUploadError} from '../providers/CloudinaryImageProvider';
import {AudioError} from '../providers/AudioValidation';
import {AdminVoiceJob} from '../models/AdminVoiceJob';
import {adminVoiceCapabilities, adminJobView, createSystemVoice, enqueueVoicePreview, reorderSystemVoices} from '../services/AdminVoiceProvisioning';
const router=Router();router.use(requireAdminAuth,requirePermission('voices.read'));
const route=(fn:any)=>(req:any,res:any)=>Promise.resolve(fn(req,res)).catch((e:any)=>res.status(e instanceof AudioError?400:e instanceof AdminVoiceError||e instanceof ImageUploadError?e.status:500).json({success:false,error:{code:e instanceof AdminVoiceError||e instanceof ImageUploadError||e instanceof AudioError?e.code:'VOICE_MANAGEMENT_UNAVAILABLE'}}));
router.get('/capabilities',route(async(_req:any,res:any)=>res.json({success:true,data:adminVoiceCapabilities})));
router.get('/order',route(async(req:any,res:any)=>{const page=Number(req.query.page||1),limit=10;if(!Number.isSafeInteger(page)||page<1||page>10000)throw new AdminVoiceError('INVALID_INPUT');const filter={isSystem:true,status:{$ne:'DELETED'}};const [items,total]=await Promise.all([Voice.find(filter).sort({position:1,isDefault:-1,name:1,_id:1}).skip((page-1)*limit).limit(limit),Voice.countDocuments(filter)]);res.json({success:true,data:{items:items.map(adminVoiceView),total,page,limit}});}));
router.post('/order',csrfProtection,requirePermission('voices.revoke'),route(async(req:any,res:any)=>res.json({success:true,data:await reorderSystemVoices(req.admin._id,req.body)})));
router.post('/',csrfProtection,requirePermission('voices.revoke'),route(async(req:any,res:any)=>res.status(202).json({success:true,data:await createSystemVoice(req.admin._id,req.body,req.get('Idempotency-Key'))})));
router.get('/jobs/:id',route(async(req:any,res:any)=>{
 if(!mongoose.isObjectIdOrHexString(req.params.id))throw new AdminVoiceError('INVALID_ID');const job=await AdminVoiceJob.findById(req.params.id);if(!job)throw new AdminVoiceError('NOT_FOUND',404);
 res.json({success:true,data:adminJobView(job)});
}));
router.post('/:id/preview',csrfProtection,requirePermission('voices.revoke'),route(async(req:any,res:any)=>res.status(202).json({success:true,data:await enqueueVoicePreview(req.admin._id,req.params.id,req.body,req.get('Idempotency-Key'))})));
router.get('/',route(async(req:any,res:any)=>{
 const page=req.query.page===undefined?1:Number(req.query.page),size=10,filter:any={};if(!Number.isSafeInteger(page)||page<1||page>10000)throw new AdminVoiceError('INVALID_INPUT');
 if(req.query.type && !['ALL','SYSTEM','CLONE'].includes(req.query.type))throw new AdminVoiceError('INVALID_INPUT');
 if(req.query.type==='SYSTEM')filter.isSystem=true;if(req.query.type==='CLONE')filter.isSystem=false;
 if(req.query.status && req.query.status!=='ALL'){if(!['ACTIVE','PENDING','REVOKED','DELETED'].includes(req.query.status))throw new AdminVoiceError('INVALID_INPUT');filter.status=req.query.status;}
 if(req.query.search){const search=String(req.query.search).slice(0,100).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');filter.$or=[{name:{$regex:search,$options:'i'}},{tags:{$regex:search,$options:'i'}}];}
 const [rows,total,summary,plans]=await Promise.all([Voice.find(filter).sort({isSystem:-1,position:1,isDefault:-1,name:1,_id:1}).skip((page-1)*size).limit(size).lean(),Voice.countDocuments(filter),Voice.aggregate([{$group:{_id:{isSystem:'$isSystem',status:'$status'},count:{$sum:1}}}]),Plan.find({archived:false}).select('tier').lean()]);
 const role=req.admin.roleId;return res.json({success:true,data:{items:rows.map(adminVoiceView),total,page,pageSize:size,summary,tiers:plans.map(p=>p.tier),canManage:role.name==='OWNER'||role.permissions.includes('voices.revoke')}});
}));
router.get('/:id/history',route(async(req:any,res:any)=>{if(!mongoose.isObjectIdOrHexString(req.params.id))throw new AdminVoiceError('INVALID_ID');const page=Number(req.query.page||1),limit=10;if(!Number.isSafeInteger(page)||page<1||page>10000)throw new AdminVoiceError('INVALID_INPUT');const filter={resource:'Voice',resourceId:req.params.id};const [items,total]=await Promise.all([AdminAuditLog.find(filter).sort({createdAt:-1,_id:-1}).skip((page-1)*limit).limit(limit).select('action changes createdAt').lean(),AdminAuditLog.countDocuments(filter)]);res.json({success:true,data:{items,total,page,limit}});}));
router.get('/:id/details',route(async(req:any,res:any)=>{if(!mongoose.isObjectIdOrHexString(req.params.id))throw new AdminVoiceError('INVALID_ID');const voice=await Voice.findById(req.params.id);if(!voice)throw new AdminVoiceError('NOT_FOUND',404);res.json({success:true,data:adminVoiceView(voice)});}));
router.get('/:id/preview',route(async(req:any,res:any)=>{if(!mongoose.isObjectIdOrHexString(req.params.id))throw new AdminVoiceError('INVALID_ID');const v=await Voice.findById(req.params.id);if(!v||!v.isSystem||!v.preview)throw new AdminVoiceError('PREVIEW_NOT_FOUND',404);const audio=await readSystemVoicePreview(v);res.set({'Content-Type':'audio/wav','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}).send(audio);}));
router.patch('/:id',csrfProtection,requirePermission('voices.revoke'),route(async(req:any,res:any)=>res.json({success:true,data:await updateVoiceWithAvatar(req.params.id,req.body,(req as any).admin._id)})));
export default router;

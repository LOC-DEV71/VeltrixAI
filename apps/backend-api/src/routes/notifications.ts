import {Router} from 'express';
import mongoose from 'mongoose';
import {Notification} from '../models/Notification';
import {Session} from '../models/Session';
import {User} from '../models/User';
import {requireAuth} from '../middlewares/authMiddleware';
import {csrfProtection} from '../middlewares/csrfMiddleware';
const router=Router();router.use(requireAuth);
export async function notificationList(ownerId:unknown,page=1){const limit=10;const [items,unread,total]=await Promise.all([Notification.find({ownerId}).select('_id title message orderId readAt createdAt').sort({createdAt:-1,_id:-1}).skip((page-1)*limit).limit(limit).lean(),Notification.countDocuments({ownerId,readAt:{$exists:false}}),Notification.countDocuments({ownerId})]);return {items,unread,total,page,limit};}
router.get('/',async(req:any,res)=>{res.setHeader('Cache-Control','no-store');try{const page=Number(req.query.page||1);if(!Number.isSafeInteger(page)||page<1||page>10000)return res.status(400).json({success:false,error:{code:'INVALID_PAGINATION'}});res.json({success:true,data:await notificationList(req.user._id,page)});}catch{res.status(503).json({success:false,error:{code:'NOTIFICATIONS_UNAVAILABLE'}});}});
router.get('/stream',(req:any,res)=>{
 res.set({'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});res.flushHeaders();let closed=false,busy=false,last='';
 const send=async()=>{if(closed||busy)return;busy=true;try{
  const [session,user]=await Promise.all([Session.findById(req.session._id).select('expiresAt revokedAt').lean(),User.findById(req.user._id).select('status').lean()]);if(!session||session.revokedAt||session.expiresAt<=new Date()||user?.status!=='ACTIVE'){res.end();return;}
  const data=JSON.stringify(await notificationList(req.user._id));if(data!==last){last=data;res.write(`event: notifications\ndata: ${data}\n\n`);}else res.write(': heartbeat\n\n');
 }catch{res.end();}finally{busy=false;}};
 const timer=setInterval(send,2000);void send();res.on('close',()=>{closed=true;clearInterval(timer);});
});
router.post('/:id/read',csrfProtection,async(req:any,res)=>{if(req.params.id!=='all'&&!mongoose.isObjectIdOrHexString(req.params.id))return res.status(400).json({success:false,error:{code:'INVALID_ID'}});try{await Notification.updateMany({ownerId:req.user._id,...(req.params.id==='all'?{}:{_id:req.params.id}),readAt:{$exists:false}},{$set:{readAt:new Date()}});res.json({success:true,data:await notificationList(req.user._id)});}catch{res.status(503).json({success:false,error:{code:'NOTIFICATIONS_UNAVAILABLE'}});}});
export default router;

// Durable Mongo fallback; jobs survive restarts and run in configured priority order.
// BullMQ deployments can replace this adapter without changing admission/snapshot rules.
export const connection = null;
let busy=false;
const timer=process.env.NODE_ENV === 'test' ? null : setInterval(async()=>{
  if(busy)return;
  const mongoose=require('mongoose');if(mongoose.connection.readyState!==1)return;
  busy=true;
  try{const {Job}=require('../models/Job');const job=await Job.findOne({type:{$in:['AI_CONTENT','AI_SPLIT','AI_PROMPT_GEN']},$or:[{status:'QUEUED'},{status:'PROCESSING',leaseExpiresAt:{$lt:new Date()}}]}).sort({'payload.priority':1,createdAt:1});if(job)await require('./ContentWorker').processContentJob({data:{jobId:String(job._id)}});}catch{/* The worker persists a safe failure code and releases held credits. */}finally{busy=false;}
},1000);timer?.unref();
export const contentQueue={add:async(_name:string,data:any,_options:any)=>({id:data.jobId})} as any;

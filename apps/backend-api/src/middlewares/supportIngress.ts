import type {RequestHandler} from 'express';
import {createHash} from 'node:crypto';

// Cheap, bounded rejection before JSON parsing, authentication or database work.
// Shared account/IP limits in Mongo remain authoritative across replicas.
export function supportIngress():RequestHandler {
  const buckets=new Map<string,{count:number,expiresAt:number}>();
  let global={count:0,expiresAt:0};
  return (req,res,next)=>{
    const now=Date.now();
    if(global.expiresAt<=now){global={count:0,expiresAt:now+60000};for(const [key,row] of buckets)if(row.expiresAt<=now)buckets.delete(key);}
    const key=createHash('sha256').update(req.ip||req.socket.remoteAddress||'unknown').digest('hex');
    let row=buckets.get(key);
    if(!row||row.expiresAt<=now){if(!row&&buckets.size>=5000)return deny();row={count:0,expiresAt:now+60000};buckets.set(key,row);}
    if(global.count>=600||row.count>=60)return deny();
    global.count++;row.count++;next();
    function deny(){res.setHeader('Retry-After','10');return res.status(429).json({success:false,error:{code:'SUPPORT_RATE_LIMITED',message:'Có quá nhiều yêu cầu. Vui lòng chờ rồi thử lại.'}});}
  };
}

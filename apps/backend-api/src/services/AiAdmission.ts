import mongoose from 'mongoose';
import {Job} from '../models/Job';
import {PlanUsage} from '../models/Plan';
import {AI_LIMITS,AiProviderError,getAiConfiguration} from '../providers/AiProvider';
const queueOwner=new mongoose.Types.ObjectId('0000000000000000000000a1');
// Shared Mongo fence bounds local pending jobs across API replicas.
export async function reserveAiQueueSlot(session:mongoose.ClientSession){const config=getAiConfiguration();if(config.kind==='local'){await PlanUsage.findOneAndUpdate({ownerId:queueOwner,period:'local-ai-admission'},{$inc:{fence:1},$setOnInsert:{counts:{}}},{upsert:true,session});if(await Job.countDocuments({type:{$in:['AI_CONTENT','AI_SPLIT','AI_PROMPT_GEN']},status:{$in:['QUEUED','PROCESSING']}}).session(session)>=AI_LIMITS.queuedJobs)throw new AiProviderError('CONTENT_QUEUE_FULL',429);}return {kind:config.kind,model:config.model};}

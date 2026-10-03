import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { Content } from '../models/Content';
import { Project } from '../models/Project';
import { Workspace } from '../models/Workspace';
import { ContentRevision } from '../models/Plan';
import { generateContent } from './ContentController';
import { forOwner, enabled } from '../services/EntitlementService';
import { PlanError } from '../services/PlanService';
async function owned(req:Request) {
  if(typeof req.params.id!=='string'||!mongoose.isObjectIdOrHexString(req.params.id))throw new PlanError('INVALID_INPUT');
  const content=await Content.findById(req.params.id);const project=content&&await Project.findById(content.projectId);
  if(!content||!project||!await Workspace.exists({_id:project.workspaceId,ownerId:(req as any).user._id}))throw new PlanError('NOT_FOUND',404);
  return content;
}
export const operation=(kind:'AI_SPLIT'|'AI_PROMPT_GEN')=>async(req:Request,res:Response)=>{
  try{
    const content=await owned(req);const snapshot=await forOwner((req as any).user._id);
    enabled(kind==='AI_SPLIT'?snapshot.config.scenes.enabled:snapshot.config.prompts.imageEnabled||snapshot.config.prompts.videoEnabled,'CONTENT_FEATURE_DISABLED');
    let topic=content.rawText;try{const scenes=JSON.parse(topic);if(Array.isArray(scenes))topic=scenes.map(s=>s.narration).join('\n');}catch{}
    if(!topic.trim())throw new PlanError('CONTENT_INPUT_LIMIT_EXCEEDED');
    (req as any).aiOperation=kind;
    req.body={...content.generationSettings,...req.body,topic,platform:content.generationSettings?.platform || 'tiktok',audience:content.generationSettings?.audience || '',tone:content.generationSettings?.tone || 'pro'};
    return generateContent(req,res);
  }catch(error){return res.status(error instanceof PlanError?error.status:500).json({success:false,error:{code:error instanceof PlanError?error.code:'CONTENT_OPERATION_FAILED'}});}
};
export async function revisions(req:Request,res:Response){
  try{const content=await owned(req);const page=Number(req.query.page||1),limit=10;if(!Number.isSafeInteger(page)||page<1||page>10000)throw new PlanError('INVALID_PAGINATION',400);const filter={contentId:content._id};const [items,total]=await Promise.all([ContentRevision.find(filter).sort({revision:-1}).skip((page-1)*limit).limit(limit).select('revision rawText scenes createdAt'),ContentRevision.countDocuments(filter)]);return res.json({success:true,data:items,meta:{page,limit,total}});}
  catch(error){return res.status(error instanceof PlanError?error.status:500).json({success:false,error:{code:error instanceof PlanError?error.code:'CONTENT_HISTORY_UNAVAILABLE'}});}
}

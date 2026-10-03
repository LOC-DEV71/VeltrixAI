import {Request,Response} from 'express';
import {AiProviderError} from '../providers/AiProvider';
import {PlanError} from '../services/PlanService';
import {saveAiImage,deleteAiImage} from '../services/AiImageAssets';
function failure(res:Response,error:unknown){return res.status(error instanceof AiProviderError||error instanceof PlanError?error.status:500).json({success:false,error:{code:error instanceof AiProviderError||error instanceof PlanError?error.code:'CONTENT_IMAGE_STORAGE_UNAVAILABLE'}});}
export async function uploadContentImage(req:Request,res:Response){try{if(req.body.url!==undefined||req.body.path!==undefined)throw new AiProviderError('CONTENT_IMAGE_INVALID',400);return res.status(201).json({success:true,data:await saveAiImage((req as any).user._id,String(req.params.id),req.body.imageBase64)});}catch(error){return failure(res,error);}}
export async function removeContentImage(req:Request,res:Response){try{await deleteAiImage((req as any).user._id,String(req.params.id),req.params.imageId);return res.json({success:true});}catch(error){return failure(res,error);}}

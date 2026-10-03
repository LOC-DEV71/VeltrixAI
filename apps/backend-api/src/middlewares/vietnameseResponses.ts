import { Request, Response, NextFunction } from 'express';
import { errorMessage } from '../utils/userMessages';
// Localize every API error while preserving stable machine-readable codes.
export function vietnameseResponses(_req: Request,res: Response,next: NextFunction) {
  const json=res.json.bind(res);
  res.json=(body: any)=>{
    if(body?.success===false && body.error) body={...body,error:{...body.error,message:res.statusCode < 500 && typeof body.error.message === 'string' && /[À-ỹ]/u.test(body.error.message) ? body.error.message : errorMessage({code:body.error.code},res.statusCode)}};
    return json(body);
  };
  next();
}


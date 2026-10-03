import {Request, Response, NextFunction} from 'express';
import {DeveloperToken, DeveloperRateUsage} from '../models/DeveloperToken';
import {tokenDigest, DeveloperError} from '../services/DeveloperTokens';
import {User} from '../models/User';
import {forOwner} from '../services/EntitlementService';
import {DeveloperRequest} from '../models/DeveloperRequest';
import {SystemSettings} from '../models/SystemSettings';

export const requireDeveloperToken = (scope: string) => async (req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const match = /^Bearer (vtx_[a-f0-9]{24}_[A-Za-z0-9_-]{43})$/.exec(req.get('Authorization') || '');
    if (!match) throw new DeveloperError('API_TOKEN_INVALID', 401);
    const token = await DeveloperToken.findOne({tokenHash: tokenDigest(match[1]), revokedAt: {$exists: false}, expiresAt: {$gt: new Date()}});
    if (!token) throw new DeveloperError('API_TOKEN_INVALID', 401);
    if (!token.scopes.includes(scope)) throw new DeveloperError('API_SCOPE_REQUIRED', 403);
    const user = await User.findById(token.ownerId);
    if (!user || user.status !== 'ACTIVE') throw new DeveloperError('API_ACCOUNT_UNAVAILABLE', 403);
    if(user.developerApiDisabled)throw new DeveloperError('API_ACCESS_SUSPENDED',403);
    const start=Date.now();
    const settings=await SystemSettings.findOne({key:'ADMIN_OPERATIONS'}).lean();
    const retention=(settings as any)?.value?.requestRetentionDays||90;
    res.once('finish',()=>{void DeveloperRequest.create({ownerId:user._id,tokenId:token._id,method:req.method,endpoint:req.route?.path||'/v1',status:res.statusCode,durationMs:Date.now()-start,jobId:res.locals.developerJobId,characters:req.method==='POST'&&typeof req.body?.text==='string'?[...req.body.text.trim()].length:0,expiresAt:new Date(Date.now()+retention*86400000)}).catch(()=>{});});
    const snapshot = await forOwner(user._id), rate = snapshot.config.limits.requestsPerMinute;
    if (rate !== null) {
      const minute = new Date().toISOString().slice(0, 16), filter = {ownerId: user._id, minute};
      const update = {$inc: {count: 1}, $setOnInsert: {expiresAt: new Date(Date.now() + 120000)}};
      let usage: any;
      try {usage = await DeveloperRateUsage.findOneAndUpdate(filter, update, {upsert: true, new: true});}
      catch (error: any) {if (error.code !== 11000) throw error; usage = await DeveloperRateUsage.findOneAndUpdate(filter, update, {new: true});}
      res.setHeader('X-RateLimit-Limit', rate); res.setHeader('X-RateLimit-Remaining', Math.max(0, rate - usage.count));
      if (usage.count > rate) {res.setHeader('Retry-After', Math.ceil((60000 - Date.now() % 60000) / 1000)); throw new DeveloperError('API_RATE_LIMIT_EXCEEDED', 429);}
    }
    await DeveloperToken.updateOne({_id: token._id, $or: [{lastUsedAt: {$exists: false}}, {lastUsedAt: {$lt: new Date(Date.now() - 60000)}}]}, {$set: {lastUsedAt: new Date()}});
    (req as any).user = user; (req as any).developerPlan = snapshot; (req as any).developerToken = token._id;
    next();
  } catch (error) {
    const code = error instanceof DeveloperError ? error.code : 'API_UNAVAILABLE';
    res.status(error instanceof DeveloperError ? error.status : 503).json({success: false, error: {code, message: code === 'API_RATE_LIMIT_EXCEEDED' ? 'Đã vượt giới hạn gọi API. Thử lại sau.' : 'Token không hợp lệ, thiếu quyền hoặc API chưa sẵn sàng.'}});
  }
};

import { Request, Response } from 'express';
import { User } from '../models/User';
import { Wallet, CreditLot, CreditLedger } from '../models/Credits';
import { AdminAuditLog } from '../models/AdminAuditLog';
import { randomUUID, createHash } from 'node:crypto';
import { Workspace } from '../models/Workspace';
import { Job } from '../models/Job';
import mongoose from 'mongoose';
import { parsePlanPeriod, planPeriodView } from '../services/PlanPeriod';
import { AccountError } from '../services/UserAccount';
import {subscriptions as ownedSubscriptions} from '../services/BillingService';

export const getUsers = async (req: Request, res: Response) => {
  try {
    const page = Number(req.query.page || 1);
    const limit = 10;
    if (!Number.isSafeInteger(page) || page < 1 || page > 10000) return res.status(400).json({ success: false, error: { code: 'INVALID_PAGINATION', message: 'Trang không hợp lệ' } });
    const search = req.query.search as string || '';
    const status = req.query.status as string;

    const query: any = {};
    if (search) {
      query.$or = [
        { email: { $regex: search, $options: 'i' } },
        { displayName: { $regex: search, $options: 'i' } }
      ];
    }
    if (status) {
      query.status = status;
    }

    const total = await User.countDocuments(query);
    const users = await User.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    // Fetch wallets for these users
    const userIds = users.map(u => u._id);
    const wallets = await Wallet.find({ userId: { $in: userIds } }).lean();

    const data = users.map(user => {
      const userWallets = wallets.filter(w => w.userId.toString() === user._id.toString());
      const totalCredits = userWallets.reduce((sum, w) => sum + (w.available || 0), 0);

      return {
        _id: user._id,
        email: user.email,
        displayName: user.displayName,
        status: user.status,
        createdAt: user.createdAt,
        avatar: user.avatarAssetId,
        plan: user.plan || 'FREE',
        credits: totalCredits
      };
    });

    res.json({ success: true, data: { users: data, total, page, limit } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: error.message } });
  }
};

export const getUserDetails = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!mongoose.isObjectIdOrHexString(id)) return res.status(400).json({ success: false, error: { code: 'INVALID_ID' } });

    const user = await User.findById(id).select('email displayName status createdAt updatedAt avatarAssetId plan planPeriod billingOrderId controlRevision developerApiDisabled').lean();
    if (!user) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });

    const wallets = await Wallet.find({ userId: id }).lean();
    const workspaces = await Workspace.find({ ownerId: id }).sort({createdAt:-1,_id:-1}).limit(10).lean();
    const workspaceTotal=await Workspace.countDocuments({ownerId:id});
    const recentJobs = await Job.find({ ownerId: id }).select('type status payload.cost createdAt updatedAt').sort({ createdAt: -1 }).limit(10).lean();

    const period = planPeriodView(user);
    const subscriptions: any[] = period ? [{
      _id: 'active-sub',
      tier: user.plan || 'FREE',
      ...period,
      provider: user.billingOrderId ? 'VNPAY' : 'ADMIN'
    }] : [];
    const purchased=await ownedSubscriptions(id,req.query);
    if(purchased.total>0){subscriptions.splice(0,subscriptions.length,...purchased.items.map((o:any)=>({_id:String(o._id),tier:o.name||o.tier,status:o.active?'ACTIVE':'EXPIRED',provider:'VNPAY',billingCycle:o.billingCycle==='yearly'?'YEARLY':'MONTHLY',startsAt:o.startsAt,endsAt:o.endsAt,selected:String(o._id)===purchased.selectedId})));}

    res.json({
      success: true,
      data: {
        user,
        subscriptions,
        subscriptionsMeta:{page:purchased.page,total:purchased.total,limit:10},
        wallets,
        workspaces,
        workspacesMeta:{total:workspaceTotal,page:1,limit:10},
        recentJobs
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: error.message } });
  }
};

export const updateUserStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    if (!['ACTIVE', 'BANNED'].includes(status)) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_STATUS' } });
    }

      if(!mongoose.isObjectIdOrHexString(id))return res.status(400).json({success:false,error:{code:'INVALID_ID'}});
      if(req.body.confirmed!==true||typeof req.body.reason!=='string'||req.body.reason.trim().length<5||req.body.reason.length>1000)return res.status(400).json({success:false,error:{code:'ADMIN_CONFIRMATION_REQUIRED'}});
      if(!Number.isSafeInteger(req.body.expectedRevision)||req.body.expectedRevision<0)return res.status(400).json({success:false,error:{code:'ADMIN_INVALID_INPUT'}});
      const session=await mongoose.startSession();
      try {
        const result=await session.withTransaction(async()=>{
          const user=await User.findById(id).session(session);if(!user)throw Object.assign(new Error(),{code:'NOT_FOUND',status:404});
          if((user.controlRevision||0)!==req.body.expectedRevision)throw Object.assign(new Error(),{code:'ADMIN_REVISION_CONFLICT',status:409});
          const before=user.status;user.status=status;user.controlRevision=(user.controlRevision||0)+1;await user.save({session});
          await AdminAuditLog.create([{adminId:(req as any).admin._id,action:'USER_STATUS_CHANGED',resource:'User',resourceId:String(user._id),changes:{before,after:status,reason:req.body.reason.trim(),revision:user.controlRevision}}],{session});
          return {id:user._id,status:user.status,controlRevision:user.controlRevision};
        });
        res.json({success:true,data:result});
      } finally {await session.endSession();}
  } catch (error: any) {
      res.status(error.status||500).json({ success: false, error: { code: error.status?error.code:'INTERNAL_SERVER_ERROR' } });
  }
};

export const updateUserPlan = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { tier } = req.body;

    if (!['FREE', 'BASIC_STUDENT', 'PLUS', 'PRO'].includes(tier)) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_TIER' } });
    }

    if (!mongoose.isObjectIdOrHexString(id)) return res.status(400).json({success:false,error:{code:'INVALID_ID'}});
    const explicitPeriod = Object.prototype.hasOwnProperty.call(req.body,'planPeriod');
    const period = explicitPeriod ? parsePlanPeriod(req.body.planPeriod,tier) : null;
    const session = await mongoose.startSession();
    try { await session.withTransaction(async()=>{
      const user = await User.findById(id).session(session);
      if (!user) throw new AccountError('NOT_FOUND',404);
      const before = {tier:user.plan,planPeriod:user.planPeriod ? {billingCycle:user.planPeriod.billingCycle,startsAt:user.planPeriod.startsAt,endsAt:user.planPeriod.endsAt} : null};
      // A manual tier change without dates must not inherit another plan's period.
      if (tier === 'FREE' || explicitPeriod || user.plan !== tier) user.set('planPeriod',period || undefined);
      if(explicitPeriod || user.plan !== tier || tier==='FREE')user.set('billingOrderId',undefined);
      user.plan=tier; await user.save({session});
      await AdminAuditLog.create([{adminId:(req as any).admin._id,action:'USER_PLAN_UPDATED',resource:'USER',resourceId:String(id),changes:{before,after:{tier:user.plan,planPeriod:user.planPeriod || null}}}],{session});
    }); } finally { await session.endSession(); }

    res.json({ success: true, message: 'Đã cập nhật gói tài khoản.' });
  } catch (error: any) {
    res.status(error instanceof AccountError ? error.status : 500).json({ success: false, error: { code: error instanceof AccountError ? error.code : 'INTERNAL_SERVER_ERROR' } });
  }
};

export const grantCredits = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { amount, reason } = req.body;
    
    if (!Number.isSafeInteger(amount) || amount <= 0 || typeof reason !== 'string' || reason.trim().length < 5 || reason.length > 1000) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_AMOUNT' } });
    }

    if (!mongoose.isObjectIdOrHexString(id)) return res.status(400).json({success:false,error:{code:'INVALID_ID'}});
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });

    const rawKey=req.get('Idempotency-Key') || randomUUID();
    if(!/^[A-Za-z0-9_.-]{8,128}$/.test(rawKey)) return res.status(400).json({success:false,error:{code:'INVALID_INPUT'}});
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        let wallet = await Wallet.findOne({ userId: id, bucket: 'PAID' }).session(session);
        if (!wallet) {
          [wallet] = await Wallet.create([{ userId: id, bucket: 'PAID', available: 0, reserved: 0 }], { session });
        }
        
        const referenceId='admin_grant_'+createHash('sha256').update(String((req as any).admin._id)+':'+id+':'+rawKey).digest('hex');
        const previous=await CreditLedger.findOne({walletId:wallet._id,transactionType:'GRANT',referenceId}).session(session);
        if(previous) { if(previous.deltaAvailable!==amount) throw new Error('IDEMPOTENCY_CONFLICT');return; }
        await CreditLot.create([{walletId:wallet._id,amount,available:amount,source:'ADMIN',expiresAt:new Date('9999-12-31T00:00:00Z')}],{session});
        await CreditLedger.create([{walletId:wallet._id,transactionType:'GRANT',deltaAvailable:amount,deltaReserved:0,referenceId}],{session});
        await AdminAuditLog.create([{adminId:(req as any).admin._id,action:'CREDIT_GRANT',resource:'USER',resourceId:String(id),changes:{amount,reason:reason.trim(),referenceId}}],{session});
        wallet.available += amount;
        await wallet.save({ session });
      });
    } finally {
      await session.endSession();
    }

    res.json({ success: true, message: 'Đã cộng credit vào tài khoản.' });
  } catch (error: any) {
    if(error.message==='IDEMPOTENCY_CONFLICT') return res.status(409).json({success:false,error:{code:error.message}});
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: error.message } });
  }
};


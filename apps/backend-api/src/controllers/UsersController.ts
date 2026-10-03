import { Request, Response } from 'express';
import { Wallet } from '../models/Credits';
import { accountFields, updateAccount, AccountError } from '../services/UserAccount';
import { planPeriodView } from '../services/PlanPeriod';
import {forOwner} from '../services/EntitlementService';
import {User} from '../models/User';

export const getMe = async (req: Request, res: Response) => {
  try {
    let user = (req as any).user;
    const effectivePlan=user.billingOrderId?(await forOwner(user._id)).tier:user.plan;
    if(user.billingOrderId)user=await User.findById(user._id);

    // Query both wallets in parallel
    const [freeWallet, paidWallet] = await Promise.all([
      Wallet.findOne({ userId: user._id, bucket: 'FREE' }),
      Wallet.findOne({ userId: user._id, bucket: 'PAID' }),
    ]);

    const credits = {
      free: {
        available: freeWallet?.available ?? 0,
        reserved: freeWallet?.reserved ?? 0,
      },
      paid: {
        available: paidWallet?.available ?? 0,
        reserved: paidWallet?.reserved ?? 0,
      },
      total: (freeWallet?.available ?? 0) + (paidWallet?.available ?? 0),
    };

    res.json({
      success: true,
      data: {
        id: user._id,
        email: user.email,
        displayName: user.displayName,
        plan: effectivePlan,
        subscriptionPeriod: planPeriodView(user),
        createdAt: user.createdAt,
        ...accountFields(user),
        avatarAssetId: user.avatarAssetId ?? null,
        roles: user.roles,
        status: user.status,
        credits,
      },
    });
  } catch (error) {
    console.error('[GET /users/me Error]', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: 'Server error' } });
  }
};

export const patchMe = async (req: Request, res: Response) => {
  try { return res.json({success:true,data:await updateAccount((req as any).user._id,req.body)}); }
  catch (error) { return res.status(error instanceof AccountError ? error.status : 500).json({success:false,error:{code:error instanceof AccountError ? error.code : 'INTERNAL_SERVER_ERROR',message:'Không lưu được tài khoản. Vui lòng kiểm tra dữ liệu và thử lại.'}}); }
};

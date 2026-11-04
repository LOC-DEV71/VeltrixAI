import {forOwner} from './EntitlementService';
import mongoose from 'mongoose';
import { DeviceGrantCounter, FreeGrant, Wallet, CreditLot, CreditReservation, CreditLedger } from '../models/Credits';
import { SystemSettings } from '../models/SystemSettings';

export class CreditService {
  // Reserve once across eligible lots. Admin gifts remain usable on every plan;
  // paidAllowed controls purchased credits, not administrative grants.
  static async reserveUsable(userId: mongoose.Types.ObjectId, amount: number, jobId: mongoose.Types.ObjectId, paidAllowed: boolean, externalSession?: mongoose.ClientSession) {
    return this.transaction(externalSession, async session => {
      if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('INVALID_CREDIT_AMOUNT');
      const existing = await CreditReservation.findOne({ jobId }).session(session);
      if (existing) {
        if (existing.status !== 'HELD') throw new Error('RESERVATION_ALREADY_FINALIZED');
        const wallets = await Wallet.find({ userId }).session(session);
        if (existing.allocations.some(a => !wallets.some(w => w._id.equals(a.walletId))) || existing.allocations.reduce((n,a)=>n+a.amount,0) !== amount) throw new Error('RESERVATION_CONFLICT');
        return existing;
      }
      const wallets = await Wallet.find({ userId }).session(session);
      const lots = await CreditLot.find({ walletId: { $in: wallets.map(w=>w._id) }, refundBlocked:{$ne:true}, available: { $gt: 0 }, expiresAt: { $gt: new Date() } }).sort({ expiresAt: 1, _id: 1 }).session(session);
      const eligible = lots.filter(l => { const wallet=wallets.find(w=>w._id.equals(l.walletId)); return wallet?.bucket === 'FREE' || paidAllowed || l.source === 'ADMIN'; });
      const budgets = new Map(wallets.map(w=>[w._id.toString(), Math.max(0,w.available)]));
      const allocations: { lotId: mongoose.Types.ObjectId; walletId: mongoose.Types.ObjectId; amount: number }[] = [];
      let remaining = amount;
      for (const lot of eligible) {
        const key=lot.walletId.toString(), take=Math.min(remaining,lot.available,budgets.get(key)||0);
        if (take > 0) { allocations.push({lotId:lot._id as mongoose.Types.ObjectId,walletId:lot.walletId,amount:take});budgets.set(key,(budgets.get(key)||0)-take);remaining-=take; }
        if (remaining===0) break;
      }
      // No mutation before confirming the full amount is available.
      if (remaining>0) throw new Error('INSUFFICIENT_CREDITS');
      for (const allocation of allocations) await CreditLot.updateOne({_id:allocation.lotId},{$inc:{available:-allocation.amount}},{session});
      const [reservation]=await CreditReservation.create([{jobId,allocations,status:'HELD'}],{session});
      for (const wallet of wallets) {
        const held=allocations.filter(a=>a.walletId.equals(wallet._id)).reduce((n,a)=>n+a.amount,0);
        if (!held) continue;
        await Wallet.updateOne({_id:wallet._id},{$inc:{available:-held,reserved:held}},{session});
        await CreditLedger.create([{walletId:wallet._id,transactionType:'RESERVE',deltaAvailable:-held,deltaReserved:held,referenceId:`reserve_${jobId}`}],{session});
      }
      return reservation;
    });
  }
  private static async transaction<T>(external: mongoose.ClientSession | undefined, operation: (session: mongoose.ClientSession) => Promise<T>): Promise<T> {
    if (external) return operation(external);
    const session = await mongoose.startSession();
    try {
      const result = await session.withTransaction(() => operation(session));
      return result as T;
    } finally { await session.endSession(); }
  }
  static async getFreeGrantAmount(): Promise<number> {
    const setting = await SystemSettings.findOne({ key: 'FREE_GRANT_AMOUNT' });
    if (setting) {
      return Number(setting.value);
    }
    // Default fallback, and initialize it
    await SystemSettings.create({ key: 'FREE_GRANT_AMOUNT', value: 2000 }).catch(() => {});
    return 2000;
  }

  static async grantFreeCredits(userId: mongoose.Types.ObjectId, deviceId: string, grantMonth: string) {
    const snapshot=await forOwner(userId);
    const amount=snapshot.config.credits.monthlyGrant;
    if(amount===0)return null;
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      // 1. Check Device Grant Counter
      const counter = await DeviceGrantCounter.findOneAndUpdate(
        { deviceId, grantMonth },
        { $setOnInsert: { deviceId, grantMonth, count: 0 } },
        { upsert: true, new: true, session }
      );

      if (counter.count >= 3) {
        throw new Error('DEVICE_LIMIT_REACHED');
      }

      // 2. Check User Grant
      const existingGrant = await FreeGrant.findOne({ userId, grantMonth }).session(session);
      if (existingGrant) {
        throw new Error('USER_ALREADY_GRANTED');
      }

      // 3. Grant
      await FreeGrant.create([{ userId, deviceId, grantMonth }], { session });
      await DeviceGrantCounter.updateOne({ _id: counter._id }, { $inc: { count: 1 } }, { session });

      let wallet = await Wallet.findOne({ userId, bucket: 'FREE' }).session(session);
      if (!wallet) {
        wallet = await Wallet.create([{ userId, bucket: 'FREE', available: 0, reserved: 0 }], { session }).then(w => w[0]);
      }

      if (!wallet) {
        throw new Error('Wallet not found or created');
      }

      // Only versioned future grants participate in rollover; legacy lots are preserved.
      const oldLots=await CreditLot.find({walletId:wallet._id,available:{$gt:0},grantSnapshot:{$exists:true},createdAt:{$lt:new Date(grantMonth+'-01T00:00:00.000Z')}}).sort({createdAt:-1}).session(session);
      const carried=new Map<string,number>();let expired=0;
      for(const old of oldLots){const config=old.grantSnapshot.config.credits;const key=old.grantSnapshot.planId+':'+old.grantSnapshot.revision;const already=carried.get(key)||0;const keep=!config.rolloverAllowed?0:config.maxRollover===null?old.available:Math.min(old.available,Math.max(0,config.maxRollover-already));carried.set(key,already+keep);expired+=old.available-keep;old.available=keep;await old.save({session});}
      if(expired){await Wallet.updateOne({_id:wallet._id},{$inc:{available:-expired}},{session});await CreditLedger.create([{walletId:wallet._id,transactionType:'EXPIRE',deltaAvailable:-expired,deltaReserved:0,referenceId:`rollover_${grantMonth}_${userId}`}],{session});}
      const days=snapshot.config.credits.expiresAfterDays;
      const expiresAt=days===null?new Date('9999-12-31T00:00:00.000Z'):new Date(Date.now()+days*86400000);

      const lot = await CreditLot.create([{
        walletId: wallet._id,
        amount,
        grantSnapshot:snapshot,
        available: amount,
        expiresAt
      }], { session }).then(l => l[0]);

      await Wallet.updateOne({ _id: wallet._id }, { $inc: { available: amount } }, { session });

      await CreditLedger.create([{
        walletId: wallet._id,
        transactionType: 'GRANT',
        deltaAvailable: amount,
        deltaReserved: 0,
        referenceId: `grant_${grantMonth}_${userId}`
      }], { session });

      await session.commitTransaction();
      return lot;
    } catch (e) {
      await session.abortTransaction();
      throw e;
    } finally {
      session.endSession();
    }
  }

  static async reserve(userId: mongoose.Types.ObjectId, bucket: 'FREE' | 'PAID', amount: number, jobId: mongoose.Types.ObjectId, externalSession?: mongoose.ClientSession) {
    return this.transaction(externalSession, async session => {
      if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('INVALID_CREDIT_AMOUNT');
      const existing = await CreditReservation.findOne({ jobId }).session(session);
      if (existing) {
        if (existing.status !== 'HELD') throw new Error('RESERVATION_ALREADY_FINALIZED');
        return existing;
      }
      const wallet = await Wallet.findOne({ userId, bucket }).session(session);
      if (!wallet || wallet.available < amount) {
        throw new Error('INSUFFICIENT_CREDITS');
      }

      const lots = await CreditLot.find({ walletId: wallet._id, refundBlocked:{$ne:true}, available: { $gt: 0 }, expiresAt: { $gt: new Date() } })
        .sort({ expiresAt: 1 })
        .session(session);

      let remaining = amount;
      const allocations = [];

      for (const lot of lots) {
        if (remaining <= 0) break;
        const take = Math.min(lot.available, remaining);
        lot.available -= take;
        await lot.save({ session });
        allocations.push({ lotId: lot._id, walletId: wallet._id, amount: take });
        remaining -= take;
      }

      if (remaining > 0) {
        throw new Error('INSUFFICIENT_CREDITS_IN_LOTS'); // Should theoretically not happen if wallet.available is in sync
      }

      const reservation = await CreditReservation.create([{
        jobId,
        allocations,
        status: 'HELD'
      }], { session }).then(r => r[0]);

      await Wallet.updateOne({ _id: wallet._id }, { $inc: { available: -amount, reserved: amount } }, { session });

      await CreditLedger.create([{
        walletId: wallet._id,
        transactionType: 'RESERVE',
        deltaAvailable: -amount,
        deltaReserved: amount,
        referenceId: `reserve_${jobId}`
      }], { session });

      return reservation;
    });
  }

  static async settle(jobId: mongoose.Types.ObjectId, finalCost: number, externalSession?: mongoose.ClientSession) {
    return this.transaction(externalSession, async session => {
      const reservation = await CreditReservation.findOne({ jobId }).session(session);
      if (!reservation) {
        throw new Error('RESERVATION_NOT_FOUND_OR_NOT_HELD');
      }
      if (reservation.status === 'SETTLED') return reservation;
      if (reservation.status !== 'HELD') throw new Error('RESERVATION_ALREADY_FINALIZED');
      if (!Number.isSafeInteger(finalCost) || finalCost < 0) throw new Error('INVALID_CREDIT_AMOUNT');

      reservation.status = 'SETTLED';
      await reservation.save({ session });

      const totalReserved = reservation.allocations.reduce((acc, alloc) => acc + alloc.amount, 0);
      const actualCost = Math.min(finalCost, totalReserved); // System eats overage
      const refund = totalReserved - actualCost;

      // Group refunds by wallet
      const walletRefunds = new Map<string, number>();
      const walletExpiredRefunds = new Map<string, number>();

      if (refund > 0) {
        let remainingRefund = refund;
        // Refund to lots (last reserved, first refunded)
        for (let i = reservation.allocations.length - 1; i >= 0; i--) {
          if (remainingRefund <= 0) break;
          const alloc = reservation.allocations[i];
          const refundToThisLot = Math.min(alloc.amount, remainingRefund);
          
          const lot = await CreditLot.findById(alloc.lotId).session(session);
          if (lot && lot.expiresAt > new Date()) {
            lot.available += refundToThisLot;
            await lot.save({ session });
            const wid = alloc.walletId.toString();
            walletRefunds.set(wid, (walletRefunds.get(wid) || 0) + refundToThisLot);
          } else {
             const wid = alloc.walletId.toString();
             walletExpiredRefunds.set(wid, (walletExpiredRefunds.get(wid) || 0) + refundToThisLot);
             // If lot expired, refund becomes EXPIRE. We do not increase lot available or wallet available.
             await CreditLedger.create([{
                walletId: alloc.walletId,
                transactionType: 'EXPIRE',
                deltaAvailable: 0, // It never goes to available
                deltaReserved: -refundToThisLot,
                referenceId: `expire_refund_${jobId}_${alloc.lotId}`
              }], { session });
          }
          remainingRefund -= refundToThisLot;
        }
      }

      // Update wallets
      const walletIds = Array.from(new Set(reservation.allocations.map(a => a.walletId.toString())));
      for (const wid of walletIds) {
        const totalAllocForWallet = reservation.allocations.filter(a => a.walletId.toString() === wid).reduce((acc, a) => acc + a.amount, 0);
        const refundForWallet = walletRefunds.get(wid) || 0;
        const expiredRefundForWallet = walletExpiredRefunds.get(wid) || 0;

        // Wallet available increases by refundForWallet.
        // Wallet reserved decreases by totalAllocForWallet.
        await Wallet.updateOne({ _id: wid }, { $inc: { available: refundForWallet, reserved: -totalAllocForWallet } }, { session });

        await CreditLedger.create([{
          walletId: wid,
          transactionType: 'SETTLE',
          deltaAvailable: refundForWallet, // Returning unused
          deltaReserved: -totalAllocForWallet + expiredRefundForWallet, // EXPIRE already records the expired portion
          referenceId: `settle_${jobId}`
        }], { session });
      }

      return reservation;
    });
  }

  static async release(jobId: mongoose.Types.ObjectId, externalSession?: mongoose.ClientSession) {
    return this.transaction(externalSession, async session => {
      const reservation = await CreditReservation.findOne({ jobId }).session(session);
      if (!reservation) {
        throw new Error('RESERVATION_NOT_FOUND_OR_NOT_HELD');
      }
      if (reservation.status === 'RELEASED') return reservation;
      if (reservation.status !== 'HELD') throw new Error('RESERVATION_ALREADY_FINALIZED');

      reservation.status = 'RELEASED';
      await reservation.save({ session });

      const walletRefunds = new Map<string, number>();
      const walletExpired = new Map<string, number>();
      const walletHolds = new Map<string, number>();

      for (const alloc of reservation.allocations) {
        const lot = await CreditLot.findById(alloc.lotId).session(session);
        const wid = alloc.walletId.toString();
        walletHolds.set(wid, (walletHolds.get(wid) || 0) + alloc.amount);

        if (lot && lot.expiresAt > new Date()) {
          lot.available += alloc.amount;
          await lot.save({ session });
          walletRefunds.set(wid, (walletRefunds.get(wid) || 0) + alloc.amount);
        } else {
          walletExpired.set(wid, (walletExpired.get(wid) || 0) + alloc.amount);
          await CreditLedger.create([{
            walletId: alloc.walletId,
            transactionType: 'EXPIRE',
            deltaAvailable: 0,
            deltaReserved: -alloc.amount,
            referenceId: `expire_release_${jobId}_${alloc.lotId}`
          }], { session });
        }
      }

      for (const [wid, held] of walletHolds.entries()) {
        const refunded = walletRefunds.get(wid) || 0;
        await Wallet.updateOne({ _id: wid }, { $inc: { available: refunded, reserved: -held } }, { session });
        
        await CreditLedger.create([{
          walletId: wid,
          transactionType: 'RELEASE',
          deltaAvailable: refunded,
          deltaReserved: -held + (walletExpired.get(wid) || 0),
          referenceId: `release_${jobId}`
        }], { session });
      }

      return reservation;
    });
  }

}

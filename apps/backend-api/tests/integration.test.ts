import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { CreditService } from '../src/services/CreditService';
import { JobService } from '../src/services/JobService';
import { Wallet, CreditLot, CreditReservation, CreditLedger, DeviceGrantCounter, FreeGrant } from '../src/models/Credits';
import { Job } from '../src/models/Job';
import { User } from '../src/models/User';

let replSet: MongoMemoryReplSet;

beforeAll(async () => {
  // Start a Replica Set to enable transactions
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = replSet.getUri();
  await mongoose.connect(uri);
});

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});

beforeEach(async () => {
  // Clear collections
  await Promise.all(Object.values(mongoose.connection.collections).map(c => c.deleteMany({})));
});

describe('AG-005 Integration Tests', () => {

  it('(1) Cấp Free Grant vượt quá 3 thiết bị -> từ chối', async () => {
    const deviceId = 'device-123';
    const grantMonth = '2026-10';
    const amount = 100;

    // Grant 3 times to 3 different users
    for (let i = 0; i < 3; i++) {
      const user = await User.create({ email: `test${i}@test.com`, displayName: `Test ${i}` });
      await CreditService.grantFreeCredits(user._id as mongoose.Types.ObjectId, deviceId, grantMonth, amount);
    }

    const user4 = await User.create({ email: 'test4@test.com', displayName: 'Test 4' });
    
    // 4th grant should fail
    await expect(
      CreditService.grantFreeCredits(user4._id as mongoose.Types.ObjectId, deviceId, grantMonth, amount)
    ).rejects.toThrow('DEVICE_LIMIT_REACHED');

    // Verify counter is exactly 3
    const counter = await DeviceGrantCounter.findOne({ deviceId, grantMonth });
    expect(counter?.count).toBe(3);
  });

  it('(2) Settle/Release credit lot quá hạn -> EXPIRE', async () => {
    const user = await User.create({ email: 'lot-test@test.com', displayName: 'Lot Test' });
    const amount = 50;

    // Manually create wallet and an almost expired lot
    const wallet = await Wallet.create({ userId: user._id, bucket: 'PAID', available: amount, reserved: 0 });
    const expiresAt = new Date(Date.now() + 1000); // Expires in 1s
    const lot = await CreditLot.create({ walletId: wallet._id, amount, available: amount, expiresAt });

    const job = await Job.create({
      ownerId: user._id,
      type: 'TTS',
      status: 'QUEUED',
      idempotencyKey: 'job-1'
    });

    // Reserve 20 credits
    const reservation = await CreditService.reserve(user._id as mongoose.Types.ObjectId, 'PAID', 20, job._id as mongoose.Types.ObjectId);
    expect(reservation.allocations.length).toBe(1);
    
    // Link reservation to Job
    job.reservationId = reservation._id as mongoose.Types.ObjectId;
    await job.save();

    // Check Wallet state
    let w = await Wallet.findById(wallet._id);
    expect(w?.available).toBe(30);
    expect(w?.reserved).toBe(20);

    // Force lot to expire in DB by shifting expiresAt back
    lot.expiresAt = new Date(Date.now() - 5000); // 5s ago
    await lot.save();

    // Now Settle the job with a cost of 10. The refund is 10.
    // Because the lot is expired, the refund of 10 should NOT go back to lot.available or wallet.available.
    // It should be recorded as EXPIRE ledger.
    const executionClaim = 'worker-1_12345';
    job.executionClaim = executionClaim;
    await job.save();

    await JobService.completeJob(job._id as mongoose.Types.ObjectId, executionClaim, { success: true }, 10);

    // Check Wallet again
    w = await Wallet.findById(wallet._id);
    expect(w?.reserved).toBe(0); // all reservations cleared
    expect(w?.available).toBe(30); // Available didn't increase back to 40 because lot expired!

    // Check ledgers
    const expireLedgers = await CreditLedger.find({ transactionType: 'EXPIRE' });
    expect(expireLedgers.length).toBe(1);
    expect(expireLedgers[0].deltaAvailable).toBe(0);
    expect(expireLedgers[0].deltaReserved).toBe(-10); // Refunded 10 from reserve directly to expire
  });

  it('(3) Concurrent worker tranh chấp cập nhật Job kết quả', async () => {
    const user = await User.create({ email: 'concurrent@test.com', displayName: 'Concurrent' });
    
    const job = await Job.create({
      ownerId: user._id,
      type: 'TTS',
      status: 'QUEUED',
      idempotencyKey: 'job-concurrent'
    });

    // Worker 1 claims
    const claimedJob1 = await JobService.claimJob(job._id as mongoose.Types.ObjectId, 'worker-1');
    expect(claimedJob1.executionClaim).toContain('worker-1');
    expect(claimedJob1.status).toBe('PROCESSING');

    // Worker 2 claims (e.g. Worker 1 timed out in queue)
    const claimedJob2 = await JobService.claimJob(job._id as mongoose.Types.ObjectId, 'worker-2');
    expect(claimedJob2.executionClaim).toContain('worker-2');
    
    // Worker 1 tries to complete the job
    await expect(
      JobService.completeJob(job._id as mongoose.Types.ObjectId, claimedJob1.executionClaim!, { audioUrl: 'w1' }, 0)
    ).rejects.toThrow('WORKER_CLAIM_MISMATCH');

    // Worker 2 tries to complete the job
    await JobService.completeJob(job._id as mongoose.Types.ObjectId, claimedJob2.executionClaim!, { audioUrl: 'w2' }, 0);

    // Verify job is completed by worker 2
    const finalJob = await Job.findById(job._id);
    expect(finalJob?.status).toBe('COMPLETED');
    expect(finalJob?.result.audioUrl).toBe('w2');
  });

});

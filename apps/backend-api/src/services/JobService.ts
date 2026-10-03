import mongoose from 'mongoose';
import { Job } from '../models/Job';
import { CreditService } from './CreditService';

export class JobService {
  static async claimJob(jobId: mongoose.Types.ObjectId, workerId: string) {
    const executionClaim = `${workerId}_${Date.now()}`;
    const job = await Job.findOneAndUpdate(
      { _id: jobId, status: { $in: ['QUEUED', 'PROCESSING'] } },
      { $set: { status: 'PROCESSING', executionClaim } },
      { new: true }
    );
    if (!job) {
      throw new Error('JOB_NOT_FOUND_OR_NOT_CLAIMABLE');
    }
    return job;
  }

  static async completeJob(jobId: mongoose.Types.ObjectId, executionClaim: string, result: any, finalCost: number) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const job = await Job.findOne({ _id: jobId, executionClaim }).session(session);
      if (!job) {
        throw new Error('WORKER_CLAIM_MISMATCH');
      }
      
      job.status = 'COMPLETED';
      job.result = result;
      await job.save({ session });

      if (job.reservationId) {
        await CreditService.settle(job._id as mongoose.Types.ObjectId, finalCost);
      }

      await session.commitTransaction();
      return job;
    } catch (e) {
      await session.abortTransaction();
      throw e;
    } finally {
      session.endSession();
    }
  }

  static async failJob(jobId: mongoose.Types.ObjectId, executionClaim: string, error: any) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const job = await Job.findOne({ _id: jobId, executionClaim }).session(session);
      if (!job) {
        throw new Error('WORKER_CLAIM_MISMATCH');
      }
      
      job.status = 'FAILED';
      job.error = error;
      await job.save({ session });

      if (job.reservationId) {
        await CreditService.release(job._id as mongoose.Types.ObjectId);
      }

      await session.commitTransaction();
      return job;
    } catch (e) {
      await session.abortTransaction();
      throw e;
    } finally {
      session.endSession();
    }
  }
}

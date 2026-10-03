import { Request, Response } from 'express';
import { Job } from '../models/Job';

export const getJob = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = (req as any).user._id;

    const job = await Job.findById(id).lean();

    if (!job) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Job not found' } });
    }

    // Only the owner can poll their own job
    if (job.ownerId.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Access denied' } });
    }

    return res.json({
      success: true,
      data: {
        id: job._id,
        type: job.type,
        status: job.status,
        result: job.result ?? null,
        failedReason: job.error ?? null,
        createdAt: (job as any).createdAt,
        updatedAt: (job as any).updatedAt,
      },
    });
  } catch (error) {
    console.error('[GET /jobs/:id Error]', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: 'Server error' } });
  }
};

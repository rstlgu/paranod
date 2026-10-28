import { db } from '@/lib/db';

export const ACTIVE_JOB_STATES = ['PENDING', 'SUBMITTED', 'PROCESSING'];

/** Claim a terminal state once so callbacks, cancellation and timeouts cannot overwrite it. */
export async function settleAddonJob(
  jobId: string,
  status: 'COMPLETED' | 'FAILED' | 'TIMEOUT' | 'CANCELLED',
  data: { result?: string; error?: string } = {}
) {
  const claimed = await db.transformJob.updateMany({
    where: { id: jobId, status: { in: ACTIVE_JOB_STATES } },
    data: {
      status,
      ...data,
      completedAt: new Date(),
      ...(status === 'COMPLETED' ? { progress: 100 } : {})
    }
  });
  if (!claimed.count) return false;
  return true;
}

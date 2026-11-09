/**
 * Timeout Handler for Transform Jobs
 * Checks for jobs that have exceeded maximum execution time
 */

import { db } from '../db';
import { parseStoredAddonManifest } from '@/features/plugins/addon-storage';
import { settleAddonJob, ACTIVE_JOB_STATES } from './settle-job';

// Timeout limits in milliseconds
const TIMEOUT_MS = {
  custom: 30 * 60 * 1000, // 30 minutes for custom plugins
  store: 2 * 60 * 60 * 1000, // 2 hours for store plugins (future)
  official: 4 * 60 * 60 * 1000 // 4 hours for official plugins (future)
};

/**
 * Check for timed out jobs and mark them as TIMEOUT
 */
export async function checkTimeouts() {
  console.log('⏱️  Checking for timed out jobs...');

  const now = new Date();
  const timeoutThreshold = new Date(now.getTime() - TIMEOUT_MS.custom);

  // Find jobs stuck in SUBMITTED or PROCESSING that started too long ago
  const stuckJobs = await db.transformJob.findMany({
    where: {
      status: { in: ACTIVE_JOB_STATES },
      startedAt: {
        lt: timeoutThreshold
      }
    },
    include: {
      addon: {
        select: {
          addonId: true
        }
      }
    }
  });

  if (stuckJobs.length === 0) {
    console.log('✅ No timed out jobs found');
    return {
      timedOut: 0
    };
  }

  console.log(`⚠️  Found ${stuckJobs.length} timed out job(s)`);

  // Update all timed out jobs
  for (const job of stuckJobs) {
    await settleAddonJob(job.id, 'TIMEOUT', {
      error: `Job exceeded maximum execution time (${TIMEOUT_MS.custom / 60000} minutes)`
    });

    console.log(`   ⏱️  Job ${job.id} marked as TIMEOUT`);
    console.log(`      Addon: ${job.addon.addonId}`);
    console.log(`      Started: ${job.startedAt.toISOString()}`);
  }

  return { timedOut: stuckJobs.length };
}

/**
 * Get jobs that are currently active (not completed/failed/timeout)
 */
export async function getActiveJobs(workspaceId: string, userId: string) {
  const where: any = {
    status: { in: ['PENDING', 'SUBMITTED', 'PROCESSING'] }
  };
  where.graph = { OR: [{ userId }, { visibility: 'workspace' }] };

  if (workspaceId) {
    where.workspaceId = workspaceId;
  }

  const jobs = await db.transformJob.findMany({
    where,
    include: {
      addon: {
        select: {
          addonId: true,
          manifestData: true
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  return jobs.map((job) => {
    const manifest = parseStoredAddonManifest(job.addon.manifestData);
    const elapsed = Date.now() - job.startedAt.getTime();

    return {
      id: job.id,
      addonId: job.addonId,
      addonName: manifest.plugin.name,
      transformId: job.transformId,
      status: job.status,
      progress: job.progress,
      progressMessage: job.progressMessage,
      startedAt: job.startedAt,
      elapsedSeconds: Math.round(elapsed / 1000)
    };
  });
}

/**
 * Cancel a running job
 */
export async function cancelJob(
  jobId: string,
  workspaceId: string,
  userId: string
): Promise<boolean> {
  try {
    const job = await db.transformJob.findFirst({
      where: {
        id: jobId,
        workspaceId,
        graph: { OR: [{ userId }, { visibility: 'workspace' }] },
        status: { in: ['PENDING', 'SUBMITTED', 'PROCESSING'] }
      }
    });

    if (!job) {
      return false;
    }

    const changed = await settleAddonJob(jobId, 'CANCELLED', {
      error: 'Cancelled by user'
    });
    if (!changed) return false;

    console.log(`🚫 Job cancelled: ${jobId}`);

    return true;
  } catch (error) {
    console.error('Cancel job error:', error);
    return false;
  }
}

import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { safeFetch } from '@/lib/security/safe-fetch';
import { createAddonRequestHeaders } from '@/lib/security/addon-request';
import { decryptSecret } from '@/lib/security/secrets';
import { AddonPollingResponseSchema } from '@/features/plugins/addon-payload';
import { parseAddonResult } from '@/lib/validators/addon-result';

const ACTIVE = ['SUBMITTED', 'PROCESSING'];
const POLL_INTERVAL_MS = 5_000;
const LEASE_MS = 30_000;
const JOB_TIMEOUT_MS = 30 * 60_000;

function due(now: Date) {
  return {
    resultDelivery: 'polling',
    agentRunId: null,
    status: { in: ACTIVE },
    externalJobId: { not: null },
    nextPollAt: { lte: now },
    OR: [{ pollLeaseExpiresAt: null }, { pollLeaseExpiresAt: { lte: now } }]
  };
}

/** Called after API authorization, or by the authenticated maintenance worker. */
export async function pollAddonJob(jobId: string): Promise<void> {
  const now = new Date();
  const token = randomUUID();
  const claimed = await db.transformJob.updateMany({
    where: { id: jobId, ...due(now) },
    data: {
      pollLeaseToken: token,
      pollLeaseExpiresAt: new Date(now.getTime() + LEASE_MS)
    }
  });
  if (!claimed.count) return;

  // Every response, including failures and progress, is fenced by this claim.
  const where = { id: jobId, pollLeaseToken: token, status: { in: ACTIVE } };
  const released = { pollLeaseToken: null, pollLeaseExpiresAt: null };
  const finish = (
    status: 'FAILED' | 'COMPLETED' | 'TIMEOUT' | 'CANCELLED',
    data: { result?: string; error?: string } = {}
  ) =>
    db.transformJob.updateMany({
      where,
      data: {
        ...released,
        ...data,
        status,
        nextPollAt: null,
        completedAt: new Date(),
        ...(status === 'COMPLETED' ? { progress: 100 } : {})
      }
    });
  const job = await db.transformJob.findUnique({
    where: { id: jobId },
    include: { addon: { select: { webhookSecret: true, uninstalledAt: true } } }
  });
  if (!job || job.pollLeaseToken !== token || !ACTIVE.includes(job.status))
    return;
  if (Date.now() - job.startedAt.getTime() >= JOB_TIMEOUT_MS) {
    await finish('TIMEOUT', {
      error: 'Addon job exceeded the 30 minute execution limit'
    });
    return;
  }
  if (!job.pollingEndpoint || !job.externalJobId || job.addon.uninstalledAt) {
    await finish('FAILED', {
      error: 'Addon polling configuration unavailable'
    });
    return;
  }

  const retry = () =>
    db.transformJob.updateMany({
      where,
      data: {
        ...released,
        pollFailureCount: { increment: 1 },
        nextPollAt: new Date(
          Date.now() +
            Math.min(
              60_000,
              POLL_INTERVAL_MS * 2 ** Math.min(job.pollFailureCount, 4)
            )
        )
      }
    });

  let response;
  try {
    const body = JSON.stringify({
      action: 'status',
      jobId: job.externalJobId,
      transformId: job.transformId
    });
    response = await safeFetch(decryptSecret(job.pollingEndpoint), {
      method: 'POST',
      body,
      headers: createAddonRequestHeaders(
        body,
        job.workspaceId,
        decryptSecret(job.addon.webhookSecret)
      ),
      timeoutMs: 10_000,
      maxResponseBytes: 5 * 1024 * 1024,
      maxRedirects: 0
    });
  } catch {
    // Network errors can contain personalized endpoint URLs; do not persist/log them.
    await retry();
    return;
  }
  if (response.status === 429 || response.status >= 500) {
    await retry();
    return;
  }
  if (!response.ok) {
    await finish('FAILED', {
      error:
        response.status === 404
          ? 'Addon job is unavailable or expired; it was not executed again'
          : 'Addon rejected the signed job status request'
    });
    return;
  }

  let snapshot;
  try {
    snapshot = AddonPollingResponseSchema.parse(await response.json());
    if (
      snapshot.jobId !== job.externalJobId ||
      snapshot.transformId !== job.transformId
    ) {
      throw new Error('Mismatched addon job');
    }
    if (snapshot.status === 'completed') {
      parseAddonResult(snapshot.result, JSON.parse(job.inputEntity).id);
    }
  } catch {
    await finish('FAILED', {
      error: 'Addon returned an invalid job status or result'
    });
    return;
  }

  if (snapshot.status === 'completed') {
    await finish('COMPLETED', { result: JSON.stringify(snapshot.result) });
  } else if (snapshot.status === 'failed' || snapshot.status === 'cancelled') {
    await finish(snapshot.status === 'failed' ? 'FAILED' : 'CANCELLED', {
      error:
        snapshot.status === 'failed'
          ? 'Addon operation failed'
          : 'Operation cancelled by addon'
    });
  } else {
    await db.transformJob.updateMany({
      where,
      data: {
        ...released,
        status: 'PROCESSING',
        pollFailureCount: 0,
        progress: snapshot.progress,
        progressMessage: snapshot.progressMessage,
        nextPollAt: new Date(Date.now() + POLL_INTERVAL_MS)
      }
    });
  }
}

/** Bounded work per tick; DB leases also coordinate UI polling and replicas. */
export async function pollAddonJobs() {
  // Recover orphaned agent jobs without resubmitting work or acquiring a graph lease.
  await db.transformJob.updateMany({
    where: {
      agentRunId: { not: null },
      status: { in: ['PENDING', ...ACTIVE] },
      OR: [
        { agentRun: { is: { status: { not: 'running' } } } },
        {
          agentRun: { is: { graph: { agentLease: { is: { runId: null } } } } }
        },
        {
          agentRun: {
            is: {
              graph: { agentLease: { is: { expiresAt: { lte: new Date() } } } }
            }
          }
        }
      ]
    },
    data: {
      status: 'CANCELLED',
      error: 'agent_run_finished',
      completedAt: new Date(),
      nextPollAt: null,
      pollLeaseToken: null,
      pollLeaseExpiresAt: null
    }
  });
  const jobs = await db.transformJob.findMany({
    where: due(new Date()),
    select: { id: true },
    orderBy: { nextPollAt: 'asc' },
    take: 5
  });
  const results = await Promise.allSettled(
    jobs.map((job) => pollAddonJob(job.id))
  );
  return {
    checked: jobs.length,
    failed: results.filter((result) => result.status === 'rejected').length
  };
}

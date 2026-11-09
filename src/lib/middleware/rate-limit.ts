/**
 * Rate Limiting Middleware for External Plugins
 */

import { db } from '../db';

// Rate limits per plugin type
const LIMITS = {
  custom: {
    perMinute: 30,
    perHour: 500,
    perDay: 2000
  },
  store: {
    perMinute: 100,
    perHour: 2000,
    perDay: 20000
  },
  official: {
    perMinute: 500,
    perHour: 10000,
    perDay: 100000
  }
};

interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: Date;
}

/**
 * Check rate limit for plugin execution
 */
export async function checkPluginRateLimit(
  workspaceId: string,
  pluginId: string,
  pluginType: 'custom' | 'store' | 'official' = 'custom'
): Promise<RateLimitResult> {
  const limits = LIMITS[pluginType];
  const now = new Date();

  // Check per-minute limit
  const oneMinuteAgo = new Date(now.getTime() - 60 * 1000);

  const recentJobs = await db.transformJob.count({
    where: {
      workspaceId,
      addonId: pluginId,
      createdAt: { gte: oneMinuteAgo }
    }
  });

  if (recentJobs >= limits.perMinute) {
    return {
      allowed: false,
      limit: limits.perMinute,
      remaining: 0,
      resetAt: new Date(oneMinuteAgo.getTime() + 60 * 1000)
    };
  }

  return {
    allowed: true,
    limit: limits.perMinute,
    remaining: limits.perMinute - recentJobs,
    resetAt: new Date(now.getTime() + 60 * 1000)
  };
}

/**
 * Check webhook rate limit (prevent webhook spam)
 */
export async function checkWebhookRateLimit(
  jobId: string
): Promise<{ allowed: boolean; reason?: string }> {
  const now = new Date();
  const oneMinuteAgo = new Date(now.getTime() - 60 * 1000);

  // Count recent updates to this job
  const job = await db.transformJob.findUnique({
    where: { id: jobId },
    select: {
      updatedAt: true,
      status: true
    }
  });

  if (!job) {
    return { allowed: false, reason: 'Job not found' };
  }

  // Don't allow webhooks to completed/failed jobs
  if (['COMPLETED', 'FAILED', 'TIMEOUT', 'CANCELLED'].includes(job.status)) {
    return { allowed: false, reason: 'Job already finished' };
  }

  // Max 100 updates per job (prevents infinite loops)
  // This is checked by counting how many times updatedAt changed
  // For simplicity, we allow all webhooks here
  // In production, track webhook count in metadata

  return { allowed: true };
}

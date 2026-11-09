import { db } from '@/lib/db';

/** Retention is opt-in. An empty value or zero preserves all flow runs. */
export function getHistoryRetentionDays(): number | null {
  const raw = process.env.FLOW_HISTORY_RETENTION_DAYS;
  if (!raw || raw.trim() === '' || Number(raw) === 0) return null;
  const days = Number(raw);
  if (!Number.isSafeInteger(days) || days < 1 || days > 36500) {
    throw new Error(
      'FLOW_HISTORY_RETENTION_DAYS must be an integer from 1 to 36500, or 0 for unlimited history'
    );
  }
  return days;
}

export function getHistoryCutoff(): Date | null {
  const days = getHistoryRetentionDays();
  return days === null ? null : new Date(Date.now() - days * 86_400_000);
}

export async function purgeExpiredFlowRuns(
  workspaceId: string
): Promise<number> {
  const cutoff = getHistoryCutoff();
  if (!cutoff) return 0;
  const result = await db.flowRun.deleteMany({
    where: {
      workspaceId,
      startedAt: { lt: cutoff },
      status: { not: 'RUNNING' }
    }
  });
  return result.count;
}

export async function purgeAllExpiredFlowRuns(): Promise<{
  workspaces: number;
  deleted: number;
}> {
  if (!getHistoryCutoff()) return { workspaces: 0, deleted: 0 };
  const groups = await db.flowRun.groupBy({ by: ['workspaceId'] });
  let deleted = 0;
  for (const group of groups)
    deleted += await purgeExpiredFlowRuns(group.workspaceId);
  return { workspaces: groups.length, deleted };
}

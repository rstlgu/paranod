import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { deleteMany, groupBy } = vi.hoisted(() => ({
  deleteMany: vi.fn(),
  groupBy: vi.fn()
}));
vi.mock('@/lib/db', () => ({ db: { flowRun: { deleteMany, groupBy } } }));
import {
  getHistoryCutoff,
  getHistoryRetentionDays,
  purgeAllExpiredFlowRuns,
  purgeExpiredFlowRuns
} from './history-retention';

describe('operator-configured history retention', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-28T12:00:00Z'));
    vi.stubEnv('FLOW_HISTORY_RETENTION_DAYS', '');
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });
  it('preserves all history by default without querying or deleting data', async () => {
    expect(getHistoryRetentionDays()).toBeNull();
    expect(getHistoryCutoff()).toBeNull();
    expect(await purgeAllExpiredFlowRuns()).toEqual({
      workspaces: 0,
      deleted: 0
    });
    expect(await purgeExpiredFlowRuns('workspace')).toBe(0);
    expect(deleteMany).not.toHaveBeenCalled();
    expect(groupBy).not.toHaveBeenCalled();
  });
  it('only expires completed history within the requested workspace', async () => {
    vi.stubEnv('FLOW_HISTORY_RETENTION_DAYS', '30');
    deleteMany.mockResolvedValue({ count: 2 });
    expect(await purgeExpiredFlowRuns('workspace-a')).toBe(2);
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        workspaceId: 'workspace-a',
        startedAt: { lt: new Date('2026-09-28T12:00:00Z') },
        status: { not: 'RUNNING' }
      }
    });
  });
  it.each(['-1', '1.5', 'abc', 'Infinity', '36501'])(
    'rejects invalid retention %s before deleting data',
    async (value) => {
      vi.stubEnv('FLOW_HISTORY_RETENTION_DAYS', value);
      await expect(purgeExpiredFlowRuns('workspace-a')).rejects.toThrow(
        'FLOW_HISTORY_RETENTION_DAYS'
      );
      expect(deleteMany).not.toHaveBeenCalled();
    }
  );
});

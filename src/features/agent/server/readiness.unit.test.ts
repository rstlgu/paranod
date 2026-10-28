import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import {
  AGENT_WORKER_HEARTBEAT_MS,
  AGENT_WORKER_PROTOCOL_VERSION,
  AGENT_WORKER_QUEUE,
  AGENT_WORKER_TTL_MS,
  assertAgentWorkerCapacity,
  getAgentWorkerCapacity,
  heartbeatAgentWorker,
  removeAgentWorker
} from './readiness';

function fixture(readyWorkers = 1, activeRuns = 0) {
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  const query = vi.fn(
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?');
      statements.push({ sql, values });
      return sql.includes('pg_advisory_xact_lock')
        ? [{ lock: '' }]
        : [{ readyWorkers, activeRuns }];
    }
  );
  const execute = vi.fn(
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      statements.push({ sql: strings.join('?'), values });
      return 1;
    }
  );
  const deleteMany = vi.fn(async () => ({ count: 1 }));
  const tx = {
    $queryRaw: query,
    $executeRaw: execute,
    agentWorker: { deleteMany }
  } as unknown as Prisma.TransactionClient;
  return { tx, query, statements, deleteMany };
}

afterEach(() => vi.unstubAllEnvs());

describe('agent worker admission', () => {
  it.each([
    [0, 0, 0],
    [1, 0, 1],
    [2, 1, 1],
    [1, 3, 0]
  ])(
    'reports %i workers and %i active leases as %i slots',
    async (readyWorkers, activeRuns, availableSlots) => {
      const f = fixture(readyWorkers, activeRuns);
      expect(await getAgentWorkerCapacity(f.tx)).toEqual({
        readyWorkers,
        activeRuns,
        availableSlots
      });
      expect(f.statements).toHaveLength(1);
    }
  );

  it('serializes starts globally before taking a separate fresh capacity snapshot', async () => {
    const f = fixture();
    await assertAgentWorkerCapacity(f.tx);
    expect(f.statements[0].sql).toContain(
      'pg_advisory_xact_lock(1346458177, 1095189838)::text'
    );
    expect(f.statements[1].sql).toContain('clock_timestamp()');
    expect(f.statements).toHaveLength(2);
  });

  it.each([
    [0, 0, 'agent_worker_unavailable', 503],
    [0, 2, 'agent_worker_unavailable', 503],
    [1, 1, 'agent_worker_busy', 409]
  ])(
    'fails closed with %i workers and %i leases',
    async (workers, runs, code, status) => {
      await expect(
        assertAgentWorkerCapacity(fixture(workers as number, runs as number).tx)
      ).rejects.toMatchObject({ code, status });
    }
  );

  it('does not expose database errors through the admission error', async () => {
    const f = fixture();
    f.query.mockResolvedValueOnce([{ lock: '' }] as never);
    f.query.mockRejectedValueOnce(new Error('private-database-credentials'));
    await expect(assertAgentWorkerCapacity(f.tx)).rejects.toThrow(
      'agent_worker_unavailable'
    );
  });

  it('filters stale, expired, future, incompatible heartbeats under one DB clock', async () => {
    const f = fixture();
    await getAgentWorkerCapacity(f.tx);
    const { sql, values } = f.statements[0];
    expect(sql.match(/clock_timestamp\(\)/g)).toHaveLength(1);
    expect(sql).toContain('WITH clock AS MATERIALIZED');
    expect(sql).toContain('"heartbeatAt" <= clock.now');
    expect(sql).toContain('"heartbeatAt" > clock.now - ?');
    expect(sql).toContain('"expiresAt" > clock.now');
    expect(sql).toContain('"protocolVersion" = ?');
    expect(sql).toContain('"queueName" = ?');
    expect(values).toEqual([
      AGENT_WORKER_PROTOCOL_VERSION,
      AGENT_WORKER_QUEUE,
      30_000
    ]);
  });

  it('counts only running records joined to their own live, credentialed lease', async () => {
    const f = fixture();
    await getAgentWorkerCapacity(f.tx);
    const { sql } = f.statements[0];
    expect(sql).toContain('run."id" = lease."runId"');
    expect(sql).toContain('run."graphId" = lease."graphId"');
    expect(sql).toContain('run."userId" = lease."userId"');
    expect(sql).toContain('run."status" = \'running\'');
    expect(sql).toContain('lease."token" IS NOT NULL');
    expect(sql).toContain('lease."expiresAt" > clock.now');
  });

  it('upserts a heartbeat using the DB clock and removes only this process on stop', async () => {
    const f = fixture();
    await heartbeatAgentWorker(f.tx, 'worker-id');
    const { sql, values } = f.statements[0];
    expect(sql).toContain('clock_timestamp()');
    expect(sql).toContain('ON CONFLICT ("id") DO UPDATE');
    expect(values).toEqual([
      'worker-id',
      1,
      AGENT_WORKER_QUEUE,
      AGENT_WORKER_TTL_MS
    ]);
    expect(AGENT_WORKER_HEARTBEAT_MS).toBe(10_000);
    expect(AGENT_WORKER_TTL_MS).toBe(30_000);
    await removeAgentWorker(f.tx, 'worker-id');
    expect(f.deleteMany).toHaveBeenCalledWith({ where: { id: 'worker-id' } });
  });
});

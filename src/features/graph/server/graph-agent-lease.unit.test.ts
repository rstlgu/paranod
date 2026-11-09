import { describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import {
  acquireAgentGraphLease,
  assertAgentGraphLease,
  assertGraphEditable,
  getGraphWriteState,
  releaseAgentGraphLease,
  renewAgentGraphLease
} from './graph-agent-lease';

function fixture() {
  let now = new Date('2026-09-27T12:00:00Z');
  let lease: any = null;
  let member = true;
  let exists = true;
  const statements: string[] = [];
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      statements.push(sql);
      if (sql.includes('clock_timestamp')) return [{ now }];
      return exists ? [{ id: 'graph' }] : [];
    },
    graph: {
      findUnique: async () => ({ userId: 'user', workspaceId: 'workspace' })
    },
    workspaceMember: {
      findUnique: async () => (member ? { id: 'member' } : null)
    },
    graphAgentLease: {
      findUnique: async () => lease && { ...lease },
      upsert: async ({ create, update }: any) => {
        lease = lease
          ? {
              ...lease,
              ...update,
              generation: lease.generation + update.generation.increment
            }
          : { ...create };
        return { ...lease };
      },
      update: async ({ data }: any) => {
        lease = {
          ...lease,
          ...data,
          generation: data.generation
            ? lease.generation + data.generation.increment
            : lease.generation
        };
        return { ...lease };
      }
    }
  } as unknown as Prisma.TransactionClient;
  return {
    tx,
    statements,
    acquire: (expectedWriteVersion = 0) =>
      acquireAgentGraphLease(tx, {
        graphId: 'graph',
        runId: 'run',
        userId: 'user',
        expectedWriteVersion
      }),
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
    revoke: () => {
      member = false;
    },
    remove: () => {
      exists = false;
    }
  };
}

describe('graph agent lease', () => {
  it('allows existing clients before the first agent run', async () => {
    const { tx } = fixture();
    await expect(
      assertGraphEditable(tx, 'graph', { snapshot: true })
    ).resolves.toMatchObject({ version: 0, locked: false });
  });

  it('locks the graph row before reading the database clock and lease', async () => {
    const f = fixture();
    await f.acquire();
    expect(f.statements[0]).toContain('FOR UPDATE');
    expect(f.statements[1]).toContain('clock_timestamp()');
  });

  it('denies manual writers and a second agent while occupied', async () => {
    const f = fixture();
    await f.acquire();
    await expect(assertGraphEditable(f.tx, 'graph')).rejects.toMatchObject({
      status: 423
    });
    await expect(f.acquire(1)).rejects.toMatchObject({
      code: 'graph_agent_running'
    });
  });

  it('publishes no lease credential or actor in the read state', async () => {
    const f = fixture();
    await f.acquire();
    expect(await getGraphWriteState(f.tx, 'graph')).toEqual({
      version: 1,
      locked: true,
      expiresAt: '2026-09-27T12:01:00.000Z'
    });
  });

  it('allows only the current worker to write or renew', async () => {
    const f = fixture();
    const handle = await f.acquire();
    await expect(assertAgentGraphLease(f.tx, handle)).resolves.toBeInstanceOf(
      Date
    );
    for (const patch of [
      { token: 'forged' },
      { generation: 0 },
      { runId: 'another' },
      { userId: 'another' }
    ]) {
      await expect(
        assertAgentGraphLease(f.tx, { ...handle, ...patch })
      ).rejects.toMatchObject({ code: 'graph_lease_lost' });
    }
    f.advance(20_000);
    await renewAgentGraphLease(f.tx, handle);
    expect((await getGraphWriteState(f.tx, 'graph')).expiresAt).toBe(
      '2026-09-27T12:01:20.000Z'
    );
  });

  it('rejects snapshots made before acquisition even after release', async () => {
    const f = fixture();
    const handle = await f.acquire();
    expect(await releaseAgentGraphLease(f.tx, handle)).toBe(true);
    await expect(
      assertGraphEditable(f.tx, 'graph', {
        snapshot: true,
        expectedWriteVersion: 0
      })
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      assertGraphEditable(f.tx, 'graph', { snapshot: true })
    ).rejects.toMatchObject({ status: 428 });
    await expect(
      assertGraphEditable(f.tx, 'graph', {
        snapshot: true,
        expectedWriteVersion: 2
      })
    ).resolves.toMatchObject({ locked: false });
  });

  it('recovers expiry exactly at the deadline and fences the old worker', async () => {
    const f = fixture();
    const handle = await f.acquire();
    f.advance(60_000);
    expect(await getGraphWriteState(f.tx, 'graph')).toEqual({
      version: 2,
      locked: false,
      expiresAt: null
    });
    await expect(renewAgentGraphLease(f.tx, handle)).rejects.toMatchObject({
      code: 'graph_lease_lost'
    });
    const next = await f.acquire(2);
    expect(next.generation).toBe(3);
    expect(next.token).not.toBe(handle.token);
    expect(await releaseAgentGraphLease(f.tx, handle)).toBe(false);
    expect((await getGraphWriteState(f.tx, 'graph')).locked).toBe(true);
  });

  it('makes release idempotent and does not require a revoked membership', async () => {
    const f = fixture();
    const handle = await f.acquire();
    f.revoke();
    await expect(assertAgentGraphLease(f.tx, handle)).rejects.toMatchObject({
      status: 403
    });
    expect(await releaseAgentGraphLease(f.tx, handle)).toBe(true);
    expect(await releaseAgentGraphLease(f.tx, handle)).toBe(false);
  });

  it('validates identity, membership, expected version and TTL', async () => {
    const f = fixture();
    const input = {
      graphId: 'graph',
      runId: 'run',
      userId: 'user',
      expectedWriteVersion: 0
    };
    await expect(
      acquireAgentGraphLease(f.tx, { ...input, userId: 'other' })
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      acquireAgentGraphLease(f.tx, { ...input, runId: '' })
    ).rejects.toMatchObject({ status: 400 });
    await expect(f.acquire(5)).rejects.toMatchObject({ code: 'graph_changed' });
    for (const version of [-1, 0.5, '0', null]) {
      await expect(
        assertGraphEditable(f.tx, 'graph', {
          snapshot: true,
          expectedWriteVersion: version
        })
      ).rejects.toMatchObject({ status: 400 });
    }
    for (const ttl of [0, 999, 300001, NaN]) {
      await expect(
        acquireAgentGraphLease(f.tx, input, ttl)
      ).rejects.toMatchObject({ status: 400 });
    }
    f.revoke();
    await expect(f.acquire()).rejects.toMatchObject({ status: 403 });
    f.remove();
    await expect(getGraphWriteState(f.tx, 'graph')).rejects.toMatchObject({
      status: 404
    });
  });
});

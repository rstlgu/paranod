import { beforeEach, expect, it, vi } from 'vitest';
import type { AgentEventData } from '../lib/contracts';
const lease = vi.hoisted(() => ({ assert: vi.fn(), release: vi.fn() }));
vi.mock('@/features/graph/server/graph-agent-lease', () => ({
  assertAgentGraphLease: lease.assert,
  releaseAgentGraphLease: lease.release,
  acquireAgentGraphLease: vi.fn(),
  getGraphWriteState: vi.fn(),
  GraphWriteError: class extends Error {}
}));
import { finishAgentRun } from './runs';
const handle = {
  runId: 'run',
  graphId: 'graph',
  userId: 'user',
  generation: 1,
  token: 'private'
};
function fixture(status = 'running', count = 4) {
  const events: AgentEventData[] = [
    { type: 'graph_changes', nodesAdded: 10, edgesAdded: 10, summary: 'Saved' },
    {
      type: 'tool',
      callId: 'headers',
      name: 'run_transform',
      target: 'url-parser/url-http-headers',
      status: 'failed',
      summary: 'Failed.',
      sources: []
    },
    {
      type: 'tool',
      callId: 'dns',
      name: 'run_transform',
      target: 'dns',
      status: 'completed',
      summary: 'Done',
      sources: []
    }
  ];
  const db = {
    agentRun: {
      findUnique: vi.fn(async () => ({ id: 'run', graphId: 'graph', status })),
      update: vi.fn(async () => ({ eventCount: ++count }))
    },
    agentEvent: {
      findMany: vi.fn(async () => events.map((data) => ({ data }))),
      create: vi.fn(async ({ data }: any) => {
        events.push(data.data);
        return data;
      })
    }
  };
  return { db, events };
}
beforeEach(() => vi.clearAllMocks());

it.each([4, 500])(
  'persists a factual final reply and reason, including at the event cap %s',
  async (count) => {
    const { db, events } = fixture('running', count);
    await finishAgentRun(
      db as never,
      handle,
      'failed',
      'Token budget reached.',
      'token_limit'
    );
    expect(events.at(-2)).toMatchObject({
      type: 'message',
      text: expect.stringContaining('10 nodes and 10 links')
    });
    expect(events.at(-2)).toMatchObject({
      text: expect.stringContaining('url-parser/url-http-headers')
    });
    expect(events.at(-1)).toMatchObject({
      type: 'finished',
      status: 'failed',
      reasonCode: 'token_limit'
    });
    expect(lease.release).toHaveBeenCalledOnce();
    expect(JSON.stringify(events)).not.toContain('private');
  }
);

it('does not overwrite cancellation or lose the lock check', async () => {
  const { db } = fixture('cancelled');
  await expect(
    finishAgentRun(db as never, handle, 'failed', 'Failed.')
  ).rejects.toThrow('agent_run_finished');
  expect(lease.assert).toHaveBeenCalledOnce();
  expect(db.agentEvent.create).not.toHaveBeenCalled();
  expect(lease.release).not.toHaveBeenCalled();
});

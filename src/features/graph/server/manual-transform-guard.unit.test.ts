import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ findFirst: vi.fn(), state: vi.fn() }));
vi.mock('@/lib/db', () => ({
  db: {
    $transaction: (fn: (tx: unknown) => unknown) =>
      fn({ graph: { findFirst: mocks.findFirst } })
  }
}));
vi.mock('./graph-agent-lease', () => ({ getGraphWriteState: mocks.state }));
import { manualTransformGraphError } from './manual-transform-guard';
const access = { userId: 'owner', workspaceId: 'workspace' };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.findFirst.mockResolvedValue({ id: 'graph' });
  mocks.state.mockResolvedValue({ locked: true });
});
it('denies manual execution on a locked graph before an executor is called', async () => {
  const error = await manualTransformGraphError('graph', access);
  expect(error?.status).toBe(423);
  expect(await error?.json()).toEqual({
    success: false,
    error: 'graph_agent_running'
  });
});
it('permits unlocked graph execution and standalone modules', async () => {
  mocks.state.mockResolvedValue({ locked: false });
  expect(await manualTransformGraphError('graph', access)).toBeNull();
  expect(await manualTransformGraphError(undefined, access)).toBeNull();
  expect(mocks.state).toHaveBeenCalledOnce();
});
it('checks owner/workspace scope before revealing a lock', async () => {
  mocks.findFirst.mockResolvedValue(null);
  expect((await manualTransformGraphError('other', access))?.status).toBe(404);
  expect(mocks.state).not.toHaveBeenCalled();
  expect(mocks.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        id: 'other',
        workspaceId: 'workspace',
        OR: [{ userId: 'owner' }, { visibility: 'workspace' }]
      }
    })
  );
});
it('rejects malformed graph IDs without a database query', async () => {
  for (const value of [null, '', 42, 'x'.repeat(161)])
    expect((await manualTransformGraphError(value, access))?.status).toBe(400);
  expect(mocks.findFirst).not.toHaveBeenCalled();
});

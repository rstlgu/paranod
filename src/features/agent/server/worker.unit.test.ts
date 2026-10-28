import { beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({
  investigate: vi.fn(),
  finish: vi.fn(),
  interrupt: vi.fn(),
  readRun: vi.fn()
}));
vi.mock('./runtime', () => ({ runInvestigation: mock.investigate }));
vi.mock('./gateway', () => ({ createAgentGateway: vi.fn(() => ({})) }));
vi.mock('./context', () => ({
  readAgentContext: vi.fn(async () => ({ history: [], summary: '', goals: [] }))
}));
vi.mock('./runs', () => ({
  finishAgentRun: mock.finish,
  interruptAgentRun: mock.interrupt,
  readOwnedAgentRun: mock.readRun
}));
vi.mock('@/features/graph/server/graph-agent-lease', () => ({
  assertAgentGraphLease: vi.fn(),
  renewAgentGraphLease: vi.fn()
}));
import { processAgentJob } from './worker';
beforeEach(() => vi.clearAllMocks());

it('persists a safe failure reason, logs only its code, and closes the provider', async () => {
  const run = {
    id: 'run',
    graphId: 'graph',
    userId: 'user',
    status: 'running',
    workerStartedAt: null,
    model: 'test',
    reasoning: 'high',
    approvalMode: 'auto',
    goal: 'test'
  };
  const db = {
    $transaction: (callback: (tx: unknown) => unknown) =>
      Promise.resolve(callback(db)),
    agentRun: {
      findUnique: vi.fn(async () => run),
      updateMany: vi.fn(async () => ({ count: 1 }))
    },
    graph: {
      findUniqueOrThrow: vi.fn(async () => ({ workspaceId: 'workspace' }))
    },
    graphAgentLease: {
      findUniqueOrThrow: vi.fn(async () => ({
        generation: 1,
        token: 'private-lease'
      }))
    }
  };
  mock.readRun.mockResolvedValue(run);
  mock.investigate.mockRejectedValue(
    Object.assign(new Error('agent_token_limit'), {
      requestBody: 'PRIVATE CREDENTIALS'
    })
  );
  mock.finish.mockResolvedValue(undefined);
  const close = vi.fn(async () => {});
  const log = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  try {
    await processAgentJob({
      db: db as never,
      runId: 'run',
      signal: new AbortController().signal,
      getProvider: async () => ({ provider: {} as never, close })
    });
    expect(mock.finish).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ runId: 'run' }),
      'failed',
      expect.stringContaining('token budget'),
      'token_limit'
    );
    expect(log).toHaveBeenCalledExactlyOnceWith(
      '[agent] Run failed {"runId":"run","code":"token_limit"}\n'
    );
    expect(close).toHaveBeenCalledOnce();
    expect(mock.interrupt).not.toHaveBeenCalled();
  } finally {
    log.mockRestore();
  }
});

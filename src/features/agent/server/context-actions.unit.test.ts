import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  state: vi.fn(),
  memory: vi.fn(),
  compact: vi.fn()
}));
vi.mock('./runs', () => ({
  PUBLIC_RUN_SELECT: {},
  readOwnedAgentRun: mocks.read,
  toRunSummary: (run: unknown) => run
}));
vi.mock('./context', async (original) => ({
  ...(await original<typeof import('./context')>()),
  readAgentContext: mocks.memory,
  compactContext: mocks.compact
}));
vi.mock('@/features/graph/server/graph-agent-lease', async (original) => ({
  ...(await original<
    typeof import('@/features/graph/server/graph-agent-lease')
  >()),
  getGraphWriteState: mocks.state
}));
import { changeAgentContext } from './context-actions';
import { AGENT_CONTEXT_LIMIT } from '../lib/context';

function fixture() {
  const state = {
    contextCheckpoint: null as unknown,
    contextUsage: null,
    inputTokens: 10,
    outputTokens: 5,
    status: 'completed',
    id: 'run',
    graphId: 'graph',
    model: 'gpt-6-astra',
    reasoning: 'high'
  };
  mocks.read.mockImplementation(async () => ({ ...state }));
  mocks.state.mockResolvedValue({ version: 2, locked: false });
  mocks.memory.mockResolvedValue({
    summary: '',
    history: [
      { runId: 'run', goal: 'Target example.org', messages: ['Found seed'] }
    ],
    goals: ['Target example.org']
  });
  mocks.compact.mockResolvedValue('Memory: example.org, node seed.');
  const tx = {
    agentRun: {
      findUniqueOrThrow: vi.fn(async () => ({
        contextCheckpoint: state.contextCheckpoint
      })),
      update: vi.fn(async ({ data }) => {
        Object.assign(state, data);
        return { ...state };
      })
    },
    graph: {
      findUniqueOrThrow: vi.fn(async () => ({ workspaceId: 'workspace' }))
    }
  };
  const close = vi.fn(async () => {});
  const getProvider = vi.fn(async () => ({ provider: {} as never, close }));
  const input = {
    db: { $transaction: (fn: (tx: unknown) => unknown) => fn(tx) } as never,
    runId: 'run',
    userId: 'owner',
    signal: new AbortController().signal,
    getProvider
  };
  return {
    state,
    tx,
    close,
    getProvider,
    run: (action: 'clear' | 'compact') =>
      changeAgentContext({ ...input, action })
  };
}
beforeEach(() => vi.resetAllMocks());
it('clears memory without an AI request or deletion of graph/history', async () => {
  const f = fixture();
  await f.run('clear');
  expect(f.state.contextCheckpoint).toEqual({
    mode: 'cleared',
    summary: '',
    includesRun: true,
    goals: []
  });
  expect(f.getProvider).not.toHaveBeenCalled();
  expect(f.tx.agentRun.update).toHaveBeenCalledOnce();
  expect(f.state.contextUsage).toMatchObject({
    limit: AGENT_CONTEXT_LIMIT,
    budgetVersion: 2,
    state: 'cleared'
  });
});
it('persists a summary and keeps original goals separate from generated text', async () => {
  const f = fixture();
  await f.run('compact');
  expect(f.state.contextCheckpoint).toEqual({
    mode: 'compacted',
    summary: 'Memory: example.org, node seed.',
    includesRun: true,
    goals: ['Target example.org']
  });
  expect(f.close).toHaveBeenCalledOnce();
  expect(f.state.contextUsage).toMatchObject({
    limit: AGENT_CONTEXT_LIMIT,
    budgetVersion: 2,
    compactions: 1
  });
});
it('keeps a smaller model-specific limit after manual context changes', async () => {
  const f = fixture();
  f.state.model = 'openrouter/vendor/custom-model';
  f.state.reasoning = 'low';
  await f.run('clear');
  expect(f.state.contextUsage).toMatchObject({
    limit: 24_000,
    budgetVersion: 2
  });
});
it('preserves memory and closes the provider if summarization fails', async () => {
  const f = fixture();
  mocks.compact.mockRejectedValue(new Error('failed'));
  await expect(f.run('compact')).rejects.toThrow('failed');
  expect(f.state.contextCheckpoint).toBeNull();
  expect(f.close).toHaveBeenCalledOnce();
});
it('rejects context changes while the agent runs', async () => {
  const f = fixture();
  mocks.state.mockResolvedValue({ version: 2, locked: true });
  await expect(f.run('clear')).rejects.toThrow('graph_agent_running');
  expect(f.tx.agentRun.update).not.toHaveBeenCalled();
});
it('does not overwrite a clear or a newer run that races compaction', async () => {
  for (const kind of ['version', 'clear'] as const) {
    const f = fixture();
    mocks.compact.mockImplementation(async () => {
      if (kind === 'version')
        mocks.state.mockResolvedValue({ version: 4, locked: false });
      else
        f.state.contextCheckpoint = {
          mode: 'cleared',
          summary: '',
          includesRun: true,
          goals: []
        };
      return 'Stale memory';
    });
    await expect(f.run('compact')).rejects.toThrow('agent_context_changed');
    expect(f.tx.agentRun.update).not.toHaveBeenCalled();
  }
});
it('rechecks access before persisting a generated summary', async () => {
  const f = fixture();
  mocks.compact.mockImplementation(async () => {
    mocks.read.mockRejectedValue(new Error('Access lost'));
    return 'Summary';
  });
  await expect(f.run('compact')).rejects.toThrow('Access lost');
  expect(f.tx.agentRun.update).not.toHaveBeenCalled();
});

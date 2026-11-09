import { describe, expect, it } from 'vitest';
import { agentStartTarget } from './start-target';
import type { AgentRunSummary } from './contracts';

const run: AgentRunSummary = {
  id: 'previous',
  graphId: 'graph',
  graphName: 'Graph',
  goal: 'First question',
  model: 'test',
  reasoning: 'high',
  approvalMode: 'guarded',
  status: 'completed',
  createdAt: new Date(0).toISOString(),
  endedAt: new Date(1).toISOString()
};
const input = {
  activeGraphId: 'graph',
  loaded: true,
  selectedRunId: run.id,
  run
};

describe('agent conversation start target', () => {
  it('starts a fresh conversation only from a loaded active graph', () => {
    expect(agentStartTarget({ ...input, selectedRunId: null })).toEqual({
      graphId: 'graph'
    });
    expect(
      agentStartTarget({ ...input, selectedRunId: null, loaded: false })
    ).toBeNull();
  });
  it.each(['completed', 'cancelled', 'failed', 'interrupted'] as const)(
    'continues a %s run on its loaded active graph',
    (status) => {
      expect(agentStartTarget({ ...input, run: { ...run, status } })).toEqual({
        graphId: 'graph',
        parentRunId: run.id
      });
    }
  );
  it.each([
    { activeGraphId: null },
    { activeGraphId: 'other' },
    { loaded: false },
    { run: null },
    { selectedRunId: 'other' },
    { run: { ...run, status: 'running' as const } }
  ])('rejects history without its matching loaded editor: %j', (override) => {
    expect(agentStartTarget({ ...input, ...override })).toBeNull();
  });
});

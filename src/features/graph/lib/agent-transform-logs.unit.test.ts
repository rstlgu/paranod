import { beforeEach, expect, it } from 'vitest';
import { projectAgentTransforms } from './agent-transform-logs';
import {
  useAgentActivityStore,
  type AgentActivity
} from '@/features/agent/store/agent-activity-store';
import type { AgentEvent } from '@/features/agent/lib/contracts';

const activity: AgentActivity = {
  run: {
    id: 'run',
    graphId: 'graph',
    graphName: 'Graph',
    goal: 'Goal',
    model: 'test',
    reasoning: 'low',
    approvalMode: 'auto',
    status: 'running',
    createdAt: new Date(0).toISOString(),
    endedAt: null
  },
  events: []
};
const event = (
  sequence: number,
  status: 'running' | 'completed' | 'failed'
): AgentEvent => ({
  sequence,
  createdAt: new Date(sequence * 1000).toISOString(),
  data: {
    type: 'tool',
    callId: 'call',
    name: 'run_transform',
    target: 'dns/resolve',
    status,
    summary: status === 'failed' ? 'Lookup unavailable.' : 'Public activity',
    sources: [],
    ...(status !== 'running' ? { durationMs: 1000 } : {})
  }
});
beforeEach(() => useAgentActivityStore.setState({ runs: {} }));
it('projects real start/completion events to one read-only activity and two console lines', () => {
  const result = projectAgentTransforms({
    ...activity,
    events: [event(1, 'running'), event(2, 'completed')]
  });
  expect(result.logs).toHaveLength(1);
  expect(result.logs[0]).toMatchObject({
    origin: 'agent',
    viewed: true,
    status: 'completed',
    transformName: 'resolve',
    startTime: new Date(1000),
    endTime: new Date(2000)
  });
  expect(result.logs[0].results).toBeUndefined();
  expect(result.entries.map((entry) => entry.level)).toEqual([
    'info',
    'success'
  ]);
});
it('logs errors and excludes notes and unrelated tool events', () => {
  const other = event(2, 'completed');
  if (other.data.type === 'tool') other.data.name = 'read_graph';
  const result = projectAgentTransforms({
    ...activity,
    events: [event(1, 'failed'), other]
  });
  expect(result.entries).toHaveLength(1);
  expect(result.entries[0].level).toBe('error');
  expect(result.logs[0].error).toBe('Lookup unavailable.');
});
it('ends unconfirmed running activity without claiming success', () => {
  const result = projectAgentTransforms({
    ...activity,
    run: {
      ...activity.run,
      status: 'cancelled',
      endedAt: new Date(3000).toISOString()
    },
    events: [event(1, 'running')]
  });
  expect(result.logs[0].status).toBe('failed');
  expect(result.entries.at(-1)?.level).toBe('warn');
});
it('does not report interrupted transforms before the last feed page arrives', () => {
  const result = projectAgentTransforms({
    ...activity,
    complete: false,
    run: { ...activity.run, status: 'completed' },
    events: [event(1, 'running')]
  });
  expect(result.logs[0].status).toBe('running');
  expect(result.entries).toHaveLength(1);
});
it('merges replayed feeds without duplicates and keeps graph scopes distinct', () => {
  const store = useAgentActivityStore.getState();
  store.receive(activity.run, [event(1, 'running')]);
  store.receive(activity.run, [event(1, 'running'), event(2, 'completed')]);
  store.receive({ ...activity.run, id: 'other', graphId: 'other-graph' }, [
    event(1, 'running')
  ]);
  expect(useAgentActivityStore.getState().runs.run.events).toHaveLength(2);
  expect(useAgentActivityStore.getState().runs.other.run.graphId).toBe(
    'other-graph'
  );
});

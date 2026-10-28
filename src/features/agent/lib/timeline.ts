import type { AgentEvent } from './contracts';
import { runFailureSummary } from './run-outcome';

export function latestAgentActivity(events: AgentEvent[]) {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (
      event.data.type === 'message' ||
      event.data.type === 'graph_changes' ||
      event.data.type === 'tool'
    )
      return event;
  }
  return undefined;
}

// Commentary stays readable while low-level tools and fast polling batches pass.
// Only another public note replaces it; never expose internal reasoning events.
export function latestAgentNote(events: AgentEvent[]) {
  return events.findLast((event) => event.data.type === 'message');
}

export function describeCompactActivity(data: AgentEvent['data']) {
  if (data.type === 'message') return data.text;
  if (data.type === 'graph_changes')
    return data.nodesRemoved || data.edgesRemoved
      ? `Graph updated: removed ${data.nodesRemoved ?? 0} nodes and ${data.edgesRemoved ?? 0} links.`
      : `Graph updated: added ${data.nodesAdded} nodes and ${data.edgesAdded} links.`;
  if (data.type === 'tool') {
    const labels: Record<string, [string, string]> = {
      read_graph: ['Reading the current graph', 'Graph read'],
      list_modules: ['Looking up available tools', 'Tools found'],
      describe_module: ['Loading tool details', 'Tool loaded'],
      compact_context: [
        'Compacting context',
        'Context compacted automatically'
      ],
      add_seed: ['Adding a node', 'Node added'],
      delete_nodes: ['Removing nodes', 'Nodes removed'],
      merge_nodes: ['Merging nodes', 'Nodes merged'],
      propose_relationship: ['Linking nodes', 'Link added']
    };
    const label = labels[data.name];
    if (label)
      return data.status === 'failed'
        ? `${label[0]} failed.`
        : `${label[data.status === 'running' ? 0 : 1]}${data.status === 'running' ? '…' : ''}`;
    if (data.status === 'failed')
      return `Transform ${data.target} failed. ${data.summary}`.trim();
    return data.status === 'running'
      ? `Running transform ${data.target}…`
      : `Transform ${data.target} completed.`;
  }
  return 'Thinking…';
}

export function agentTimeline(events: AgentEvent[]) {
  const timeline: AgentEvent[] = [];
  const tools = new Map<string, number>();
  for (const event of events) {
    if (event.data.type === 'usage') continue;
    // Hide generic thinking and reasoning summaries, including historical runs.
    if (event.data.type === 'phase' && event.data.phase === 'thinking')
      continue;
    if (
      event.data.type === 'finished' &&
      ['failed', 'interrupted'].includes(event.data.status)
    ) {
      const text = runFailureSummary(
        events.map((item) => item.data),
        event.data.summary
      );
      // Older runs have no persisted failure reply. Render one without rewriting history.
      const last = timeline[timeline.length - 1];
      if (!(last?.data.type === 'message' && last.data.text === text)) {
        timeline.push({
          ...event,
          data: { type: 'message', text, sources: [] }
        });
      }
      continue;
    }
    if (event.data.type === 'decision' || event.data.type === 'finished')
      continue;
    if (event.data.type === 'tool') {
      const previous = tools.get(event.data.callId);
      if (previous !== undefined) {
        timeline[previous] = {
          ...event,
          sequence: timeline[previous].sequence
        };
        continue;
      }
      tools.set(event.data.callId, timeline.length);
    }
    timeline.push(event);
  }
  return timeline;
}

export type AgentTimelineBlock =
  | {
      kind: 'steps';
      key: number;
      steps: AgentEvent[];
      startedAt: string;
      endedAt: string;
    }
  | { kind: 'event'; key: number; event: AgentEvent };

const STEP_TYPES: ReadonlySet<string> = new Set([
  'phase',
  'tool',
  'graph_changes'
]);

// The final report is the last message, and only when nothing follows it.
// Earlier notes stay in the activity, even when they were written after the
// last tool. While the run is active every note stays there too.
function finalAnswerIndex(timeline: AgentEvent[]) {
  for (let index = timeline.length - 1; index >= 0; index--) {
    if (timeline[index].data.type !== 'message') continue;
    const hasLaterWork = timeline
      .slice(index + 1)
      .some((event) => event.data.type !== 'message');
    return hasLaterWork ? -1 : index;
  }
  return -1;
}

// Intermediate work collapses into one block. Only pending approvals and the
// final report stay visible.
export function groupAgentTimeline(
  timeline: AgentEvent[],
  decided: ReadonlySet<string> = new Set(),
  running = false
): AgentTimelineBlock[] {
  const blocks: AgentTimelineBlock[] = [];
  const answerIndex = running ? -1 : finalAnswerIndex(timeline);
  for (let index = 0; index < timeline.length; index++) {
    const event = timeline[index];
    const { data } = event;
    const isStep =
      STEP_TYPES.has(data.type) ||
      (data.type === 'approval' && decided.has(data.approvalId)) ||
      (data.type === 'message' && index !== answerIndex);
    if (!isStep) {
      blocks.push({ kind: 'event', key: event.sequence, event });
      continue;
    }
    const last = blocks[blocks.length - 1];
    if (last?.kind !== 'steps') {
      blocks.push({
        kind: 'steps',
        key: event.sequence,
        steps: [event],
        startedAt: event.createdAt,
        endedAt: event.createdAt
      });
      continue;
    }
    if (event.createdAt > last.endedAt) last.endedAt = event.createdAt;
    const previous = last.steps[last.steps.length - 1].data;
    // Every model call re-announces the same phase; keep one entry per streak.
    if (
      previous.type === 'phase' &&
      event.data.type === 'phase' &&
      previous.phase === event.data.phase &&
      previous.summary === event.data.summary
    )
      continue;
    last.steps.push(event);
  }
  return blocks;
}

import type { AgentEventData } from './contracts';

/** A factual fallback, not an AI-generated assessment of the findings. */
export function runFailureSummary(events: AgentEventData[], reason: string) {
  if (
    reason === 'Run failed. Check the configuration and service availability.'
  ) {
    reason =
      'The investigation stopped before a final answer. No detailed failure reason was recorded for this older run.';
  }
  let nodes = 0;
  let edges = 0;
  let nodesRemoved = 0;
  let edgesRemoved = 0;
  const tools = new Map<string, Extract<AgentEventData, { type: 'tool' }>>();
  for (const event of events) {
    if (event.type === 'graph_changes') {
      nodes += event.nodesAdded;
      edges += event.edgesAdded;
      nodesRemoved += event.nodesRemoved ?? 0;
      edgesRemoved += event.edgesRemoved ?? 0;
    }
    if (event.type === 'tool') tools.set(event.callId, event);
  }
  const completed = Array.from(tools.values()).filter(
    (tool) => tool.status === 'completed'
  ).length;
  const failed = Array.from(tools.values()).filter(
    (tool) => tool.status === 'failed'
  );
  const lines = [
    reason,
    '',
    `Saved progress: ${nodes} nodes and ${edges} links added.${nodesRemoved || edgesRemoved ? ` ${nodesRemoved} nodes and ${edgesRemoved} links removed.` : ''}`,
    `${completed} operations completed; ${failed.length} failed.`
  ];
  const targets = Array.from(
    new Set(
      failed
        .filter((tool) => tool.name === 'run_transform')
        .map((tool) => tool.target)
    )
  );
  if (targets.length)
    lines.push(
      `Failed transforms: ${targets
        .slice(0, 5)
        .map((target) => target.slice(0, 160))
        .join(', ')}${targets.length > 5 ? ', …' : ''}.`
    );
  lines.push(
    '',
    'This investigation is incomplete. Saved results remain in the graph; you can ask to continue from them.'
  );
  return lines.join('\n');
}

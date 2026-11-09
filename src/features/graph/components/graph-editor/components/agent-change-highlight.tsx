'use client';

import type { AgentGraphChanges } from '@/features/graph/lib/agent-graph-changes';

interface AgentChangeHighlightProps {
  changes: AgentGraphChanges | null;
}

export function AgentChangeHighlight({ changes }: AgentChangeHighlightProps) {
  if (!changes || (!changes.nodeIds.length && !changes.edgeIds.length))
    return null;
  const nodes = changes.nodeIds.map(
    (id) => `.react-flow__node[data-testid="rf__node-${CSS.escape(id)}"]`
  );
  const edges = changes.edgeIds.map(
    (id) => `.react-flow__edge[data-testid="rf__edge-${CSS.escape(id)}"] path`
  );
  return (
    <style>
      {`${KEYFRAMES}${[
        nodes.length
          ? `${nodes.join(',')}{animation:paranod-agent-node 1.4s ease-out 2}`
          : '',
        edges.length
          ? `${edges.join(',')}{animation:paranod-agent-edge 1.4s ease-out 2}`
          : ''
      ].join('')}`}
    </style>
  );
}

const KEYFRAMES = `@keyframes paranod-agent-node{0%{filter:drop-shadow(0 0 0 hsl(var(--primary)/0))}35%{filter:drop-shadow(0 0 7px hsl(var(--primary)/0.45))}100%{filter:drop-shadow(0 0 0 hsl(var(--primary)/0))}}@keyframes paranod-agent-edge{0%,100%{stroke-width:inherit}35%{stroke:hsl(var(--primary));stroke-width:2.25px}}`;

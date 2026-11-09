'use client';

import { create } from 'zustand';
import type { Node } from 'reactflow';

export interface AgentGraphReferences {
  nodes: readonly Node[];
  onSelectNode: (id: string) => void;
}

// Ephemeral, graph-scoped editor data. No network fetch or persisted graph copy.
export const useAgentGraphReferences = create<{
  graphs: Record<string, AgentGraphReferences>;
}>(() => ({ graphs: {} }));

export function registerAgentGraphReferences(
  graphId: string,
  references: AgentGraphReferences
) {
  useAgentGraphReferences.setState((state) => ({
    graphs: { ...state.graphs, [graphId]: references }
  }));
  return () => {
    useAgentGraphReferences.setState((state) => {
      if (state.graphs[graphId] !== references) return state;
      const graphs = { ...state.graphs };
      delete graphs[graphId];
      return { graphs };
    });
  };
}

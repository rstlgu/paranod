'use client';

import { createContext, useCallback, useContext } from 'react';
import { useReactFlow } from 'reactflow';

export const GraphMutationContext = createContext<() => boolean>(() => true);

export function useGraphCanEdit() {
  return useContext(GraphMutationContext);
}

// ReactFlow node components can mutate its store directly. Give those setters
// the same snapshot-bound guard as the parent editor, including async callbacks.
export function useGuardedReactFlow<NodeData = any, EdgeData = any>() {
  const flow = useReactFlow<NodeData, EdgeData>();
  const canEdit = useContext(GraphMutationContext);
  const setNodes: typeof flow.setNodes = useCallback(
    (next) => {
      if (canEdit())
        flow.setNodes((current) =>
          canEdit()
            ? typeof next === 'function'
              ? next(current)
              : next
            : current
        );
    },
    [canEdit, flow.setNodes]
  );
  const setEdges: typeof flow.setEdges = useCallback(
    (next) => {
      if (canEdit())
        flow.setEdges((current) =>
          canEdit()
            ? typeof next === 'function'
              ? next(current)
              : next
            : current
        );
    },
    [canEdit, flow.setEdges]
  );
  const deleteElements: typeof flow.deleteElements = useCallback(
    (input) => {
      if (canEdit()) return flow.deleteElements(input);
    },
    [canEdit, flow.deleteElements]
  );
  return { ...flow, setNodes, setEdges, deleteElements, canEdit };
}

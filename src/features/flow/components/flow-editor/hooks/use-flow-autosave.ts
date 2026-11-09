import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import type { Edge, Node as FlowNode } from 'reactflow';

interface UseFlowAutosaveArgs {
  flowId?: string;
  mounted: boolean;
  nodes: FlowNode[];
  edges: Edge[];
  isLoadingFromStorageRef: MutableRefObject<boolean>;
  createStateHash: (nodes: FlowNode[], edges: Edge[]) => string;
  saveToDatabase: (nodes: FlowNode[], edges: Edge[]) => Promise<void> | void;
  debounceMs?: number;
}

export function useFlowAutosave({
  flowId,
  mounted,
  nodes,
  edges,
  isLoadingFromStorageRef,
  createStateHash,
  saveToDatabase,
  debounceMs = 2000
}: UseFlowAutosaveArgs) {
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedStateRef = useRef<string | null>(null);

  const markSavedState = useCallback(
    (nextNodes: FlowNode[], nextEdges: Edge[]) => {
      lastSavedStateRef.current = createStateHash(nextNodes, nextEdges);
    },
    [createStateHash]
  );

  const resetSavedState = useCallback(() => {
    lastSavedStateRef.current = null;
  }, []);

  const save = useCallback(
    async (nodesToSave: FlowNode[], edgesToSave: Edge[]) => {
      if (!flowId || !mounted) return;
      const currentHash = createStateHash(nodesToSave, edgesToSave);
      if (lastSavedStateRef.current === currentHash) return;
      try {
        await saveToDatabase(nodesToSave, edgesToSave);
        lastSavedStateRef.current = currentHash;
      } catch {
        // keep lastSavedStateRef as-is so we retry on next change
      }
    },
    [createStateHash, flowId, mounted, saveToDatabase]
  );

  useEffect(() => {
    if (!mounted || !flowId || isLoadingFromStorageRef.current) return;

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

    saveTimeoutRef.current = setTimeout(() => {
      void save(nodes, edges);
    }, debounceMs);

    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [debounceMs, edges, flowId, isLoadingFromStorageRef, mounted, nodes, save]);

  return { markSavedState, resetSavedState, save };
}

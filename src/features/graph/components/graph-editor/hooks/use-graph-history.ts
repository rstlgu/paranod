import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  createGraphHistory,
  type GraphSnapshot
} from '@/features/graph/lib/graph-history';

interface UseGraphHistoryArgs extends GraphSnapshot {
  mounted: boolean;
  setNodes: (next: GraphSnapshot['nodes']) => void;
  setEdges: (next: GraphSnapshot['edges']) => void;
  debounceMs?: number;
  maxHistory?: number;
  canEditSnapshot?: () => boolean;
}

export function useGraphHistory({
  mounted,
  nodes,
  edges,
  setNodes,
  setEdges,
  debounceMs = 500,
  maxHistory = 50,
  canEditSnapshot
}: UseGraphHistoryArgs) {
  const [history] = useState(() => createGraphHistory(maxHistory));
  const [, render] = useState(0);
  const latest = useRef({ nodes, edges });
  latest.current = { nodes, edges };
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoring = useRef<GraphSnapshot | null>(null);
  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const resetHistory = useCallback(
    (snapshot: GraphSnapshot) => {
      cancel();
      restoring.current = snapshot;
      history.reset(snapshot);
      render((value) => value + 1);
    },
    [cancel, history]
  );
  const commitHistory = useCallback(
    (snapshot: GraphSnapshot) => {
      cancel();
      restoring.current = snapshot;
      if (history.commit(snapshot)) render((value) => value + 1);
    },
    [cancel, history]
  );

  useEffect(() => {
    cancel();
    if (!mounted) return;
    restoring.current = null;
    // Measurement/selection updates compare equal, so cannot erase redo.
    if (!history.matches({ nodes, edges })) {
      timer.current = setTimeout(() => {
        if (history.commit(latest.current)) render((value) => value + 1);
        timer.current = null;
      }, debounceMs);
    }
    return cancel;
  }, [cancel, debounceMs, edges, history, mounted, nodes]);

  const travel = useCallback(
    (direction: 'undo' | 'redo') => {
      if (!mounted || (canEditSnapshot && !canEditSnapshot())) return;
      cancel();
      // Flush edits before debounce; rapid travel must not read stale render props.
      history.commit(restoring.current ?? latest.current);
      const snapshot = history[direction]();
      if (!snapshot) return;
      restoring.current = snapshot;
      setNodes(snapshot.nodes);
      setEdges(snapshot.edges);
      render((value) => value + 1);
      toast.info(direction === 'undo' ? 'Undo' : 'Redo');
    },
    [cancel, history, setEdges, setNodes, mounted, canEditSnapshot]
  );
  return {
    historyIndex: history.index,
    canUndo:
      mounted &&
      (!canEditSnapshot || canEditSnapshot()) &&
      (history.canUndo || !history.matches({ nodes, edges })),
    canRedo:
      mounted && (!canEditSnapshot || canEditSnapshot()) && history.canRedo,
    undo: useCallback(() => travel('undo'), [travel]),
    redo: useCallback(() => travel('redo'), [travel]),
    resetHistory,
    commitHistory
  };
}

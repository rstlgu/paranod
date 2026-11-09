import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { Edge, Node as FlowNode } from 'reactflow';
import { toast } from 'sonner';

interface FlowSnapshot {
  nodes: FlowNode[];
  edges: Edge[];
}

interface UseFlowHistoryArgs {
  mounted: boolean;
  nodes: FlowNode[];
  edges: Edge[];
  setNodes: (next: FlowNode[]) => void;
  setEdges: (next: Edge[]) => void;
  debounceMs?: number;
  maxHistory?: number;
}

function normalizeSnapshot(snapshot: FlowSnapshot): FlowSnapshot {
  const nodes = snapshot.nodes.map((n) => {
    const { selected: _selected, ...rest } = n as any;
    return rest as FlowNode;
  });
  const edges = snapshot.edges.map((e) => {
    const { selected: _selected, ...rest } = e as any;
    return rest as Edge;
  });
  return { nodes, edges };
}

function snapshotSignature(snapshot: FlowSnapshot) {
  return JSON.stringify(snapshot);
}

export function useFlowHistory({
  mounted,
  nodes,
  edges,
  setNodes,
  setEdges,
  debounceMs = 500,
  maxHistory = 50
}: UseFlowHistoryArgs) {
  const [history, setHistory] = useState<FlowSnapshot[]>([{ nodes: [], edges: [] }]);
  const [historyIndex, setHistoryIndex] = useState(0);

  const isUndoRedoRef = useRef(false);
  const historyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const resetHistory = useCallback((snapshot: FlowSnapshot) => {
    setHistory([normalizeSnapshot(snapshot)]);
    setHistoryIndex(0);
  }, []);

  useEffect(() => {
    if (!mounted || isUndoRedoRef.current) return;
    if (historyTimeoutRef.current) clearTimeout(historyTimeoutRef.current);

    historyTimeoutRef.current = setTimeout(() => {
      const currentState = normalizeSnapshot({ nodes, edges });
      const lastState = history[historyIndex];
      if (snapshotSignature(currentState) !== snapshotSignature(lastState)) {
        const newHistory = history.slice(0, historyIndex + 1);
        newHistory.push(currentState);
        if (newHistory.length > maxHistory) newHistory.shift();
        setHistory(newHistory);
        setHistoryIndex(newHistory.length - 1);
      }
    }, debounceMs);

    return () => {
      if (historyTimeoutRef.current) clearTimeout(historyTimeoutRef.current);
    };
  }, [debounceMs, edges, history, historyIndex, maxHistory, mounted, nodes]);

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  const undo = useCallback(() => {
    if (!canUndo) return;
    isUndoRedoRef.current = true;
    const currentSig = snapshotSignature(history[historyIndex]);
    let newIndex = historyIndex - 1;
    while (newIndex > 0 && snapshotSignature(history[newIndex]) === currentSig) newIndex -= 1;
    const state = history[newIndex];
    setNodes(state.nodes);
    setEdges(state.edges);
    setHistoryIndex(newIndex);
    setTimeout(() => {
      isUndoRedoRef.current = false;
    }, 100);
    toast.info('Undo');
  }, [canUndo, history, historyIndex, setEdges, setNodes]);

  const redo = useCallback(() => {
    if (!canRedo) return;
    isUndoRedoRef.current = true;
    const currentSig = snapshotSignature(history[historyIndex]);
    let newIndex = historyIndex + 1;
    while (newIndex < history.length - 1 && snapshotSignature(history[newIndex]) === currentSig)
      newIndex += 1;
    const state = history[newIndex];
    setNodes(state.nodes);
    setEdges(state.edges);
    setHistoryIndex(newIndex);
    setTimeout(() => {
      isUndoRedoRef.current = false;
    }, 100);
    toast.info('Redo');
  }, [canRedo, history, historyIndex, setEdges, setNodes]);

  return {
    historyIndex,
    canUndo,
    canRedo,
    undo,
    redo,
    resetHistory,
    isUndoRedoRef: isUndoRedoRef as MutableRefObject<boolean>
  };
}

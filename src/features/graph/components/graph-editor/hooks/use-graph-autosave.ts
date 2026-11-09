import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import type { Edge, Node as FlowNode } from 'reactflow';

import type { OSINTNodeData } from '@/features/graph/types';
import { useRegisterManualSave } from '@/contexts/save-status-context';
import { createSerialSaveQueue } from '@/features/graph/lib/serial-save-queue';
import {
  graphClientCoordinator,
  graphDraftFingerprint
} from '@/features/graph/lib/graph-client-coordinator';

interface SaveStatusApi {
  setSaving?: (saving: boolean) => void;
  setLastSaved?: (date: Date | null) => void;
}

interface UseGraphAutosaveArgs {
  graphId?: string;
  mounted: boolean;
  nodes: FlowNode<OSINTNodeData>[];
  edges: Edge[];
  isLoadingFromStorageRef: MutableRefObject<boolean>;
  createStateHash: (nodes: FlowNode<OSINTNodeData>[], edges: Edge[]) => string;
  saveStatus: SaveStatusApi | null;
  debounceMs?: number;
  writeVersionRef: MutableRefObject<number | undefined>;
  blockedRef?: MutableRefObject<boolean>;
  canEditSnapshot?: () => boolean;
  canSaveSnapshot?: () => boolean;
}

export function useGraphAutosave({
  graphId,
  mounted,
  nodes,
  edges,
  isLoadingFromStorageRef,
  createStateHash,
  saveStatus,
  debounceMs = 2000,
  writeVersionRef,
  blockedRef,
  canEditSnapshot,
  canSaveSnapshot = canEditSnapshot
}: UseGraphAutosaveArgs) {
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedStateRef = useRef<string | null>(null);
  const lastConfirmedRef = useRef<string | null>(null);
  const queueRef = useRef(createSerialSaveQueue());
  const currentGraphIdRef = useRef(graphId);
  currentGraphIdRef.current = graphId;
  const latestSnapshotRef = useRef({ nodes, edges });
  latestSnapshotRef.current = { nodes, edges };

  const setSavingRef = useRef(saveStatus?.setSaving);
  const setLastSavedRef = useRef(saveStatus?.setLastSaved);

  useEffect(() => {
    setSavingRef.current = saveStatus?.setSaving;
    setLastSavedRef.current = saveStatus?.setLastSaved;
  }, [saveStatus]);

  const markSavedState = useCallback(
    (nextNodes: FlowNode<OSINTNodeData>[], nextEdges: Edge[]) => {
      lastSavedStateRef.current = createStateHash(nextNodes, nextEdges);
      lastConfirmedRef.current = graphDraftFingerprint({
        nodes: nextNodes,
        edges: nextEdges
      });
    },
    [createStateHash]
  );

  const resetSavedState = useCallback(() => {
    lastSavedStateRef.current = null;
  }, []);

  const saveToDatabase = useCallback(
    (
      nodesToSave: FlowNode<OSINTNodeData>[],
      edgesToSave: Edge[],
      barrier = false
    ): Promise<boolean> => {
      const version = writeVersionRef.current;
      const isCurrent = () =>
        currentGraphIdRef.current === graphId &&
        writeVersionRef.current === version &&
        (canSaveSnapshot ? canSaveSnapshot() : !blockedRef?.current);
      if (
        !graphId ||
        !mounted ||
        version === undefined ||
        !isCurrent() ||
        !graphClientCoordinator.canSave(graphId, barrier)
      )
        return Promise.resolve(false);

      const currentHash = createStateHash(nodesToSave, edgesToSave);
      const confirmedHash = graphDraftFingerprint({
        nodes: nodesToSave,
        edges: edgesToSave
      });
      const body = JSON.stringify({
        nodes: nodesToSave,
        edges: edgesToSave,
        expectedWriteVersion: version
      });
      return queueRef.current.enqueue(async () => {
        if (!isCurrent()) return false;
        // The layout hash intentionally omits metadata, edge labels and small
        // moves. It cannot prove that the complete draft has been persisted.
        if (!barrier && lastConfirmedRef.current === confirmedHash) return true;
        setSavingRef.current?.(true);
        try {
          const response = await fetch(`/api/graphs/${graphId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body
          });
          if (!isCurrent()) return false;
          if ([409, 423, 428].includes(response.status)) {
            // Never retry this snapshot under a new agent ownership epoch.
            writeVersionRef.current = undefined;
            window.dispatchEvent(
              new CustomEvent('graph-write-blocked', {
                detail: { graphId, status: response.status }
              })
            );
          }
          if (!response.ok) return false;
          lastSavedStateRef.current = currentHash;
          lastConfirmedRef.current = confirmedHash;
          setLastSavedRef.current?.(new Date());
          try {
            localStorage.setItem('graphs-need-refresh', 'true');
          } catch {
            // Storage may be unavailable; the server has still confirmed the save.
          }
          return true;
        } catch {
          return false;
        } finally {
          setSavingRef.current?.(false);
        }
      });
    },
    [
      blockedRef,
      canSaveSnapshot,
      createStateHash,
      graphId,
      mounted,
      writeVersionRef
    ]
  );

  const flush = useCallback(
    async (
      barrier = false,
      captured?: { nodes: FlowNode<OSINTNodeData>[]; edges: Edge[] }
    ) => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      // Start barriers own an immutable captured draft. Do not substitute a
      // snapshot ref from an intermediate render after a context/run refresh.
      const latest = captured ?? latestSnapshotRef.current;
      const saved = await saveToDatabase(latest.nodes, latest.edges, barrier);
      await queueRef.current.idle();
      return (
        saved &&
        (!canSaveSnapshot || canSaveSnapshot()) &&
        lastConfirmedRef.current ===
          graphDraftFingerprint(latestSnapshotRef.current)
      );
    },
    [canSaveSnapshot, saveToDatabase]
  );

  const manualSave = useCallback(() => {
    if (!graphId || !mounted) return;
    lastSavedStateRef.current = null;
    void saveToDatabase(nodes, edges);
  }, [edges, graphId, mounted, nodes, saveToDatabase]);

  useRegisterManualSave(manualSave);

  useEffect(() => {
    if (!mounted || !graphId || isLoadingFromStorageRef.current) return;

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

    saveTimeoutRef.current = setTimeout(() => {
      void saveToDatabase(nodes, edges);
    }, debounceMs);

    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [
    debounceMs,
    edges,
    graphId,
    isLoadingFromStorageRef,
    mounted,
    nodes,
    saveToDatabase
  ]);

  return {
    markSavedState,
    resetSavedState,
    saveToDatabase,
    flush,
    idle: () => queueRef.current.idle(),
    isDirty: () =>
      lastConfirmedRef.current !==
      graphDraftFingerprint(latestSnapshotRef.current)
  };
}

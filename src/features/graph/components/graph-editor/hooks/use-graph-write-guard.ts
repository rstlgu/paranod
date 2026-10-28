'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { graphEditability } from '@/features/graph/lib/graph-editability';
import type { GraphWriteState } from '@/features/graph/lib/graph-write-state';
import { useGraphCoordinator } from './use-graph-participant';

async function fetchWriteState(url: string): Promise<GraphWriteState> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error('write_state_unavailable');
  const { writeState } = await response.json();
  if (
    !Number.isSafeInteger(writeState?.version) ||
    writeState.version < 0 ||
    typeof writeState.locked !== 'boolean'
  ) {
    throw new Error('invalid_write_state');
  }
  return writeState;
}

export function useGraphWriteGuard(graphId?: string | null) {
  const coordinator = useGraphCoordinator();
  const scope = coordinator.epoch(graphId);
  const { mutate: mutateCache } = useSWRConfig();
  const [snapshot, setSnapshot] = useState<{
    graphId: string;
    version: number;
  } | null>(null);
  const currentSnapshotRef = useRef(snapshot);
  const blockedRef = useRef(Boolean(graphId));
  const serverBlockedRef = useRef(Boolean(graphId));
  const [rejectedGraph, setRejectedGraph] = useState<string | null>(null);
  const { data, error, mutate } = useSWR(
    graphId ? `/api/graphs/${encodeURIComponent(graphId)}/write-state` : null,
    fetchWriteState,
    {
      refreshInterval: 2500,
      dedupingInterval: 500,
      revalidateOnFocus: true,
      errorRetryInterval: 5000,
      keepPreviousData: false
    }
  );
  const acceptSnapshot = useCallback(
    (id: string, state: GraphWriteState) => {
      const next = { graphId: id, version: state.version };
      currentSnapshotRef.current = next;
      coordinator.invalidate(id);
      setSnapshot(next);
      setRejectedGraph(null);
      // The graph and ownership version must come from the same server snapshot.
      void mutateCache(
        `/api/graphs/${encodeURIComponent(id)}/write-state`,
        state,
        { revalidate: true }
      );
    },
    [coordinator, mutateCache]
  );
  const reject = useCallback(() => {
    blockedRef.current = true;
    serverBlockedRef.current = true;
    if (graphId) setRejectedGraph(graphId);
    void mutate();
  }, [graphId, mutate]);
  useEffect(() => {
    const blocked = (event: Event) => {
      if ((event as CustomEvent).detail?.graphId === graphId) reject();
    };
    window.addEventListener('graph-write-blocked', blocked);
    return () => window.removeEventListener('graph-write-blocked', blocked);
  }, [graphId, reject]);
  const serverStatus = graphEditability({
    enabled: Boolean(graphId),
    snapshotVersion:
      snapshot && snapshot.graphId === graphId ? snapshot.version : undefined,
    state: data,
    error: Boolean(error),
    rejected: rejectedGraph === graphId
  });
  serverBlockedRef.current = serverStatus !== 'editable';
  const status = coordinator.frozen(graphId) ? 'locked' : serverStatus;
  blockedRef.current = status !== 'editable';
  // Each callback belongs to the loaded snapshot, not just the server lease epoch.
  // Reloading the same epoch must invalidate old async mutations too.
  const canSaveSnapshot = useCallback(
    () =>
      !serverBlockedRef.current &&
      (!graphId ||
        Boolean(
          snapshot &&
            snapshot.graphId === graphId &&
            currentSnapshotRef.current === snapshot
        )),
    [graphId, snapshot]
  );
  const canEditSnapshot = useCallback(
    () =>
      serverStatus === 'editable' &&
      canSaveSnapshot() &&
      !coordinator.frozen(graphId) &&
      coordinator.epoch(graphId) === scope,
    // Publish remote lock changes to memoized node/menu consumers as well.
    [canSaveSnapshot, coordinator, graphId, scope, serverStatus]
  );
  return {
    status,
    blocked: blockedRef.current,
    blockedRef,
    canEditSnapshot,
    canSaveSnapshot,
    acceptSnapshot,
    reject,
    retry: () => void mutate()
  };
}

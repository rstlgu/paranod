'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import {
  graphClientCoordinator,
  type GraphParticipant
} from '@/features/graph/lib/graph-client-coordinator';

export function useGraphCoordinator() {
  useSyncExternalStore(
    graphClientCoordinator.subscribe,
    graphClientCoordinator.getRevision,
    () => 0
  );
  return graphClientCoordinator;
}

export function useGraphParticipant(
  graphId: string | null | undefined,
  participant: GraphParticipant
) {
  const latest = useRef(participant);
  latest.current = participant;
  useEffect(() => {
    if (!graphId) return;
    return graphClientCoordinator.register(graphId, {
      kind: participant.kind,
      capture: () => latest.current.capture(),
      idle: () => latest.current.idle(),
      flush: (draft) => latest.current.flush(draft),
      adopt: (snapshot) => latest.current.adopt(snapshot),
      preview: (snapshot) => latest.current.preview?.(snapshot),
      invalidate: () => latest.current.invalidate?.()
    });
  }, [graphId, participant.kind]);
}

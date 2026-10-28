'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';

export function useAnalysisMutationGuard(args: {
  readOnly?: boolean;
  canEditSnapshot?: () => boolean;
  scope?: string;
}) {
  const snapshot = useMemo(
    () => ({
      readOnly: Boolean(args.readOnly),
      canEditSnapshot: args.canEditSnapshot,
      scope: args.scope,
      active: true
    }),
    [args.readOnly, args.canEditSnapshot, args.scope]
  );
  const currentSnapshotRef = useRef(snapshot);
  currentSnapshotRef.current = snapshot;

  useEffect(() => {
    snapshot.active = true;
    return () => {
      snapshot.active = false;
    };
  }, [snapshot]);

  // A callback from before a lock must stay invalid after editing resumes.
  return useCallback(
    () =>
      snapshot.active &&
      currentSnapshotRef.current === snapshot &&
      !snapshot.readOnly &&
      (snapshot.canEditSnapshot?.() ?? true),
    [snapshot]
  );
}

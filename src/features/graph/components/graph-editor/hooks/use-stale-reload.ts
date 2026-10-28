'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import {
  downloadLocalDraft,
  type GraphEditability
} from '@/features/graph/lib/graph-editability';

const RETRY_MS = 3000;

// A stale editor reloads the saved version by itself; failed reloads retry.
export function useStaleReload(
  status: GraphEditability,
  busy: boolean,
  reload: () => void
) {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const attemptedRef = useRef(false);
  useEffect(() => {
    if (status !== 'stale') {
      attemptedRef.current = false;
      return;
    }
    if (busy) return;
    if (!attemptedRef.current) {
      attemptedRef.current = true;
      reloadRef.current();
      return;
    }
    const timer = setTimeout(() => reloadRef.current(), RETRY_MS);
    return () => clearTimeout(timer);
  }, [status, busy]);
}

export function notifyReplacedDraft(value: unknown, filename: string) {
  toast.warning('Unsaved local changes were replaced by the saved version.', {
    duration: 15000,
    action: {
      label: 'Download',
      onClick: () => downloadLocalDraft(value, filename)
    }
  });
}

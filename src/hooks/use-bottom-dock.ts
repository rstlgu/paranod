'use client';

import { useCallback, useState } from 'react';
import type { BottomPanel } from '@/features/graph/lib/panel-layout';

export function useBottomDock() {
  const [state, setState] = useState({
    tab: 'console' as BottomPanel,
    expanded: false
  });
  const toggle = useCallback(
    (tab: BottomPanel) =>
      setState((current) => ({
        tab,
        expanded: current.tab === tab ? !current.expanded : true
      })),
    []
  );
  const setExpanded = useCallback(
    (expanded: boolean) => setState((current) => ({ ...current, expanded })),
    []
  );
  return { ...state, toggle, setExpanded };
}

'use client';

import { usePathname } from 'next/navigation';
import { useShallow } from 'zustand/react/shallow';
import { useWorkspaceTabsStore } from '@/features/workspace/store/workspace-tabs-store';

export interface ActiveAgentGraph {
  id: string;
  name: string;
}

// The agent works on one graph at a time: it exists only in an open graph tab.
export function useActiveAgentGraph(): ActiveAgentGraph | null {
  const pathname = usePathname();
  const tab = useWorkspaceTabsStore(
    useShallow((state) => {
      const active = state.tabs.find((item) => item.id === state.activeTabId);
      return active?.kind === 'graph'
        ? { id: active.resourceId, name: active.title }
        : null;
    })
  );
  return pathname === '/' ? tab : null;
}

export function readActiveAgentGraphId(pathname: string | null) {
  if (pathname !== '/') return null;
  const state = useWorkspaceTabsStore.getState();
  const tab = state.tabs.find((item) => item.id === state.activeTabId);
  return tab?.kind === 'graph' ? tab.resourceId : null;
}

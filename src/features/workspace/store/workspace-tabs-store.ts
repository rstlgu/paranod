'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { toast } from 'sonner';

export type WorkspaceTabKind =
  | 'graph'
  | 'case'
  | 'note'
  | 'flow'
  | 'start'
  | 'browser';

export interface WorkspaceTab {
  id: string; // `${kind}:${resourceId}`
  kind: WorkspaceTabKind;
  resourceId: string;
  title: string;
}

export const MAX_WORKSPACE_TABS = 10;

interface WorkspaceTabsState {
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  hasHydrated: boolean;
  openTab: (args: {
    kind: WorkspaceTabKind;
    resourceId: string;
    title?: string;
  }) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  setTabTitle: (tabId: string, title: string) => void;
  reorderTabs: (activeId: string, overId: string) => void;
  clear: () => void;
}

function buildTabId(kind: WorkspaceTabKind, resourceId: string) {
  return `${kind}:${resourceId}`;
}

const DEFAULT_START_RESOURCE_ID = 'new-tab';

function buildDefaultStartTab(): WorkspaceTab {
  return {
    id: buildTabId('start', DEFAULT_START_RESOURCE_ID),
    kind: 'start',
    resourceId: DEFAULT_START_RESOURCE_ID,
    title: 'New Tab'
  };
}

export const useWorkspaceTabsStore = create<WorkspaceTabsState>()(
  persist(
    (set, get) => ({
      tabs: [buildDefaultStartTab()],
      activeTabId: buildTabId('start', DEFAULT_START_RESOURCE_ID),
      hasHydrated: false,

      openTab: ({ kind, resourceId, title }) => {
        const id = buildTabId(kind, resourceId);
        const { tabs } = get();
        const existing = tabs.find((t) => t.id === id);

        if (existing) {
          // Update title if provided (e.g. opening from list)
          if (title && title !== existing.title) {
            set({
              tabs: tabs.map((t) => (t.id === id ? { ...t, title } : t)),
              activeTabId: id
            });
            return;
          }
          set({ activeTabId: id });
          return;
        }

        if (tabs.length >= MAX_WORKSPACE_TABS) {
          toast.warning(
            `Limit reached: a maximum of ${MAX_WORKSPACE_TABS} tabs can be open.`
          );
          return;
        }

        const next: WorkspaceTab = {
          id,
          kind,
          resourceId,
          title:
            title ??
            (kind === 'graph'
              ? 'Graph'
              : kind === 'case'
                ? 'Case'
                : kind === 'note'
                  ? 'Note'
                  : kind === 'flow'
                    ? 'Flow'
                    : kind === 'browser'
                      ? 'Browser'
                      : 'New Tab')
        };

        set({ tabs: [...tabs, next], activeTabId: id });
      },

      closeTab: (tabId) => {
        const { tabs, activeTabId } = get();
        const nextTabs = tabs.filter((t) => t.id !== tabId);
        let nextActive = activeTabId;

        if (nextTabs.length === 0) {
          const fallback = buildDefaultStartTab();
          set({ tabs: [fallback], activeTabId: fallback.id });
          return;
        }

        if (activeTabId === tabId) {
          const closedIndex = tabs.findIndex((t) => t.id === tabId);
          const fallback =
            nextTabs[closedIndex - 1] ?? nextTabs[closedIndex] ?? null;
          nextActive = fallback?.id ?? null;
        }

        set({ tabs: nextTabs, activeTabId: nextActive });
      },

      setActiveTab: (tabId) => set({ activeTabId: tabId }),

      setTabTitle: (tabId, title) => {
        const { tabs } = get();
        const exists = tabs.some((t) => t.id === tabId);
        if (!exists) return;
        set({ tabs: tabs.map((t) => (t.id === tabId ? { ...t, title } : t)) });
      },

      reorderTabs: (activeId, overId) => {
        if (activeId === overId) return;
        const { tabs } = get();
        const from = tabs.findIndex((t) => t.id === activeId);
        const to = tabs.findIndex((t) => t.id === overId);
        if (from < 0 || to < 0) return;

        const nextTabs = tabs.slice();
        const [moved] = nextTabs.splice(from, 1);
        if (!moved) return;
        nextTabs.splice(to, 0, moved);
        set({ tabs: nextTabs });
      },

      clear: () => {
        const fallback = buildDefaultStartTab();
        set({ tabs: [fallback], activeTabId: fallback.id });
      }
    }),
    {
      name: 'workspace-tabs',
      storage: createJSONStorage(() => sessionStorage),
      version: 1,
      onRehydrateStorage: () => () => {
        // Prevent effects from running before persisted tabs are available.
        // Without this, we can accidentally "cleanup" sessions on first mount.
        useWorkspaceTabsStore.setState({ hasHydrated: true });
      }
    }
  )
);

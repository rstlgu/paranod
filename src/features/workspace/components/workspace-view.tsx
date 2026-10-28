'use client';

import { useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useQueryState, parseAsString } from 'nuqs';
import { cn } from '@/lib/utils';
import { useWorkspaceTabsStore } from '../store/workspace-tabs-store';
import { CaseDetailContent } from '@/features/cases/components/case-detail-content';
import { CaseNoteWorkspaceEditor } from '@/features/cases/components/case-note-workspace-editor';
import { StartInvestigation } from './start-investigation';

const GraphViewPage = dynamic(
  () => import('@/features/graph/components/graph-view-page'),
  {
    ssr: false,
    loading: () => null
  }
);
const FlowViewPage = dynamic(
  () => import('@/features/flow/components/flow-view-page'),
  {
    ssr: false,
    loading: () => null
  }
);
const BrowserWorkspaceTab = dynamic(
  () => import('./browser-workspace-tab').then((m) => m.BrowserWorkspaceTab),
  { ssr: false, loading: () => null }
);

function parseOpenParam(
  open: string | null
): { kind: 'graph' | 'case' | 'note' | 'browser' | 'flow'; id: string } | null {
  if (!open) return null;
  const [kind, id] = open.split(':');
  if (!id) return null;
  if (
    kind !== 'graph' &&
    kind !== 'case' &&
    kind !== 'note' &&
    kind !== 'browser' &&
    kind !== 'flow'
  )
    return null;
  return { kind, id };
}

export function WorkspaceView() {
  const router = useRouter();
  const tabs = useWorkspaceTabsStore((s) => s.tabs);
  const activeTabId = useWorkspaceTabsStore((s) => s.activeTabId);
  const openTab = useWorkspaceTabsStore((s) => s.openTab);
  const setActiveTab = useWorkspaceTabsStore((s) => s.setActiveTab);
  const closeTab = useWorkspaceTabsStore((s) => s.closeTab);
  const hasHydrated = useWorkspaceTabsStore((s) => s.hasHydrated);

  const [open, setOpen] = useQueryState('open', parseAsString);
  const [title, setTitle] = useQueryState('title', parseAsString);

  useEffect(() => {
    if (!hasHydrated) return;

    // Cleanup: stop orphan sessions created by the user.
    // IMPORTANT: never run before Zustand persist hydration, otherwise keepSessionIds is empty
    // and we can stop sessions that are actually in open tabs.
    const keepSessionIds = tabs
      .filter((t) => t.kind === 'browser')
      .map((t) => t.resourceId)
      .filter(Boolean);

    const t = window.setTimeout(() => {
      void fetch('/api/workspaces/sessions/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keepSessionIds,
          confirmNoTabs: keepSessionIds.length === 0
        })
      }).catch(() => {});
    }, 500);

    return () => window.clearTimeout(t);
  }, [hasHydrated, tabs]);

  useEffect(() => {
    const parsed = parseOpenParam(open);
    if (!parsed) return;

    if (parsed.kind === 'case') {
      router.replace(`/cases/${parsed.id}`);
      return;
    }

    openTab({
      kind: parsed.kind,
      resourceId: parsed.id,
      title: title ?? undefined
    });

    // pulisci URL dopo l'apertura
    void setOpen(null);
    void setTitle(null);
  }, [open, title, openTab, router, setOpen, setTitle]);

  useEffect(() => {
    if (!hasHydrated) return;
    tabs
      .filter((tab) => tab.kind === 'case')
      .forEach((tab) => closeTab(tab.id));
  }, [closeTab, hasHydrated, tabs]);

  // Se non c'è activeTabId ma ho tab, attiva la prima
  useEffect(() => {
    if (activeTabId) return;
    if (tabs.length === 0) return;
    setActiveTab(tabs[0]!.id);
  }, [activeTabId, tabs, setActiveTab]);

  // Evita che una tab precedente (es. ReactFlow) resti "focalizzata" e continui a ricevere eventi da tastiera.
  useEffect(() => {
    if (!activeTabId) return;
    const el = document.activeElement;
    if (el && el instanceof HTMLElement) el.blur();
    // ReactFlow può lasciare un cursor globale (es. crosshair) durante connessioni/drag.
    document.body.style.removeProperty('cursor');
    document.documentElement.style.removeProperty('cursor');
  }, [activeTabId]);

  return (
    <div className='relative h-full w-full'>
      {tabs.length === 0 && (
        <div className='flex h-full w-full items-start justify-center overflow-y-auto px-4 pt-12 pb-12 md:px-6 md:pt-[10vh]'>
          <StartInvestigation />
        </div>
      )}
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            className={cn(
              'h-full w-full',
              isActive ? 'absolute inset-0 block' : 'hidden'
            )}
            aria-hidden={!isActive}
          >
            {tab.kind === 'start' ? (
              <div className='flex h-full w-full items-start justify-center overflow-y-auto px-4 pt-12 pb-12 md:px-6 md:pt-[10vh]'>
                <StartInvestigation tabId={tab.id} />
              </div>
            ) : tab.kind === 'graph' ? (
              <GraphViewPage graphId={tab.resourceId} isActive={isActive} />
            ) : tab.kind === 'flow' ? (
              <FlowViewPage flowId={tab.resourceId} isActive={isActive} />
            ) : tab.kind === 'note' ? (
              <CaseNoteWorkspaceEditor
                resourceId={tab.resourceId}
                isActive={isActive}
                onOpenGraph={(graphId, graphTitle) =>
                  openTab({
                    kind: 'graph',
                    resourceId: graphId,
                    title: graphTitle
                  })
                }
              />
            ) : tab.kind === 'browser' ? (
              <BrowserWorkspaceTab
                sessionId={tab.resourceId}
                isActive={isActive}
              />
            ) : (
              <CaseDetailContent
                caseId={tab.resourceId}
                isActive={isActive}
                onOpenGraph={(graphId, title) =>
                  openTab({
                    kind: 'graph',
                    resourceId: graphId,
                    title: title ?? 'Graph'
                  })
                }
                onOpenNote={(caseId, noteId, noteTitle) =>
                  openTab({
                    kind: 'note',
                    resourceId: `${caseId}/${noteId}`,
                    title: noteTitle ?? 'Note'
                  })
                }
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

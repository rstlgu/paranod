'use client';

import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  CaretDownIcon as CaretDown,
  CaretRightIcon as CaretRight,
  FolderOpenIcon as FolderOpen,
  GraphIcon as Graph,
  XIcon as X
} from '@/components/icons';
import { useWorkspaceTabsStore } from '../store/workspace-tabs-store';

type CaseGraphItem = { id: string; name: string };

function getActiveCaseId(activeTabId: string | null): string | null {
  if (!activeTabId) return null;
  const [kind, id] = activeTabId.split(':');
  if (kind !== 'case') return null;
  return id ?? null;
}

export function WorkspaceSidebarTree() {
  const tabs = useWorkspaceTabsStore((s) => s.tabs);
  const activeTabId = useWorkspaceTabsStore((s) => s.activeTabId);
  const setActiveTab = useWorkspaceTabsStore((s) => s.setActiveTab);
  const closeTab = useWorkspaceTabsStore((s) => s.closeTab);
  const openTab = useWorkspaceTabsStore((s) => s.openTab);

  const [isCasesOpen, setIsCasesOpen] = useState(true);
  const [caseGraphs, setCaseGraphs] = useState<CaseGraphItem[]>([]);
  const [isLoadingCaseGraphs, setIsLoadingCaseGraphs] = useState(false);

  const caseTabs = useMemo(() => tabs.filter((t) => t.kind === 'case'), [tabs]);
  const activeCaseId = getActiveCaseId(activeTabId);

  useEffect(() => {
    if (!activeCaseId) {
      setCaseGraphs([]);
      return;
    }

    let isCancelled = false;
    async function load() {
      setIsLoadingCaseGraphs(true);
      try {
        const res = await fetch(`/api/cases/${activeCaseId}/graphs`);
        if (!res.ok) return;
        const data = await res.json();
        const graphs = Array.isArray(data.graphs) ? data.graphs : [];
        const mapped = graphs
          .filter((g: any) => g && typeof g.id === 'string')
          .map((g: any) => ({
            id: g.id as string,
            name: String(g.name ?? 'Graph')
          }));
        if (!isCancelled) setCaseGraphs(mapped);
      } finally {
        if (!isCancelled) setIsLoadingCaseGraphs(false);
      }
    }
    void load();
    return () => {
      isCancelled = true;
    };
  }, [activeCaseId]);

  return (
    <aside className='border-border/20 flex h-full w-[280px] shrink-0 flex-col border-r bg-black/60'>
      <div className='flex items-center justify-between px-3 py-3'>
        <div className='text-xs font-semibold tracking-wide text-zinc-200'>
          Workspace
        </div>
      </div>

      <div className='min-h-0 flex-1 overflow-auto px-2 pb-3'>
        {/* CASES */}
        <button
          type='button'
          onClick={() => setIsCasesOpen((v) => !v)}
          className='flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-900/60'
        >
          {isCasesOpen ? (
            <CaretDown className='h-3.5 w-3.5' />
          ) : (
            <CaretRight className='h-3.5 w-3.5' />
          )}
          <FolderOpen className='h-4 w-4' />
          <span className='flex-1 text-left'>Cases</span>
          <span className='text-[10px] text-zinc-500'>{caseTabs.length}</span>
        </button>

        {isCasesOpen && (
          <div className='mt-1 space-y-0.5'>
            {caseTabs.map((t) => {
              const isActive = t.id === activeTabId;
              return (
                <div key={t.id}>
                  <button
                    type='button'
                    onClick={() => setActiveTab(t.id)}
                    className={cn(
                      'group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                      isActive
                        ? 'bg-zinc-900/70 text-zinc-100'
                        : 'text-zinc-300 hover:bg-zinc-900/50'
                    )}
                  >
                    <span className='h-1.5 w-1.5 rounded-full bg-zinc-600' />
                    <span className='min-w-0 flex-1 truncate text-left'>
                      {t.title}
                    </span>
                    <span
                      className='inline-flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 opacity-0 group-hover:opacity-100 hover:bg-zinc-800 hover:text-zinc-100'
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTab(t.id);
                      }}
                      role='button'
                      aria-label='Close case tab'
                    >
                      <X className='h-3.5 w-3.5' />
                    </span>
                  </button>

                  {/* children: graphs in active case */}
                  {isActive && (
                    <div className='border-border/10 mt-1 ml-4 space-y-0.5 border-l pl-2'>
                      <div className='px-2 py-1 text-[10px] font-medium tracking-wide text-zinc-500 uppercase'>
                        Graphs
                      </div>
                      {isLoadingCaseGraphs ? (
                        <div className='px-2 py-1 text-xs text-zinc-500'>
                          Loading…
                        </div>
                      ) : caseGraphs.length === 0 ? (
                        <div className='px-2 py-1 text-xs text-zinc-500'>
                          No graphs
                        </div>
                      ) : (
                        caseGraphs.map((g) => (
                          <button
                            key={g.id}
                            type='button'
                            onClick={() =>
                              openTab({
                                kind: 'graph',
                                resourceId: g.id,
                                title: g.name
                              })
                            }
                            className='flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-900/50'
                          >
                            <Graph className='h-3.5 w-3.5 text-zinc-400' />
                            <span className='min-w-0 flex-1 truncate'>
                              {g.name}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}

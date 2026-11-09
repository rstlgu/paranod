'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import {
  FolderOpenIcon as FolderOpen,
  GlobeIcon as Globe,
  GraphIcon as Graph,
  NoteIcon as Note,
  ArrowsSplitIcon as FlowIcon,
  PlusIcon as Plus,
  XIcon as IconX
} from '@/components/icons';
import { toast } from 'sonner';
import {
  MAX_WORKSPACE_TABS,
  useWorkspaceTabsStore
} from '../store/workspace-tabs-store';
import { Icons } from '@/components/icons';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  AnimatePresence,
  LayoutGroup,
  motion,
  useReducedMotion
} from 'framer-motion';
import type { WorkspaceTab } from '../store/workspace-tabs-store';

const TAB_LAYOUT_TRANSITION = {
  duration: 0.16,
  ease: [0.22, 1, 0.36, 1]
} as const;

const TAB_FADE_TRANSITION = {
  duration: 0.1,
  ease: 'easeOut'
} as const;

function normalizeTabTitle(value: string) {
  const next = value.trim();
  return next.length > 0 ? next : null;
}

async function persistTabRename(args: {
  tabId: string;
  kind: 'graph' | 'case' | 'flow' | 'note';
  resourceId: string;
  prevTitle: string;
  nextTitle: string;
}) {
  try {
    if (args.kind === 'graph') {
      const res = await fetch(`/api/graphs/${args.resourceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: args.nextTitle })
      });
      if (!res.ok) throw new Error('graph_rename_failed');
      localStorage.setItem('graphs-need-refresh', 'true');
      return;
    }

    if (args.kind === 'flow') {
      const res = await fetch(`/api/flows/${args.resourceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: args.nextTitle })
      });
      if (!res.ok) throw new Error('flow_rename_failed');
      localStorage.setItem('flows-need-refresh', 'true');
      return;
    }

    if (args.kind === 'note') {
      const separator = args.resourceId.indexOf('/');
      if (separator < 1 || separator === args.resourceId.length - 1) {
        throw new Error('note_resource_invalid');
      }
      const caseId = encodeURIComponent(args.resourceId.slice(0, separator));
      const noteId = encodeURIComponent(args.resourceId.slice(separator + 1));
      const res = await fetch(`/api/cases/${caseId}/notes/${noteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: args.nextTitle })
      });
      if (!res.ok) throw new Error('note_rename_failed');
      return;
    }

    const res = await fetch(`/api/cases/${args.resourceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: args.nextTitle })
    });
    if (!res.ok) throw new Error('case_rename_failed');
    localStorage.setItem('cases-need-refresh', 'true');
  } catch {
    // Evita di "tornare indietro" se l'utente ha già rinominato di nuovo
    const current = useWorkspaceTabsStore
      .getState()
      .tabs.find((t) => t.id === args.tabId)?.title;
    if (current === args.nextTitle)
      useWorkspaceTabsStore.getState().setTabTitle(args.tabId, args.prevTitle);

    toast.error('Unable to rename. Try again.');
  }
}

interface SortableWorkspaceTabButtonProps {
  tab: WorkspaceTab;
  isActive: boolean;
  isCloseHidden: boolean;
  editingTabId: string | null;
  setEditingTabId: (value: string | null) => void;
  draftTitle: string;
  setDraftTitle: (value: string) => void;
  setActiveTab: (tabId: string) => void;
  closeTab: (tabId: string) => void;
  setTabTitle: (tabId: string, title: string) => void;
  reduceMotion: boolean;
}

function SortableWorkspaceTabButton({
  tab,
  isActive,
  isCloseHidden,
  editingTabId,
  setEditingTabId,
  draftTitle,
  setDraftTitle,
  setActiveTab,
  closeTab,
  setTabTitle,
  reduceMotion
}: SortableWorkspaceTabButtonProps) {
  const isEditing = tab.id === editingTabId;
  const editInputWidth = Math.min(
    220,
    Math.max(80, Math.max(tab.title.length, draftTitle.length, 8) * 7.5 + 12)
  );
  const LeadingIcon =
    tab.kind === 'case'
      ? FolderOpen
      : tab.kind === 'graph'
        ? Graph
        : tab.kind === 'note'
          ? Note
          : tab.kind === 'flow'
            ? FlowIcon
            : tab.kind === 'browser'
              ? Globe
              : Icons.logo;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({
    id: tab.id,
    disabled: isEditing
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition
  };

  function enterEditMode() {
    setActiveTab(tab.id);
    setEditingTabId(tab.id);
    setDraftTitle(tab.title);
  }

  function cancelEditMode() {
    setEditingTabId(null);
    setDraftTitle('');
  }

  function commitEditMode() {
    const nextTitle = normalizeTabTitle(draftTitle);
    if (nextTitle && nextTitle !== tab.title) {
      const prevTitle = tab.title;
      setTabTitle(tab.id, nextTitle);
      if (
        tab.kind === 'graph' ||
        tab.kind === 'case' ||
        tab.kind === 'flow' ||
        tab.kind === 'note'
      ) {
        void persistTabRename({
          tabId: tab.id,
          kind: tab.kind,
          resourceId: tab.resourceId,
          prevTitle,
          nextTitle
        });
      }
    }
    cancelEditMode();
  }

  return (
    <button
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      type='button'
      onClick={() => {
        if (isEditing) return;
        setActiveTab(tab.id);
      }}
      onDoubleClick={(e) => {
        e.preventDefault();
        enterEditMode();
      }}
      className={cn(
        // VSCode-like tabs: full height, squared corners, separators
        'group/tab relative flex h-full shrink-0 items-center gap-2 px-3 text-sm transition-colors',
        // Non-active tabs sit 1px lower than active
        isActive ? 'translate-y-0' : 'translate-y-px',
        '-ml-px border-t border-r border-l first:ml-0',
        'outline-none focus-visible:ring-0 focus-visible:outline-none',
        'border-border/30 dark:border-white/10',
        !isEditing && 'hover:cursor-grab active:cursor-grabbing',
        isActive
          ? 'bg-background text-foreground z-10 border-b-0 font-medium'
          : 'bg-muted/5 text-muted-foreground hover:bg-muted/10 border-b-0',
        // Con DragOverlay, l'elemento in drag resta come placeholder (invisibile) nella lista
        isDragging && 'cursor-grabbing opacity-0'
      )}
    >
      {isActive ? (
        <motion.span
          layoutId='workspace-active-tab-indicator'
          className='bg-primary absolute inset-x-0 top-0 h-[2px]'
          transition={reduceMotion ? { duration: 0 } : TAB_LAYOUT_TRANSITION}
        />
      ) : null}

      <LeadingIcon
        key='leading-icon'
        className={cn(
          'h-4 w-4',
          tab.kind === 'flow' && '-rotate-90',
          isActive ? 'text-foreground' : 'text-muted-foreground'
        )}
      />

      <span className='relative flex max-w-[220px] min-w-0 items-center'>
        <AnimatePresence initial={false} mode='popLayout'>
          {isEditing ? (
            <motion.input
              key='title-input'
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onBlur={() => commitEditMode()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitEditMode();
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  cancelEditMode();
                }
              }}
              onFocus={(e) => e.currentTarget.select()}
              autoFocus
              aria-label='Rename tab'
              initial={reduceMotion ? false : { opacity: 0, y: 1 }}
              animate={{ opacity: 1, y: 0, width: editInputWidth }}
              exit={reduceMotion ? undefined : { opacity: 0, y: -1 }}
              transition={reduceMotion ? { duration: 0 } : TAB_FADE_TRANSITION}
              className={cn(
                'block max-w-[220px] min-w-0 bg-transparent text-sm',
                'ring-0 outline-none focus-visible:ring-0 focus-visible:outline-none'
              )}
            />
          ) : (
            <motion.span
              key={`title-${tab.title}`}
              initial={reduceMotion ? false : { opacity: 0, y: 1 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, y: -1 }}
              transition={reduceMotion ? { duration: 0 } : TAB_FADE_TRANSITION}
              className='block max-w-[220px] truncate'
            >
              {tab.title}
            </motion.span>
          )}
        </AnimatePresence>
      </span>

      {!isCloseHidden ? (
        <span key='close' className='flex items-center'>
          <span
            className={cn(
              'text-muted-foreground hover:bg-muted hover:text-foreground flex h-6 w-6 cursor-pointer items-center justify-center rounded-md transition-[opacity,background-color,color] duration-100 ease-out',
              !isActive && 'opacity-0 group-hover/tab:opacity-100',
              isEditing && 'pointer-events-none opacity-0'
            )}
            onClick={(e) => {
              e.stopPropagation();
              if (tab.kind === 'browser') {
                const sessionId = tab.resourceId;
                // Close UI immediately; stop the container in background.
                closeTab(tab.id);
                void fetch(
                  `/api/workspaces/sessions/${encodeURIComponent(sessionId)}`,
                  {
                    method: 'DELETE'
                  }
                ).catch(() => {});
                return;
              }
              closeTab(tab.id);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            role='button'
            aria-label='Close tab'
          >
            <IconX className='h-3.5 w-3.5' />
          </span>
        </span>
      ) : null}
    </button>
  );
}

interface WorkspaceTabOverlayProps {
  tab: WorkspaceTab;
  isActive: boolean;
}

function WorkspaceTabOverlay({ tab, isActive }: WorkspaceTabOverlayProps) {
  const LeadingIcon =
    tab.kind === 'case'
      ? FolderOpen
      : tab.kind === 'graph'
        ? Graph
        : tab.kind === 'note'
          ? Note
          : tab.kind === 'flow'
            ? FlowIcon
            : tab.kind === 'browser'
              ? Globe
              : Icons.logo;

  return (
    <div
      className={cn(
        'relative flex h-full shrink-0 items-center gap-2 px-3 text-sm',
        'border-border/40 bg-background rounded-md border shadow-lg',
        'text-foreground'
      )}
      style={{ height: '100%' }}
    >
      {isActive && (
        <span className='bg-primary absolute inset-x-0 top-0 h-[2px]' />
      )}
      <LeadingIcon
        className={cn(
          'h-4 w-4',
          isActive ? 'text-foreground' : 'text-muted-foreground'
        )}
      />
      <span className='max-w-[220px] truncate'>{tab.title}</span>
    </div>
  );
}

export function WorkspaceTabs() {
  const tabs = useWorkspaceTabsStore((s) => s.tabs);
  const activeTabId = useWorkspaceTabsStore((s) => s.activeTabId);
  const setActiveTab = useWorkspaceTabsStore((s) => s.setActiveTab);
  const closeTab = useWorkspaceTabsStore((s) => s.closeTab);
  const setTabTitle = useWorkspaceTabsStore((s) => s.setTabTitle);
  const openTab = useWorkspaceTabsStore((s) => s.openTab);
  const reorderTabs = useWorkspaceTabsStore((s) => s.reorderTabs);

  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const shouldReduceMotion = useReducedMotion();

  const hasTabs = tabs.length > 0;
  const visibleTabs = useMemo(() => tabs, [tabs]);
  const isOnlyNewTab = tabs.length === 1 && tabs[0]?.kind === 'start';
  const hasReachedTabLimit = tabs.length >= MAX_WORKSPACE_TABS;
  const tabIds = useMemo(() => visibleTabs.map((t) => t.id), [visibleTabs]);
  const draggingTab = useMemo(
    () =>
      draggingTabId
        ? (visibleTabs.find((t) => t.id === draggingTabId) ?? null)
        : null,
    [draggingTabId, visibleTabs]
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function openStartTab() {
    if (hasReachedTabLimit) return;
    const resourceId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : String(Date.now());
    openTab({ kind: 'start', resourceId, title: 'New Tab' });
  }

  function onDragEnd(event: DragEndEvent) {
    const overId = event.over?.id;
    if (!overId) return;
    reorderTabs(String(event.active.id), String(overId));
    setDraggingTabId(null);
  }

  function onDragStart(event: DragStartEvent) {
    setDraggingTabId(String(event.active.id));
  }

  function onDragCancel() {
    setDraggingTabId(null);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <LayoutGroup id='workspace-tabs'>
        <SortableContext
          items={tabIds}
          strategy={horizontalListSortingStrategy}
        >
          <div className='group/tabs flex h-full min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden'>
            <AnimatePresence initial={false} mode='popLayout'>
              {visibleTabs.map((tab) => (
                <motion.div
                  key={tab.id}
                  layout={shouldReduceMotion ? false : 'position'}
                  initial={
                    shouldReduceMotion
                      ? false
                      : { opacity: 0, scale: 0.96, x: -6 }
                  }
                  animate={{ opacity: 1, scale: 1, x: 0 }}
                  exit={
                    shouldReduceMotion
                      ? undefined
                      : { opacity: 0, scale: 0.96, x: -4 }
                  }
                  transition={
                    shouldReduceMotion ? { duration: 0 } : TAB_LAYOUT_TRANSITION
                  }
                  className='h-full shrink-0 origin-left'
                >
                  <SortableWorkspaceTabButton
                    tab={tab}
                    isActive={tab.id === activeTabId}
                    isCloseHidden={isOnlyNewTab && tab.kind === 'start'}
                    editingTabId={editingTabId}
                    setEditingTabId={setEditingTabId}
                    draftTitle={draftTitle}
                    setDraftTitle={setDraftTitle}
                    setActiveTab={setActiveTab}
                    closeTab={closeTab}
                    setTabTitle={setTabTitle}
                    reduceMotion={Boolean(shouldReduceMotion)}
                  />
                </motion.div>
              ))}
            </AnimatePresence>

            {/* "+" tab (browser-like). A destra. */}
            <motion.button
              layout={shouldReduceMotion ? false : 'position'}
              transition={
                shouldReduceMotion ? { duration: 0 } : TAB_LAYOUT_TRANSITION
              }
              type='button'
              onClick={openStartTab}
              disabled={hasReachedTabLimit}
              aria-label='New tab'
              className={cn(
                'relative flex h-full shrink-0 items-center px-3 text-sm transition-[background-color,color,border-color,opacity] duration-150 ease-out',
                '-ml-px border-t border-r border-l first:ml-0',
                'border-border/30 dark:border-white/10',
                'bg-muted/5 text-muted-foreground hover:bg-muted/10 hover:text-foreground border-b-0',
                // Mostra solo in hover sulle tabs (o se è l'unica tab)
                isOnlyNewTab || !hasTabs
                  ? 'opacity-100'
                  : 'pointer-events-none opacity-0 group-hover/tabs:pointer-events-auto group-hover/tabs:opacity-100',
                hasReachedTabLimit && 'pointer-events-none opacity-40'
              )}
            >
              <Plus className='h-4 w-4' />
            </motion.button>
          </div>
        </SortableContext>

        <DragOverlay>
          {draggingTab ? (
            <WorkspaceTabOverlay
              tab={draggingTab}
              isActive={draggingTab.id === activeTabId}
            />
          ) : null}
        </DragOverlay>
      </LayoutGroup>
    </DndContext>
  );
}

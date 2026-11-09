'use client';

import * as React from 'react';
import {
  useFloatingPanel,
  FLOATING_RESIZE_HANDLES
} from '@/hooks/use-floating-panel';
import dynamic from 'next/dynamic';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import type { Node } from 'reactflow';
import type { ImperativePanelHandle } from 'react-resizable-panels';
import { toast } from 'sonner';
import {
  AppWindowIcon as IconWindow,
  ArrowSquareOutIcon as IconOpenExternal,
  CircleNotchIcon as IconLoader,
  NotePencilIcon as IconCreateNote,
  SidebarSimpleIcon as IconSidebar,
  XIcon as IconClose
} from '@/components/icons';
import { Button } from '@/components/ui/button';
import { ResizableHandle, ResizablePanel } from '@/components/ui/resizable';
import { Skeleton } from '@/components/ui/skeleton';
import { GraphSidepanelBottomBar } from './graph-sidepanel-bottom-bar';
import type { CaseReference } from '@/features/cases/components/case-note-types';
import {
  dispatchLinkedGraphNoteUpdated,
  LINKED_GRAPH_NOTE_UPDATED_EVENT,
  type LinkedGraphNoteUpdatedDetail
} from '@/features/cases/lib/linked-graph-note-events';
import type { OSINTNodeData } from '@/features/graph/types';
import { useGraphCanEdit } from '@/features/graph/contexts/graph-mutation-context';
import { useWorkspaceTabsStore } from '@/features/workspace/store/workspace-tabs-store';
import {
  getLogoUrlForDomain,
  getNodeTypeUiLabel,
  nodeTypeByType,
  type NodeType
} from '@/features/osint/node-registry';
import { cn } from '@/lib/utils';
import { useGraphWriteGuard } from '../hooks/use-graph-write-guard';
import { notifyReplacedDraft, useStaleReload } from '../hooks/use-stale-reload';
import { createSerialSaveQueue } from '@/features/graph/lib/serial-save-queue';
import { graphClientCoordinator } from '@/features/graph/lib/graph-client-coordinator';
import { useGraphParticipant } from '../hooks/use-graph-participant';

const GraphNotesEditor = dynamic(
  () =>
    import('@/features/cases/components/case-rich-text-editor').then(
      (module) => module.CaseRichTextEditor
    ),
  {
    ssr: false,
    loading: () => <Skeleton className='h-full min-h-72 w-full rounded-none' />
  }
);

interface GraphNotesPanelProps {
  graphId?: string;
  graphName: string;
  nodes: ReadonlyArray<Node>;
  notesPanelRef: React.MutableRefObject<ImperativePanelHandle | null>;
  lastOpenNotesSizeRef: React.MutableRefObject<number>;
  notesStateFromResizeRef: React.MutableRefObject<boolean>;
  isNotesPanelOpen: boolean;
  setIsNotesPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isDetached: boolean;
  detachNotesPanel: () => void;
  attachNotesPanel: () => void;
  notesCollapsedSizePct: number;
  notesMinSizePct: number;
  notesMaxSizePct: number;
  closeNotesPanel: () => void;
  onSelectNodeId: (nodeId: string) => void;
}

const AUTOSAVE_DELAY = 2000;
const DEFAULT_ACCENT = '#94a3b8';

interface LinkedCaseNote {
  id: string;
  caseId: string;
  name: string;
  graphId: string | null;
}

function getFaviconUrl(type: string, value: string) {
  if (!['domain', 'subdomain', 'hostname', 'url'].includes(type)) return null;

  let domain = '';
  try {
    domain = new URL(value.includes('://') ? value : `https://${value}`)
      .hostname;
  } catch {
    domain = value.replace(/^https?:\/\//i, '').split('/')[0] ?? '';
  }

  return domain ? (getLogoUrlForDomain({ domain, size: 32 }) ?? null) : null;
}

function getMetadataSearchText(metadata: Record<string, unknown> | undefined) {
  if (!metadata) return '';
  return Object.entries(metadata)
    .flatMap(([key, value]) => {
      if (typeof value === 'string' || typeof value === 'number') {
        return [key, String(value)];
      }
      if (!Array.isArray(value)) return [];
      return [
        key,
        ...value
          .filter(
            (item) => typeof item === 'string' || typeof item === 'number'
          )
          .slice(0, 8)
          .map(String)
      ];
    })
    .slice(0, 40)
    .join(' ');
}

function buildGraphReferences(
  graphId: string,
  graphName: string,
  nodes: ReadonlyArray<Node>
) {
  const nodeIdByReferenceId = new Map<string, string>();
  const references = nodes.flatMap((node) => {
    const data = node.data as OSINTNodeData | undefined;
    const entityType = String(data?.type ?? 'custom');
    const definition = nodeTypeByType[entityType as NodeType];
    const typeLabel = definition
      ? getNodeTypeUiLabel(entityType as NodeType)
      : entityType;
    const label = String(data?.label ?? '').trim() || typeLabel || node.id;
    const customColor = data?.metadata?.customColor;
    const accentColor =
      typeof customColor === 'string' && /^#[0-9a-f]{6}$/i.test(customColor)
        ? customColor
        : (definition?.colorHex ?? DEFAULT_ACCENT);
    const referenceId = `entity:${graphId}:${encodeURIComponent(node.id)}`;
    nodeIdByReferenceId.set(referenceId, node.id);

    return [
      {
        id: referenceId,
        label,
        kind: 'entity' as const,
        graphId,
        graphName,
        subtitle: typeLabel,
        entityType,
        category: definition?.category ?? 'Other',
        accentColor,
        faviconUrl: getFaviconUrl(entityType, label),
        iconUrl: definition
          ? `/api/public/entity-icons/${encodeURIComponent(entityType)}`
          : null,
        searchText:
          `${label} ${entityType} ${typeLabel} ${getMetadataSearchText(data?.metadata)}`.trim()
      } satisfies CaseReference
    ];
  });

  return { references, nodeIdByReferenceId };
}

export function GraphNotesPanel({
  graphId,
  graphName,
  nodes,
  notesPanelRef,
  lastOpenNotesSizeRef,
  notesStateFromResizeRef,
  isNotesPanelOpen,
  setIsNotesPanelOpen,
  isDetached,
  detachNotesPanel,
  attachNotesPanel,
  notesCollapsedSizePct,
  notesMinSizePct,
  notesMaxSizePct,
  closeNotesPanel,
  onSelectNodeId
}: GraphNotesPanelProps) {
  const openTab = useWorkspaceTabsStore((state) => state.openTab);
  const writeGuard = useGraphWriteGuard(graphId);
  const canEdit = useGraphCanEdit();
  const readOnly = writeGuard.blocked || !canEdit();
  const {
    blockedRef,
    acceptSnapshot,
    reject,
    canEditSnapshot,
    canSaveSnapshot
  } = writeGuard;
  const [content, setContent] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);
  const [isLoaded, setIsLoaded] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isOpeningCaseNote, setIsOpeningCaseNote] = React.useState(false);
  const [loadError, setLoadError] = React.useState(false);
  const [linkedCaseNote, setLinkedCaseNote] =
    React.useState<LinkedCaseNote | null>(null);
  const [editorStats, setEditorStats] = React.useState({
    words: 0,
    characters: 0
  });
  const latestContentRef = React.useRef('');
  const currentGraphRef = React.useRef(graphId);
  currentGraphRef.current = graphId;
  const loadGenerationRef = React.useRef(0);
  const graphWriteVersionRef = React.useRef<number | undefined>(undefined);
  const graphWriteBlockedRef = React.useRef(false);
  const savedContentRef = React.useRef('');
  const savingContentRef = React.useRef<string | null>(null);
  const saveQueueRef = React.useRef(createSerialSaveQueue());
  const isMountedRef = React.useRef(false);
  const wasOpenRef = React.useRef(false);
  const { floatingBoundsRef, floatingRect, beginFloatingInteraction } =
    useFloatingPanel({ isDetached });

  const { references, nodeIdByReferenceId } = React.useMemo(
    () => buildGraphReferences(graphId ?? '', graphName, nodes),
    [graphId, graphName, nodes]
  );

  const loadNote = React.useCallback(async () => {
    if (!graphId || isLoading) return;
    // A first read is safe during a run; never replace an existing frozen draft.
    const browsingLockedNote = !isLoaded && graphClientCoordinator.frozen(graphId);
    if (graphClientCoordinator.frozen(graphId) && !browsingLockedNote) return;
    const scope = graphClientCoordinator.epoch(graphId);
    const generation = ++loadGenerationRef.current;
    setIsLoading(true);
    setLoadError(false);
    try {
      await saveQueueRef.current.idle();
      if (
        generation !== loadGenerationRef.current ||
        currentGraphRef.current !== graphId ||
        graphClientCoordinator.epoch(graphId) !== scope ||
        (graphClientCoordinator.frozen(graphId) && !browsingLockedNote)
      )
        return;
      const response = await fetch(
        `/api/graphs/${encodeURIComponent(graphId)}/notes`,
        { cache: 'no-store' }
      );
      if (!response.ok) throw new Error('load_failed');
      const data = await response.json();
      if (
        generation !== loadGenerationRef.current ||
        currentGraphRef.current !== graphId ||
        graphClientCoordinator.epoch(graphId) !== scope ||
        (graphClientCoordinator.frozen(graphId) && !browsingLockedNote)
      )
        return;
      graphWriteVersionRef.current = data.writeState?.version ?? 0;
      if (data.writeState) acceptSnapshot(graphId, data.writeState);
      graphWriteBlockedRef.current = false;
      const loadedContent =
        typeof data?.content === 'string' ? data.content : '';
      setLinkedCaseNote(
        data?.caseNote && typeof data.caseNote.id === 'string'
          ? (data.caseNote as LinkedCaseNote)
          : null
      );
      setContent(loadedContent);
      latestContentRef.current = loadedContent;
      savedContentRef.current = loadedContent;
      savingContentRef.current = null;
      setIsLoaded(true);
    } catch {
      setLoadError(true);
    } finally {
      setIsLoading(false);
    }
  }, [acceptSnapshot, graphId, isLoaded, isLoading]);
  useStaleReload(writeGuard.status, isLoading, () => {
    if (latestContentRef.current !== savedContentRef.current)
      notifyReplacedDraft(
        { graphId, content: latestContentRef.current },
        'graph-notes-local-draft.json'
      );
    void loadNote();
  });

  React.useEffect(() => {
    setContent('');
    latestContentRef.current = '';
    graphWriteVersionRef.current = undefined;
    graphWriteBlockedRef.current = false;
    savedContentRef.current = '';
    savingContentRef.current = null;
    setLinkedCaseNote(null);
    setEditorStats({ words: 0, characters: 0 });
    setIsLoaded(false);
    setLoadError(false);
  }, [graphId]);

  React.useEffect(() => {
    if (!isNotesPanelOpen || isLoaded || isLoading || !graphId) return;
    void loadNote();
  }, [
    graphId,
    isLoaded,
    isLoading,
    isNotesPanelOpen,
    loadNote,
    writeGuard.blocked
  ]);

  const handleContentChange = React.useCallback(
    (nextContent: string) => {
      if (!canEdit() || !canEditSnapshot()) return;
      latestContentRef.current = nextContent;
      setContent(nextContent);
    },
    [canEdit, canEditSnapshot]
  );

  const saveNote = React.useCallback(
    ({
      keepalive = false,
      barrier = false
    }: { keepalive?: boolean; barrier?: boolean } = {}): Promise<boolean> => {
      const contentToSave = latestContentRef.current;
      const version = graphWriteVersionRef.current;
      const isCurrent = () =>
        currentGraphRef.current === graphId &&
        canSaveSnapshot() &&
        !graphWriteBlockedRef.current &&
        graphWriteVersionRef.current === version;
      if (
        !graphId ||
        !isLoaded ||
        version === undefined ||
        !isCurrent() ||
        !graphClientCoordinator.canSave(graphId, barrier) ||
        graphClientCoordinator.noteConflict(graphId)
      ) {
        return Promise.resolve(false);
      }

      return saveQueueRef.current.enqueue(async () => {
        if (!isCurrent()) return false;
        if (!barrier && contentToSave === savedContentRef.current) return true;
        savingContentRef.current = contentToSave;
        if (isMountedRef.current) setIsSaving(true);
        try {
          const response = await fetch(
            `/api/graphs/${encodeURIComponent(graphId)}/notes`,
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                content: contentToSave,
                expectedWriteVersion: version
              }),
              keepalive
            }
          );
          if (!isCurrent()) return false;
          if ([409, 423, 428].includes(response.status)) {
            graphWriteBlockedRef.current = true;
            reject();
          }
          if (!response.ok) throw new Error('save_failed');
          savedContentRef.current = contentToSave;
          if (linkedCaseNote) {
            dispatchLinkedGraphNoteUpdated({
              graphId,
              writeVersion: version,
              note: linkedCaseNote,
              content: contentToSave
            });
          }
          if (isMountedRef.current) setLoadError(false);
          return true;
        } catch {
          if (isMountedRef.current) setLoadError(true);
          return false;
        } finally {
          if (savingContentRef.current === contentToSave) {
            savingContentRef.current = null;
          }
          if (isMountedRef.current) setIsSaving(false);
        }
      });
    },
    [canSaveSnapshot, graphId, isLoaded, linkedCaseNote, reject]
  );

  useGraphParticipant(graphId, {
    kind: 'note',
    capture: () =>
      !isLoaded && !isLoading
        ? null
        : {
            ready: isLoaded && !isLoading && canSaveSnapshot(),
            version: graphWriteVersionRef.current,
            value: latestContentRef.current,
            dirty: latestContentRef.current !== savedContentRef.current
          },
    idle: () => saveQueueRef.current.idle(),
    invalidate: reject,
    flush: async () => {
      const saved = await saveNote({ barrier: true });
      await saveQueueRef.current.idle();
      return saved && latestContentRef.current === savedContentRef.current;
    },
    adopt: (snapshot) => {
      loadGenerationRef.current++;
      latestContentRef.current = snapshot.notes;
      savedContentRef.current = snapshot.notes;
      graphWriteVersionRef.current = snapshot.writeState.version;
      graphWriteBlockedRef.current = false;
      setContent(snapshot.notes);
      setLoadError(false);
      acceptSnapshot(snapshot.graphId, snapshot.writeState);
    }
  });

  const flushPendingSave = React.useCallback(() => {
    void saveNote({ keepalive: true });
  }, [saveNote]);

  const isDirty = isLoaded && content !== savedContentRef.current;

  React.useEffect(() => {
    if (!isDirty || isSaving) return;
    const timeout = window.setTimeout(() => void saveNote(), AUTOSAVE_DELAY);
    return () => window.clearTimeout(timeout);
  }, [content, isDirty, isSaving, saveNote]);

  React.useEffect(() => {
    if (wasOpenRef.current && !isNotesPanelOpen) flushPendingSave();
    wasOpenRef.current = isNotesPanelOpen;
  }, [flushPendingSave, isNotesPanelOpen]);

  React.useEffect(() => {
    isMountedRef.current = true;
    const handlePageHide = () => flushPendingSave();
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      flushPendingSave();
      isMountedRef.current = false;
    };
  }, [flushPendingSave]);

  React.useEffect(() => {
    if (!graphId) return;

    const handleLinkedNoteUpdate = (event: Event) => {
      const detail = (event as CustomEvent<LinkedGraphNoteUpdatedDetail>)
        .detail;
      if (!detail || detail.graphId !== graphId) return;
      if (
        blockedRef.current ||
        graphClientCoordinator.frozen(graphId) ||
        detail.writeVersion !== graphWriteVersionRef.current ||
        saveQueueRef.current.pending > 0
      )
        return;
      if (
        latestContentRef.current !== savedContentRef.current &&
        latestContentRef.current !== detail.content
      )
        return;

      setLinkedCaseNote({ ...detail.note, graphId: detail.graphId });
      setContent(detail.content);
      latestContentRef.current = detail.content;
      savedContentRef.current = detail.content;
      savingContentRef.current = null;
      setLoadError(false);
    };

    window.addEventListener(
      LINKED_GRAPH_NOTE_UPDATED_EVENT,
      handleLinkedNoteUpdate
    );
    return () =>
      window.removeEventListener(
        LINKED_GRAPH_NOTE_UPDATED_EVENT,
        handleLinkedNoteUpdate
      );
  }, [blockedRef, graphId]);

  const openCaseNote = React.useCallback(async () => {
    if (!graphId || !isLoaded) return;
    if (linkedCaseNote) {
      openTab({
        kind: 'note',
        resourceId: `${linkedCaseNote.caseId}/${linkedCaseNote.id}`,
        title: linkedCaseNote.name
      });
      if (isDetached) closeNotesPanel();
      return;
    }
    if (!canEdit() || !canEditSnapshot()) return;
    if (
      isOpeningCaseNote ||
      isSaving ||
      savingContentRef.current !== null
    )
      return;
    if (graphWriteBlockedRef.current || !canEditSnapshot()) {
      toast.error('This note has unsaved changes after an agent run.');
      return;
    }

    const contentToPromote = latestContentRef.current;
    const version = graphWriteVersionRef.current;
    if (version === undefined) return;
    const isCurrent = () =>
      currentGraphRef.current === graphId &&
      canEdit() &&
      canEditSnapshot() &&
      !graphWriteBlockedRef.current &&
      graphWriteVersionRef.current === version;
    setIsOpeningCaseNote(true);

    try {
      await saveQueueRef.current.enqueue(async () => {
        if (!isCurrent()) return;
        savingContentRef.current = contentToPromote;
        const response = await fetch(
          `/api/graphs/${encodeURIComponent(graphId)}/notes`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: contentToPromote,
              expectedWriteVersion: version
            })
          }
        );
        const data = await response.json();
        if (!isCurrent()) return;
        if ([409, 423, 428].includes(response.status)) {
          graphWriteBlockedRef.current = true;
          reject();
        }
        if (!response.ok)
          throw new Error(data.error || 'Unable to create note');

        const note = data.note as LinkedCaseNote;
        savedContentRef.current = contentToPromote;
        setLinkedCaseNote(note);
        setLoadError(false);
        dispatchLinkedGraphNoteUpdated({
          graphId,
          writeVersion: version,
          note,
          content: contentToPromote
        });
        openTab({
          kind: 'note',
          resourceId: `${note.caseId}/${note.id}`,
          title: note.name
        });
        if (isDetached) closeNotesPanel();
        toast.success(linkedCaseNote ? 'Note opened' : 'Case note created');
      });
    } catch (error) {
      setLoadError(true);
      toast.error(
        error instanceof Error ? error.message : 'Unable to create note'
      );
    } finally {
      if (savingContentRef.current === contentToPromote) {
        savingContentRef.current = null;
      }
      setIsOpeningCaseNote(false);
    }
  }, [
    canEdit,
    canEditSnapshot,
    closeNotesPanel,
    graphId,
    isDetached,
    isLoaded,
    isOpeningCaseNote,
    isSaving,
    linkedCaseNote,
    openTab,
    reject
  ]);

  const statusLabel =
    loadError && isLoaded
      ? 'Save failed'
      : isLoading
        ? 'Loading…'
        : isSaving
          ? 'Saving…'
          : isDirty
            ? 'Unsaved'
            : isLoaded
              ? 'Saved'
              : null;

  const panelHeaderActions = (
    <>
      {statusLabel ? (
        <span
          className={cn(
            'text-muted-foreground text-[10px] font-medium whitespace-nowrap',
            loadError && isLoaded && 'text-destructive'
          )}
          aria-live='polite'
        >
          {statusLabel}
        </span>
      ) : null}
      <Button
        type='button'
        variant='ghost'
        size='icon'
        className="graph-notes-header-close shrink-0 [&_svg:not([class*='size-'])]:!size-4"
        onClick={closeNotesPanel}
        aria-label={isDetached ? 'Close floating notes' : 'Hide graph notes'}
        title={isDetached ? 'Close' : 'Hide notes'}
      >
        {isDetached ? (
          <IconClose className='size-4' />
        ) : (
          <IconSidebar className='size-4 rotate-180' />
        )}
      </Button>
    </>
  );

  const notesSurface = (
    <aside
      className={cn(
        'group/graph-notes-panel bg-background text-foreground border-border/20 relative flex h-full flex-col overflow-hidden dark:border-white/5',
        !isDetached && 'border-l'
      )}
    >
      <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
        <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
          {isLoaded ? (
            <GraphNotesEditor
              readOnly={readOnly}
              compactMode
              compactHeaderEnd={panelHeaderActions}
              compactHeaderClassName={
                isDetached
                  ? 'cursor-move [&_button]:cursor-default [&_[role=combobox]]:cursor-default'
                  : undefined
              }
              onCompactHeaderPointerDown={
                isDetached
                  ? (event) => beginFloatingInteraction(event)
                  : undefined
              }
              content={content}
              references={references}
              onChange={handleContentChange}
              onStatsChange={setEditorStats}
              minHeight={320}
              placeholder='Write graph notes… Use @ or / to link entities.'
              isDirty={isDirty}
              isSaving={isSaving}
              onSave={() => {
                if (canEdit() && canEditSnapshot()) void saveNote();
              }}
              onOpenReference={(reference) => {
                const nodeId = nodeIdByReferenceId.get(reference.id);
                if (nodeId) onSelectNodeId(nodeId);
              }}
            />
          ) : (
            <>
              <div
                onPointerDown={
                  isDetached
                    ? (event) => beginFloatingInteraction(event)
                    : undefined
                }
                className={cn(
                  'border-border/40 bg-background/90 supports-[backdrop-filter]:bg-background/70 flex h-11 shrink-0 items-center justify-end gap-1 border-b px-1.5 shadow-sm backdrop-blur dark:border-white/10',
                  isDetached && 'cursor-move [&_button]:cursor-default'
                )}
              >
                {panelHeaderActions}
              </div>
              <div className='min-h-0 flex-1 overflow-hidden'>
                {!graphId ? (
                  <div className='text-muted-foreground flex h-full items-center justify-center px-6 text-center text-sm'>
                    Save the graph before adding notes.
                  </div>
                ) : isLoading ? (
                  <div className='space-y-3 p-3'>
                    <Skeleton className='h-64 w-full rounded-md' />
                  </div>
                ) : loadError ? (
                  <div className='flex h-full flex-col items-center justify-center gap-3 px-6 text-center'>
                    <p className='text-muted-foreground text-sm'>
                      Unable to load graph notes.
                    </p>
                    <Button
                      type='button'
                      variant='outline'
                      size='sm'
                      onClick={loadNote}
                    >
                      <IconLoader
                        className={cn('size-4', isLoading && 'animate-spin')}
                      />
                      Retry
                    </Button>
                  </div>
                ) : (
                  <div className='space-y-3 p-3'>
                    <Skeleton className='h-64 w-full rounded-md' />
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        <GraphSidepanelBottomBar className='border-l-0'>
          <div className='text-muted-foreground flex min-w-0 items-center gap-3 text-[10px] tabular-nums'>
            <span>{editorStats.characters.toLocaleString()} characters</span>
            <span>{editorStats.words.toLocaleString()} words</span>
          </div>
          <div className='ml-auto flex items-center gap-0.5'>
            <Button
              type='button'
              variant='ghost'
              size='icon'
              className='size-6 shrink-0 rounded-md'
              onClick={isDetached ? attachNotesPanel : detachNotesPanel}
              aria-label={
                isDetached
                  ? 'Attach notes to the right sidebar'
                  : 'Detach notes into a floating window'
              }
              title={isDetached ? 'Attach to sidebar' : 'Detach notes'}
            >
              {isDetached ? (
                <IconSidebar className='size-3.5 -scale-x-100' />
              ) : (
                <IconWindow className='size-3.5' />
              )}
            </Button>
            <Button
              type='button'
              variant='ghost'
              size='icon'
              className='size-6 shrink-0 rounded-md'
              onClick={() => void openCaseNote()}
              disabled={
                !isLoaded ||
                (!linkedCaseNote &&
                  (readOnly ||
                    editorStats.characters === 0 ||
                    isOpeningCaseNote ||
                    isSaving))
              }
              aria-label={
                linkedCaseNote
                  ? 'Open linked case note in a tab'
                  : 'Create case note and open it in a tab'
              }
              title={
                linkedCaseNote ? 'Open linked note in tab' : 'Create case note'
              }
            >
              {isOpeningCaseNote ? (
                <IconLoader className='size-3.5 animate-spin' />
              ) : linkedCaseNote ? (
                <IconOpenExternal className='size-3.5' />
              ) : (
                <IconCreateNote className='size-3.5' />
              )}
            </Button>
          </div>
        </GraphSidepanelBottomBar>
      </div>
    </aside>
  );

  const floatingNotes =
    isDetached && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={floatingBoundsRef}
            className='pointer-events-none fixed inset-x-2 top-12 bottom-9 z-50'
          >
            <AnimatePresence initial={false}>
              {isNotesPanelOpen ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.985 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.985 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                  style={{
                    left: floatingRect.x,
                    top: floatingRect.y,
                    width: floatingRect.width,
                    height: floatingRect.height
                  }}
                  className='border-border/70 bg-background pointer-events-auto absolute overflow-hidden rounded-xl border shadow-[0_4px_16px_rgba(0,0,0,0.16)] dark:border-white/12 dark:shadow-[0_5px_18px_rgba(0,0,0,0.24)]'
                >
                  {notesSurface}
                  {FLOATING_RESIZE_HANDLES.map((handle) => (
                    <div
                      key={handle.key}
                      aria-hidden='true'
                      className={cn(
                        'absolute z-30 touch-none bg-transparent',
                        handle.className
                      )}
                      onPointerDown={(event) =>
                        beginFloatingInteraction(
                          event,
                          handle.edges,
                          handle.cursor
                        )
                      }
                    />
                  ))}
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>,
          document.body
        )
      : null;

  if (isDetached) return floatingNotes;

  return (
    <>
      <ResizableHandle
        withHandle
        className={cn(
          'bg-border/60 dark:bg-white/10',
          'group/resize-handle [&>div]:opacity-0 group-hover/graph-notes-panel:[&>div]:opacity-100',
          isNotesPanelOpen ? '' : 'hidden'
        )}
      />
      <ResizablePanel
        ref={notesPanelRef}
        defaultSize={
          isNotesPanelOpen
            ? lastOpenNotesSizeRef.current
            : notesCollapsedSizePct
        }
        collapsible
        collapsedSize={notesCollapsedSizePct}
        minSize={notesMinSizePct}
        maxSize={notesMaxSizePct}
        onResize={(size) => {
          const collapseAt = notesCollapsedSizePct + 0.5;
          const expandAt = notesCollapsedSizePct + 2;
          if (size <= collapseAt && isNotesPanelOpen) {
            notesStateFromResizeRef.current = true;
            setIsNotesPanelOpen(false);
            return;
          }
          if (size >= expandAt && !isNotesPanelOpen) {
            notesStateFromResizeRef.current = true;
            setIsNotesPanelOpen(true);
          }
          if (size >= expandAt) lastOpenNotesSizeRef.current = size;
        }}
        className='min-w-0 transition-[flex-grow,flex-basis] duration-200 ease-in-out'
      >
        {notesSurface}
      </ResizablePanel>
    </>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileText } from 'lucide-react';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { useWorkspaceTabsStore } from '@/features/workspace/store/workspace-tabs-store';
import { CaseRichTextEditor } from './case-rich-text-editor';
import type { CaseNote, CaseReference } from './case-note-types';
import { useGraphWriteGuard } from '@/features/graph/components/graph-editor/hooks/use-graph-write-guard';
import {
  notifyReplacedDraft,
  useStaleReload
} from '@/features/graph/components/graph-editor/hooks/use-stale-reload';
import { createSerialSaveQueue } from '@/features/graph/lib/serial-save-queue';
import { graphClientCoordinator } from '@/features/graph/lib/graph-client-coordinator';
import { useGraphParticipant } from '@/features/graph/components/graph-editor/hooks/use-graph-participant';
import {
  dispatchLinkedGraphNoteUpdated,
  LINKED_GRAPH_NOTE_UPDATED_EVENT,
  type LinkedGraphNoteUpdatedDetail
} from '../lib/linked-graph-note-events';

interface CaseNoteWorkspaceEditorProps {
  resourceId: string;
  isActive?: boolean;
  onOpenGraph: (graphId: string, title: string) => void;
}

const NOTE_AUTOSAVE_DELAY = 2000;

function parseResourceId(resourceId: string) {
  const separator = resourceId.indexOf('/');
  if (separator < 1 || separator === resourceId.length - 1) return null;
  return {
    caseId: resourceId.slice(0, separator),
    noteId: resourceId.slice(separator + 1)
  };
}

export function CaseNoteWorkspaceEditor({
  resourceId,
  isActive = true,
  onOpenGraph
}: CaseNoteWorkspaceEditorProps) {
  const setTabTitle = useWorkspaceTabsStore((state) => state.setTabTitle);
  const tabTitle = useWorkspaceTabsStore(
    (state) =>
      state.tabs.find((tab) => tab.id === `note:${resourceId}`)?.title ?? null
  );
  const [note, setNote] = useState<CaseNote | null>(null);
  const writeGuard = useGraphWriteGuard(note?.graphId);
  const {
    blockedRef,
    acceptSnapshot,
    reject,
    canEditSnapshot,
    canSaveSnapshot
  } = writeGuard;
  const [reloadCount, setReloadCount] = useState(0);
  const [references, setReferences] = useState<CaseReference[]>([]);
  const [content, setContent] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const hasLoadedReferences = useRef(false);
  const hasLoadedNote = useRef(false);
  const loadedResourceRef = useRef<string | null>(null);
  const loadGenerationRef = useRef(0);
  const latestContentRef = useRef('');
  const graphWriteVersionRef = useRef<number | undefined>(undefined);
  const graphWriteBlockedRef = useRef(false);
  const savedContentRef = useRef('');
  const savingContentRef = useRef<string | null>(null);
  const saveQueueRef = useRef(createSerialSaveQueue());
  const noteEndpointRef = useRef<string | null>(null);
  const isMountedRef = useRef(false);
  const resource = useMemo(() => parseResourceId(resourceId), [resourceId]);
  const noteEndpoint = useMemo(
    () =>
      resource
        ? `/api/cases/${encodeURIComponent(resource.caseId)}/notes/${encodeURIComponent(resource.noteId)}`
        : null,
    [resource]
  );
  noteEndpointRef.current = noteEndpoint;

  useStaleReload(writeGuard.status, isLoading, () => {
    if (latestContentRef.current !== savedContentRef.current)
      notifyReplacedDraft(
        { resourceId, content: latestContentRef.current },
        'note-local-draft.json'
      );
    setReloadCount((count) => count + 1);
  });

  useEffect(() => {
    loadGenerationRef.current += 1;
    const preserveExisting = loadedResourceRef.current === resourceId;
    const previousVersion = graphWriteVersionRef.current;
    const previouslyBlocked = graphWriteBlockedRef.current;
    hasLoadedReferences.current = false;
    hasLoadedNote.current = false;
    graphWriteVersionRef.current = undefined;
    graphWriteBlockedRef.current = false;
    if (!resource) {
      setIsLoading(false);
      return;
    }
    const currentResource = resource;

    const controller = new AbortController();
    async function loadNote() {
      setIsLoading(true);
      try {
        await saveQueueRef.current.idle();
        if (controller.signal.aborted) return;
        const [noteResponse, referencesResponse] = await Promise.all([
          fetch(
            `/api/cases/${currentResource.caseId}/notes/${currentResource.noteId}`,
            {
              signal: controller.signal
            }
          ),
          fetch(`/api/cases/${currentResource.caseId}/references`, {
            signal: controller.signal,
            cache: 'no-store'
          })
        ]);
        if (!noteResponse.ok || !referencesResponse.ok) {
          throw new Error('note_load_failed');
        }

        const [noteData, referencesData] = await Promise.all([
          noteResponse.json(),
          referencesResponse.json()
        ]);
        if (controller.signal.aborted) return;
        const loadedNote = noteData.note as CaseNote;
        if (
          preserveExisting &&
          graphClientCoordinator.frozen(loadedNote.graphId)
        )
          return;
        graphWriteVersionRef.current = noteData.writeState?.version;
        if (loadedNote.graphId && noteData.writeState)
          acceptSnapshot(loadedNote.graphId, noteData.writeState);
        const loadedContent = loadedNote.content ?? '';
        setNote(loadedNote);
        setContent(loadedContent);
        latestContentRef.current = loadedContent;
        savedContentRef.current = loadedContent;
        savingContentRef.current = null;
        hasLoadedNote.current = true;
        loadedResourceRef.current = resourceId;
        setReferences(referencesData.references ?? []);
        hasLoadedReferences.current = true;
        setTabTitle(`note:${resourceId}`, loadedNote.name);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError')
          return;
        if (preserveExisting) {
          graphWriteVersionRef.current = previousVersion;
          graphWriteBlockedRef.current = previouslyBlocked;
          hasLoadedNote.current = true;
        } else {
          setNote(null);
          hasLoadedNote.current = false;
        }
        toast.error('Unable to load the note');
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }

    void loadNote();
    return () => controller.abort();
  }, [acceptSnapshot, reloadCount, resource, resourceId, setTabTitle]);

  useEffect(() => {
    if (!isActive || !resource || !hasLoadedReferences.current) return;
    const currentResource = resource;
    const controller = new AbortController();

    async function refreshReferences() {
      try {
        const response = await fetch(
          `/api/cases/${currentResource.caseId}/references`,
          {
            signal: controller.signal,
            cache: 'no-store'
          }
        );
        if (!response.ok) throw new Error('references_load_failed');
        const data = await response.json();
        setReferences(data.references ?? []);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError')
          return;
        toast.error('Unable to refresh references');
      }
    }

    void refreshReferences();
    return () => controller.abort();
  }, [isActive, resource]);

  useEffect(() => {
    if (!resource) return;

    const handleLinkedNoteUpdate = (event: Event) => {
      const detail = (event as CustomEvent<LinkedGraphNoteUpdatedDetail>)
        .detail;
      if (!detail || detail.note.id !== resource.noteId) return;
      if (
        blockedRef.current ||
        graphClientCoordinator.frozen(detail.graphId) ||
        detail.writeVersion !== graphWriteVersionRef.current ||
        saveQueueRef.current.pending > 0
      )
        return;
      if (
        latestContentRef.current !== savedContentRef.current &&
        latestContentRef.current !== detail.content
      )
        return;

      setContent(detail.content);
      latestContentRef.current = detail.content;
      savedContentRef.current = detail.content;
      savingContentRef.current = null;
      setNote((current) =>
        current ? { ...current, content: detail.content } : current
      );
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
  }, [blockedRef, resource]);

  const handleContentChange = useCallback(
    (nextContent: string) => {
      if (!canEditSnapshot()) return;
      latestContentRef.current = nextContent;
      setContent(nextContent);
    },
    [canEditSnapshot]
  );

  const saveNote = useCallback(
    ({
      silent = false,
      keepalive = false,
      barrier = false
    }: {
      silent?: boolean;
      keepalive?: boolean;
      barrier?: boolean;
    } = {}): Promise<boolean> => {
      const endpoint = noteEndpointRef.current;
      const contentToSave = latestContentRef.current;
      const version = graphWriteVersionRef.current;
      const loadGeneration = loadGenerationRef.current;
      const isCurrent = () =>
        endpoint === noteEndpointRef.current &&
        endpoint === noteEndpoint &&
        loadedResourceRef.current === resourceId &&
        loadGenerationRef.current === loadGeneration &&
        graphWriteVersionRef.current === version &&
        !graphWriteBlockedRef.current &&
        canSaveSnapshot();
      if (
        !endpoint ||
        !hasLoadedNote.current ||
        !isCurrent() ||
        !graphClientCoordinator.canSave(note?.graphId, barrier) ||
        (note?.graphId && graphClientCoordinator.noteConflict(note.graphId))
      ) {
        return Promise.resolve(false);
      }

      return saveQueueRef.current.enqueue(async () => {
        if (!isCurrent()) return false;
        if (!barrier && contentToSave === savedContentRef.current) return true;
        savingContentRef.current = contentToSave;
        if (isMountedRef.current) setIsSaving(true);

        try {
          const response = await fetch(endpoint, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: contentToSave,
              expectedWriteVersion: version
            }),
            keepalive
          });
          if (!isCurrent()) return false;
          if ([409, 423, 428].includes(response.status)) {
            graphWriteBlockedRef.current = true;
            reject();
          }
          const data = await response.json();
          if (!isCurrent()) return false;
          if (!response.ok) throw new Error(data.error || 'Save failed');

          const updatedNote = data.note as CaseNote;
          savedContentRef.current = contentToSave;
          if (isMountedRef.current) {
            setNote(updatedNote);
            if (updatedNote.graphId && resource && version !== undefined) {
              dispatchLinkedGraphNoteUpdated({
                graphId: updatedNote.graphId,
                writeVersion: version,
                note: {
                  id: updatedNote.id,
                  caseId: resource.caseId,
                  name: updatedNote.name
                },
                content: updatedNote.content ?? ''
              });
            }
            if (!silent) toast.success('Note saved');
          }
          return true;
        } catch (error) {
          if (isMountedRef.current) {
            toast.error(error instanceof Error ? error.message : 'Save failed');
          }
          return false;
        } finally {
          if (savingContentRef.current === contentToSave) {
            savingContentRef.current = null;
          }
          if (isMountedRef.current) setIsSaving(false);
        }
      });
    },
    [canSaveSnapshot, note?.graphId, noteEndpoint, reject, resource, resourceId]
  );

  useGraphParticipant(note?.graphId, {
    kind: 'note',
    capture: () => ({
      ready: hasLoadedNote.current && !isLoading && canSaveSnapshot(),
      version: graphWriteVersionRef.current,
      value: latestContentRef.current,
      dirty: latestContentRef.current !== savedContentRef.current
    }),
    idle: () => saveQueueRef.current.idle(),
    invalidate: reject,
    flush: async () => {
      const saved = await saveNote({ silent: true, barrier: true });
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
      setNote((current) =>
        current ? { ...current, content: snapshot.notes } : current
      );
      acceptSnapshot(snapshot.graphId, snapshot.writeState);
    }
  });

  const flushPendingSave = useCallback(() => {
    void saveNote({ silent: true, keepalive: true });
  }, [saveNote]);

  const isDirty = Boolean(note && content !== savedContentRef.current);

  useEffect(() => {
    if (!note || !isDirty || isSaving) return;
    const timeout = window.setTimeout(() => {
      void saveNote({ silent: true });
    }, NOTE_AUTOSAVE_DELAY);
    return () => window.clearTimeout(timeout);
  }, [content, isDirty, isSaving, note, saveNote]);

  useEffect(() => {
    isMountedRef.current = true;
    const handlePageHide = () => flushPendingSave();
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      flushPendingSave();
      isMountedRef.current = false;
    };
  }, [flushPendingSave]);

  if (isLoading) {
    return (
      <div className='bg-page flex h-full min-h-0 flex-col overflow-hidden'>
        <Skeleton className='h-11 w-full shrink-0 rounded-none' />
        <div className='bg-muted/25 min-h-0 flex-1 overflow-hidden px-8 py-10'>
          <Skeleton className='mx-auto h-[70rem] w-full max-w-[49.625rem] rounded-sm' />
        </div>
      </div>
    );
  }

  if (!resource || !note) {
    return (
      <div className='bg-page flex h-full items-center justify-center'>
        <div className='text-muted-foreground text-center text-sm'>
          <FileText className='mx-auto mb-3 h-7 w-7' />
          Note not found
        </div>
      </div>
    );
  }

  return (
    <div className='bg-page flex h-full min-h-0 flex-col overflow-hidden'>
      <main
        inert={writeGuard.blocked || undefined}
        className='min-h-0 w-full flex-1'
      >
        <CaseRichTextEditor
          readOnly={writeGuard.blocked}
          content={content}
          references={references}
          onChange={handleContentChange}
          onOpenReference={(reference) =>
            onOpenGraph(reference.graphId, reference.graphName)
          }
          minHeight={900}
          documentMode
          documentTitle={tabTitle ?? note.name}
          isDirty={isDirty}
          isSaving={isSaving}
          onSave={() => void saveNote()}
        />
      </main>
    </div>
  );
}

'use client';

import {
  FolderOpenIcon as FolderOpen,
  GraphIcon as Graph,
  NoteIcon as Note,
  PlusIcon as Plus
} from '@/components/icons';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuTrigger
} from '@/components/ui/context-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useWorkspaceTabsStore } from '@/features/workspace/store/workspace-tabs-store';
import { Ellipsis, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { toast } from 'sonner';
import {
  LINKED_GRAPH_NOTE_UPDATED_EVENT,
  type LinkedGraphNoteUpdatedDetail
} from '../lib/linked-graph-note-events';
import type { CaseNote } from './case-note-types';

interface CaseDetail {
  id: string;
  name: string;
  description: string | null;
  status: 'open' | 'closed' | 'archived';
}

interface GraphItem {
  id: string;
  name: string;
  description: string | null;
  updatedAt: string;
  lastOpenedAt: string | null;
  nodeCount: number;
  edgeCount: number;
  thumbnail: string | null;
  preview: GraphPreview;
}

interface GraphPreview {
  nodes: Array<{ id: string; x: number; y: number }>;
  edges: Array<{ source: string; target: string }>;
}

type ResourceKind = 'graph' | 'note';

interface ResourceTarget {
  id: string;
  kind: ResourceKind;
  name: string;
}

interface CaseResourceCardProps {
  id: string;
  kind: ResourceKind;
  name: string;
  preview?: string | null;
  thumbnail?: string | null;
  graphPreview?: GraphPreview;
  onOpen: () => void;
  onRename: (target: ResourceTarget) => void;
  onDelete: (target: ResourceTarget) => void;
}

function RealGraphPreview({ preview }: { preview: GraphPreview }) {
  const nodeById = new Map(preview.nodes.map((node) => [node.id, node]));

  return (
    <div className='absolute inset-0 overflow-hidden' aria-hidden='true'>
      <div className='absolute inset-0 bg-[radial-gradient(circle_at_center,var(--border)_1px,transparent_1px)] bg-[size:14px_14px] opacity-40' />
      <svg
        viewBox='0 0 200 110'
        preserveAspectRatio='xMidYMid meet'
        className='absolute inset-x-0 top-1 h-[105px] w-full'
      >
        {preview.edges.map((edge, index) => {
          const source = nodeById.get(edge.source);
          const target = nodeById.get(edge.target);
          if (!source || !target) return null;

          return (
            <line
              key={`${edge.source}-${edge.target}-${index}`}
              x1={source.x}
              y1={source.y}
              x2={target.x}
              y2={target.y}
              className='stroke-border'
              strokeWidth='1.2'
              vectorEffect='non-scaling-stroke'
            />
          );
        })}
        {preview.nodes.map((node) => (
          <rect
            key={node.id}
            x={node.x - 5}
            y={node.y - 3.5}
            width='10'
            height='7'
            rx='2'
            className='fill-background stroke-primary/60'
            strokeWidth='1.2'
            vectorEffect='non-scaling-stroke'
          />
        ))}
      </svg>
    </div>
  );
}

function stripHtml(value: string | null | undefined) {
  return (value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function CaseResourceCard({
  id,
  kind,
  name,
  preview,
  thumbnail,
  graphPreview,
  onOpen,
  onRename,
  onDelete
}: CaseResourceCardProps) {
  const target: ResourceTarget = { id, kind, name };

  const actions = (
    <>
      <Pencil />
      Rename
    </>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <article className='group bg-muted/25 hover:border-primary/30 focus-within:ring-ring relative h-36 w-52 shrink-0 overflow-hidden rounded-xl border transition-[border-color,box-shadow,transform] focus-within:ring-2 hover:-translate-y-px hover:shadow-sm'>
          <button
            type='button'
            onClick={onOpen}
            className='absolute inset-0 z-10 cursor-pointer outline-none'
            aria-label={`Open ${kind} ${name}`}
          />

          {kind === 'graph' ? (
            thumbnail ? (
              <div
                aria-hidden='true'
                className='absolute inset-0 bg-cover bg-center opacity-85 transition-transform duration-300 group-hover:scale-[1.02]'
                style={{
                  backgroundImage: `url(${JSON.stringify(thumbnail)})`
                }}
              />
            ) : graphPreview?.nodes.length ? (
              <RealGraphPreview preview={graphPreview} />
            ) : (
              <div
                className='absolute inset-0 bg-[radial-gradient(circle_at_center,var(--border)_1px,transparent_1px)] bg-[size:14px_14px] opacity-40'
                aria-hidden='true'
              />
            )
          ) : (
            <div className='text-muted-foreground absolute inset-x-3 top-3 line-clamp-4 text-xs leading-5'>
              {stripHtml(preview) || 'Empty note'}
            </div>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant='ghost'
                size='icon'
                className='bg-background/70 hover:bg-background absolute top-2 right-2 z-20 size-7 rounded-lg opacity-75 shadow-sm backdrop-blur-sm transition-opacity hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100'
                aria-label={`Actions for ${name}`}
              >
                <Ellipsis data-icon='inline-start' />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              <DropdownMenuGroup>
                <DropdownMenuItem onSelect={() => onRename(target)}>
                  {actions}
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant='destructive'
                  onSelect={() => onDelete(target)}
                >
                  <Trash2 />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className='from-card via-card/95 pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t to-transparent px-3 pt-9 pb-2.5'>
            <p className='truncate text-sm font-semibold tracking-tight drop-shadow-sm'>
              {name}
            </p>
          </div>
        </article>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuGroup>
          <ContextMenuItem onSelect={() => onRename(target)}>
            <Pencil />
            Rename
          </ContextMenuItem>
          <ContextMenuItem
            variant='destructive'
            onSelect={() => onDelete(target)}
          >
            <Trash2 />
            Delete
          </ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function CaseDetailContent({
  caseId,
  isActive = true,
  onOpenGraph,
  onOpenNote
}: {
  caseId: string;
  isActive?: boolean;
  onOpenGraph?: (graphId: string, title?: string) => void;
  onOpenNote?: (caseId: string, noteId: string, title?: string) => void;
}) {
  const [caseDetail, setCaseDetail] = useState<CaseDetail | null>(null);
  const [graphs, setGraphs] = useState<GraphItem[]>([]);
  const [notes, setNotes] = useState<CaseNote[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [graphDialogOpen, setGraphDialogOpen] = useState(false);
  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [caseDialogOpen, setCaseDialogOpen] = useState(false);
  const [graphName, setGraphName] = useState('');
  const [graphDescription, setGraphDescription] = useState('');
  const [noteName, setNoteName] = useState('');
  const [caseName, setCaseName] = useState('');
  const [caseDescription, setCaseDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUpdatingCase, setIsUpdatingCase] = useState(false);
  const [renameTarget, setRenameTarget] = useState<ResourceTarget | null>(null);
  const [renameName, setRenameName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ResourceTarget | null>(null);
  const [isUpdatingResource, setIsUpdatingResource] = useState(false);
  const setTabTitle = useWorkspaceTabsStore((state) => state.setTabTitle);
  const closeTab = useWorkspaceTabsStore((state) => state.closeTab);

  function openGraphDialog() {
    setGraphDialogOpen(true);
  }

  useEffect(() => {
    if (!isActive) return;
    const controller = new AbortController();

    async function loadCase() {
      setIsLoading(true);
      try {
        const [caseResponse, graphsResponse, notesResponse] = await Promise.all(
          [
            fetch(`/api/cases/${caseId}`, { signal: controller.signal }),
            fetch(`/api/cases/${caseId}/graphs`, { signal: controller.signal }),
            fetch(`/api/cases/${caseId}/notes`, {
              signal: controller.signal,
              cache: 'no-store'
            })
          ]
        );

        if (!caseResponse.ok || !graphsResponse.ok || !notesResponse.ok) {
          throw new Error('case_load_failed');
        }

        const [caseData, graphsData, notesData] = await Promise.all([
          caseResponse.json(),
          graphsResponse.json(),
          notesResponse.json()
        ]);

        setCaseDetail(caseData.case ?? null);
        setGraphs(graphsData.graphs ?? []);
        setNotes(notesData.notes ?? []);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError')
          return;
        setCaseDetail(null);
        toast.error('Unable to load the case');
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }

    void loadCase();
    return () => controller.abort();
  }, [caseId, isActive]);

  useEffect(() => {
    const handleLinkedNoteUpdate = (event: Event) => {
      const detail = (event as CustomEvent<LinkedGraphNoteUpdatedDetail>)
        .detail;
      if (!detail || detail.note.caseId !== caseId) return;

      setNotes((current) => {
        const existing = current.find((note) => note.id === detail.note.id);
        if (existing) {
          return current.map((note) =>
            note.id === detail.note.id
              ? { ...note, ...detail.note, content: detail.content }
              : note
          );
        }

        const now = new Date().toISOString();
        return [
          {
            ...detail.note,
            graphId: detail.graphId,
            content: detail.content,
            createdAt: now,
            updatedAt: now,
            lastOpenedAt: null
          },
          ...current
        ];
      });
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
  }, [caseId]);

  async function createGraph() {
    if (!graphName.trim()) return;
    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/cases/${caseId}/graphs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: graphName,
          description: graphDescription,
          visibility: 'workspace'
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to create graph');
      }

      setGraphs((current) => [data.graph, ...current]);
      setGraphName('');
      setGraphDescription('');
      setGraphDialogOpen(false);
      toast.success('Graph created');
      onOpenGraph?.(data.graph.id, data.graph.name);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Creation failed');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function createNote() {
    if (!noteName.trim()) return;
    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/cases/${caseId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: noteName, content: '<p></p>' })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to create note');

      setNotes((current) => [data.note, ...current]);
      setNoteName('');
      setNoteDialogOpen(false);
      toast.success('Note created');
      onOpenNote?.(caseId, data.note.id, data.note.name);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Creation failed');
    } finally {
      setIsSubmitting(false);
    }
  }

  function openCaseDialog() {
    if (!caseDetail) return;
    setCaseName(caseDetail.name);
    setCaseDescription(caseDetail.description ?? '');
    setCaseDialogOpen(true);
  }

  async function updateCase() {
    if (!caseName.trim()) return;
    setIsUpdatingCase(true);

    try {
      const response = await fetch(`/api/cases/${caseId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: caseName.trim(),
          description: caseDescription.trim()
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Update failed');

      setCaseDetail((current) =>
        current ? { ...current, ...data.case } : data.case
      );
      setTabTitle(`case:${caseId}`, data.case.name);
      setCaseDialogOpen(false);
      toast.success('Case updated');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Update failed');
    } finally {
      setIsUpdatingCase(false);
    }
  }

  function openRenameDialog(target: ResourceTarget) {
    setRenameTarget(target);
    setRenameName(target.name);
  }

  async function renameResource() {
    if (!renameTarget || !renameName.trim()) return;
    const target = renameTarget;
    const nextName = renameName.trim();
    setIsUpdatingResource(true);

    try {
      const response = await fetch(
        target.kind === 'graph'
          ? `/api/graphs/${target.id}`
          : `/api/cases/${caseId}/notes/${target.id}`,
        {
          method: target.kind === 'graph' ? 'PUT' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: nextName })
        }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Rename failed');

      if (target.kind === 'graph') {
        setGraphs((current) =>
          current.map((graph) =>
            graph.id === target.id ? { ...graph, name: nextName } : graph
          )
        );
        setTabTitle(`graph:${target.id}`, nextName);
      } else {
        setNotes((current) =>
          current.map((note) =>
            note.id === target.id ? { ...note, name: nextName } : note
          )
        );
        setTabTitle(`note:${caseId}/${target.id}`, nextName);
      }

      setRenameTarget(null);
      toast.success('Item renamed');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Rename failed');
    } finally {
      setIsUpdatingResource(false);
    }
  }

  async function deleteResource() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setIsUpdatingResource(true);

    try {
      const response = await fetch(
        target.kind === 'graph'
          ? `/api/graphs/${target.id}`
          : `/api/cases/${caseId}/notes/${target.id}`,
        { method: 'DELETE' }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Delete failed');

      if (target.kind === 'graph') {
        setGraphs((current) =>
          current.filter((graph) => graph.id !== target.id)
        );
        closeTab(`graph:${target.id}`);
      } else {
        setNotes((current) => current.filter((note) => note.id !== target.id));
        closeTab(`note:${caseId}/${target.id}`);
      }

      setDeleteTarget(null);
      toast.success('Item deleted');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Deletion failed');
    } finally {
      setIsUpdatingResource(false);
    }
  }

  if (isLoading) {
    return (
      <div className='bg-page h-full overflow-y-auto'>
        <div className='mx-auto max-w-7xl px-8 py-8'>
          <Skeleton className='h-9 w-72' />
          <Skeleton className='mt-3 h-4 w-96 max-w-full' />
          <div className='mt-10 flex flex-col gap-6'>
            <Skeleton className='h-56 w-full rounded-2xl' />
            <Skeleton className='h-56 w-full rounded-2xl' />
          </div>
        </div>
      </div>
    );
  }

  if (!caseDetail) {
    return (
      <div className='bg-page flex h-full items-center justify-center'>
        <div className='text-center'>
          <FolderOpen className='text-muted-foreground mx-auto h-8 w-8' />
          <p className='text-muted-foreground mt-3 text-sm'>Case not found</p>
        </div>
      </div>
    );
  }

  return (
    <div className='bg-page h-full overflow-y-auto'>
      <main className='mx-auto max-w-7xl px-8 py-8 lg:px-10'>
        <header className='flex items-start justify-between gap-4'>
          <div className='min-w-0'>
            <div className='flex items-center gap-2'>
              <FolderOpen className='text-primary size-6 shrink-0' />
              <h1 className='truncate text-2xl font-semibold tracking-[-0.025em]'>
                {caseDetail.name}
              </h1>
            </div>
            {caseDetail.description ? (
              <p className='text-muted-foreground mt-1.5 max-w-2xl text-sm'>
                {caseDetail.description}
              </p>
            ) : null}
          </div>
          <Button variant='outline' size='sm' onClick={openCaseDialog}>
            <Pencil data-icon='inline-start' /> Edit Case
          </Button>
        </header>

        <section className='mt-10' aria-labelledby='case-graphs-heading'>
          <Card className='group/collection bg-page gap-4 rounded-2xl py-5 shadow-none'>
            <CardHeader className='px-5'>
              <CardTitle
                id='case-graphs-heading'
                className='flex items-center gap-2 text-sm'
              >
                <Graph className='text-muted-foreground size-4' />
                Graphs
                <Badge variant='secondary'>{graphs.length}</Badge>
              </CardTitle>
              <CardAction>
                <Button onClick={openGraphDialog}>
                  <Plus data-icon='inline-start' /> New Graph
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className='min-h-[18.75rem] px-5'>
              {graphs.length === 0 ? (
                <div className='flex min-h-[16rem] flex-col items-center justify-center p-8 text-center'>
                  <Graph className='text-muted-foreground mb-4 size-9' />
                  <h3 className='text-sm font-semibold'>No graphs yet</h3>
                  <p className='text-muted-foreground mt-1 mb-4 max-w-sm text-xs'>
                    Create the first graph for this case.
                  </p>
                  <button
                    type='button'
                    onClick={openGraphDialog}
                    className='text-muted-foreground hover:text-foreground hover:border-primary/40 pointer-events-none flex h-20 w-52 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed opacity-0 transition-[opacity,color,border-color] group-focus-within/collection:pointer-events-auto group-focus-within/collection:opacity-100 group-hover/collection:pointer-events-auto group-hover/collection:opacity-100'
                  >
                    <Plus className='size-5' />
                    <span className='text-xs font-medium'>New Graph</span>
                  </button>
                </div>
              ) : (
                <div className='flex flex-wrap gap-3'>
                  {graphs.map((graph) => (
                    <CaseResourceCard
                      key={graph.id}
                      id={graph.id}
                      kind='graph'
                      name={graph.name}
                      thumbnail={graph.thumbnail}
                      graphPreview={graph.preview}
                      onOpen={() => onOpenGraph?.(graph.id, graph.name)}
                      onRename={openRenameDialog}
                      onDelete={setDeleteTarget}
                    />
                  ))}
                  <button
                    type='button'
                    onClick={openGraphDialog}
                    className='text-muted-foreground hover:text-foreground hover:border-primary/40 pointer-events-none flex h-36 w-52 flex-col items-center justify-center gap-2 rounded-xl border border-dashed opacity-0 transition-[opacity,color,border-color] group-focus-within/collection:pointer-events-auto group-focus-within/collection:opacity-100 group-hover/collection:pointer-events-auto group-hover/collection:opacity-100'
                  >
                    <Plus className='size-5' />
                    <span className='text-xs font-medium'>New Graph</span>
                  </button>
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        <section className='mt-6' aria-labelledby='case-notes-heading'>
          <Card className='group/collection bg-page gap-4 rounded-2xl py-5 shadow-none'>
            <CardHeader className='px-5'>
              <CardTitle
                id='case-notes-heading'
                className='flex items-center gap-2 text-sm'
              >
                <Note className='text-muted-foreground size-4' />
                Notes
                <Badge variant='secondary'>{notes.length}</Badge>
              </CardTitle>
              <CardAction>
                <Button onClick={() => setNoteDialogOpen(true)}>
                  <Plus data-icon='inline-start' /> New Note
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className='min-h-[18.75rem] px-5'>
              {notes.length === 0 ? (
                <div className='flex min-h-[16rem] flex-col items-center justify-center p-8 text-center'>
                  <Note className='text-muted-foreground mb-4 size-9' />
                  <h3 className='text-sm font-semibold'>No notes yet</h3>
                  <p className='text-muted-foreground mt-1 mb-4 max-w-sm text-xs'>
                    Add the first note to this case.
                  </p>
                  <button
                    type='button'
                    onClick={() => setNoteDialogOpen(true)}
                    className='text-muted-foreground hover:text-foreground hover:border-primary/40 pointer-events-none flex h-20 w-52 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed opacity-0 transition-[opacity,color,border-color] group-focus-within/collection:pointer-events-auto group-focus-within/collection:opacity-100 group-hover/collection:pointer-events-auto group-hover/collection:opacity-100'
                  >
                    <Plus className='size-5' />
                    <span className='text-xs font-medium'>New Note</span>
                  </button>
                </div>
              ) : (
                <div className='flex flex-wrap gap-3'>
                  {notes.map((note) => (
                    <CaseResourceCard
                      key={note.id}
                      id={note.id}
                      kind='note'
                      name={note.name}
                      preview={note.content}
                      onOpen={() => onOpenNote?.(caseId, note.id, note.name)}
                      onRename={openRenameDialog}
                      onDelete={setDeleteTarget}
                    />
                  ))}
                  <button
                    type='button'
                    onClick={() => setNoteDialogOpen(true)}
                    className='text-muted-foreground hover:text-foreground hover:border-primary/40 pointer-events-none flex h-36 w-52 flex-col items-center justify-center gap-2 rounded-xl border border-dashed opacity-0 transition-[opacity,color,border-color] group-focus-within/collection:pointer-events-auto group-focus-within/collection:opacity-100 group-hover/collection:pointer-events-auto group-hover/collection:opacity-100'
                  >
                    <Plus className='size-5' />
                    <span className='text-xs font-medium'>New Note</span>
                  </button>
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </main>

      <Dialog open={graphDialogOpen} onOpenChange={setGraphDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Graph</DialogTitle>
            <DialogDescription>
              The graph will belong to {caseDetail.name}.
            </DialogDescription>
          </DialogHeader>
          <div className='flex flex-col gap-4 py-2'>
            <div className='flex flex-col gap-2'>
              <Label htmlFor='case-graph-name'>Name</Label>
              <Input
                id='case-graph-name'
                autoFocus
                value={graphName}
                onChange={(event) => setGraphName(event.target.value)}
                onKeyDown={(event) =>
                  event.key === 'Enter' && void createGraph()
                }
              />
            </div>
            <div className='flex flex-col gap-2'>
              <Label htmlFor='case-graph-description'>Description</Label>
              <Textarea
                id='case-graph-description'
                value={graphDescription}
                onChange={(event) => setGraphDescription(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setGraphDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={isSubmitting || !graphName.trim()}
              onClick={() => void createGraph()}
            >
              Create Graph
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={noteDialogOpen} onOpenChange={setNoteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Note</DialogTitle>
            <DialogDescription>
              The note will open in its own workspace tab.
            </DialogDescription>
          </DialogHeader>
          <div className='flex flex-col gap-2 py-2'>
            <Label htmlFor='case-note-name'>Title</Label>
            <Input
              id='case-note-name'
              autoFocus
              value={noteName}
              onChange={(event) => setNoteName(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && void createNote()}
            />
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setNoteDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={isSubmitting || !noteName.trim()}
              onClick={() => void createNote()}
            >
              Create Note
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={caseDialogOpen} onOpenChange={setCaseDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Case</DialogTitle>
            <DialogDescription>Update name and description.</DialogDescription>
          </DialogHeader>
          <div className='flex flex-col gap-4 py-2'>
            <div className='flex flex-col gap-2'>
              <Label htmlFor='edit-case-name'>Name</Label>
              <Input
                id='edit-case-name'
                autoFocus
                value={caseName}
                onChange={(event) => setCaseName(event.target.value)}
                onKeyDown={(event) =>
                  event.key === 'Enter' && void updateCase()
                }
              />
            </div>
            <div className='flex flex-col gap-2'>
              <Label htmlFor='edit-case-description'>Description</Label>
              <Textarea
                id='edit-case-description'
                value={caseDescription}
                onChange={(event) => setCaseDescription(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setCaseDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={isUpdatingCase || !caseName.trim()}
              onClick={() => void updateCase()}
            >
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(renameTarget)}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename {renameTarget?.kind}</DialogTitle>
            <DialogDescription>Choose a new name.</DialogDescription>
          </DialogHeader>
          <div className='flex flex-col gap-2 py-2'>
            <Label htmlFor='case-resource-name'>Name</Label>
            <Input
              id='case-resource-name'
              autoFocus
              value={renameName}
              onChange={(event) => setRenameName(event.target.value)}
              onKeyDown={(event) =>
                event.key === 'Enter' && void renameResource()
              }
            />
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setRenameTarget(null)}>
              Cancel
            </Button>
            <Button
              disabled={isUpdatingResource || !renameName.trim()}
              onClick={() => void renameResource()}
            >
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open && !isUpdatingResource) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isUpdatingResource}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isUpdatingResource}
              className={buttonVariants({ variant: 'destructive' })}
              onClick={(event) => {
                event.preventDefault();
                void deleteResource();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

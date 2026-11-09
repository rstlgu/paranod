'use client';

import { ArrowsSplitIcon as IconFlow } from '@/components/icons';
import { FlowRunsDialog } from '@/features/flow/components/flow-runs-dialog';
import {
  IconCopy,
  IconDotsVertical,
  IconHistory,
  IconLayoutGrid,
  IconList,
  IconPencil,
  IconPlus,
  IconSearch,
  IconTrash,
  IconX
} from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import PageContainer from '@/components/layout/page-container';
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
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardHeader
} from '@/components/ui/card';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
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
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { enUS } from 'date-fns/locale';
import { toast } from 'sonner';

interface Flow {
  id: string;
  name: string;
  description: string | null;
  nodeCount: number;
  edgeCount: number;
  thumbnail: string | null;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
}

type ViewMode = 'grid' | 'table';

const STORAGE_KEY_VIEW = 'flows-view-mode-v2';
const CACHE_KEY_FLOWS = 'flows-cache';
const CACHE_TTL = 5 * 60 * 1000; // 5 minuti

interface CachedData {
  flows: Flow[];
  timestamp: number;
}

export default function FlowsPage() {
  const router = useRouter();

  const [flows, setFlows] = useState<Flow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [runsFlow, setRunsFlow] = useState<Flow | null>(null);
  const [selectedFlow, setSelectedFlow] = useState<Flow | null>(null);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY_VIEW);
    if (saved === 'grid' || saved === 'table') setViewMode(saved);
  }, []);

  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem(STORAGE_KEY_VIEW, mode);
  };

  const getCached = useCallback((): CachedData | null => {
    try {
      const cached = sessionStorage.getItem(CACHE_KEY_FLOWS);
      if (!cached) return null;
      const data: CachedData = JSON.parse(cached);
      const now = Date.now();
      if (now - data.timestamp < CACHE_TTL) return data;
      sessionStorage.removeItem(CACHE_KEY_FLOWS);
      return null;
    } catch {
      return null;
    }
  }, []);

  const setCached = useCallback((flows: Flow[]) => {
    try {
      const data: CachedData = { flows, timestamp: Date.now() };
      sessionStorage.setItem(CACHE_KEY_FLOWS, JSON.stringify(data));
    } catch {
      // ignore
    }
  }, []);

  const invalidateCache = useCallback(() => {
    try {
      sessionStorage.removeItem(CACHE_KEY_FLOWS);
    } catch {
      // ignore
    }
  }, []);

  const fetchFlows = useCallback(
    async (forceRefresh = false) => {
      if (!forceRefresh) {
        const cached = getCached();
        if (cached) {
          setFlows(cached.flows);
          setLoading(false);
          return;
        }
      }

      try {
        const response = await fetch('/api/flows');
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.error ?? 'Failed to fetch');
        setFlows(data.flows ?? []);
        setCached(data.flows ?? []);
      } catch (e: any) {
        toast.error(e?.message ?? 'Failed to load flows');
      } finally {
        setLoading(false);
      }
    },
    [getCached, setCached]
  );

  useEffect(() => {
    fetchFlows();
  }, [fetchFlows]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // se un editor ha salvato, forziamo refresh
        const needRefresh =
          localStorage.getItem('flows-need-refresh') === 'true';
        void fetchFlows(needRefresh);
        if (needRefresh) localStorage.setItem('flows-need-refresh', 'false');
      }
    };
    const handleFocus = () => {
      const needRefresh = localStorage.getItem('flows-need-refresh') === 'true';
      void fetchFlows(needRefresh);
      if (needRefresh) localStorage.setItem('flows-need-refresh', 'false');
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [fetchFlows]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return flows;
    return flows.filter((f) => {
      const name = String(f.name ?? '').toLowerCase();
      const desc = String(f.description ?? '').toLowerCase();
      return name.includes(q) || desc.includes(q);
    });
  }, [flows, searchQuery]);

  const openFlow = (flow: Flow) => {
    router.push(
      `/?open=flow:${flow.id}&title=${encodeURIComponent(flow.name)}`
    );
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/flows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          description: newDescription.trim() || null
        })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error ?? 'Failed to create flow');
      }

      invalidateCache();
      setCreateDialogOpen(false);
      setNewName('');
      setNewDescription('');
      toast.success('Flow created');
      openFlow(data.flow);
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to create flow');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = async () => {
    if (!selectedFlow) return;
    if (!newName.trim()) return;
    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/flows/${selectedFlow.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          description: newDescription.trim() || null
        })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error ?? 'Failed to update flow');

      invalidateCache();
      toast.success('Flow updated');
      setEditDialogOpen(false);
      setSelectedFlow(null);
      void fetchFlows(true);
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to update flow');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedFlow) return;
    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/flows/${selectedFlow.id}`, {
        method: 'DELETE'
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error ?? 'Failed to delete flow');
      invalidateCache();
      toast.success('Flow deleted');
      setDeleteDialogOpen(false);
      setSelectedFlow(null);
      void fetchFlows(true);
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to delete flow');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDuplicate = async (flow: Flow) => {
    setIsSubmitting(true);
    try {
      const detailRes = await fetch(`/api/flows/${flow.id}`);
      const detail = await detailRes.json().catch(() => null);
      if (!detailRes.ok)
        throw new Error(detail?.error ?? 'Failed to load flow');

      const createRes = await fetch('/api/flows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${flow.name} (copy)`,
          description: flow.description ?? null
        })
      });
      const created = await createRes.json().catch(() => null);
      if (!createRes.ok)
        throw new Error(created?.error ?? 'Failed to duplicate flow');

      // copy nodes/edges
      await fetch(`/api/flows/${created.flow.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodes: detail?.flow?.nodes ?? [],
          edges: detail?.flow?.edges ?? []
        })
      });

      invalidateCache();
      toast.success('Flow duplicated');
      openFlow(created.flow);
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to duplicate flow');
    } finally {
      setIsSubmitting(false);
    }
  };

  const openCreateDialog = () => {
    setSelectedFlow(null);
    setNewName('');
    setNewDescription('');
    setCreateDialogOpen(true);
  };

  const openEditDialog = (flow: Flow) => {
    setSelectedFlow(flow);
    setNewName(flow.name);
    setNewDescription(flow.description ?? '');
    setEditDialogOpen(true);
  };

  const openDeleteDialog = (flow: Flow) => {
    setSelectedFlow(flow);
    setDeleteDialogOpen(true);
  };

  const FlowCard = ({ flow }: { flow: Flow }) => (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <article className='group bg-muted/25 hover:border-primary/30 focus-within:ring-ring relative h-36 min-w-0 overflow-hidden rounded-xl border transition-[border-color,box-shadow,transform] focus-within:ring-2 hover:-translate-y-px hover:shadow-sm'>
          <button
            type='button'
            onClick={() => openFlow(flow)}
            className='absolute inset-0 z-10 cursor-pointer outline-none'
            aria-label={`Open flow ${flow.name}`}
          />

          {flow.thumbnail ? (
            <div
              aria-hidden='true'
              className='absolute inset-0 bg-cover bg-center opacity-85 transition-transform duration-300 group-hover:scale-[1.02]'
              style={{
                backgroundImage: `url(${JSON.stringify(flow.thumbnail)})`
              }}
            />
          ) : (
            <>
              <div
                className='absolute inset-0 bg-[radial-gradient(circle_at_center,var(--border)_1px,transparent_1px)] bg-[size:14px_14px] opacity-35'
                aria-hidden='true'
              />
              <div className='bg-background/75 absolute top-3 left-3 flex size-9 items-center justify-center rounded-lg border shadow-sm backdrop-blur-sm'>
                <IconFlow className='text-primary size-4.5 -rotate-90' />
              </div>
            </>
          )}

          <div className='absolute top-14 left-3 flex flex-wrap gap-1.5'>
            <Badge
              variant='secondary'
              className='bg-background/75 h-5 px-1.5 text-[10px] backdrop-blur-sm'
            >
              {flow.nodeCount} nodes
            </Badge>
            <Badge
              variant='secondary'
              className='bg-background/75 h-5 px-1.5 text-[10px] backdrop-blur-sm'
            >
              {flow.edgeCount} links
            </Badge>
            {null}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant='ghost'
                size='icon'
                className='bg-background/70 hover:bg-background absolute top-2 right-2 z-20 size-7 rounded-lg opacity-75 shadow-sm backdrop-blur-sm transition-opacity hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100'
                aria-label={`Actions for ${flow.name}`}
              >
                <IconDotsVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              <DropdownMenuItem onSelect={() => openEditDialog(flow)}>
                <IconPencil /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void handleDuplicate(flow)}>
                <IconCopy /> Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setRunsFlow(flow)}>
                <IconHistory /> Run history
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant='destructive'
                onSelect={() => openDeleteDialog(flow)}
              >
                <IconTrash /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className='from-card via-card/95 pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t to-transparent px-3 pt-9 pb-2.5'>
            <p className='truncate text-sm font-semibold tracking-tight drop-shadow-sm'>
              {flow.name}
            </p>
          </div>
        </article>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => openEditDialog(flow)}>
          <IconPencil /> Edit
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void handleDuplicate(flow)}>
          <IconCopy /> Duplicate
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => setRunsFlow(flow)}>
          <IconHistory /> Run history
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          variant='destructive'
          onSelect={() => openDeleteDialog(flow)}
        >
          <IconTrash /> Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );

  return (
    <PageContainer containerClassName='bg-page px-4 py-6 md:px-8 md:py-8 lg:px-10'>
      <header className='flex items-start justify-between gap-4'>
        <div className='min-w-0'>
          <div className='flex items-center gap-2'>
            <IconFlow className='text-primary size-6 shrink-0 -rotate-90' />
            <h1 className='text-2xl font-semibold tracking-[-0.025em]'>
              Flows
            </h1>
            <Badge variant='secondary'>{filtered.length}</Badge>
          </div>
          <p className='text-muted-foreground mt-1.5 text-sm'>
            Transform flows for your workspace.
          </p>
        </div>
        <Button onClick={openCreateDialog}>
          <IconPlus /> New Flow
        </Button>
      </header>

      <section className='mt-10' aria-label='Flows collection'>
        <Card className='group/collection bg-page gap-4 rounded-2xl py-5 shadow-none'>
          <CardHeader className='px-5'>
            <div className='relative w-full max-w-[380px]'>
              <IconSearch className='text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2' />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder='Search flows…'
                className='pl-9'
              />
              {searchQuery ? (
                <button
                  className='text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2'
                  onClick={() => setSearchQuery('')}
                  type='button'
                  aria-label='Clear search'
                >
                  <IconX className='size-4' />
                </button>
              ) : null}
            </div>
            <CardAction>
              <ToggleGroup
                type='single'
                variant='outline'
                size='sm'
                value={viewMode}
                onValueChange={(value) =>
                  value && handleViewModeChange(value as ViewMode)
                }
              >
                <ToggleGroupItem value='grid' aria-label='Grid view'>
                  <IconLayoutGrid />
                </ToggleGroupItem>
                <ToggleGroupItem value='table' aria-label='List view'>
                  <IconList />
                </ToggleGroupItem>
              </ToggleGroup>
            </CardAction>
          </CardHeader>

          <CardContent className='min-h-[18.75rem] px-5'>
            {loading ? (
              <div className='grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-3'>
                {Array.from({ length: 4 }).map((_, index) => (
                  <Skeleton key={index} className='h-36 rounded-xl' />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className='flex min-h-[16rem] flex-col items-center justify-center p-8 text-center'>
                <IconFlow className='text-muted-foreground mb-4 size-9 -rotate-90' />
                <h2 className='text-sm font-semibold'>
                  {searchQuery ? 'No flows found' : 'No flows yet'}
                </h2>
                <p className='text-muted-foreground mt-1 mb-4 max-w-sm text-xs'>
                  {searchQuery
                    ? 'Try a different search term.'
                    : 'Create your first transform flow.'}
                </p>
                {!searchQuery ? (
                  <button
                    type='button'
                    onClick={openCreateDialog}
                    className='text-muted-foreground hover:text-foreground hover:border-primary/40 pointer-events-none mt-2 flex h-20 w-52 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed opacity-0 transition-[opacity,color,border-color] group-focus-within/collection:pointer-events-auto group-focus-within/collection:opacity-100 group-hover/collection:pointer-events-auto group-hover/collection:opacity-100'
                  >
                    <IconPlus className='size-5' />
                    <span className='text-xs font-medium'>New Flow</span>
                  </button>
                ) : null}
              </div>
            ) : viewMode === 'grid' ? (
              <div className='grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-3'>
                {filtered.map((flow) => (
                  <FlowCard key={flow.id} flow={flow} />
                ))}
                {!searchQuery ? (
                  <button
                    type='button'
                    onClick={openCreateDialog}
                    className='text-muted-foreground hover:text-foreground hover:border-primary/40 pointer-events-none flex h-36 flex-col items-center justify-center gap-2 rounded-xl border border-dashed opacity-0 transition-[opacity,color,border-color] group-focus-within/collection:pointer-events-auto group-focus-within/collection:opacity-100 group-hover/collection:pointer-events-auto group-hover/collection:opacity-100'
                  >
                    <IconPlus className='size-5' />
                    <span className='text-xs font-medium'>New Flow</span>
                  </button>
                ) : null}
              </div>
            ) : (
              <div className='overflow-hidden rounded-xl border'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead className='hidden md:table-cell'>
                        Description
                      </TableHead>
                      <TableHead className='text-right'>Nodes</TableHead>
                      <TableHead className='text-right'>Links</TableHead>
                      <TableHead className='hidden lg:table-cell'>
                        Updated
                      </TableHead>
                      <TableHead className='w-[60px]' />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((flow) => (
                      <TableRow
                        key={flow.id}
                        className='cursor-pointer'
                        onClick={() => openFlow(flow)}
                      >
                        <TableCell className='font-medium'>
                          <div className='flex items-center gap-2'>
                            <IconFlow className='text-primary h-4 w-4 shrink-0 -rotate-90' />
                            {flow.name}
                          </div>
                        </TableCell>
                        <TableCell className='text-muted-foreground hidden md:table-cell'>
                          {flow.description ?? '—'}
                        </TableCell>
                        <TableCell className='text-right'>
                          {flow.nodeCount}
                        </TableCell>
                        <TableCell className='text-right'>
                          {flow.edgeCount}
                        </TableCell>
                        <TableCell className='text-muted-foreground hidden lg:table-cell'>
                          {format(new Date(flow.updatedAt), 'PPP p', {
                            locale: enUS
                          })}
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant='ghost' size='icon'>
                                <IconDotsVertical className='h-4 w-4' />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align='end'>
                              <DropdownMenuItem
                                onSelect={() => openEditDialog(flow)}
                              >
                                <IconPencil /> Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => void handleDuplicate(flow)}
                              >
                                <IconCopy /> Duplicate
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => setRunsFlow(flow)}
                              >
                                <IconHistory /> Run history
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant='destructive'
                                onSelect={() => openDeleteDialog(flow)}
                              >
                                <IconTrash /> Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Run history */}
      {runsFlow ? (
        <FlowRunsDialog
          open={!!runsFlow}
          onOpenChange={(open) => {
            if (!open) setRunsFlow(null);
          }}
          flowId={runsFlow.id}
          flowName={runsFlow.name}
        />
      ) : null}

      {/* Create */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Flow</DialogTitle>
            <DialogDescription>Create a new transform flow.</DialogDescription>
          </DialogHeader>
          <div className='space-y-3'>
            <div className='space-y-1'>
              <Label>Name</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div className='space-y-1'>
              <Label>Description</Label>
              <Textarea
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => setCreateDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void handleCreate()}
              disabled={isSubmitting || !newName.trim()}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Flow</DialogTitle>
            <DialogDescription>Update name/description.</DialogDescription>
          </DialogHeader>
          <div className='space-y-3'>
            <div className='space-y-1'>
              <Label>Name</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div className='space-y-1'>
              <Label>Description</Label>
              <Textarea
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => {
                setEditDialogOpen(false);
                setSelectedFlow(null);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void handleEdit()}
              disabled={isSubmitting || !newName.trim()}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete flow?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className={cn(
                'bg-destructive text-destructive-foreground hover:bg-destructive/90'
              )}
              onClick={() => void handleDelete()}
              disabled={isSubmitting}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}

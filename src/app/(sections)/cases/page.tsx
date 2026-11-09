'use client';

import { FolderOpenIcon as IconFolderOpen } from '@/components/icons';
import {
  IconCheck,
  IconDotsVertical,
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
import { useWorkspaceTabsStore } from '@/features/workspace/store/workspace-tabs-store';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { enUS } from 'date-fns/locale';
import { toast } from 'sonner';

interface CaseItem {
  id: string;
  name: string;
  description: string | null;
  status: 'open' | 'closed' | 'archived';
  tags: string[];
  createdAt: string;
  updatedAt: string;
  _count?: {
    targets?: number;
    graphs?: number;
    notes?: number;
  };
}

type ViewMode = 'grid' | 'table';

const STORAGE_KEY_VIEW = 'cases-view-mode-v2';
const CACHE_KEY_CASES = 'cases-cache-v2';
const CACHE_KEY_GRAPHS = 'graphs-cache';
const RECENTS_KEY = 'paranod-omnibox-recents-v1';
const CACHE_TTL = 5 * 60 * 1000;

interface CachedData {
  cases: CaseItem[];
  timestamp: number;
}

export default function CasesPage() {
  const router = useRouter();

  const tabs = useWorkspaceTabsStore((state) => state.tabs);
  const closeTab = useWorkspaceTabsStore((state) => state.closeTab);
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedCase, setSelectedCase] = useState<CaseItem | null>(null);
  const [newCaseName, setNewCaseName] = useState('');
  const [newCaseDescription, setNewCaseDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [searchQuery, setSearchQuery] = useState('');

  const openCreateDialog = () => {
    setNewCaseName('');
    setNewCaseDescription('');
    setCreateDialogOpen(true);
  };

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY_VIEW);
    if (saved === 'grid' || saved === 'table') setViewMode(saved);
  }, []);

  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem(STORAGE_KEY_VIEW, mode);
  };

  const getCachedCases = useCallback((): CachedData | null => {
    try {
      const cached = sessionStorage.getItem(CACHE_KEY_CASES);
      if (!cached) return null;
      const data: CachedData = JSON.parse(cached);
      if (Date.now() - data.timestamp < CACHE_TTL) return data;
      sessionStorage.removeItem(CACHE_KEY_CASES);
      return null;
    } catch {
      return null;
    }
  }, []);

  const setCachedCases = useCallback((cases: CaseItem[]) => {
    try {
      sessionStorage.setItem(
        CACHE_KEY_CASES,
        JSON.stringify({ cases, timestamp: Date.now() })
      );
    } catch {
      // ignore
    }
  }, []);

  const invalidateCache = useCallback(() => {
    try {
      sessionStorage.removeItem(CACHE_KEY_CASES);
    } catch {
      /* ignore */
    }
  }, []);

  const fetchCases = useCallback(
    async (forceRefresh = false) => {
      if (!forceRefresh) {
        const cached = getCachedCases();
        if (cached) {
          setCases(cached.cases);
          setLoading(false);
          return;
        }
      }
      try {
        const response = await fetch('/api/cases');
        if (!response.ok) throw new Error('Failed to fetch');
        const data = await response.json();
        setCases(data.cases ?? []);
        setCachedCases(data.cases ?? []);
      } catch {
        toast.error('Unable to load cases');
      } finally {
        setLoading(false);
      }
    },
    [getCachedCases, setCachedCases]
  );

  useEffect(() => {
    fetchCases();
  }, [fetchCases]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') fetchCases(true);
    };
    const handleFocus = () => fetchCases(true);
    const checkForRefresh = () => {
      const shouldRefresh = localStorage.getItem('cases-need-refresh');
      if (shouldRefresh === 'true') {
        localStorage.removeItem('cases-need-refresh');
        fetchCases(true);
      }
    };
    checkForRefresh();
    const intervalId = setInterval(checkForRefresh, 1000);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [fetchCases]);

  const filteredCases = useMemo(() => {
    let filtered = cases.filter((c) => c.status !== 'archived');
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.description?.toLowerCase().includes(q) ?? false)
      );
    }
    return filtered.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }, [cases, searchQuery]);

  const handleCreate = async () => {
    if (!newCaseName.trim()) {
      toast.error('Name is required');
      return;
    }
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newCaseName,
          description: newCaseDescription
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error('Failed to create');
      }
      invalidateCache();
      setCreateDialogOpen(false);
      setNewCaseName('');
      setNewCaseDescription('');
      toast.success('Case created');
      router.push(`/cases/${data.case.id}`);
    } catch {
      toast.error('Creation failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = async () => {
    if (!selectedCase || !newCaseName.trim()) return;
    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/cases/${selectedCase.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newCaseName,
          description: newCaseDescription
        })
      });
      if (!response.ok) throw new Error('Failed to update');
      invalidateCache();
      toast.success('Case updated');
      setEditDialogOpen(false);
      setSelectedCase(null);
      void fetchCases(true);
    } catch {
      toast.error('Update failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedCase) return;
    const caseId = selectedCase.id;
    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/cases/${caseId}`, {
        method: 'DELETE'
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'Failed to delete');

      const graphIds = new Set<string>(data?.deleted?.graphIds ?? []);
      const noteIds = new Set<string>(data?.deleted?.noteIds ?? []);
      const noteTabIds = new Set(
        Array.from(noteIds, (noteId) => `${caseId}/${noteId}`)
      );

      tabs
        .filter(
          (tab) =>
            (tab.kind === 'case' && tab.resourceId === caseId) ||
            (tab.kind === 'graph' && graphIds.has(tab.resourceId)) ||
            (tab.kind === 'note' && noteTabIds.has(tab.resourceId))
        )
        .forEach((tab) => closeTab(tab.id));

      try {
        sessionStorage.removeItem(CACHE_KEY_GRAPHS);
        localStorage.setItem('graphs-need-refresh', 'true');
        localStorage.setItem('cases-need-refresh', 'true');

        graphIds.forEach((graphId) => {
          localStorage.removeItem(
            `paranod-manual-node-positions-v1:${graphId}`
          );
          sessionStorage.removeItem(
            `paranod-graph-node-type-filter-v1:${graphId}`
          );
        });

        const rawRecents = localStorage.getItem(RECENTS_KEY);
        if (rawRecents) {
          const recents = JSON.parse(rawRecents) as Array<{
            kind?: string;
            id?: string;
          }>;
          const nextRecents = recents.filter(
            (item) =>
              !(item.kind === 'case' && item.id === caseId) &&
              !(item.kind === 'graph' && item.id && graphIds.has(item.id))
          );
          localStorage.setItem(RECENTS_KEY, JSON.stringify(nextRecents));
        }
      } catch {
        // Storage cleanup is best-effort; server deletion already succeeded.
      }

      invalidateCache();
      toast.success('Case deleted');
      setDeleteDialogOpen(false);
      setSelectedCase(null);
      void fetchCases(true);
    } catch {
      toast.error('Deletion failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const openEditDialog = (caseItem: CaseItem) => {
    setSelectedCase(caseItem);
    setNewCaseName(caseItem.name);
    setNewCaseDescription(caseItem.description || '');
    setEditDialogOpen(true);
  };

  const openDeleteDialog = (caseItem: CaseItem) => {
    setSelectedCase(caseItem);
    setDeleteDialogOpen(true);
  };

  const openCase = (caseItem: CaseItem) => {
    router.push(`/cases/${caseItem.id}`);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'open':
        return (
          <Badge
            variant='outline'
            className='border-green-200 bg-green-50 text-xs text-green-600 dark:border-green-900/30 dark:bg-green-900/10 dark:text-green-400'
          >
            <IconCheck className='mr-1 h-3 w-3' />
            Open
          </Badge>
        );
      case 'closed':
        return (
          <Badge variant='outline' className='text-xs'>
            Closed
          </Badge>
        );
      case 'archived':
        return (
          <Badge
            variant='outline'
            className='border-orange-200 bg-orange-50 text-xs text-orange-600 dark:border-orange-900/30 dark:bg-orange-900/10 dark:text-orange-400'
          >
            Archived
          </Badge>
        );
      default:
        return null;
    }
  };

  const CaseCard = ({ caseItem }: { caseItem: CaseItem }) => (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <article className='group bg-muted/25 hover:border-primary/30 focus-within:ring-ring relative h-36 min-w-0 overflow-hidden rounded-xl border transition-[border-color,box-shadow,transform] focus-within:ring-2 hover:-translate-y-px hover:shadow-sm'>
          <button
            type='button'
            onClick={() => openCase(caseItem)}
            className='absolute inset-0 z-10 cursor-pointer outline-none'
            aria-label={`Open case ${caseItem.name}`}
          />

          <div
            className='absolute inset-0 bg-[radial-gradient(circle_at_center,var(--border)_1px,transparent_1px)] bg-[size:14px_14px] opacity-35'
            aria-hidden='true'
          />
          <div className='absolute top-3 left-3'>
            <div className='flex items-center gap-1.5'>
              <div className='bg-background/75 flex size-9 items-center justify-center rounded-lg border shadow-sm backdrop-blur-sm'>
                <IconFolderOpen className='text-primary size-4.5' />
              </div>
              <Badge variant='secondary' className='h-5 px-1.5 text-[10px]'>
                {caseItem._count?.graphs ?? 0} graphs
              </Badge>
            </div>
            <div className='mt-3 flex flex-wrap gap-1.5'>
              <Badge variant='secondary' className='h-5 px-1.5 text-[10px]'>
                {caseItem._count?.notes ?? 0} notes
              </Badge>
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant='ghost'
                size='icon'
                className='bg-background/70 hover:bg-background absolute top-2 right-2 z-20 size-7 rounded-lg opacity-75 shadow-sm backdrop-blur-sm transition-opacity hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100'
                aria-label={`Actions for ${caseItem.name}`}
              >
                <IconDotsVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              <DropdownMenuItem onSelect={() => openEditDialog(caseItem)}>
                <IconPencil /> Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant='destructive'
                onSelect={() => openDeleteDialog(caseItem)}
              >
                <IconTrash /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className='from-card via-card/95 pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t to-transparent px-3 pt-9 pb-2.5'>
            <p className='truncate text-sm font-semibold tracking-tight drop-shadow-sm'>
              {caseItem.name}
            </p>
          </div>
        </article>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => openEditDialog(caseItem)}>
          <IconPencil /> Edit
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          variant='destructive'
          onSelect={() => openDeleteDialog(caseItem)}
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
            <IconFolderOpen className='text-primary size-6 shrink-0' />
            <h1 className='text-2xl font-semibold tracking-[-0.025em]'>
              Cases
            </h1>
            <Badge variant='secondary'>{filteredCases.length}</Badge>
          </div>
          <p className='text-muted-foreground mt-1.5 text-sm'>
            Investigations shared across your workspace.
          </p>
        </div>
        <Button onClick={openCreateDialog}>
          <IconPlus /> New Case
        </Button>
      </header>

      <section className='mt-10' aria-label='Cases collection'>
        <Card className='group/collection bg-page gap-4 rounded-2xl py-5 shadow-none'>
          <CardHeader className='px-5'>
            <div className='relative w-full max-w-[380px]'>
              <IconSearch className='text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2' />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder='Search cases…'
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
            ) : filteredCases.length === 0 ? (
              <div className='flex min-h-[16rem] flex-col items-center justify-center p-8 text-center'>
                <IconFolderOpen className='text-muted-foreground mb-4 size-9' />
                <h2 className='text-sm font-semibold'>
                  {searchQuery ? 'No cases found' : 'No cases yet'}
                </h2>
                <p className='text-muted-foreground mt-1 mb-4 max-w-sm text-xs'>
                  {searchQuery
                    ? 'Try a different search term.'
                    : 'Create your first case to start an investigation.'}
                </p>
                {!searchQuery ? (
                  <button
                    type='button'
                    onClick={openCreateDialog}
                    className='text-muted-foreground hover:text-foreground hover:border-primary/40 pointer-events-none mt-2 flex h-20 w-52 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed opacity-0 transition-[opacity,color,border-color] group-focus-within/collection:pointer-events-auto group-focus-within/collection:opacity-100 group-hover/collection:pointer-events-auto group-hover/collection:opacity-100'
                  >
                    <IconPlus className='size-5' />
                    <span className='text-xs font-medium'>New Case</span>
                  </button>
                ) : null}
              </div>
            ) : viewMode === 'grid' ? (
              <div className='grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-3'>
                {filteredCases.map((caseItem) => (
                  <CaseCard key={caseItem.id} caseItem={caseItem} />
                ))}
                {!searchQuery ? (
                  <button
                    type='button'
                    onClick={openCreateDialog}
                    className='text-muted-foreground hover:text-foreground hover:border-primary/40 pointer-events-none flex h-36 flex-col items-center justify-center gap-2 rounded-xl border border-dashed opacity-0 transition-[opacity,color,border-color] group-focus-within/collection:pointer-events-auto group-focus-within/collection:opacity-100 group-hover/collection:pointer-events-auto group-hover/collection:opacity-100'
                  >
                    <IconPlus className='size-5' />
                    <span className='text-xs font-medium'>New Case</span>
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
                      <TableHead className='text-center'>Status</TableHead>
                      <TableHead className='text-right'>Targets</TableHead>
                      <TableHead className='text-right'>Notes</TableHead>
                      <TableHead className='text-right'>Graphs</TableHead>
                      <TableHead className='hidden lg:table-cell'>
                        Updated
                      </TableHead>
                      <TableHead className='w-[60px]' />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredCases.map((caseItem) => (
                      <TableRow
                        key={caseItem.id}
                        className='cursor-pointer'
                        onClick={() => openCase(caseItem)}
                      >
                        <TableCell className='font-medium'>
                          <div className='flex items-center gap-2'>
                            <IconFolderOpen className='text-primary h-4 w-4 shrink-0' />
                            {caseItem.name}
                          </div>
                        </TableCell>
                        <TableCell className='text-muted-foreground hidden md:table-cell'>
                          {caseItem.description || '—'}
                        </TableCell>
                        <TableCell className='text-center'>
                          {getStatusBadge(caseItem.status)}
                        </TableCell>
                        <TableCell className='text-right'>
                          {caseItem._count?.targets ?? 0}
                        </TableCell>
                        <TableCell className='text-right'>
                          {caseItem._count?.notes ?? 0}
                        </TableCell>
                        <TableCell className='text-right'>
                          {caseItem._count?.graphs ?? 0}
                        </TableCell>
                        <TableCell className='text-muted-foreground hidden lg:table-cell'>
                          {format(new Date(caseItem.updatedAt), 'PPP p', {
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
                                onSelect={() => openEditDialog(caseItem)}
                              >
                                <IconPencil /> Edit
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant='destructive'
                                onSelect={() => openDeleteDialog(caseItem)}
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

      {/* Create Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Case</DialogTitle>
            <DialogDescription>
              Create a persistent target-centric investigative container.
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-3'>
            <div className='space-y-1'>
              <Label>Name</Label>
              <Input
                value={newCaseName}
                onChange={(e) => setNewCaseName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              />
            </div>
            <div className='space-y-1'>
              <Label>Description</Label>
              <Textarea
                value={newCaseDescription}
                onChange={(e) => setNewCaseDescription(e.target.value)}
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
              disabled={isSubmitting || !newCaseName.trim()}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Case</DialogTitle>
            <DialogDescription>Update name and description.</DialogDescription>
          </DialogHeader>
          <div className='space-y-3'>
            <div className='space-y-1'>
              <Label>Name</Label>
              <Input
                value={newCaseName}
                onChange={(e) => setNewCaseName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleEdit()}
              />
            </div>
            <div className='space-y-1'>
              <Label>Description</Label>
              <Textarea
                value={newCaseDescription}
                onChange={(e) => setNewCaseDescription(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => {
                setEditDialogOpen(false);
                setSelectedCase(null);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void handleEdit()}
              disabled={isSubmitting || !newCaseName.trim()}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Case</AlertDialogTitle>
            <AlertDialogDescription>
              Delete &quot;{selectedCase?.name}&quot; and all of its graphs and
              notes? This action cannot be undone.
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

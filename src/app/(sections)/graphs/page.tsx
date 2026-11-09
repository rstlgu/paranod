'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  IconPlus,
  IconDotsVertical,
  IconTrash,
  IconPencil,
  IconCopy,
  IconClock,
  IconLayoutGrid,
  IconList,
  IconSearch,
  IconX,
  IconPoint,
  IconLock,
  IconUsers
} from '@tabler/icons-react';
import { GraphIcon as IconGraph } from '@/components/icons';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import { Heading } from '@/components/ui/heading';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import PageContainer from '@/components/layout/page-container';
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
import { toast } from 'sonner';
import { formatDistanceToNow, format } from 'date-fns';
import { it } from 'date-fns/locale';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';

interface Graph {
  id: string;
  name: string;
  description: string | null;
  nodeCount: number;
  edgeCount: number;
  thumbnail: string | null;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
  visibility?: 'private' | 'workspace';
  userId?: string;
  caseId: string;
  case: { id: string; name: string };
}

interface CaseItem {
  id: string;
  name: string;
}

type ViewMode = 'grid' | 'table';

const STORAGE_KEY_VIEW = 'graphs-view-mode';
const CACHE_KEY_GRAPHS = 'graphs-cache';
const CACHE_TTL = 5 * 60 * 1000; // 5 minuti

interface CachedData {
  graphs: Graph[];
  timestamp: number;
}

export default function GraphsPage() {
  const router = useRouter();
  const [graphs, setGraphs] = useState<Graph[]>([]);
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedGraph, setSelectedGraph] = useState<Graph | null>(null);
  const [newGraphName, setNewGraphName] = useState('');
  const [newGraphDescription, setNewGraphDescription] = useState('');
  const [selectedCaseId, setSelectedCaseId] = useState('');
  const [isShared, setIsShared] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [searchQuery, setSearchQuery] = useState('');

  // Carica preferenza vista da localStorage
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY_VIEW);
    if (saved === 'grid' || saved === 'table') {
      setViewMode(saved);
    }
  }, []);

  // Salva preferenza vista
  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem(STORAGE_KEY_VIEW, mode);
  };

  // Helper per gestire il cache
  const getCachedGraphs = useCallback((): CachedData | null => {
    try {
      const cached = sessionStorage.getItem(CACHE_KEY_GRAPHS);
      if (!cached) return null;

      const data: CachedData = JSON.parse(cached);
      const now = Date.now();

      // Controlla se il cache è ancora valido
      if (now - data.timestamp < CACHE_TTL) {
        return data;
      }

      // Cache scaduto
      sessionStorage.removeItem(CACHE_KEY_GRAPHS);
      return null;
    } catch {
      return null;
    }
  }, []);

  const setCachedGraphs = useCallback((graphs: Graph[]) => {
    try {
      const data: CachedData = {
        graphs,
        timestamp: Date.now()
      };
      sessionStorage.setItem(CACHE_KEY_GRAPHS, JSON.stringify(data));
    } catch {
      // Ignora errori di storage
    }
  }, []);

  const invalidateCache = useCallback(() => {
    try {
      sessionStorage.removeItem(CACHE_KEY_GRAPHS);
    } catch {
      // Ignora errori
    }
  }, []);

  // Carica i grafi con caching intelligente
  const fetchGraphs = useCallback(
    async (forceRefresh = false) => {
      // Prova prima a caricare dal cache
      if (!forceRefresh) {
        const cached = getCachedGraphs();
        if (cached) {
          setGraphs(cached.graphs);
          setLoading(false);
          return;
        }
      }

      try {
        const response = await fetch('/api/graphs');
        if (!response.ok) throw new Error('Failed to fetch');
        const data = await response.json();
        setGraphs(data.graphs);
        setCachedGraphs(data.graphs); // Salva nel cache
      } catch {
        toast.error('Failed to load graphs');
      } finally {
        setLoading(false);
      }
    },
    [getCachedGraphs, setCachedGraphs]
  );

  useEffect(() => {
    fetchGraphs();
  }, [fetchGraphs]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/cases')
      .then((response) => (response.ok ? response.json() : { cases: [] }))
      .then((data) => {
        if (cancelled) return;
        const nextCases = Array.isArray(data.cases) ? data.cases : [];
        setCases(nextCases);
        setSelectedCaseId((current) => current || nextCases[0]?.id || '');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Ricarica i grafici quando la pagina diventa visibile
  // (es. quando torni dall'editing di un grafo)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Forza il refresh quando la pagina diventa visibile
        fetchGraphs(true);
      }
    };

    const handleFocus = () => {
      // Forza il refresh anche quando la finestra riceve il focus
      fetchGraphs(true);
    };

    // Controlla periodicamente se è stato richiesto un refresh
    const checkForRefresh = () => {
      const shouldRefresh = localStorage.getItem('graphs-need-refresh');
      if (shouldRefresh === 'true') {
        localStorage.removeItem('graphs-need-refresh');
        console.log('🔄 Rilevato flag di refresh, ricarico grafici...');
        fetchGraphs(true);
      }
    };

    // Controlla al mount e ogni secondo
    checkForRefresh();
    const intervalId = setInterval(checkForRefresh, 1000);

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [fetchGraphs]);

  // Filtra e ordina grafi (più recenti prima)
  const filteredGraphs = useMemo(() => {
    let filtered = graphs;

    // Filtra per ricerca
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = graphs.filter(
        (g) =>
          g.name.toLowerCase().includes(q) ||
          (g.description?.toLowerCase().includes(q) ?? false)
      );
    }

    // Ordina per data di modifica (più recenti prima)
    return filtered.sort((a, b) => {
      const dateA = new Date(a.updatedAt).getTime();
      const dateB = new Date(b.updatedAt).getTime();
      return dateB - dateA; // Decrescente
    });
  }, [graphs, searchQuery]);

  // Crea nuovo grafo
  const handleCreate = async () => {
    if (!newGraphName.trim()) {
      toast.error('Name is required');
      return;
    }
    if (!selectedCaseId) {
      toast.error('Create a case before creating a graph');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch('/api/graphs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newGraphName,
          description: newGraphDescription,
          caseId: selectedCaseId,
          visibility: isShared ? 'workspace' : 'private'
        })
      });

      if (!response.ok) throw new Error('Failed to create');

      const data = await response.json();
      const updatedGraphs = [data.graph, ...graphs];
      setGraphs(updatedGraphs);
      setCachedGraphs(updatedGraphs); // Aggiorna cache
      setCreateDialogOpen(false);
      setNewGraphName('');
      setNewGraphDescription('');
      setIsShared(true);
      toast.success('Graph created');

      // Apri subito il nuovo grafo
      router.push(
        `/?open=graph:${data.graph.id}&title=${encodeURIComponent(
          data.graph.name ?? 'Graph'
        )}`
      );
    } catch {
      toast.error('Failed to create graph');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Modifica grafo
  const handleEdit = async () => {
    if (!selectedGraph || !newGraphName.trim()) return;

    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/graphs/${selectedGraph.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newGraphName,
          description: newGraphDescription,
          visibility: isShared ? 'workspace' : 'private'
        })
      });

      if (!response.ok) throw new Error('Failed to update');

      const data = await response.json();
      const updatedGraphs = graphs.map((g) =>
        g.id === data.graph.id ? data.graph : g
      );
      setGraphs(updatedGraphs);
      setCachedGraphs(updatedGraphs); // Aggiorna cache
      setEditDialogOpen(false);
      setSelectedGraph(null);
      toast.success('Graph updated');
    } catch {
      toast.error('Failed to update graph');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Elimina grafo
  const handleDelete = async () => {
    if (!selectedGraph) return;

    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/graphs/${selectedGraph.id}`, {
        method: 'DELETE'
      });

      if (!response.ok) throw new Error('Failed to delete');

      const updatedGraphs = graphs.filter((g) => g.id !== selectedGraph.id);
      setGraphs(updatedGraphs);
      setCachedGraphs(updatedGraphs); // Aggiorna cache
      setDeleteDialogOpen(false);
      setSelectedGraph(null);
      toast.success('Graph deleted');
    } catch {
      toast.error('Failed to delete graph');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Duplica grafo
  const handleDuplicate = async (graph: Graph, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      const getResponse = await fetch(`/api/graphs/${graph.id}`);
      if (!getResponse.ok) throw new Error('Failed to fetch');
      const getData = await getResponse.json();

      const createResponse = await fetch('/api/graphs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${graph.name} (Copy)`,
          description: graph.description,
          caseId: graph.caseId
        })
      });

      if (!createResponse.ok) throw new Error('Failed to create');
      const createData = await createResponse.json();

      const updateResponse = await fetch(`/api/graphs/${createData.graph.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodes: getData.graph.nodes,
          edges: getData.graph.edges
        })
      });

      if (!updateResponse.ok) throw new Error('Failed to update');
      const updateData = await updateResponse.json();

      setGraphs([updateData.graph, ...graphs]);
      toast.success('Graph duplicated');
    } catch {
      toast.error('Failed to duplicate graph');
    }
  };

  const openEditDialog = (graph: Graph, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSelectedGraph(graph);
    setNewGraphName(graph.name);
    setNewGraphDescription(graph.description || '');
    setIsShared(graph.visibility !== 'private');
    setEditDialogOpen(true);
  };

  const openDeleteDialog = (graph: Graph, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSelectedGraph(graph);
    setDeleteDialogOpen(true);
  };

  const openGraph = (graph: Graph) => {
    router.push(
      `/?open=graph:${graph.id}&title=${encodeURIComponent(
        graph.name ?? 'Graph'
      )}`
    );
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const relative = formatDistanceToNow(date, {
      addSuffix: true,
      locale: it
    });
    const absolute = format(date, 'dd/MM/yyyy HH:mm');
    return { relative, absolute, date };
  };

  // Card Graph per vista Grid
  const GraphCard = ({ graph }: { graph: Graph }) => (
    <motion.div whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}>
      <Card
        className='group hover:border-primary/20 dark:hover:shadow-primary/5 relative flex cursor-pointer flex-col overflow-hidden rounded-[24px] border border-zinc-200/50 bg-white/50 shadow-sm backdrop-blur-xl transition-all duration-300 hover:shadow-lg dark:border-zinc-800/50 dark:bg-zinc-900/50'
        onClick={() => openGraph(graph)}
      >
        <CardHeader className='relative pb-2'>
          <div className='flex items-start justify-between gap-3'>
            <div className='flex items-center gap-3'>
              <div className='bg-primary/5 flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-zinc-200/50 shadow-sm dark:border-zinc-700/50 dark:bg-zinc-800/50'>
                <IconGraph className='text-primary h-6 w-6' />
              </div>
              <div className='min-w-0'>
                <CardTitle className='truncate text-base font-bold tracking-tight'>
                  {graph.name}
                </CardTitle>
                <CardDescription className='line-clamp-1 text-xs font-medium'>
                  {graph.description || 'No description'}
                </CardDescription>
              </div>
            </div>
            <div onClick={(e) => e.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant='ghost'
                    size='icon'
                    className='h-8 w-8 opacity-0 transition-opacity group-hover:opacity-100'
                  >
                    <IconDotsVertical className='h-4 w-4' />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='end'>
                  <DropdownMenuItem
                    onClick={(e) =>
                      openEditDialog(graph, e as unknown as React.MouseEvent)
                    }
                  >
                    <IconPencil className='mr-2 h-4 w-4' />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={(e) =>
                      handleDuplicate(graph, e as unknown as React.MouseEvent)
                    }
                  >
                    <IconCopy className='mr-2 h-4 w-4' />
                    Duplicate
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={(e) =>
                      openDeleteDialog(graph, e as unknown as React.MouseEvent)
                    }
                    className='text-destructive focus:text-destructive'
                  >
                    <IconTrash className='mr-2 h-4 w-4' />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </CardHeader>
        <CardFooter className='flex items-center justify-between border-t pt-3'>
          <div className='flex items-center gap-2'>
            <Badge
              variant='secondary'
              className='h-5 px-1.5 text-[10px] font-medium'
            >
              <IconPoint className='mr-1 h-3 w-3' />
              {graph.nodeCount} nodes
            </Badge>
            <Badge
              variant='secondary'
              className='h-5 px-1.5 text-[10px] font-medium'
            >
              {graph.edgeCount} edges
            </Badge>
          </div>
          <div className='flex items-center gap-2'>
            {graph.visibility === 'private' ? (
              <IconLock
                className='text-muted-foreground h-3.5 w-3.5'
                title='Private'
              />
            ) : (
              <IconUsers
                className='text-muted-foreground h-3.5 w-3.5'
                title='Shared with workspace'
              />
            )}
            <span className='text-muted-foreground flex items-center gap-1 text-xs'>
              <IconClock className='h-3 w-3' />
              <span className='flex flex-col gap-0.5'>
                <span>{formatDate(graph.updatedAt).relative}</span>
                <span className='text-[10px] opacity-70'>
                  {formatDate(graph.updatedAt).absolute}
                </span>
              </span>
            </span>
          </div>
        </CardFooter>
      </Card>
    </motion.div>
  );

  // (table view uses <Table> directly in JSX below)

  return (
    <PageContainer>
      <div className='flex items-center justify-between'>
        <div>
          <Heading
            title={`Graphs (${graphs.length})`}
            description='Create and manage your OSINT investigation graphs.'
          />
        </div>
        <Button
          onClick={() => {
            if (cases.length === 0) {
              router.push('/cases');
              return;
            }
            setNewGraphName('');
            setNewGraphDescription('');
            setSelectedCaseId(cases[0]?.id || '');
            setCreateDialogOpen(true);
          }}
        >
          <IconPlus className='mr-2 h-4 w-4' />
          {cases.length === 0 ? 'New Case' : 'New Graph'}
        </Button>
      </div>

      <Separator className='my-4' />

      <div className='flex flex-col gap-3 md:flex-row md:items-center md:justify-between'>
        <div className='relative w-full md:w-[380px]'>
          <IconSearch className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2' />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder='Search graphs...'
            className='pl-9'
          />
          {searchQuery ? (
            <button
              className='text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2'
              onClick={() => setSearchQuery('')}
              type='button'
              aria-label='Clear search'
            >
              <IconX className='h-4 w-4' />
            </button>
          ) : null}
        </div>

        <ToggleGroup
          type='single'
          value={viewMode}
          onValueChange={(v) => v && handleViewModeChange(v as ViewMode)}
        >
          <ToggleGroupItem value='table' aria-label='Table view'>
            <IconList className='h-4 w-4' />
          </ToggleGroupItem>
          <ToggleGroupItem value='grid' aria-label='Grid view'>
            <IconLayoutGrid className='h-4 w-4' />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className='mt-4'>
        {loading ? (
          <div className='space-y-2'>
            <Skeleton className='h-10 w-full' />
            <Skeleton className='h-10 w-full' />
            <Skeleton className='h-10 w-full' />
          </div>
        ) : filteredGraphs.length === 0 ? (
          <div className='flex min-h-[300px] flex-col items-center justify-center p-8 text-center'>
            <IconGraph className='text-muted-foreground mb-4 h-10 w-10' />
            <h3 className='mb-1 text-sm font-semibold'>
              {searchQuery ? 'No graphs found' : 'No graphs yet'}
            </h3>
            <p className='text-muted-foreground mb-4 max-w-sm text-xs'>
              {searchQuery
                ? 'Try a different search term.'
                : cases.length === 0
                  ? 'Create a case first. Every graph belongs to one case.'
                  : 'Create your first OSINT investigation graph to start mapping entities and relationships.'}
            </p>
            {!searchQuery && (
              <Button
                onClick={() => {
                  if (cases.length === 0) {
                    router.push('/cases');
                    return;
                  }
                  setNewGraphName('');
                  setNewGraphDescription('');
                  setSelectedCaseId(cases[0]?.id || '');
                  setCreateDialogOpen(true);
                }}
              >
                <IconPlus className='mr-2 h-4 w-4' />
                {cases.length === 0
                  ? 'Create First Case'
                  : 'Create First Graph'}
              </Button>
            )}
          </div>
        ) : viewMode === 'grid' ? (
          <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
            <AnimatePresence>
              {filteredGraphs.map((graph) => (
                <GraphCard key={graph.id} graph={graph} />
              ))}
            </AnimatePresence>
          </div>
        ) : (
          <div className='rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className='hidden md:table-cell'>
                    Description
                  </TableHead>
                  <TableHead>Case</TableHead>
                  <TableHead className='text-center'>Visibility</TableHead>
                  <TableHead className='text-right'>Nodes</TableHead>
                  <TableHead className='text-right'>Edges</TableHead>
                  <TableHead className='hidden lg:table-cell'>
                    Updated
                  </TableHead>
                  <TableHead className='w-[60px]' />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredGraphs.map((graph) => (
                  <TableRow
                    key={graph.id}
                    className='cursor-pointer'
                    onClick={() => openGraph(graph)}
                  >
                    <TableCell className='font-medium'>
                      <div className='flex items-center gap-2'>
                        <IconGraph className='text-primary h-4 w-4 shrink-0' />
                        {graph.name}
                      </div>
                    </TableCell>
                    <TableCell className='text-muted-foreground hidden md:table-cell'>
                      {graph.description || '—'}
                    </TableCell>
                    <TableCell className='text-muted-foreground'>
                      {graph.case?.name || '—'}
                    </TableCell>
                    <TableCell className='text-center'>
                      {graph.visibility === 'private' ? (
                        <Badge variant='outline' className='text-xs'>
                          <IconLock className='mr-1 h-3 w-3' />
                          Private
                        </Badge>
                      ) : (
                        <Badge variant='outline' className='text-xs'>
                          <IconUsers className='mr-1 h-3 w-3' />
                          Shared
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className='text-right'>
                      {graph.nodeCount}
                    </TableCell>
                    <TableCell className='text-right'>
                      {graph.edgeCount}
                    </TableCell>
                    <TableCell className='text-muted-foreground hidden lg:table-cell'>
                      {format(new Date(graph.updatedAt), 'PPP p', {
                        locale: it
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
                            onClick={() => openEditDialog(graph)}
                          >
                            <IconPencil className='mr-2 h-4 w-4' />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => void handleDuplicate(graph)}
                          >
                            <IconCopy className='mr-2 h-4 w-4' />
                            Duplicate
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className='text-destructive focus:text-destructive'
                            onClick={() => openDeleteDialog(graph)}
                          >
                            <IconTrash className='mr-2 h-4 w-4' />
                            Delete
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
      </div>

      {/* Create Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Graph</DialogTitle>
            <DialogDescription>
              Create a new OSINT investigation graph.
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-4 py-4'>
            <div className='space-y-2'>
              <Label htmlFor='graph-case'>Case</Label>
              <Select value={selectedCaseId} onValueChange={setSelectedCaseId}>
                <SelectTrigger id='graph-case'>
                  <SelectValue placeholder='Select a case' />
                </SelectTrigger>
                <SelectContent>
                  {cases.map((caseItem) => (
                    <SelectItem key={caseItem.id} value={caseItem.id}>
                      {caseItem.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className='space-y-2'>
              <Label htmlFor='name'>Name</Label>
              <Input
                id='name'
                placeholder='Investigation Alpha'
                value={newGraphName}
                onChange={(e) => setNewGraphName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='description'>Description (optional)</Label>
              <Textarea
                id='description'
                placeholder='Brief description...'
                value={newGraphDescription}
                onChange={(e) => setNewGraphDescription(e.target.value)}
                rows={3}
              />
            </div>
            <div className='flex items-center justify-between rounded-lg border p-3'>
              <div className='flex items-center gap-2'>
                <IconUsers className='text-muted-foreground h-4 w-4' />
                <div>
                  <p className='text-sm font-medium'>Share with workspace</p>
                  <p className='text-muted-foreground text-xs'>
                    All workspace members can access
                  </p>
                </div>
              </div>
              <Switch checked={isShared} onCheckedChange={setIsShared} />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => setCreateDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={isSubmitting}>
              {isSubmitting ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Graph</DialogTitle>
            <DialogDescription>
              Update the name, description and visibility.
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-4 py-4'>
            <div className='space-y-2'>
              <Label htmlFor='edit-name'>Name</Label>
              <Input
                id='edit-name'
                value={newGraphName}
                onChange={(e) => setNewGraphName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleEdit()}
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='edit-description'>Description</Label>
              <Textarea
                id='edit-description'
                value={newGraphDescription}
                onChange={(e) => setNewGraphDescription(e.target.value)}
                rows={3}
              />
            </div>
            <div className='flex items-center justify-between rounded-lg border p-3'>
              <div className='flex items-center gap-2'>
                <IconUsers className='text-muted-foreground h-4 w-4' />
                <div>
                  <p className='text-sm font-medium'>Share with workspace</p>
                  <p className='text-muted-foreground text-xs'>
                    All workspace members can access
                  </p>
                </div>
              </div>
              <Switch checked={isShared} onCheckedChange={setIsShared} />
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleEdit} disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Graph</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{selectedGraph?.name}&quot;?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
            >
              {isSubmitting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}

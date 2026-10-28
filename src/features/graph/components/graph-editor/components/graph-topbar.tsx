'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { Edge } from 'reactflow';
import { BackgroundVariant } from 'reactflow';
import {
  BezierCurveIcon as IconVectorSpline,
  CaretRightIcon as IconChevronRight,
  ColumnsIcon as IconLayoutDistributeHorizontal,
  CornersOutIcon as IconFocusCentered,
  DownloadSimpleIcon as IconDownload,
  EyeIcon as IconEye,
  EyeSlashIcon as IconEyeOff,
  FileTextIcon as IconFileText,
  FloppyDiskIcon as IconDeviceFloppy,
  FolderOpenIcon as IconFolderOpen,
  DotsNineIcon as IconGridDots,
  FunnelIcon as IconFilter,
  GraphIcon as IconGraph,
  HandIcon as IconHand,
  ImageIcon as IconPhoto,
  LayoutIcon as IconLayoutGrid,
  MapTrifoldIcon as IconMap2,
  NotePencilIcon as IconNotes,
  RowsIcon as IconLayoutDistributeVertical,
  LineSegmentIcon as IconLine,
  ListDashesIcon as IconLineDashed,
  ListBulletsIcon as IconListDetails,
  MagnifyingGlassIcon as IconSearch,
  MagnifyingGlassMinusIcon as IconZoomOut,
  MagnifyingGlassPlusIcon as IconZoomIn,
  ArrowsOutSimpleIcon as IconMaximize,
  PlusIcon as IconPlus,
  PlusCircleIcon as IconCirclePlus,
  ArrowsClockwiseIcon as IconRefresh,
  TreeStructureIcon as IconTreeStructure,
  UploadSimpleIcon as IconUpload,
  CircleNotchIcon as IconLoader2,
  TrashIcon as IconTrash,
  PaletteIcon as IconPalette,
  PenIcon as IconBorderStyle,
  ArrowElbowRightUpIcon as IconArrowWaveRightUp
} from '@/components/icons';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  selectTriggerClassName
} from '@/components/ui/select';
import { ChevronDown, Focus, Redo2, Undo2 } from 'lucide-react';
import { AgentToggleButton } from '@/features/agent/components/agent-toggle-button';
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
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { getPhosphorIconByKey } from '@/features/osint/phosphor-icon-by-key';
import {
  getGroupedPaletteItems,
  nodeTypeByType
} from '@/features/osint/node-registry';
import { LogoOrIcon } from './logo-or-icon';
import type { LayoutOptions } from '@/features/graph/utils/auto-layout';
import type { AnalysisLayoutOptions } from '../analysis/state/analysis-layout-state';

const INVESTIGATION_AXIS_STORAGE_KEY = 'paranod-investigation-axis';
const groupedNodeTypes = getGroupedPaletteItems();

function readSessionValue(key: string) {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSessionValue(key: string, value: string) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // ignore storage errors
  }
}

const edgeTypeOptions = [
  { value: 'default', label: 'Bezier (Curved)', icon: IconVectorSpline },
  { value: 'straight', label: 'Straight', icon: IconLine },
  { value: 'smoothstep', label: 'Smooth Step', icon: IconArrowWaveRightUp }
] as const;

const edgeColorOptions = [
  { value: '#64748b', label: 'Slate' },
  { value: '#3b82f6', label: 'Blue' },
  { value: '#22c55e', label: 'Green' },
  { value: '#ef4444', label: 'Red' },
  { value: '#a855f7', label: 'Purple' },
  { value: '#f97316', label: 'Orange' },
  { value: '#06b6d4', label: 'Cyan' },
  { value: '#ec4899', label: 'Pink' }
];

const edgeWidthOptions = [
  { value: 2, label: 'Thin' },
  { value: 3, label: 'Medium' },
  { value: 4.5, label: 'Thick' }
];

interface SaveStatusLike {
  isSaving?: boolean;
  lastSaved?: Date | null;
  triggerManualSave?: () => void;
}

interface GraphCaseLike {
  id: string;
  name: string;
}

interface GraphTopbarProps {
  isReadOnly?: boolean;
  graphId?: string;
  isSidebarOpen: boolean;
  isDetailsPanelOpen: boolean;
  isNotesPanelOpen: boolean;
  isBottomDockExpanded: boolean;

  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;

  openTopbarMenuId: string | null;
  openTopbarMenu: (id: string) => void;
  openTopbarMenuOnHover: (id: string) => void;
  scheduleCloseTopbarMenus: () => void;
  cancelCloseTopbarMenus: () => void;
  setOpenTopbarMenuId: (next: string | null) => void;
  activeGraphCase: GraphCaseLike | null;
  onActiveGraphCaseChange: (next: GraphCaseLike | null) => void;

  edges: Edge[];
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>;
  setCurrentEdgeType: (type: 'default' | 'straight' | 'smoothstep') => void;

  showGrid: boolean;
  setShowGrid: (updater: (prev: boolean) => boolean) => void;
  showMiniMap: boolean;
  setShowMiniMap: (updater: (prev: boolean) => boolean) => void;
  setBackgroundVariant: (variant: BackgroundVariant) => void;

  graphViewMode: 'free' | 'locked' | 'analysis' | 'map';
  setGraphViewMode: (next: 'free' | 'locked' | 'analysis' | 'map') => void;
  lockedAxis: 'vertical' | 'horizontal';
  setLockedAxis: (next: 'vertical' | 'horizontal') => void;
  layoutSettings: {
    direction: LayoutOptions['direction'];
    spacingPreset: NonNullable<LayoutOptions['spacingPreset']>;
    quality: NonNullable<LayoutOptions['quality']>;
    considerEdgeLabels: boolean;
  };
  setLayoutSettings: React.Dispatch<
    React.SetStateAction<{
      direction: LayoutOptions['direction'];
      spacingPreset: NonNullable<LayoutOptions['spacingPreset']>;
      quality: NonNullable<LayoutOptions['quality']>;
      considerEdgeLabels: boolean;
    }>
  >;
  applyLayout: (next?: Partial<LayoutOptions>) => void;
  analysisLayoutSettings: AnalysisLayoutOptions;
  applyAnalysisLayout: (next?: Partial<AnalysisLayoutOptions>) => void;
  analysisLayoutProgress?: {
    pct: number;
    stage: string;
    isRunning: boolean;
  } | null;
  handleFitView: () => void;
  canFitViewToSelected: boolean;
  handleFitViewToSelected: () => void;
  handleZoomIn: () => void;
  handleZoomOut: () => void;

  exportPNG: () => void;
  exportPNGHighRes: () => void;
  exportJPEG: () => void;
  exportHTML: () => void;
  exportGraph: () => void;
  importGraph: () => void;

  nodeTypeFilter: string[] | null;
  setNodeTypeFilter: (next: string[] | null) => void;
  availableNodeTypes: string[];

  refreshGraph: () => void;
  saveStatus?: SaveStatusLike | null;
  toggleSidebar: () => void;
  toggleNotesPanel: () => void;
  openSidebarEntities: () => void;
  openSidebarAdd: () => void;
  handleBottomTabClick: (tab: 'console' | 'activity') => void;
}

export function GraphTopbar(props: GraphTopbarProps) {
  const [caseQuery, setCaseQuery] = useState('');
  const [caseItems, setCaseItems] = useState<GraphCaseLike[]>([]);
  const [caseNextCursor, setCaseNextCursor] = useState<string | null>(null);
  const [isLoadingCases, setIsLoadingCases] = useState(false);
  const [isSwitchingCase, setIsSwitchingCase] = useState(false);
  const casesScrollAreaRootRef = useRef<HTMLDivElement | null>(null);
  const casesSentinelRef = useRef<HTMLDivElement | null>(null);
  const lastCaseQueryRef = useRef<string>('');

  function getCasesViewportEl() {
    const root = casesScrollAreaRootRef.current;
    if (!root) return null;
    return root.querySelector(
      '[data-slot="scroll-area-viewport"]'
    ) as HTMLDivElement | null;
  }

  const fetchCasesPage = useCallback(
    async (args: { q: string; cursor: string | null }) => {
      const q = args.q.trim();
      const search = new URLSearchParams();
      search.set('limit', '4');
      if (q) search.set('q', q);
      if (args.cursor) search.set('cursor', args.cursor);

      const res = await fetch(`/api/cases?${search.toString()}`, {
        cache: 'no-store',
        headers: { 'cache-control': 'no-cache' }
      });
      if (!res.ok) throw new Error('cases');
      const data = await res.json();
      const raw = Array.isArray(data?.cases) ? data.cases : [];
      const cases = raw
        .filter(
          (c: any) =>
            c && typeof c.id === 'string' && typeof c.name === 'string'
        )
        .map((c: any) => ({ id: c.id as string, name: c.name as string }));
      const nextCursor =
        typeof data?.nextCursor === 'string' ? data.nextCursor : null;
      return { cases, nextCursor };
    },
    []
  );

  const loadInitialCases = useCallback(async () => {
    setIsLoadingCases(true);
    try {
      const { cases, nextCursor } = await fetchCasesPage({
        q: caseQuery,
        cursor: null
      });
      setCaseItems(cases);
      setCaseNextCursor(nextCursor);
    } catch {
      setCaseItems([]);
      setCaseNextCursor(null);
    } finally {
      setIsLoadingCases(false);
    }
  }, [caseQuery, fetchCasesPage]);

  const loadMoreCases = useCallback(async () => {
    if (isLoadingCases) return;
    if (!caseNextCursor) return;
    setIsLoadingCases(true);
    try {
      const { cases, nextCursor } = await fetchCasesPage({
        q: caseQuery,
        cursor: caseNextCursor
      });
      setCaseItems((prev) => {
        const seen = new Set(prev.map((c) => c.id));
        const merged = [...prev];
        for (const c of cases) {
          if (!seen.has(c.id)) merged.push(c);
        }
        return merged;
      });
      setCaseNextCursor(nextCursor);
    } catch {
      // ignore
    } finally {
      setIsLoadingCases(false);
    }
  }, [caseNextCursor, caseQuery, fetchCasesPage, isLoadingCases]);

  useEffect(() => {
    if (props.openTopbarMenuId !== 'case') return;
    // reset list + load first page
    setCaseItems([]);
    setCaseNextCursor(null);
    void loadInitialCases();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.openTopbarMenuId]);

  useEffect(() => {
    if (props.openTopbarMenuId !== 'case') return;
    const next = caseQuery.trim();
    if (next === lastCaseQueryRef.current) return;
    const t = window.setTimeout(() => {
      lastCaseQueryRef.current = next;
      void loadInitialCases();
    }, 250);
    return () => window.clearTimeout(t);
  }, [caseQuery, loadInitialCases, props.openTopbarMenuId]);

  useEffect(() => {
    if (props.openTopbarMenuId !== 'case') return;
    const viewport = getCasesViewportEl();
    const sentinel = casesSentinelRef.current;
    if (!viewport || !sentinel) return;
    if (!caseNextCursor) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        void loadMoreCases();
      },
      { root: viewport, rootMargin: '80px', threshold: 0.1 }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [caseNextCursor, loadMoreCases, props.openTopbarMenuId]);

  const handleSelectCase = useCallback(
    async (selected: GraphCaseLike) => {
      if (props.isReadOnly || !props.graphId) return;
      const prev = props.activeGraphCase;
      if (prev?.id === selected.id) {
        props.setOpenTopbarMenuId(null);
        return;
      }

      setIsSwitchingCase(true);
      try {
        const res = await fetch(`/api/cases/${selected.id}/graphs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ graphId: props.graphId })
        });
        if (!res.ok) throw new Error('link_failed');

        props.onActiveGraphCaseChange(selected);
        toast.success('Graph moved to case');
        props.setOpenTopbarMenuId(null);
      } catch {
        toast.error('Failed to associate graph to case');
      } finally {
        setIsSwitchingCase(false);
      }
    },
    [props]
  );

  const availableTypeSet = useMemo(() => {
    return new Set(props.availableNodeTypes.map((t) => String(t)));
  }, [props.availableNodeTypes]);

  const selectedTypeSet = useMemo(() => {
    if (!props.nodeTypeFilter) return new Set(Array.from(availableTypeSet));
    return new Set(props.nodeTypeFilter);
  }, [availableTypeSet, props.nodeTypeFilter]);

  function commitNextTypeSet(next: Set<string>) {
    if (next.size >= availableTypeSet.size)
      return props.setNodeTypeFilter(null);
    props.setNodeTypeFilter(Array.from(next));
  }

  const currentModeUi = useMemo(() => {
    if (props.graphViewMode === 'analysis')
      return { value: 'analysis' as const, label: 'Analysis', Icon: IconGraph };
    if (props.graphViewMode === 'map')
      return { value: 'map' as const, label: 'Map', Icon: IconMap2 };
    if (props.graphViewMode === 'locked')
      return {
        value: 'locked' as const,
        label: 'Auto layout',
        Icon: IconTreeStructure
      };
    return { value: 'free' as const, label: 'Manual', Icon: IconHand };
  }, [props.graphViewMode]);

  const [pendingManualLayoutDirection, setPendingManualLayoutDirection] =
    useState<LayoutOptions['direction'] | null>(null);
  const [pendingAnalysisEngine, setPendingAnalysisEngine] = useState<
    AnalysisLayoutOptions['engine'] | null
  >(null);

  useEffect(() => {
    if (!props.isReadOnly) return;
    setPendingManualLayoutDirection(null);
    setPendingAnalysisEngine(null);
  }, [props.isReadOnly]);

  const analysisProgressLabel = useMemo(() => {
    if (!props.analysisLayoutProgress?.isRunning) return null;
    const pct = Math.round((props.analysisLayoutProgress.pct ?? 0) * 100);
    return `Layout ${Math.max(0, Math.min(100, pct))}%`;
  }, [props.analysisLayoutProgress]);

  function applyInvestigationMode(next: 'free' | 'locked') {
    if (next === 'locked' && !props.isReadOnly) {
      const savedAxis = readSessionValue(INVESTIGATION_AXIS_STORAGE_KEY);
      const axis =
        savedAxis === 'horizontal' || savedAxis === 'vertical'
          ? savedAxis
          : 'vertical';
      props.setLockedAxis(axis);
    }
    props.setGraphViewMode(next);
  }

  const activeEdgesForMenu = useMemo(() => {
    const selected = props.edges.filter((e) => (e as any)?.selected);
    return selected.length ? selected : props.edges;
  }, [props.edges]);
  const hasEdgesForMenu = activeEdgesForMenu.length > 0;
  const allEdgesLabelHidden = activeEdgesForMenu.length
    ? activeEdgesForMenu.every((e) => (e as any)?.data?.labelVisible === false)
    : false;
  const allEdgesDashed = activeEdgesForMenu.length
    ? activeEdgesForMenu.every((e) => (e as any)?.data?.dashed === true)
    : false;

  return (
    <div
      className='border-border/40 bg-background/90 supports-[backdrop-filter]:bg-background/70 relative flex h-11 w-full items-center gap-1 border-b px-1.5 shadow-sm backdrop-blur select-none dark:border-white/10'
      onMouseLeave={props.scheduleCloseTopbarMenus}
      onMouseEnter={props.cancelCloseTopbarMenus}
    >
      <AgentToggleButton graphId={props.graphId} />
      <div className='contents'>
        {/* Undo / Redo (tight) */}
        <div className='flex items-center gap-0.5'>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type='button'
                variant='ghost'
                size='icon'
                className='size-8 [&_svg]:!size-3.5'
                onClick={props.isReadOnly ? undefined : props.undo}
                disabled={props.isReadOnly || !props.canUndo}
                aria-label='Undo'
                title='Undo'
              >
                <Undo2 />
              </Button>
            </TooltipTrigger>
            <TooltipContent side='bottom' sideOffset={8}>
              Undo (Ctrl+Z)
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type='button'
                variant='ghost'
                size='icon'
                className='size-8 [&_svg]:!size-3.5'
                onClick={props.isReadOnly ? undefined : props.redo}
                disabled={props.isReadOnly || !props.canRedo}
                aria-label='Redo'
                title='Redo'
              >
                <Redo2 />
              </Button>
            </TooltipTrigger>
            <TooltipContent side='bottom' sideOffset={8}>
              Redo (Ctrl+Y)
            </TooltipContent>
          </Tooltip>
        </div>

        <div className='bg-border/30 mx-1 h-6 w-px dark:bg-white/10' />

        {/* New node */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type='button'
              variant='ghost'
              size='icon'
              className="size-8 [&_svg:not([class*='size-'])]:!size-5"
              onClick={props.openSidebarEntities}
            >
              <IconSearch className='h-4 w-4' />
            </Button>
          </TooltipTrigger>
          <TooltipContent side='bottom' sideOffset={8}>
            Entities
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type='button'
              variant='ghost'
              size='icon'
              className="size-8 [&_svg:not([class*='size-'])]:!size-5"
              onClick={props.openSidebarAdd}
            >
              <IconCirclePlus className='h-4 w-4' />
            </Button>
          </TooltipTrigger>
          <TooltipContent side='bottom' sideOffset={8}>
            Add nodes
          </TooltipContent>
        </Tooltip>

        <div className='bg-border/30 mx-1 h-6 w-px dark:bg-white/10' />

        {/* Fit view */}
        <div className='flex items-center gap-0.5'>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type='button'
                variant='ghost'
                size='icon'
                className="size-8 [&_svg:not([class*='size-'])]:!size-5"
                onClick={props.handleFitView}
                aria-label='Fit view'
              >
                <IconFocusCentered className='h-4 w-4' />
              </Button>
            </TooltipTrigger>
            <TooltipContent side='bottom' sideOffset={8}>
              Fit view
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type='button'
                variant='ghost'
                size='icon'
                className="size-8 [&_svg:not([class*='size-'])]:!size-5"
                onClick={props.handleFitViewToSelected}
                disabled={!props.canFitViewToSelected}
                aria-label='Fit view to selected'
              >
                <Focus className='size-5' strokeWidth={1.75} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side='bottom' sideOffset={8}>
              Fit view to selected
            </TooltipContent>
          </Tooltip>
        </div>

        <div className='bg-border/30 mx-1 h-6 w-px dark:bg-white/10' />

        {/* Edges (hidden in Analysis) */}
        {props.graphViewMode !== 'analysis' ? (
          <DropdownMenu
            modal={false}
            open={props.openTopbarMenuId === 'edges'}
            onOpenChange={(open) => {
              if (open) props.openTopbarMenu('edges');
              else if (props.openTopbarMenuId === 'edges')
                props.setOpenTopbarMenuId(null);
            }}
          >
            <DropdownMenuTrigger asChild>
              <span onMouseLeave={props.scheduleCloseTopbarMenus}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon'
                      className="size-8 [&_svg:not([class*='size-'])]:!size-5"
                      onMouseEnter={() => props.openTopbarMenuOnHover('edges')}
                      onFocus={() => props.openTopbarMenuOnHover('edges')}
                      onPointerDown={() => props.openTopbarMenu('edges')}
                    >
                      <IconLine className='h-4 w-4' />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side='bottom' sideOffset={8}>
                    Edges
                  </TooltipContent>
                </Tooltip>
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align='start'
              className='min-w-[220px]'
              onMouseEnter={props.cancelCloseTopbarMenus}
              onMouseLeave={props.scheduleCloseTopbarMenus}
            >
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className='gap-2'>
                  <IconVectorSpline className='h-4 w-4' />
                  <span>Line Type</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {edgeTypeOptions.map((option) => (
                    <DropdownMenuItem
                      key={option.value}
                      className='gap-2'
                      disabled={props.isReadOnly}
                      onClick={() => {
                        if (props.isReadOnly) return;
                        props.setCurrentEdgeType(option.value as any);
                        props.setEdges((eds) =>
                          eds.map((e) => {
                            const hasSelected = eds.some(
                              (x) => (x as any)?.selected
                            );
                            if (hasSelected && !(e as any)?.selected) return e;
                            return {
                              ...e,
                              data: {
                                ...(e as any).data,
                                edgeType: option.value
                              }
                            };
                          })
                        );
                        toast.success(`Line type: ${option.label}`);
                      }}
                    >
                      <option.icon className='h-4 w-4' />
                      <span>{option.label}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              <DropdownMenuSub>
                <DropdownMenuSubTrigger className='gap-2'>
                  <IconPalette className='h-4 w-4' />
                  <span>Color</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {edgeColorOptions.map((option) => (
                    <DropdownMenuItem
                      key={option.value}
                      className='gap-2'
                      disabled={props.isReadOnly}
                      onClick={() => {
                        if (props.isReadOnly) return;
                        props.setEdges((eds) =>
                          eds.map((e) => {
                            const hasSelected = eds.some(
                              (x) => (x as any)?.selected
                            );
                            if (hasSelected && !(e as any)?.selected) return e;
                            return {
                              ...e,
                              data: { ...(e as any).data, color: option.value }
                            };
                          })
                        );
                        toast.success(`Edge color: ${option.label}`);
                      }}
                    >
                      <span
                        className='h-4 w-4 rounded-full border'
                        style={{ backgroundColor: option.value }}
                      />
                      <span>{option.label}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              <DropdownMenuSub>
                <DropdownMenuSubTrigger className='gap-2'>
                  <IconBorderStyle className='h-4 w-4' />
                  <span>Thickness</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {edgeWidthOptions.map((option) => (
                    <DropdownMenuItem
                      key={option.value}
                      className='gap-2'
                      disabled={props.isReadOnly}
                      onClick={() => {
                        if (props.isReadOnly) return;
                        props.setEdges((eds) =>
                          eds.map((e) => {
                            const hasSelected = eds.some(
                              (x) => (x as any)?.selected
                            );
                            if (hasSelected && !(e as any)?.selected) return e;
                            return {
                              ...e,
                              data: {
                                ...(e as any).data,
                                strokeWidth: option.value
                              }
                            };
                          })
                        );
                        toast.success(`Edge thickness: ${option.label}`);
                      }}
                    >
                      <span
                        className='w-6 rounded'
                        style={{
                          height: option.value * 1.5,
                          backgroundColor: '#64748b'
                        }}
                      />
                      <span>{option.label}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              <DropdownMenuSeparator />

              <DropdownMenuItem
                className='gap-2'
                disabled={props.isReadOnly || !hasEdgesForMenu}
                onClick={() => {
                  if (props.isReadOnly) return;
                  props.setEdges((eds) => {
                    const hasSelected = eds.some((x) => (x as any)?.selected);
                    const targets = hasSelected
                      ? eds.filter((e) => (e as any)?.selected)
                      : eds;
                    const isAllHidden = targets.length
                      ? targets.every(
                          (e) => (e as any)?.data?.labelVisible === false
                        )
                      : false;
                    const nextVisible = isAllHidden ? true : false;
                    return eds.map((e) => {
                      if (hasSelected && !(e as any)?.selected) return e;
                      return {
                        ...e,
                        data: { ...(e as any).data, labelVisible: nextVisible }
                      };
                    });
                  });
                }}
              >
                {allEdgesLabelHidden ? (
                  <>
                    <IconEye className='h-4 w-4' />
                    <span>Show Label</span>
                  </>
                ) : (
                  <>
                    <IconEyeOff className='h-4 w-4' />
                    <span>Hide Label</span>
                  </>
                )}
              </DropdownMenuItem>

              <DropdownMenuItem
                className='gap-2'
                disabled={props.isReadOnly || !hasEdgesForMenu}
                onClick={() => {
                  if (props.isReadOnly) return;
                  props.setEdges((eds) => {
                    const hasSelected = eds.some((x) => (x as any)?.selected);
                    const targets = hasSelected
                      ? eds.filter((e) => (e as any)?.selected)
                      : eds;
                    const isAllDashed = targets.length
                      ? targets.every((e) => (e as any)?.data?.dashed === true)
                      : false;
                    const nextDashed = isAllDashed ? false : true;
                    return eds.map((e) => {
                      if (hasSelected && !(e as any)?.selected) return e;
                      return {
                        ...e,
                        data: { ...(e as any).data, dashed: nextDashed }
                      };
                    });
                  });
                }}
              >
                {allEdgesDashed ? (
                  <>
                    <IconBorderStyle className='h-4 w-4' />
                    <span>Solid Line</span>
                  </>
                ) : (
                  <>
                    <IconLineDashed className='h-4 w-4' />
                    <span>Dashed Line</span>
                  </>
                )}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}

        {/* View (only Manual) */}
        {props.graphViewMode === 'free' ? (
          <DropdownMenu
            modal={false}
            open={props.openTopbarMenuId === 'view'}
            onOpenChange={(open) => {
              if (open) props.openTopbarMenu('view');
              else if (props.openTopbarMenuId === 'view')
                props.setOpenTopbarMenuId(null);
            }}
          >
            <DropdownMenuTrigger asChild>
              <span onMouseLeave={props.scheduleCloseTopbarMenus}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon'
                      className="size-8 [&_svg:not([class*='size-'])]:!size-5"
                      onMouseEnter={() => props.openTopbarMenuOnHover('view')}
                      onFocus={() => props.openTopbarMenuOnHover('view')}
                      onPointerDown={() => props.openTopbarMenu('view')}
                    >
                      <IconGridDots className='h-4 w-4' />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side='bottom' sideOffset={8}>
                    View
                  </TooltipContent>
                </Tooltip>
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align='start'
              className='min-w-[220px]'
              onMouseEnter={props.cancelCloseTopbarMenus}
              onMouseLeave={props.scheduleCloseTopbarMenus}
            >
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className='gap-2'>
                  <IconGridDots className='h-4 w-4' />
                  <span>Background</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem
                    className='gap-2'
                    onClick={() => {
                      props.setBackgroundVariant(BackgroundVariant.Dots);
                      toast.success('Background: Dots');
                    }}
                  >
                    <IconGridDots className='h-4 w-4' />
                    <span>Dots</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className='gap-2'
                    onClick={() => {
                      props.setBackgroundVariant(BackgroundVariant.Lines);
                      toast.success('Background: Lines');
                    }}
                  >
                    <IconLine className='h-4 w-4' />
                    <span>Lines</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className='gap-2'
                    onClick={() => {
                      props.setBackgroundVariant(BackgroundVariant.Cross);
                      toast.success('Background: Cross');
                    }}
                  >
                    <IconPlus className='h-4 w-4' />
                    <span>Cross</span>
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              <DropdownMenuSeparator />

              <DropdownMenuItem
                className='gap-2'
                onClick={() => props.setShowGrid((v) => !v)}
              >
                {props.showGrid ? (
                  <IconEyeOff className='h-4 w-4' />
                ) : (
                  <IconEye className='h-4 w-4' />
                )}
                <span>{props.showGrid ? 'Hide Grid' : 'Show Grid'}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className='gap-2'
                onClick={() => props.setShowMiniMap((v) => !v)}
              >
                {props.showMiniMap ? (
                  <IconEyeOff className='h-4 w-4' />
                ) : (
                  <IconEye className='h-4 w-4' />
                )}
                <span>
                  {props.showMiniMap ? 'Hide MiniMap' : 'Show MiniMap'}
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}

        {/* Filter (all modes) */}
        <DropdownMenu
          modal={false}
          open={props.openTopbarMenuId === 'filter'}
          onOpenChange={(open) => {
            if (open) props.openTopbarMenu('filter');
            else if (props.openTopbarMenuId === 'filter')
              props.setOpenTopbarMenuId(null);
          }}
        >
          <DropdownMenuTrigger asChild>
            <span onMouseLeave={props.scheduleCloseTopbarMenus}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className={cn(
                      "size-8 [&_svg:not([class*='size-'])]:!size-5",
                      props.nodeTypeFilter !== null
                        ? 'bg-indigo-500/10 text-indigo-700 shadow-sm ring-1 ring-indigo-500/20 hover:bg-indigo-500/15 dark:text-indigo-200'
                        : null
                    )}
                    onMouseEnter={() => props.openTopbarMenuOnHover('filter')}
                    onFocus={() => props.openTopbarMenuOnHover('filter')}
                    onPointerDown={() => props.openTopbarMenu('filter')}
                    aria-label='Filter nodes'
                  >
                    <IconFilter className='h-4 w-4' />
                    {props.nodeTypeFilter !== null ? (
                      <span className='absolute top-2 right-2 h-1.5 w-1.5 rounded-full bg-indigo-500' />
                    ) : null}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side='bottom' sideOffset={8}>
                  Filter
                </TooltipContent>
              </Tooltip>
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align='start'
            className='w-[320px] p-0'
            onMouseEnter={props.cancelCloseTopbarMenus}
            onMouseLeave={props.scheduleCloseTopbarMenus}
          >
            <div className='p-1'>
              <DropdownMenuItem
                className='gap-2'
                onClick={() => {
                  props.setNodeTypeFilter(null);
                  if (props.openTopbarMenuId === 'filter')
                    props.setOpenTopbarMenuId(null);
                }}
              >
                Show all
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </div>

            <ScrollArea className='max-h-[420px]'>
              <div className='p-1 pt-0'>
                {Object.entries(groupedNodeTypes)
                  .map(([category, subcategories]) => {
                    const options = Object.values(subcategories as any)
                      .flatMap((v: any) => v as any[])
                      .filter((opt: any) =>
                        availableTypeSet.has(String(opt.value))
                      );
                    if (!options.length) return null;

                    const categoryTypeValues = options.map((o: any) =>
                      String(o.value)
                    );
                    const isCategoryChecked = categoryTypeValues.every((t) =>
                      selectedTypeSet.has(t)
                    );
                    const isCategoryIndeterminate =
                      !isCategoryChecked &&
                      categoryTypeValues.some((t) => selectedTypeSet.has(t));

                    return (
                      <div key={category} className='py-1'>
                        <DropdownMenuCheckboxItem
                          checked={isCategoryChecked || isCategoryIndeterminate}
                          onCheckedChange={(checked) => {
                            const next = new Set(selectedTypeSet);
                            if (checked)
                              categoryTypeValues.forEach((t) => next.add(t));
                            else
                              categoryTypeValues.forEach((t) => next.delete(t));
                            commitNextTypeSet(next);
                          }}
                          className='font-semibold'
                        >
                          {category}
                        </DropdownMenuCheckboxItem>

                        <div className='pl-1'>
                          {options.map((opt: any) => {
                            const value = String(opt.value);
                            const def = (nodeTypeByType as any)[value];
                            return (
                              <DropdownMenuCheckboxItem
                                key={value}
                                checked={selectedTypeSet.has(value)}
                                onCheckedChange={(checked) => {
                                  const next = new Set(selectedTypeSet);
                                  if (checked) next.add(value);
                                  else next.delete(value);
                                  commitNextTypeSet(next);
                                }}
                                className='gap-2'
                              >
                                <span
                                  className={cn(
                                    'relative rounded-lg p-1',
                                    def?.ui?.headerBg
                                  )}
                                >
                                  <LogoOrIcon
                                    label={String(opt.label ?? value)}
                                    logoUrl={opt.logoUrl}
                                    Icon={getPhosphorIconByKey(opt.iconKey)}
                                    sizePx={14}
                                    className='h-3.5 w-3.5'
                                    iconClassName={def?.ui?.headerText}
                                  />
                                </span>
                                <span className='min-w-0 flex-1 truncate'>
                                  {String(opt.label ?? value)}
                                </span>
                              </DropdownMenuCheckboxItem>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })
                  .filter(Boolean)}
              </div>
            </ScrollArea>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Layout / Axis controls (next to View) */}
        <div className='ml-1 flex items-center gap-1'>
          {props.graphViewMode === 'free' ? (
            <div className='flex items-center gap-1'>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className="size-8 [&_svg:not([class*='size-'])]:!size-5"
                    onClick={() => {
                      if (!props.isReadOnly) setPendingManualLayoutDirection('LR');
                    }}
                    disabled={props.isReadOnly}
                    aria-label='Left to right'
                  >
                    <IconLayoutDistributeHorizontal className='h-4 w-4' />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side='bottom' sideOffset={8}>
                  Left → Right
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className="size-8 [&_svg:not([class*='size-'])]:!size-5"
                    onClick={() => {
                      if (!props.isReadOnly) setPendingManualLayoutDirection('TB');
                    }}
                    disabled={props.isReadOnly}
                    aria-label='Top to bottom'
                  >
                    <IconLayoutDistributeVertical className='h-4 w-4' />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side='bottom' sideOffset={8}>
                  Top → Bottom
                </TooltipContent>
              </Tooltip>
            </div>
          ) : null}

          {props.graphViewMode === 'analysis' ? (
            <div className='flex items-center gap-1'>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className="size-8 [&_svg:not([class*='size-'])]:!size-5"
                    onClick={() => {
                      if (!props.isReadOnly) setPendingAnalysisEngine('force');
                    }}
                    disabled={props.isReadOnly}
                    aria-label='Force layout'
                  >
                    <IconGraph className='h-4 w-4' />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side='bottom' sideOffset={8}>
                  Force layout
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className="size-8 [&_svg:not([class*='size-'])]:!size-5"
                    onClick={() => {
                      if (!props.isReadOnly) setPendingAnalysisEngine('hierarchy');
                    }}
                    disabled={props.isReadOnly}
                    aria-label='Hierarchy layout'
                  >
                    <IconTreeStructure className='h-4 w-4 rotate-90' />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side='bottom' sideOffset={8}>
                  Hierarchy layout
                </TooltipContent>
              </Tooltip>
            </div>
          ) : null}
        </div>

        <div className='flex-1' />

        {/* Right actions (moved next to View) */}
        <div className='hidden'>
          {/* Auto layout axis selector moved next to the mode Select */}

          {/* Layout (Free) */}
          {props.graphViewMode === 'free' && (
            <div className='flex items-center gap-1'>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className="size-8 [&_svg:not([class*='size-'])]:!size-5"
                    onClick={() => {
                      if (!props.isReadOnly) setPendingManualLayoutDirection('LR');
                    }}
                    disabled={props.isReadOnly}
                    aria-label='Left to right'
                  >
                    <IconLayoutDistributeHorizontal className='h-4 w-4' />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side='bottom' sideOffset={8}>
                  Left → Right
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className="size-8 [&_svg:not([class*='size-'])]:!size-5"
                    onClick={() => {
                      if (!props.isReadOnly) setPendingManualLayoutDirection('TB');
                    }}
                    disabled={props.isReadOnly}
                    aria-label='Top to bottom'
                  >
                    <IconLayoutDistributeVertical className='h-4 w-4' />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side='bottom' sideOffset={8}>
                  Top → Bottom
                </TooltipContent>
              </Tooltip>
            </div>
          )}

          {/* Layout (Analysis) */}
          {props.graphViewMode === 'analysis' && (
            <DropdownMenu
              modal={false}
              open={props.openTopbarMenuId === 'layout'}
              onOpenChange={(open) => {
                if (open) props.openTopbarMenu('layout');
                else if (props.openTopbarMenuId === 'layout')
                  props.setOpenTopbarMenuId(null);
              }}
            >
              <DropdownMenuTrigger asChild>
                <span onMouseLeave={props.scheduleCloseTopbarMenus}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type='button'
                        variant='ghost'
                        size='icon'
                        className="size-8 [&_svg:not([class*='size-'])]:!size-5"
                        onMouseEnter={() =>
                          props.openTopbarMenuOnHover('layout')
                        }
                        onFocus={() => props.openTopbarMenuOnHover('layout')}
                        onPointerDown={() => props.openTopbarMenu('layout')}
                      >
                        <IconLayoutDistributeVertical className='h-4 w-4' />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side='bottom' sideOffset={8}>
                      Layout
                    </TooltipContent>
                  </Tooltip>
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align='end'
                className='min-w-[240px]'
                onMouseEnter={props.cancelCloseTopbarMenus}
                onMouseLeave={props.scheduleCloseTopbarMenus}
              >
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className='gap-2'>
                    <IconLayoutGrid className='h-4 w-4' />
                    <span>Engine</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className='min-w-[220px]'>
                    <DropdownMenuRadioGroup
                      value={props.analysisLayoutSettings.engine}
                      onValueChange={(value) => {
                        if (props.isReadOnly) return;
                        const engine = value as AnalysisLayoutOptions['engine'];
                        props.applyAnalysisLayout({ engine });
                      }}
                    >
                      <DropdownMenuRadioItem value='force' disabled={props.isReadOnly}>
                        Force (d3)
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value='hierarchy' disabled={props.isReadOnly}>
                        Hierarchy (dagre)
                      </DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>

                {props.analysisLayoutSettings.engine === 'hierarchy' && (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger className='gap-2'>
                      <IconLayoutDistributeVertical className='h-4 w-4' />
                      <span>Direction</span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className='min-w-[220px]'>
                      <DropdownMenuRadioGroup
                        value={props.analysisLayoutSettings.hierarchyDirection}
                        onValueChange={(value) => {
                          if (props.isReadOnly) return;
                          const hierarchyDirection =
                            value as AnalysisLayoutOptions['hierarchyDirection'];
                          props.applyAnalysisLayout({ hierarchyDirection });
                        }}
                      >
                        <DropdownMenuRadioItem value='TB' className='gap-2' disabled={props.isReadOnly}>
                          <IconLayoutDistributeVertical className='h-4 w-4' />
                          <span>Top → Bottom</span>
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value='LR' className='gap-2' disabled={props.isReadOnly}>
                          <IconLayoutDistributeHorizontal className='h-4 w-4' />
                          <span>Left → Right</span>
                        </DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                )}

                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className='gap-2'>
                    <IconGridDots className='h-4 w-4' />
                    <span>Density</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className='min-w-[220px]'>
                    <DropdownMenuRadioGroup
                      value={props.analysisLayoutSettings.density}
                      onValueChange={(value) => {
                        if (props.isReadOnly) return;
                        const density =
                          value as AnalysisLayoutOptions['density'];
                        props.applyAnalysisLayout({ density });
                      }}
                    >
                      <DropdownMenuRadioItem value='compact' disabled={props.isReadOnly}>
                        Compact
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value='normal' disabled={props.isReadOnly}>
                        Normal
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value='relaxed' disabled={props.isReadOnly}>
                        Relaxed
                      </DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>

                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className='gap-2'>
                    <IconRefresh className='h-4 w-4' />
                    <span>Quality</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className='min-w-[220px]'>
                    <DropdownMenuRadioGroup
                      value={props.analysisLayoutSettings.quality}
                      onValueChange={(value) => {
                        if (props.isReadOnly) return;
                        const quality =
                          value as AnalysisLayoutOptions['quality'];
                        props.applyAnalysisLayout({ quality });
                      }}
                    >
                      <DropdownMenuRadioItem value='fast' disabled={props.isReadOnly}>
                        Fast
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value='balanced' disabled={props.isReadOnly}>
                        Balanced
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value='precise' disabled={props.isReadOnly}>
                        Precise
                      </DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>

                <DropdownMenuCheckboxItem
                  checked={props.analysisLayoutSettings.showLabels}
                  disabled={props.isReadOnly}
                  onCheckedChange={(checked) => {
                    if (props.isReadOnly) return;
                    props.applyAnalysisLayout({ showLabels: Boolean(checked) });
                  }}
                  className='gap-2'
                >
                  <IconFileText className='h-4 w-4' />
                  <span>Show labels</span>
                </DropdownMenuCheckboxItem>

                {props.analysisLayoutSettings.engine === 'force' && (
                  <>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger className='gap-2'>
                        <IconLayoutGrid className='h-4 w-4' />
                        <span>Gravity</span>
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className='min-w-[220px]'>
                        <DropdownMenuRadioGroup
                          value={String(
                            props.analysisLayoutSettings.gravityStrength
                          )}
                          onValueChange={(value) => {
                            if (props.isReadOnly) return;
                            props.applyAnalysisLayout({
                              gravityStrength: Number(value)
                            });
                          }}
                        >
                          <DropdownMenuRadioItem value='0.03' disabled={props.isReadOnly}>
                            Low
                          </DropdownMenuRadioItem>
                          <DropdownMenuRadioItem value='0.06' disabled={props.isReadOnly}>
                            Medium
                          </DropdownMenuRadioItem>
                          <DropdownMenuRadioItem value='0.1' disabled={props.isReadOnly}>
                            High
                          </DropdownMenuRadioItem>
                        </DropdownMenuRadioGroup>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>

                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger className='gap-2'>
                        <IconMaximize className='h-4 w-4' />
                        <span>Max radius</span>
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className='min-w-[220px]'>
                        <DropdownMenuRadioGroup
                          value={
                            props.analysisLayoutSettings.maxRadius === null
                              ? 'off'
                              : String(props.analysisLayoutSettings.maxRadius)
                          }
                          onValueChange={(value) => {
                            if (props.isReadOnly) return;
                            const maxRadius =
                              value === 'off' ? null : Number(value);
                            props.applyAnalysisLayout({ maxRadius });
                          }}
                        >
                          <DropdownMenuRadioItem value='off' disabled={props.isReadOnly}>
                            Off
                          </DropdownMenuRadioItem>
                          <DropdownMenuRadioItem value='800' disabled={props.isReadOnly}>
                            800
                          </DropdownMenuRadioItem>
                          <DropdownMenuRadioItem value='1200' disabled={props.isReadOnly}>
                            1200
                          </DropdownMenuRadioItem>
                          <DropdownMenuRadioItem value='1800' disabled={props.isReadOnly}>
                            1800
                          </DropdownMenuRadioItem>
                        </DropdownMenuRadioGroup>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  </>
                )}

                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={props.handleFitView}
                  className='gap-2'
                >
                  <IconFocusCentered className='h-4 w-4' />
                  <span>Fit to View</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={props.handleZoomIn}
                  className='gap-2'
                >
                  <IconZoomIn className='h-4 w-4' />
                  <span>Zoom In</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={props.handleZoomOut}
                  className='gap-2'
                >
                  <IconZoomOut className='h-4 w-4' />
                  <span>Zoom Out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <Select
          value={props.graphViewMode}
          onValueChange={(v) => {
            const next = v as 'free' | 'locked' | 'analysis' | 'map';
            if (next === 'analysis' || next === 'map')
              return void props.setGraphViewMode(next);
            applyInvestigationMode(next);
          }}
        >
          <SelectTrigger size='sm' className='h-8 px-2'>
            <span className='flex items-center gap-2 text-xs font-semibold'>
              <currentModeUi.Icon className='h-4 w-4' />
              <span>{currentModeUi.label}</span>
            </span>
          </SelectTrigger>
          <SelectContent align='end' className='min-w-[170px]'>
            <SelectItem value='free'>
              <span className='flex items-center gap-2'>
                <IconHand className='h-4 w-4' />
                <span>Manual</span>
              </span>
            </SelectItem>
            <SelectItem value='locked'>
              <span className='flex items-center gap-2'>
                <IconTreeStructure className='h-4 w-4' />
                <span>Auto layout</span>
              </span>
            </SelectItem>
            <SelectItem value='analysis'>
              <span className='flex items-center gap-2'>
                <IconGraph className='h-4 w-4' />
                <span>Analysis</span>
              </span>
            </SelectItem>
            <SelectItem value='map'>
              <span className='flex items-center gap-2'>
                <IconMap2 className='h-4 w-4' />
                <span>Map</span>
              </span>
            </SelectItem>
          </SelectContent>
        </Select>

        {props.graphViewMode === 'locked' ? (
          <Select
            value={props.lockedAxis}
            onValueChange={(v) => {
              const next = v as 'vertical' | 'horizontal';
              if (next !== 'vertical' && next !== 'horizontal') return;
              writeSessionValue(INVESTIGATION_AXIS_STORAGE_KEY, next);
              props.setLockedAxis(next);
            }}
          >
            <SelectTrigger
              size='sm'
              className="h-8 px-2 [&_svg:not([class*='size-'])]:!size-4"
              aria-label='Auto layout axis'
              title='Auto layout axis'
            >
              {props.lockedAxis === 'vertical' ? (
                <IconLayoutDistributeHorizontal className='h-4 w-4' />
              ) : (
                <IconLayoutDistributeVertical className='h-4 w-4' />
              )}
            </SelectTrigger>
            <SelectContent align='end' className='min-w-[72px]'>
              <SelectItem value='vertical'>
                <span className='flex items-center'>
                  <IconLayoutDistributeHorizontal className='h-4 w-4' />
                </span>
              </SelectItem>
              <SelectItem value='horizontal'>
                <span className='flex items-center'>
                  <IconLayoutDistributeVertical className='h-4 w-4' />
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
        ) : null}

        {/* Case (right, before Import/Export) */}
        <DropdownMenu
          modal={false}
          open={props.openTopbarMenuId === 'case'}
          onOpenChange={(open) => {
            if (open) {
              props.openTopbarMenu('case');
            } else if (props.openTopbarMenuId === 'case')
              props.setOpenTopbarMenuId(null);
          }}
        >
          <DropdownMenuTrigger asChild>
            <span onMouseLeave={props.scheduleCloseTopbarMenus}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type='button'
                    className={cn(
                      selectTriggerClassName,
                      'h-8 max-w-[240px] min-w-0 px-2'
                    )}
                    onMouseEnter={() => props.openTopbarMenuOnHover('case')}
                    onFocus={() => props.openTopbarMenuOnHover('case')}
                    onPointerDown={() => {
                      props.openTopbarMenu('case');
                    }}
                  >
                    <IconFolderOpen className='size-4 shrink-0' />
                    <span
                      className={cn(
                        'max-w-[180px] truncate text-xs font-semibold',
                        !props.activeGraphCase && 'text-muted-foreground'
                      )}
                    >
                      {props.activeGraphCase?.name ?? 'Set case'}
                    </span>
                    <ChevronDown className='size-4 opacity-50' />
                  </button>
                </TooltipTrigger>
                <TooltipContent side='bottom' sideOffset={8}>
                  {props.activeGraphCase ? 'Change case' : 'Set case'}
                </TooltipContent>
              </Tooltip>
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align='end'
            className='min-w-[260px]'
            onMouseEnter={props.cancelCloseTopbarMenus}
            onMouseLeave={props.scheduleCloseTopbarMenus}
          >
            <div className='p-2'>
              <Input
                value={caseQuery}
                onChange={(e) => setCaseQuery(e.target.value)}
                placeholder='Search case…'
                className='h-8 text-xs'
              />
            </div>

            <ScrollArea
              ref={(el) => {
                casesScrollAreaRootRef.current = el;
              }}
              className='max-h-[240px]'
            >
              <div className='p-1'>
                {isLoadingCases && caseItems.length === 0 ? (
                  <div className='text-muted-foreground flex items-center justify-center py-6 text-xs'>
                    <IconLoader2 className='mr-2 h-4 w-4 animate-spin' />
                    Loading…
                  </div>
                ) : caseItems.length === 0 ? (
                  <div className='text-muted-foreground py-6 text-center text-xs'>
                    No cases found.
                  </div>
                ) : (
                  caseItems.map((c) => (
                    <DropdownMenuItem
                      key={c.id}
                      className='gap-2'
                      disabled={props.isReadOnly || !props.graphId || isSwitchingCase}
                      onClick={() => void handleSelectCase(c)}
                    >
                      <IconFolderOpen className='h-4 w-4' />
                      <span className='min-w-0 flex-1 truncate'>{c.name}</span>
                      {props.activeGraphCase?.id === c.id ? (
                        <span className='text-muted-foreground text-[10px] font-semibold'>
                          Selected
                        </span>
                      ) : null}
                    </DropdownMenuItem>
                  ))
                )}

                <div ref={casesSentinelRef} className='h-1 w-full' />
                {isLoadingCases && caseItems.length > 0 ? (
                  <div className='text-muted-foreground flex items-center justify-center py-2 text-xs'>
                    <IconLoader2 className='mr-2 h-4 w-4 animate-spin' />
                    Loading…
                  </div>
                ) : null}
              </div>
            </ScrollArea>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className='bg-border/30 mx-1 h-6 w-px dark:bg-white/10' />

        {/* Import / Export */}
        <DropdownMenu
          modal={false}
          open={props.openTopbarMenuId === 'export'}
          onOpenChange={(open) => {
            if (open) props.openTopbarMenu('export');
            else if (props.openTopbarMenuId === 'export')
              props.setOpenTopbarMenuId(null);
          }}
        >
          <DropdownMenuTrigger asChild>
            <span onMouseLeave={props.scheduleCloseTopbarMenus}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className="size-8 [&_svg:not([class*='size-'])]:!size-5"
                    onMouseEnter={() => props.openTopbarMenuOnHover('export')}
                    onFocus={() => props.openTopbarMenuOnHover('export')}
                    onPointerDown={() => props.openTopbarMenu('export')}
                  >
                    <IconUpload className='h-4 w-4' />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side='bottom' sideOffset={8}>
                  Import / Export
                </TooltipContent>
              </Tooltip>
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align='end'
            className='min-w-[220px]'
            onMouseEnter={props.cancelCloseTopbarMenus}
            onMouseLeave={props.scheduleCloseTopbarMenus}
          >
            <DropdownMenuItem
              onClick={props.isReadOnly ? undefined : props.importGraph}
              disabled={props.isReadOnly}
              className='gap-2'
            >
              <IconUpload className='h-4 w-4' />
              <span>Import JSON</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={props.exportPNG} className='gap-2'>
              <IconPhoto className='h-4 w-4' />
              <span>PNG (High Quality)</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={props.exportPNGHighRes}
              className='gap-2'
            >
              <IconPhoto className='h-4 w-4' />
              <span>PNG (Max Resolution)</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={props.exportJPEG} className='gap-2'>
              <IconPhoto className='h-4 w-4' />
              <span>JPEG (Compressed)</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={props.exportHTML} className='gap-2'>
              <IconFileText className='h-4 w-4' />
              <span>Export HTML (Read-Only)</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={props.exportGraph} className='gap-2'>
              <IconDownload className='h-4 w-4' />
              <span>Export JSON</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className='bg-border/30 mx-1 h-6 w-px dark:bg-white/10' />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type='button'
              variant='ghost'
              size='icon'
              className="size-8 [&_svg:not([class*='size-'])]:!size-5"
              onClick={props.refreshGraph}
              disabled={!props.graphId}
            >
              <IconRefresh className='h-4 w-4' />
            </Button>
          </TooltipTrigger>
          <TooltipContent side='bottom' sideOffset={8}>
            Refresh
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type='button'
              variant='ghost'
              size='icon'
              className="size-8 [&_svg:not([class*='size-'])]:!size-5"
              onClick={() => {
                if (!props.isReadOnly) props.saveStatus?.triggerManualSave?.();
              }}
              disabled={props.isReadOnly}
            >
              {props.saveStatus?.isSaving ? (
                <IconLoader2 className='h-4 w-4 animate-spin' />
              ) : (
                <IconDeviceFloppy className='h-4 w-4' />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side='bottom' sideOffset={8}>
            {props.saveStatus?.isSaving
              ? 'Saving…'
              : props.saveStatus?.lastSaved
                ? `Saved at ${props.saveStatus.lastSaved.toLocaleTimeString()}`
                : 'Save'}
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type='button'
              variant={props.isNotesPanelOpen ? 'secondary' : 'ghost'}
              size='icon'
              className="size-8 [&_svg:not([class*='size-'])]:!size-5"
              onClick={props.toggleNotesPanel}
              disabled={!props.graphId}
              aria-label='Toggle graph notes'
              aria-pressed={props.isNotesPanelOpen}
            >
              <IconNotes className='size-5' />
            </Button>
          </TooltipTrigger>
          <TooltipContent side='bottom' sideOffset={8}>
            Graph notes
          </TooltipContent>
        </Tooltip>

        <AlertDialog
          open={Boolean(pendingManualLayoutDirection)}
          onOpenChange={(open) => {
            if (!open) setPendingManualLayoutDirection(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Apply layout?</AlertDialogTitle>
              <AlertDialogDescription>
                This will reposition nodes in Manual mode.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={props.isReadOnly}
                onClick={() => {
                  const direction = pendingManualLayoutDirection;
                  setPendingManualLayoutDirection(null);
                  if (props.isReadOnly || !direction) return;
                  props.setLayoutSettings((prev) => ({ ...prev, direction }));
                  props.applyLayout({ direction });
                }}
              >
                Apply
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog
          open={Boolean(pendingAnalysisEngine)}
          onOpenChange={(open) => {
            if (!open) setPendingAnalysisEngine(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Apply layout?</AlertDialogTitle>
              <AlertDialogDescription>
                This will recompute the layout in Analysis mode.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={props.isReadOnly}
                onClick={() => {
                  const engine = pendingAnalysisEngine;
                  setPendingAnalysisEngine(null);
                  if (props.isReadOnly || !engine) return;
                  props.applyAnalysisLayout({ engine });
                }}
              >
                Apply
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

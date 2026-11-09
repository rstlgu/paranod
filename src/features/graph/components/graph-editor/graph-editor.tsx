'use client';

import {
  useCallback,
  useState,
  useRef,
  useEffect,
  useMemo,
  useId
} from 'react';
import dynamic from 'next/dynamic';
import { useSaveStatus } from '@/contexts/save-status-context';
import { usePlugins } from '@/features/plugins/hooks/use-plugins';
import { TransformLoggerProvider } from '@/features/graph/contexts/transform-logger-context';
import { GraphMutationContext } from '@/features/graph/contexts/graph-mutation-context';
import { TransformResultsAutoSheet } from './components/transform-results-auto-sheet';
import { GraphLayoutSettingsProvider } from '@/features/graph/contexts/graph-layout-settings-context';
import { EnabledPluginsProvider } from '@/features/graph/contexts/enabled-plugins-context';
import { AddToCaseDialog } from './components/dialog-add-to-case';
import { CreateCaseDialog } from './components/dialog-create-case';
import { GraphCaseDialog } from './components/dialog-graph-case';
import { PaneContextMenu } from './components/pane-context-menu';
import { SelectionContextMenu } from './components/selection-context-menu';
import { AnalysisEdgeContextMenu } from './analysis/ui/analysis-edge-context-menu';
import { AnalysisEditNodeLabelDialog } from './analysis/ui/analysis-edit-node-label-dialog';
import { NodeContextMenu } from './components/node-context-menu';
import { GraphBottomDock } from './components/graph-bottom-dock';
import { GraphTopbar } from './components/graph-topbar';
import { GraphSidebar } from './components/graph-sidebar';
import { GraphDetailsPanel } from './components/graph-details-panel';
import { GraphNotesPanel } from './components/graph-notes-panel';
import { useGraphWriteGuard } from './hooks/use-graph-write-guard';
import { notifyReplacedDraft, useStaleReload } from './hooks/use-stale-reload';
import { OpenNodeDialog } from './components/open-node-dialog';
import { GraphCanvas } from './components/graph-canvas';
import { GraphMapView } from './components/graph-map-view';
import { EmptyGraphLegend } from './components/empty-graph-legend';
import { AnalysisCanvas, type AnalysisGraphApi } from './analysis/canvas/analysis-canvas';
import { useAnalysisLayoutState, type AnalysisLayoutOptions } from './analysis/state/analysis-layout-state';
import { exportGraphHtml, exportGraphJpeg, exportGraphJson, exportGraphPng } from './utils/graph-export';
import { openGraphImportPicker } from './utils/graph-import';
import { createGraphStateHash } from './utils/graph-hash';
import { normalizeSidebarSearchQuery } from './utils/sidebar-search';
import { clampNumber, pxToPercent } from './utils/sizing';
import { useTopbarMenubarBehavior } from './hooks/use-topbar-menubar-behavior';
import { useGraphKeyboardShortcuts } from './hooks/use-graph-keyboard-shortcuts';
import { useGraphPaste } from './hooks/use-graph-paste';
import { useConnectionPreview } from './hooks/use-connection-preview';
import { useGraphFileDrop } from './hooks/use-graph-file-drop';
import { usePanToAddedNode } from './hooks/use-pan-to-added-node';
import { panToFlowNode } from './utils/pan-to-node';
import { projectNodeDimensionsForCanvas } from './utils/canvas-node-dimensions';
import {
  isClassicResultType,
  resultNodeSize,
  withEntityValue
} from '@/features/graph/utils/result-node';
import { useGraphAutosave } from './hooks/use-graph-autosave';
import { useGraphParticipant } from './hooks/use-graph-participant';
import { updateGraphSelection } from '@/features/graph/lib/graph-selection';
import { AgentChangeHighlight } from './components/agent-change-highlight';
import {
  agentGraphChanges,
  withPresentation,
  type AgentGraphChanges
} from '@/features/graph/lib/agent-graph-changes';
import { graphClientCoordinator } from '@/features/graph/lib/graph-client-coordinator';
import { useGraphHistory } from './hooks/use-graph-history';
import type { TreeDataItem } from '@/components/ui/tree-view';
import { computeLogoUrl, pickReadableHeaderTextColor } from '@/features/graph/components/osint-node-visual';
import { cn } from '@/lib/utils';
import {
  canUnmergeNode,
  getMergeEligibility,
  mergeNodes,
  unmergeNode
} from '@/features/graph/utils/node-merge';
import { useGraphPanelTogglesStore } from '@/features/graph/store/graph-panel-toggles-store';
import { useAgentPanelStore } from '@/features/agent/store/agent-panel-store';
import { registerAgentGraphReferences } from '@/features/agent/store/agent-graph-references';
import { conflictingLeftPanel } from '@/features/graph/lib/left-panels';
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
  getCachedLogoAverageColor,
  getCachedLogoIsSolid,
  getOrComputeCachedLogoColorInfo,
  getOrComputeCachedLogoAverageColor,
  loadLogoWithRetry,
  peekCachedLogo
} from './analysis/canvas/logo-cache';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut
} from '@/components/ui/command';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup
} from '@/components/ui/resizable';
import type { ImperativePanelHandle } from 'react-resizable-panels';
import {
  Node as FlowNode,
  Edge,
  Connection,
  Position,
  addEdge,
  useNodesState,
  useEdgesState,
  BackgroundVariant,
  MarkerType,
  reconnectEdge,
  useReactFlow,
  useUpdateNodeInternals
} from 'reactflow';
import { useTheme } from 'next-themes';
import { OSINTNode } from '../osint-node';
import type { OSINTNodeData } from '@/features/graph/types';
import { OSINTEdge, OSINTEdgeData } from '../osint-edge';
import { toast } from 'sonner';
import { useWorkspaceTabsStore } from '@/features/workspace/store/workspace-tabs-store';
import {
  getLayoutedElements,
  adjustNodePositionIfOverlapping,
  positionTransformResultNodes,
  getLockedLaneLayout,
  type LayoutOptions
} from '@/features/graph/utils/auto-layout';
import {
  getGroupedPaletteItems,
  nodePaletteItems,
  nodeTypeByType,
  type NodeType
} from '@/features/osint/node-registry';
import {
  createGraphNodeClipboardMarker,
  storeGraphNodeClipboard
} from '@/features/graph/utils/node-clipboard';

const nodeTypeOptions = nodePaletteItems;
const groupedNodeTypes = getGroupedPaletteItems();
const nodeColorMap = Object.fromEntries(
  nodeTypeOptions.map((option) => [option.value, option.color])
);
const defaultEdgeOptions = {
  type: 'osint',
  markerEnd: {
    type: MarkerType.ArrowClosed,
    width: 10,
    height: 10
  }
};
type ManualEdgeHandle = 'top' | 'right' | 'bottom' | 'left';
type ManualNodePosition = { x: number; y: number };

function getManualNodeCenter(
  node: FlowNode,
  positionOverride?: ManualNodePosition
) {
  const rawWidth =
    (node as any).width ??
    (node as any).measured?.width ??
    (node as any).style?.width;
  const rawHeight =
    (node as any).height ??
    (node as any).measured?.height ??
    (node as any).style?.height;
  const width =
    typeof rawWidth === 'number' && Number.isFinite(rawWidth) ? rawWidth : 220;
  const height =
    typeof rawHeight === 'number' && Number.isFinite(rawHeight) ? rawHeight : 80;
  const position = positionOverride ?? node.position;

  return {
    x: position.x + width / 2,
    y: position.y + height / 2
  };
}

function pickManualEdgeHandles(
  source: { x: number; y: number },
  target: { x: number; y: number }
): { source: ManualEdgeHandle; target: ManualEdgeHandle } {
  const dx = target.x - source.x;
  const dy = target.y - source.y;

  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? { source: 'right', target: 'left' }
      : { source: 'left', target: 'right' };
  }

  return dy >= 0
    ? { source: 'bottom', target: 'top' }
    : { source: 'top', target: 'bottom' };
}

function useLatestCallback<T extends (...args: any[]) => any>(callback: T): T {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  return useCallback(
    ((...args: Parameters<T>) => callbackRef.current(...args)) as T,
    []
  );
}

const GRAPH_VIEW_MODE_STORAGE_KEY = 'paranod-graph-view-mode';
// Cap dello zoom per i fitView di cambio modalità e layout:
// con 1-2 nodi il fit non deve mai ingrandire oltre il 100%.
const AUTO_FIT_MAX_ZOOM = 1;
const INVESTIGATION_MODE_STORAGE_KEY = 'paranod-investigation-mode';
const INVESTIGATION_AXIS_STORAGE_KEY = 'paranod-investigation-axis';
const MANUAL_NODE_POSITIONS_STORAGE_PREFIX = 'paranod-manual-node-positions-v1:';
const NODE_TYPE_FILTER_STORAGE_PREFIX = 'paranod-graph-node-type-filter-v1:';

interface ManualNodePositionsById {
  [nodeId: string]: { x: number; y: number };
}

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

function getManualNodePositionsStorageKey(graphId: string) {
  return `${MANUAL_NODE_POSITIONS_STORAGE_PREFIX}${graphId}`;
}

function getNodeTypeFilterStorageKey(graphId: string) {
  return `${NODE_TYPE_FILTER_STORAGE_PREFIX}${graphId}`;
}

function readNodeTypeFilter(graphId: string): string[] | null {
  const raw = readSessionValue(getNodeTypeFilterStorageKey(graphId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null) return null;
    if (!Array.isArray(parsed)) return null;
    return parsed.map((v) => String(v));
  } catch {
    return null;
  }
}

function writeNodeTypeFilter(graphId: string, value: string[] | null) {
  if (typeof window === 'undefined') return;
  const key = getNodeTypeFilterStorageKey(graphId);
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore storage errors
  }
}

function readManualNodePositions(graphId: string): ManualNodePositionsById {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(getManualNodePositionsStorageKey(graphId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const next: ManualNodePositionsById = {};
    for (const [nodeId, pos] of Object.entries(parsed as Record<string, any>)) {
      const x = Number(pos?.x);
      const y = Number(pos?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      next[String(nodeId)] = { x, y };
    }
    return next;
  } catch {
    return {};
  }
}

function writeManualNodePositions(graphId: string, value: ManualNodePositionsById) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(getManualNodePositionsStorageKey(graphId), JSON.stringify(value));
  } catch {
    // ignore storage errors
  }
}

const initialNodes: FlowNode[] = [];
const initialEdges: Edge[] = [];

// Definiti FUORI dal componente per evitare ri-creazione ad ogni render
const nodeTypes = { osint: OSINTNode };
const edgeTypes = { osint: OSINTEdge };

const FilePreviewDialog = dynamic(
  () => import('../file-preview-dialog').then((mod) => ({ default: mod.FilePreviewDialog })),
  { ssr: false }
);
const MapPreviewDialog = dynamic(
  () => import('../map-preview-dialog').then((mod) => ({ default: mod.MapPreviewDialog })),
  { ssr: false }
);

const FILE_PREVIEW_NODE_TYPES = new Set([
  'document',
  'pdf',
  'docx',
  'xlsx',
  'txt',
  'csv',
  'json'
]);

export interface GraphEditorProps {
  graphId?: string;
  isActive: boolean;
}

// Dialog estratti in `src/features/graph/components/graph-editor/components/dialog-*.tsx`

// Bottom dock estratto in `src/features/graph/components/graph-editor/components/graph-bottom-dock.tsx`

export function GraphEditor({
  graphId,
  isActive: tabIsActive
}: GraphEditorProps) {
  const writeGuard = useGraphWriteGuard(graphId);
  // Editing and tab visibility are separate: a leased graph remains browsable.
  const isActive = tabIsActive && !writeGuard.blocked;
  const [agentChanges, setAgentChanges] = useState<AgentGraphChanges | null>(
    null
  );
  useEffect(() => {
    if (!agentChanges) return;
    const timer = setTimeout(() => setAgentChanges(null), 3000);
    return () => clearTimeout(timer);
  }, [agentChanges]);
  const DND_NODE_TYPE_MIME = 'application/x-paranod-node-type';
  const STORAGE_KEY_BACKGROUND_VARIANT = 'graph-background-variant-v1';
  const graphIdRef = useRef<string | undefined>(graphId);
  const graphWriteVersionRef = useRef<number | undefined>(undefined);
  const manualNodePositionsByIdRef = useRef<ManualNodePositionsById>({});
  const manualNodePositionsFlushTimeoutRef = useRef<number | null>(null);
  const reactFlowRootElRef = useRef<HTMLDivElement | null>(null);
  const analysisGraphApiRef = useRef<AnalysisGraphApi | null>(null);
  const mapGraphApiRef = useRef<import('./components/graph-map-view').GraphMapApi | null>(null);
  const preloadedGraphLogoUrlsRef = useRef<Set<string>>(new Set());
  const analysisCanvasContainerRef = useRef<HTMLDivElement | null>(null);
  const backgroundPatternId = useId();

  // Inizializza con array vuoti per evitare hydration mismatch
  const [nodes, setCanonicalNodes, applyNodesChange] =
    useNodesState(initialNodes);
  const [edges, setCanonicalEdges, applyEdgesChange] =
    useEdgesState(initialEdges);
  const selectNodes = useCallback(
    (selected: (node: FlowNode<OSINTNodeData>) => boolean) =>
      setCanonicalNodes((current) => updateGraphSelection(current, selected)),
    [setCanonicalNodes]
  );
  const selectEdges = useCallback(
    (selected: (edge: Edge) => boolean) =>
      setCanonicalEdges((current) => updateGraphSelection(current, selected)),
    [setCanonicalEdges]
  );
  const { blockedRef, acceptSnapshot, canEditSnapshot, canSaveSnapshot } =
    writeGuard;
  const setNodes: typeof setCanonicalNodes = useCallback(
    (next) => {
      if (!canEditSnapshot()) return;
      setCanonicalNodes((current) =>
        canEditSnapshot()
          ? typeof next === 'function'
            ? next(current)
            : next
          : current
      );
    },
    [canEditSnapshot, setCanonicalNodes]
  );
  const setEdges: typeof setCanonicalEdges = useCallback(
    (next) => {
      if (!canEditSnapshot()) return;
      setCanonicalEdges((current) =>
        canEditSnapshot()
          ? typeof next === 'function'
            ? next(current)
            : next
          : current
      );
    },
    [canEditSnapshot, setCanonicalEdges]
  );
  const onNodesChange: typeof applyNodesChange = useCallback(
    (changes) => {
      applyNodesChange(
        canEditSnapshot()
          ? changes
          : changes.filter(
              (change) =>
                change.type === 'dimensions' || change.type === 'select'
            )
      );
    },
    [applyNodesChange, canEditSnapshot]
  );
  const onEdgesChange: typeof applyEdgesChange = useCallback(
    (changes) => {
      applyEdgesChange(
        canEditSnapshot()
          ? changes
          : changes.filter((change) => change.type === 'select')
      );
    },
    [applyEdgesChange, canEditSnapshot]
  );
  const reactFlowInstance = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const nodeDataIdentityRef = useRef<WeakMap<object, number>>(new WeakMap());
  const nextNodeDataIdentityRef = useRef(1);
  const graphNodesSnapshotRef = useRef<FlowNode[]>([]);
  graphNodesSnapshotRef.current = nodes as FlowNode[];
  const graphNodeDataSignature = useMemo(
    () =>
      (nodes as FlowNode[])
        .map((node) => {
          const data = node.data;
          let dataIdentity = 0;
          if (data && typeof data === 'object') {
            const known = nodeDataIdentityRef.current.get(data);
            if (known) {
              dataIdentity = known;
            } else {
              dataIdentity = nextNodeDataIdentityRef.current++;
              nodeDataIdentityRef.current.set(data, dataIdentity);
            }
          }
          return `${node.id}:${dataIdentity}:${node.hidden ? 1 : 0}`;
        })
        .join('|'),
    [nodes]
  );
  const graphEdgesSnapshotRef = useRef<Edge[]>([]);
  graphEdgesSnapshotRef.current = edges;
  const graphEdgeTopologySignature = useMemo(
    () =>
      edges
        .map((edge) => `${edge.id}:${edge.source}>${edge.target}`)
        .join('|'),
    [edges]
  );
  const graphEdgeById = useMemo(
    () => new Map(edges.map((edge) => [edge.id, edge])),
    [edges]
  );
  const graphEdgeIdsByNodeId = useMemo(() => {
    void graphEdgeTopologySignature;
    const edgeIdsByNodeId = new Map<string, string[]>();

    for (const edge of graphEdgesSnapshotRef.current) {
      const sourceIds = edgeIdsByNodeId.get(edge.source) ?? [];
      sourceIds.push(edge.id);
      edgeIdsByNodeId.set(edge.source, sourceIds);

      if (edge.target === edge.source) continue;
      const targetIds = edgeIdsByNodeId.get(edge.target) ?? [];
      targetIds.push(edge.id);
      edgeIdsByNodeId.set(edge.target, targetIds);
    }

    return edgeIdsByNodeId;
  }, [graphEdgeTopologySignature]);
  const pendingManualNodePositionsRef = useRef<
    Map<string, ManualNodePosition>
  >(new Map());
  const manualEdgeHandleFrameRef = useRef<number | null>(null);

  useEffect(() => {
    graphIdRef.current = graphId;
  }, [graphId]);

  const schedulePersistManualNodePositions = useCallback(() => {
    if (!canEditSnapshot()) return;
    const gid = graphIdRef.current;
    if (!gid) return;
    if (manualNodePositionsFlushTimeoutRef.current) return;
    manualNodePositionsFlushTimeoutRef.current = window.setTimeout(() => {
      manualNodePositionsFlushTimeoutRef.current = null;
      const latestGraphId = graphIdRef.current;
      if (!canEditSnapshot() || latestGraphId !== gid) return;
      writeManualNodePositions(latestGraphId, manualNodePositionsByIdRef.current);
    }, 220);
  }, [canEditSnapshot]);

  useEffect(() => {
    return () => {
      if (manualNodePositionsFlushTimeoutRef.current)
        window.clearTimeout(manualNodePositionsFlushTimeoutRef.current);
      if (manualEdgeHandleFrameRef.current !== null)
        cancelAnimationFrame(manualEdgeHandleFrameRef.current);
    };
  }, []);

  useEffect(() => {
    if (!graphId) return;
    manualNodePositionsByIdRef.current = readManualNodePositions(graphId);
  }, [graphId]);
  const maxLabelLengthForFit = useMemo(() => {
    void graphNodeDataSignature;
    // FitView di ReactFlow non considera sempre il testo (soprattutto se l’UI “sborda” dal box),
    // quindi aumentiamo leggermente il padding in base alla lunghezza massima.
    let maxLen = 0;
    for (const n of graphNodesSnapshotRef.current as any[]) {
      const label = String((n as any)?.data?.label ?? '').trim();
      if (label.length > maxLen) maxLen = label.length;
    }
    return maxLen;
  }, [graphNodeDataSignature]);
  const dragStartPositions = useRef<Map<string, { x: number; y: number }>>(
    new Map()
  );
  const [showGrid, setShowGrid] = useState(true);
  const [backgroundVariant, setBackgroundVariant] = useState<BackgroundVariant>(
    BackgroundVariant.Dots
  );
  const [showMiniMap, setShowMiniMap] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const sidebarSearchInputRef = useRef<HTMLInputElement | null>(null);
  const nodeRowElByIdRef = useRef(new Map<string, HTMLElement>());
  const [entitiesScrollRootEl, setEntitiesScrollRootEl] =
    useState<HTMLDivElement | null>(null);
  const entitiesViewportRef = useRef<HTMLDivElement | null>(null);
  const entitiesLastScrollTopRef = useRef<number | null>(null);
  const entitiesLastAlignedNodeIdRef = useRef<string | null>(null);
  const entitiesLastAlignedLevelRef = useRef<number | null>(null);
  const [shouldFocusSidebarSearch, setShouldFocusSidebarSearch] = useState(false);
  const [sidebarSearchQuery, setSidebarSearchQuery] = useState('');
  const sidebarPanelRef = useRef<ImperativePanelHandle | null>(null);
  const lastOpenSidebarSizeRef = useRef(28); // percent
  const [panelGroupWidthPx, setPanelGroupWidthPx] = useState<number | null>(null);
  const panelGroupElRef = useRef<HTMLDivElement | null>(null);
  const sidebarStateFromResizeRef = useRef(false);

  const [isDetailsPanelOpen, setIsDetailsPanelOpen] = useState(false);
  const shouldAutoOpenDetailsPanelRef = useRef(false);
  const pendingAutoOpenDetailsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasSelectionRef = useRef(false);
  const selectedNodeIdRef = useRef<string | null>(null);
  const selectedEdgeIdRef = useRef<string | null>(null);
  const lastAnalysisClickRef = useRef<{ ts: number; nodeId: string | null }>({ ts: 0, nodeId: null });
  const pendingAnalysisCenterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detailsPanelRef = useRef<ImperativePanelHandle | null>(null);
  const lastOpenDetailsSizeRef = useRef(26);
  const detailsStateFromResizeRef = useRef(false);
  const [isNotesPanelOpen, setIsNotesPanelOpen] = useState(false);
  const [isNotesPanelDetached, setIsNotesPanelDetached] = useState(false);
  const [retainedRightPanel, setRetainedRightPanel] = useState<
    'details' | 'notes'
  >('details');
  const notesPanelRef = useRef<ImperativePanelHandle | null>(null);
  const lastOpenNotesSizeRef = useRef(26);
  const notesStateFromResizeRef = useRef(false);

  const sidebarMinWidthPx = 400; // più ampio del precedente
  const sidebarMaxWidthPx = 860;

  const detailsMinWidthPx = 360;
  const detailsMaxWidthPx = 720;
  const sidebarCollapsedSizePct = 0;
  const detailsCollapsedSizePct = 0;
  const notesCollapsedSizePct = 0;

  const sidebarMinSizePct = useMemo(() => {
    if (!panelGroupWidthPx) return 20;
    return clampNumber(pxToPercent(sidebarMinWidthPx, panelGroupWidthPx), 10, 60);
  }, [panelGroupWidthPx]);

  const sidebarMaxSizePct = useMemo(() => {
    if (!panelGroupWidthPx) return 55;
    return clampNumber(pxToPercent(sidebarMaxWidthPx, panelGroupWidthPx), 20, 80);
  }, [panelGroupWidthPx]);

  const detailsMinSizePct = useMemo(() => {
    if (!panelGroupWidthPx) return 18;
    return clampNumber(pxToPercent(detailsMinWidthPx, panelGroupWidthPx), 10, 60);
  }, [panelGroupWidthPx]);

  const detailsMaxSizePct = useMemo(() => {
    if (!panelGroupWidthPx) return 45;
    return clampNumber(pxToPercent(detailsMaxWidthPx, panelGroupWidthPx), 20, 80);
  }, [panelGroupWidthPx]);
  const notesMinSizePct = detailsMinSizePct;
  const notesMaxSizePct = detailsMaxSizePct;
  const [bottomDockTab, setBottomDockTab] = useState<'console' | 'activity'>(
    'console'
  );
  const [isBottomDockExpanded, setIsBottomDockExpanded] = useState(false);
  const bottomDockPanelRef = useRef<ImperativePanelHandle | null>(null);
  const lastOpenBottomDockSizeRef = useRef(28); // percent (altezza)
  const [bottomGroupHeightPx, setBottomGroupHeightPx] = useState<number | null>(null);
  const bottomGroupElRef = useRef<HTMLDivElement | null>(null);

  const bottomCollapsedHeightPx = 32; // header-only
  const bottomMinHeightPx = 220;
  const bottomMaxHeightPx = 520;

  const bottomCollapsedSizePct = useMemo(() => {
    if (!bottomGroupHeightPx) return 6;
    return clampNumber(pxToPercent(bottomCollapsedHeightPx, bottomGroupHeightPx), 3, 20);
  }, [bottomGroupHeightPx]);

  const bottomMinSizePct = useMemo(() => {
    if (!bottomGroupHeightPx) return 20;
    return clampNumber(pxToPercent(bottomMinHeightPx, bottomGroupHeightPx), 10, 80);
  }, [bottomGroupHeightPx]);

  const bottomMaxSizePct = useMemo(() => {
    if (!bottomGroupHeightPx) return 70;
    return clampNumber(pxToPercent(bottomMaxHeightPx, bottomGroupHeightPx), 20, 95);
  }, [bottomGroupHeightPx]);
  const [consoleClearSignal, setConsoleClearSignal] = useState(0);
  const [sidebarTab, setSidebarTab] = useState<'entities' | 'add'>(
    'add'
  );
  const [isLoadingGraph, setIsLoadingGraph] = useState(true);
  const [graphLoadError, setGraphLoadError] = useState<'not_found' | 'unauthorized' | 'unknown' | null>(null);
  const [currentEdgeType, setCurrentEdgeType] = useState<
    'default' | 'straight' | 'smoothstep'
  >('default');
  const [layoutSettings, setLayoutSettings] = useState<{
    direction: LayoutOptions['direction'];
    spacingPreset: NonNullable<LayoutOptions['spacingPreset']>;
    quality: NonNullable<LayoutOptions['quality']>;
    considerEdgeLabels: boolean;
  }>({
    direction: 'TB',
    spacingPreset: 'normal',
    quality: 'balanced',
    considerEdgeLabels: true
  });
  const [graphViewMode, setGraphViewMode] = useState<'free' | 'locked' | 'analysis' | 'map'>(() => {
    const saved = readSessionValue(GRAPH_VIEW_MODE_STORAGE_KEY);
    if (saved === 'free' || saved === 'locked' || saved === 'analysis' || saved === 'map')
      return saved;
    // Back-compat: vecchi valori salvati come "relational"
    if (saved === 'relational') return 'analysis';
    const savedInvestigation = readSessionValue(INVESTIGATION_MODE_STORAGE_KEY);
    if (savedInvestigation === 'free' || savedInvestigation === 'locked')
      return savedInvestigation;
    return 'locked';
  });

  // Analysis mode è ora un canvas separato (ForceGraph2D) e indipendente da ReactFlow.
  const [lockedAxis, setLockedAxis] = useState<'vertical' | 'horizontal'>(() => {
    const saved = readSessionValue(INVESTIGATION_AXIS_STORAGE_KEY);
    if (saved === 'vertical' || saved === 'horizontal') return saved;
    return 'vertical';
  });
  const graphLayoutSettingsValue = useMemo(
    () => ({
      graphViewMode,
      lockedAxis,
      spacingPreset: layoutSettings.spacingPreset
    }),
    [graphViewMode, layoutSettings.spacingPreset, lockedAxis]
  );

  useEffect(() => {
    writeSessionValue(GRAPH_VIEW_MODE_STORAGE_KEY, graphViewMode);
    if (graphViewMode === 'free' || graphViewMode === 'locked')
      writeSessionValue(INVESTIGATION_MODE_STORAGE_KEY, graphViewMode);
  }, [graphViewMode]);

  useEffect(() => {
    writeSessionValue(INVESTIGATION_AXIS_STORAGE_KEY, lockedAxis);
  }, [lockedAxis]);

  const [nodeTypeFilter, setNodeTypeFilter] = useState<string[] | null>(() => {
    if (!graphId) return null;
    return readNodeTypeFilter(graphId);
  });

  const availableNodeTypes = useMemo(() => {
    void graphNodeDataSignature;
    const out = new Set<string>();
    for (const n of graphNodesSnapshotRef.current as any[])
      out.add(String(n?.data?.type ?? 'custom'));
    return Array.from(out);
  }, [graphNodeDataSignature]);

  useEffect(() => {
    if (!graphId) return;
    setNodeTypeFilter(readNodeTypeFilter(graphId));
  }, [graphId]);

  useEffect(() => {
    if (!graphId) return;
    writeNodeTypeFilter(graphId, nodeTypeFilter);
  }, [graphId, nodeTypeFilter]);
  // In locked mode vogliamo ordine STABILE tra i livelli (es. non invertire root quando aggiungiamo figli).
  // Conserviamo un "ordering key" per nodo basato sulla posizione corrente sul canvas locked.
  const lockedStableOrderRef = useRef<Record<string, number>>({});
  const [paneContextMenu, setPaneContextMenu] = useState<{
    screen: { x: number; y: number };
    flow: { x: number; y: number };
  } | null>(null);
  const [isClearGraphConfirmOpen, setIsClearGraphConfirmOpen] = useState(false);
  const [relationalNodeContextMenu, setRelationalNodeContextMenu] = useState<{
    position: { x: number; y: number };
    nodeId: string;
  } | null>(null);
  const [openNodeDialogNodeId, setOpenNodeDialogNodeId] = useState<string | null>(null);
  const [analysisOpenNodeDialogState, setAnalysisOpenNodeDialogState] = useState<{
    isEditMode: boolean;
    editedLabel: string;
    editedMetadata: Record<string, unknown>;
    newMetaKey: string;
    newMetaValue: string;
  }>({
    isEditMode: false,
    editedLabel: '',
    editedMetadata: {},
    newMetaKey: '',
    newMetaValue: ''
  });
  const [relationalEdgeContextMenu, setRelationalEdgeContextMenu] = useState<{
    position: { x: number; y: number };
    edgeId: string;
  } | null>(null);
  const [relationalLabelEditor, setRelationalLabelEditor] = useState<{
    nodeId: string;
    initialLabel: string;
    title?: string;
    description?: string;
    shouldPanOnSubmit?: boolean;
  } | null>(null);
  const [selectionContextMenu, setSelectionContextMenu] = useState<{
    position: { x: number; y: number };
    nodes: FlowNode[];
    edges: Edge[];
  } | null>(null);

  const [addToCaseNodes, setAddToCaseNodes] = useState<FlowNode[]>([]);
  const [addToCaseOpen, setAddToCaseOpen] = useState(false);
  const [graphCaseDialogOpen, setGraphCaseDialogOpen] = useState(false);
  const [graphCaseMode, setGraphCaseMode] = useState<'add' | 'remove'>('add');
  const [createCaseOpen, setCreateCaseOpen] = useState(false);
  const [createCaseNodes, setCreateCaseNodes] = useState<FlowNode[]>([]);
  const [recentCases, setRecentCases] = useState<Array<{ id: string; name: string }>>([]);

  const closeDockedAgentPanel = useCallback(() => {
    const panel = useAgentPanelStore.getState();
    if (panel.open && !panel.detached) panel.setOpen(false);
  }, []);
  const toggleSidebar = useCallback(() => {
    setIsSidebarOpen((open) => {
      if (!open) closeDockedAgentPanel();
      return !open;
    });
  }, [closeDockedAgentPanel]);

  const agentPanelOpen = useAgentPanelStore((state) => state.open);
  const agentDetached = useAgentPanelStore((state) => state.detached);
  const leftPanelsRef = useRef({
    sidebar: isSidebarOpen,
    agent: agentPanelOpen,
    docked: agentPanelOpen && !agentDetached,
    active: tabIsActive
  });
  useEffect(() => {
    const previous = leftPanelsRef.current;
    const current = {
      sidebar: isSidebarOpen,
      agent: agentPanelOpen,
      docked: agentPanelOpen && !agentDetached,
      active: tabIsActive
    };
    leftPanelsRef.current = current;
    const close = conflictingLeftPanel(current, previous);
    if (close === 'sidebar') setIsSidebarOpen(false);
    if (close === 'agent') closeDockedAgentPanel();
  }, [
    agentDetached,
    agentPanelOpen,
    closeDockedAgentPanel,
    isSidebarOpen,
    tabIsActive
  ]);

  const openSidebarEntities = useCallback(() => {
    closeDockedAgentPanel();
    setSidebarTab('entities');
    setIsSidebarOpen(true);
    setShouldFocusSidebarSearch(true);
  }, [closeDockedAgentPanel]);

  const openSidebarAdd = useCallback(() => {
    closeDockedAgentPanel();
    setSidebarTab('add');
    setIsSidebarOpen(true);
    setShouldFocusSidebarSearch(true);
  }, [closeDockedAgentPanel]);

  const openDetailsPanel = useCallback(() => {
    detailsStateFromResizeRef.current = false;
    setRetainedRightPanel('details');
    if (!isNotesPanelDetached) setIsNotesPanelOpen(false);
    setIsDetailsPanelOpen(true);
  }, [isNotesPanelDetached]);

  const closeDetailsPanel = useCallback(() => {
    detailsStateFromResizeRef.current = true;
    (
      detailsPanelRef.current as unknown as { collapse?: () => void }
    )?.collapse?.();
    detailsPanelRef.current?.resize(detailsCollapsedSizePct);
    setIsDetailsPanelOpen(false);
    if (!isNotesPanelDetached) setIsNotesPanelOpen(false);
  }, [detailsCollapsedSizePct, isNotesPanelDetached]);

  const toggleDetailsPanel = useCallback(() => {
    if (isDetailsPanelOpen) {
      closeDetailsPanel();
      return;
    }
    setRetainedRightPanel('details');
    if (!isNotesPanelDetached) setIsNotesPanelOpen(false);
    setIsDetailsPanelOpen(true);
  }, [closeDetailsPanel, isDetailsPanelOpen, isNotesPanelDetached]);

  const closeNotesPanel = useCallback(() => {
    setIsNotesPanelOpen(false);
    if (!isNotesPanelDetached) setIsDetailsPanelOpen(false);
  }, [isNotesPanelDetached]);

  const toggleNotesPanel = useCallback(() => {
    if (isNotesPanelDetached) {
      setRetainedRightPanel('details');
      setIsNotesPanelOpen((current) => !current);
      return;
    }
    setRetainedRightPanel('notes');
    setIsDetailsPanelOpen(false);
    setIsNotesPanelOpen((current) => !current);
  }, [isNotesPanelDetached]);

  const detachNotesPanel = useCallback(() => {
    notesStateFromResizeRef.current = true;
    (notesPanelRef.current as unknown as { collapse?: () => void })?.collapse?.();
    notesPanelRef.current?.resize(notesCollapsedSizePct);
    setIsNotesPanelDetached(true);
    setIsNotesPanelOpen(true);
    setRetainedRightPanel('details');
    setIsDetailsPanelOpen(false);
  }, [notesCollapsedSizePct]);

  const attachNotesPanel = useCallback(() => {
    closeDetailsPanel();
    notesStateFromResizeRef.current = false;
    setIsNotesPanelDetached(false);
    setRetainedRightPanel('notes');
    setIsNotesPanelOpen(true);
    requestAnimationFrame(() => {
      notesPanelRef.current?.resize(lastOpenNotesSizeRef.current);
      (
        notesPanelRef.current as unknown as { expand?: () => void }
      )?.expand?.();
    });
  }, [closeDetailsPanel]);

  const toggleRightPanel = useCallback(() => {
    if (isNotesPanelDetached) {
      setRetainedRightPanel('details');
      if (isDetailsPanelOpen) closeDetailsPanel();
      else openDetailsPanel();
      return;
    }
    if (isDetailsPanelOpen || isNotesPanelOpen) {
      if (isDetailsPanelOpen) closeDetailsPanel();
      else setIsNotesPanelOpen(false);
      return;
    }

    if (retainedRightPanel === 'notes') {
      setIsNotesPanelOpen(true);
      return;
    }
    setIsDetailsPanelOpen(true);
  }, [
    closeDetailsPanel,
    isDetailsPanelOpen,
    isNotesPanelDetached,
    isNotesPanelOpen,
    openDetailsPanel,
    retainedRightPanel
  ]);

  const setGraphPanelControls = useGraphPanelTogglesStore((s) => s.setControls);

  const openCommandPalette = useCallback(() => {
    setIsCommandPaletteOpen(true);
  }, []);

  useEffect(() => {
    if (tabIsActive || !isNotesPanelDetached) return;
    setIsNotesPanelOpen(false);
  }, [tabIsActive, isNotesPanelDetached]);

  useEffect(() => {
    if (!sidebarPanelRef.current) return;
    if (sidebarStateFromResizeRef.current) {
      sidebarStateFromResizeRef.current = false;
      return;
    }
    requestAnimationFrame(() => {
      if (!sidebarPanelRef.current) return;
      if (isSidebarOpen) {
        sidebarPanelRef.current.resize(lastOpenSidebarSizeRef.current);
        (sidebarPanelRef.current as unknown as { expand?: () => void }).expand?.();
      } else {
        (sidebarPanelRef.current as unknown as { collapse?: () => void }).collapse?.();
        sidebarPanelRef.current.resize(sidebarCollapsedSizePct);
      }
    });
  }, [isSidebarOpen, sidebarCollapsedSizePct]);

  useEffect(() => {
    if (!detailsPanelRef.current) return;
    if (detailsStateFromResizeRef.current) {
      detailsStateFromResizeRef.current = false;
      return;
    }
    requestAnimationFrame(() => {
      if (!detailsPanelRef.current) return;
      if (isDetailsPanelOpen) {
        detailsPanelRef.current.resize(lastOpenDetailsSizeRef.current);
        (detailsPanelRef.current as unknown as { expand?: () => void }).expand?.();
      } else {
        (detailsPanelRef.current as unknown as { collapse?: () => void }).collapse?.();
        detailsPanelRef.current.resize(detailsCollapsedSizePct);
      }
    });
  }, [isDetailsPanelOpen, detailsCollapsedSizePct]);

  useEffect(() => {
    if (!notesPanelRef.current) return;
    if (notesStateFromResizeRef.current) {
      notesStateFromResizeRef.current = false;
      return;
    }
    requestAnimationFrame(() => {
      if (!notesPanelRef.current) return;
      if (isNotesPanelOpen && !isNotesPanelDetached) {
        notesPanelRef.current.resize(lastOpenNotesSizeRef.current);
        (notesPanelRef.current as unknown as { expand?: () => void }).expand?.();
      } else {
        (notesPanelRef.current as unknown as { collapse?: () => void }).collapse?.();
        notesPanelRef.current.resize(notesCollapsedSizePct);
      }
    });
  }, [isNotesPanelDetached, isNotesPanelOpen, notesCollapsedSizePct]);

  const graphNodeById = useMemo(() => {
    void graphNodeDataSignature;
    const map = new Map<string, FlowNode<OSINTNodeData>>();
    for (const n of graphNodesSnapshotRef.current as FlowNode<OSINTNodeData>[])
      map.set(n.id, n);
    return map;
  }, [graphNodeDataSignature]);

  useEffect(() => {
    if (!openNodeDialogNodeId) return;
    const n: any = graphNodeById.get(openNodeDialogNodeId);
    const data: any = n?.data ?? null;
    if (!data) return;
    setAnalysisOpenNodeDialogState({
      isEditMode: false,
      editedLabel: String(data.label ?? ''),
      editedMetadata:
        data.metadata && typeof data.metadata === 'object'
          ? (data.metadata as Record<string, unknown>)
          : {},
      newMetaKey: '',
      newMetaValue: ''
    });
  }, [openNodeDialogNodeId, graphNodeById]);

  const graphChildrenById = useMemo(() => {
    void graphEdgeTopologySignature;
    const map = new Map<string, Set<string>>();
    for (const e of graphEdgesSnapshotRef.current) {
      if (!graphNodeById.has(e.source)) continue;
      if (!graphNodeById.has(e.target)) continue;
      if (e.source === e.target) continue;
      const set = map.get(e.source) ?? new Set<string>();
      set.add(e.target);
      map.set(e.source, set);
    }
    return map;
  }, [graphEdgeTopologySignature, graphNodeById]);

  const graphInDegreeById = useMemo(() => {
    void graphEdgeTopologySignature;
    const map = new Map<string, number>();
    Array.from(graphNodeById.keys()).forEach((id) => map.set(id, 0));
    for (const e of graphEdgesSnapshotRef.current) {
      if (!graphNodeById.has(e.source)) continue;
      if (!graphNodeById.has(e.target)) continue;
      map.set(e.target, (map.get(e.target) ?? 0) + 1);
    }
    return map;
  }, [graphEdgeTopologySignature, graphNodeById]);

  const graphDescendantsById = useMemo(() => {
    const memo = new Map<string, string[]>();

    const visit = (id: string, stack: Set<string>): string[] => {
      const cached = memo.get(id);
      if (cached) return cached;
      if (stack.has(id)) return [id];
      const nextStack = new Set(stack);
      nextStack.add(id);

      const direct = Array.from(graphChildrenById.get(id) ?? []);
      const all = new Set<string>([id]);
      for (const childId of direct) {
        for (const descId of visit(childId, nextStack)) all.add(descId);
      }

      const result = Array.from(all);
      memo.set(id, result);
      return result;
    };

    Array.from(graphNodeById.keys()).forEach((id) => visit(id, new Set()));
    return memo;
  }, [graphChildrenById, graphNodeById]);

  const selectedNodeIdsSnapshotRef = useRef<string[]>([]);
  const graphSelectionSignature = useMemo(() => {
    const selectedIds = (nodes as any[])
      .filter((node) => Boolean(node?.selected))
      .map((node) => String(node.id));
    selectedNodeIdsSnapshotRef.current = selectedIds;
    return selectedIds.join('|');
  }, [nodes]);
  const checkedGraphNodeIds = useMemo(
    () => {
      void graphSelectionSignature;
      return selectedNodeIdsSnapshotRef.current;
    },
    [graphSelectionSignature]
  );

  const checkedGraphNodeIdsSet = useMemo(() => new Set(checkedGraphNodeIds), [checkedGraphNodeIds]);
  const visibleSidebarNodeIdsRef = useRef<string[]>([]);

  const clearCheckedGraphNodes = useCallback(() => {
    selectNodes(() => false);
    selectEdges(() => false);
  }, [selectEdges, selectNodes]);

  const handleDeleteCheckedGraphNodes = useCallback(() => {
    if (!canEditSnapshot()) return;
    const ids = checkedGraphNodeIds;
    if (!ids.length) return;
    const idSet = new Set(ids);
    setNodes((nds) => nds.filter((n) => !idSet.has(n.id)));
    setEdges((eds) => eds.filter((e) => !idSet.has(String(e.source)) && !idSet.has(String(e.target))));
    toast.success(`Deleted ${ids.length} node(s)`);
  }, [canEditSnapshot, checkedGraphNodeIds, setNodes, setEdges]);

  const getMergedChildCountForNodeId = useCallback(
    (nodeId: string) => {
      const node = graphNodeById.get(String(nodeId)) as any;
      const metadata: any = node?.data?.metadata ?? {};
      const direct = Number(metadata?.mergedChildCount);
      if (Number.isFinite(direct) && direct > 0) return direct;
      const fromPayload = Array.isArray(metadata?.__merge?.nodeIds)
        ? metadata.__merge.nodeIds.length
        : 0;
      const payloadCount = Number(fromPayload);
      if (Number.isFinite(payloadCount) && payloadCount > 0)
        return payloadCount;
      return 0;
    },
    [graphNodeById]
  );

  function flattenTreeDataItems(data: TreeDataItem[] | TreeDataItem): string[] {
    const roots = Array.isArray(data) ? data : [data];
    const out: string[] = [];

    function visit(item: TreeDataItem) {
      const meta = item.data as any;
      const nodeId = String(meta?.nodeId ?? item.id);
      out.push(nodeId);
      const children = Array.isArray(item.children) ? item.children : [];
      for (const c of children) visit(c);
    }

    for (const r of roots) visit(r);
    return out;
  }

  const toggleCheckedGraphNode = useCallback(
    (
      nodeId: string,
      modifiers?: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }
    ) => {
      const clickedId = String(nodeId);
      const isShift = Boolean(modifiers?.shiftKey);
      const isToggle = Boolean(modifiers?.metaKey || modifiers?.ctrlKey);

      const anchorId = sidebarCheckAnchorRef.current;
      sidebarCheckAnchorRef.current = clickedId;
      const visibleSidebarNodeIds = visibleSidebarNodeIdsRef.current;

      const applyReplace = (idSet: Set<string>) => {
        selectEdges(() => false);
        selectNodes((n) => idSet.has(String(n.id)));
      };
      const applyAdd = (idSet: Set<string>) => {
        selectEdges(() => false);
        selectNodes((n) => idSet.has(String(n.id)) || Boolean(n.selected));
      };
      const applyToggle = (idSet: Set<string>, nextSelected: boolean) => {
        selectEdges(() => false);
        selectNodes((n) => idSet.has(String(n.id)) ? nextSelected : Boolean(n.selected));
      };

      function addDescendantsToSet(sourceId: string, out: Set<string>) {
        const affected = graphDescendantsById.get(sourceId) ?? [sourceId];
        for (const id of affected) out.add(String(id));
      }

      // Shift = range selection (visible order), Ctrl/Cmd+Shift = add range
      if (isShift && anchorId) {
        const a = visibleSidebarNodeIds.indexOf(String(anchorId));
        const b = visibleSidebarNodeIds.indexOf(clickedId);
        if (a !== -1 && b !== -1) {
          const min = Math.min(a, b);
          const max = Math.max(a, b);
          const range = visibleSidebarNodeIds.slice(min, max + 1);
          const rangeSet = new Set<string>();
          for (const id of range) addDescendantsToSet(id, rangeSet);
          if (isToggle) applyAdd(rangeSet);
          else applyReplace(rangeSet);
          return;
        }
      }

      // No modifiers = replace selection to this subtree (file-explorer style)
      if (!isToggle) {
        const set = new Set<string>();
        addDescendantsToSet(clickedId, set);
        const isFullyChecked = Array.from(set).every((id) => checkedGraphNodeIdsSet.has(String(id)));
        const hasAnySelectedOutside = Array.from(checkedGraphNodeIdsSet).some(
          (id) => !set.has(String(id))
        );

        // Toggle off: se il subtree è già tutto selezionato e non ci sono altri selezionati, riclick => clear.
        if (isFullyChecked && !hasAnySelectedOutside) {
          applyReplace(new Set());
          return;
        }

        applyReplace(set);
        return;
      }

      // Ctrl/Cmd = toggle subtree (keep other selection)
      const affectedIds = graphDescendantsById.get(clickedId) ?? [clickedId];
      const isFullyChecked = affectedIds.every((id) => checkedGraphNodeIdsSet.has(String(id)));
      const affectedSet = new Set<string>(affectedIds.map(String));
      applyToggle(affectedSet, !isFullyChecked);
    },
    [
      checkedGraphNodeIdsSet,
      graphDescendantsById,
      selectEdges,
      selectNodes
    ]
  );

  const getGraphNodeCheckState = useCallback(
    (nodeId: string): boolean | 'indeterminate' => {
      const affectedIds = graphDescendantsById.get(nodeId) ?? [nodeId];
      let checkedCount = 0;
      for (const id of affectedIds) if (checkedGraphNodeIdsSet.has(id)) checkedCount += 1;
      if (checkedCount === 0) return false;
      if (checkedCount === affectedIds.length) return true;
      return 'indeterminate';
    },
    [checkedGraphNodeIdsSet, graphDescendantsById]
  );

  const graphTreeData = useMemo(() => {
    const build = (id: string, visited: Set<string>): TreeDataItem | null => {
      if (visited.has(id)) return null;
      const node = graphNodeById.get(id);
      if (!node) return null;
      const data = node.data as OSINTNodeData | undefined;
      const label = data?.label || id;

      const nextVisited = new Set(visited);
      nextVisited.add(id);

      const children = Array.from(graphChildrenById.get(id) ?? [])
        .map((childId) => build(childId, nextVisited))
        .filter(Boolean) as TreeDataItem[];

      children.sort((a, b) => a.name.localeCompare(b.name));

      return {
        id,
        name: label,
        children: children.length ? children : undefined,
        data: {
          nodeId: id,
          type: data?.type,
          isHidden: Boolean((node as any).hidden)
        }
      };
    };

    const roots = Array.from(graphNodeById.keys()).filter((id) => {
      const inDegree = graphInDegreeById.get(id) ?? 0;
      return inDegree === 0;
    });

    const rootIds = roots.length ? roots : Array.from(graphNodeById.keys());
    const items = rootIds
      .map((id) => build(id, new Set()))
      .filter(Boolean) as TreeDataItem[];

    items.sort((a, b) => a.name.localeCompare(b.name));
    return items;
  }, [graphChildrenById, graphInDegreeById, graphNodeById]);

  const filteredGraphTreeData = useMemo(() => {
    const q = normalizeSidebarSearchQuery(sidebarSearchQuery);
    if (!q) return graphTreeData;

    const matches = (item: TreeDataItem) => {
      const meta = item.data as { type?: string } | undefined;
      const typeLabel =
        meta?.type && (nodeTypeOptions.find((o) => o.value === meta.type)?.label || meta.type);
      const haystack = `${item.name} ${typeLabel ?? ''}`.toLowerCase();
      return haystack.includes(q);
    };

    const filter = (items: TreeDataItem[]): TreeDataItem[] => {
      const out: TreeDataItem[] = [];
      for (const item of items) {
        const children = item.children ? filter(item.children) : [];
        if (matches(item) || children.length) out.push({ ...item, children: children.length ? children : undefined });
      }
      return out;
    };

    return filter(graphTreeData);
  }, [graphTreeData, sidebarSearchQuery]);

  useEffect(() => {
    visibleSidebarNodeIdsRef.current = flattenTreeDataItems(filteredGraphTreeData);
  }, [filteredGraphTreeData]);

  const sidebarCheckAnchorRef = useRef<string | null>(null);

  const filteredGroupedNodeTypesForSidebar = useMemo(() => {
    const q = normalizeSidebarSearchQuery(sidebarSearchQuery);
    if (!q) return groupedNodeTypes;

    const out: typeof groupedNodeTypes = {};

    for (const [category, subcategories] of Object.entries(groupedNodeTypes)) {
      const nextSubcategories: Record<string, typeof nodeTypeOptions> = {};

      for (const [subcategory, options] of Object.entries(subcategories)) {
        const filtered = options.filter((opt) => {
          const haystack = `${opt.label} ${category} ${subcategory}`.toLowerCase();
          return haystack.includes(q);
        });
        if (filtered.length) nextSubcategories[subcategory] = filtered;
      }

      if (Object.keys(nextSubcategories).length) out[category] = nextSubcategories as any;
    }

    return out;
  }, [sidebarSearchQuery]);

  const openedAddSidebarCategories = useMemo(() => {
    const q = normalizeSidebarSearchQuery(sidebarSearchQuery);
    if (!q) return null;
    return Object.keys(filteredGroupedNodeTypesForSidebar);
  }, [sidebarSearchQuery, filteredGroupedNodeTypesForSidebar]);

  const selectedNode = useMemo(
    () => nodes.find((node) => node.selected),
    [nodes]
  );
  const selectedEdge = useMemo(
    () => edges.find((edge) => edge.selected),
    [edges]
  );

  function scrollEntitiesRowIntoViewX(nodeId: string) {
    const rowEl = nodeRowElByIdRef.current.get(nodeId);
    const viewportEl = entitiesViewportRef.current;
    if (!rowEl || !viewportEl) return;

    const leftEl = rowEl.querySelector('[data-node-left]') as HTMLElement | null;
    const labelEl = rowEl.querySelector('[data-node-label]') as HTMLElement | null;
    if (!leftEl || !labelEl) return;

    const viewportRect = viewportEl.getBoundingClientRect();
    const leftRect = leftEl.getBoundingClientRect();
    const labelRect = labelEl.getBoundingClientRect();
    const current = viewportEl.scrollLeft;

    const leftBoundary = current + (leftRect.left - viewportRect.left);
    const labelRight = current + (labelRect.right - viewportRect.left);

    const paddingRight = 8;
    const desired = Math.max(0, labelRight - viewportEl.clientWidth + paddingRight);
    const maxAllowed = Math.max(0, leftBoundary - 4);
    viewportEl.scrollLeft = Math.min(desired, maxAllowed);
  }

  const handleSelectNodeFromTree = useCallback(
    (nodeId: string) => {
      // Toggle: riclick su un nodo già selezionato => deseleziona (comportamento "file explorer")
      if (checkedGraphNodeIdsSet.has(String(nodeId))) {
        selectEdges(() => false);
        selectNodes(() => false);
        return;
      }

      selectEdges(() => false);
      selectNodes((n) => n.id === nodeId);
      shouldAutoOpenDetailsPanelRef.current = true;
      requestAnimationFrame(() => {
        const rowEl = nodeRowElByIdRef.current.get(nodeId);
        const viewportEl = entitiesViewportRef.current;
        if (!rowEl || !viewportEl) return;

        // 1) Mantieni la riga visibile verticalmente
        rowEl.scrollIntoView({ block: 'nearest' });

        // 2) Auto-scroll orizzontale: mostra il label ma non nascondere caret/checkbox
        scrollEntitiesRowIntoViewX(nodeId);
      });
      requestAnimationFrame(() => {
        try {
          if (graphViewMode === 'analysis') {
            analysisGraphApiRef.current?.fitViewToNodeIds([nodeId]);
            return;
          }

          reactFlowInstance.fitView({ padding: 0.45, duration: 420, nodes: [{ id: nodeId }] });
        } catch {
          // no-op
        }
      });
    },
    [
      analysisGraphApiRef,
      checkedGraphNodeIdsSet,
      graphViewMode,
      reactFlowInstance,
      selectEdges,
      selectNodes
    ]
  );

  const handleSelectAllNodes = useCallback(() => {
    selectEdges(() => false);
    selectNodes(() => true);
  }, [selectEdges, selectNodes]);

  useEffect(() => {
    const root = entitiesScrollRootEl;
    if (!root) return;
    const viewport = root.querySelector(
      '[data-slot="scroll-area-viewport"]'
    ) as HTMLDivElement | null;
    if (!viewport) return;
    entitiesViewportRef.current = viewport;
    entitiesLastScrollTopRef.current = viewport.scrollTop;
    entitiesLastAlignedNodeIdRef.current = null;
    entitiesLastAlignedLevelRef.current = null;

    let raf = 0;
    const handleScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const viewportEl = entitiesViewportRef.current;
        if (!viewportEl) return;
        // Evita jitter: se lo scrollTop non è cambiato, è probabilmente un nostro scrollLeft.
        const prevTop = entitiesLastScrollTopRef.current;
        if (prevTop !== null && viewportEl.scrollTop === prevTop) return;
        entitiesLastScrollTopRef.current = viewportEl.scrollTop;

        const viewportRect = viewportEl.getBoundingClientRect();
        const viewportTop = viewportRect.top;

        // Cambia scroll X solo quando una riga "arriva in cima" (entro una piccola tolleranza)
        const EPS = 2;
        let best: { nodeId: string; deltaTop: number; el: HTMLElement } | null = null;

        for (const [nodeId, rowEl] of Array.from(nodeRowElByIdRef.current.entries())) {
          const r = rowEl.getBoundingClientRect();
          if (r.bottom <= viewportTop) continue; // completamente sopra
          if (r.top < viewportTop - EPS) continue; // già scorsa oltre la cima
          if (r.top > viewportRect.bottom) continue; // sotto

          const deltaTop = Math.abs(r.top - viewportTop);
          if (!best || deltaTop < best.deltaTop) best = { nodeId, deltaTop, el: rowEl };
        }

        if (!best) return;
        if (best.deltaTop > EPS) return;

        // Solo se la riga sfora orizzontalmente
        if (best.el.scrollWidth <= viewportEl.clientWidth) return;

        // Ragiona per livello: se stiamo ancora scorrendo lo stesso livello, non riallineare X
        const level = Number(best.el.dataset.nodeLevel ?? '0');
        if (entitiesLastAlignedLevelRef.current === level) return;
        entitiesLastAlignedLevelRef.current = level;

        if (entitiesLastAlignedNodeIdRef.current === best.nodeId) return;
        entitiesLastAlignedNodeIdRef.current = best.nodeId;

        scrollEntitiesRowIntoViewX(best.nodeId);
      });
    };

    viewport.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      viewport.removeEventListener('scroll', handleScroll);
    };
  }, [entitiesScrollRootEl]);

  useEffect(() => {
    if (!shouldFocusSidebarSearch) return;
    if (!isSidebarOpen) return;
    // focus after layout commit
    requestAnimationFrame(() => {
      sidebarSearchInputRef.current?.focus();
    });
    setShouldFocusSidebarSearch(false);
  }, [isSidebarOpen, shouldFocusSidebarSearch]);

  useEffect(() => {
    const hasSelection = Boolean(selectedNode || selectedEdge);
    hasSelectionRef.current = hasSelection;
    selectedNodeIdRef.current = selectedNode ? String(selectedNode.id) : null;
    selectedEdgeIdRef.current = selectedEdge ? String(selectedEdge.id) : null;
    if (!hasSelection) {
      if (pendingAutoOpenDetailsTimerRef.current) {
        clearTimeout(pendingAutoOpenDetailsTimerRef.current);
        pendingAutoOpenDetailsTimerRef.current = null;
      }
      closeDetailsPanel();
      return;
    }
    if (shouldAutoOpenDetailsPanelRef.current) {
      shouldAutoOpenDetailsPanelRef.current = false;
      openDetailsPanel();
    }
  }, [selectedNode?.id, selectedEdge?.id, openDetailsPanel, closeDetailsPanel]);

  useEffect(() => {
    const el = panelGroupElRef.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (!w) return;
      setPanelGroupWidthPx(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = bottomGroupElRef.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height;
      if (!h) return;
      setBottomGroupHeightPx(h);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!shouldFocusSidebarSearch) return;
    if (!isSidebarOpen) return;
    requestAnimationFrame(() => {
      sidebarSearchInputRef.current?.focus();
    });
    setShouldFocusSidebarSearch(false);
  }, [isSidebarOpen, shouldFocusSidebarSearch]);

  const handleBottomTabClick = useCallback((tab: 'console' | 'activity') => {
    setBottomDockTab((prevTab) => {
      // switching tabs should never compress the dock
      if (prevTab === tab) {
        setIsBottomDockExpanded((v) => {
          const next = !v;
          requestAnimationFrame(() => {
            if (!bottomDockPanelRef.current) return;
            bottomDockPanelRef.current.resize(
              next ? lastOpenBottomDockSizeRef.current : bottomCollapsedSizePct
            );
            if (next)
              (bottomDockPanelRef.current as unknown as { expand?: () => void }).expand?.();
            else
              (bottomDockPanelRef.current as unknown as { collapse?: () => void }).collapse?.();
          });
          return next;
        });
      } else {
        setIsBottomDockExpanded(true);
        requestAnimationFrame(() => {
          if (!bottomDockPanelRef.current) return;
          bottomDockPanelRef.current.resize(lastOpenBottomDockSizeRef.current);
          (bottomDockPanelRef.current as unknown as { expand?: () => void }).expand?.();
        });
      }
      return tab;
    });
  }, [bottomCollapsedSizePct]);

  useEffect(() => {
    if (!tabIsActive) {
      setGraphPanelControls(null);
      return;
    }

    setGraphPanelControls({
      isSidebarOpen,
      isRightPanelOpen:
        isDetailsPanelOpen ||
        (isNotesPanelOpen && !isNotesPanelDetached),
      isBottomDockExpanded,
      toggleSidebar,
      toggleRightPanel,
      toggleConsole: () => handleBottomTabClick('console')
    });

    return () => setGraphPanelControls(null);
  }, [
    handleBottomTabClick,
    tabIsActive,
    isBottomDockExpanded,
    isDetailsPanelOpen,
    isNotesPanelDetached,
    isNotesPanelOpen,
    isSidebarOpen,
    setGraphPanelControls,
    toggleRightPanel,
    toggleSidebar
  ]);

  const requestConsoleClear = useCallback(() => {
    setConsoleClearSignal((v) => v + 1);
  }, []);

  const {
    openTopbarMenuId,
    setOpenTopbarMenuId,
    openTopbarMenu,
    scheduleCloseTopbarMenus,
    cancelCloseTopbarMenus,
    openTopbarMenuOnHover
  } = useTopbarMenubarBehavior({ isActive: tabIsActive });

  const openGraphCaseDialog = useCallback((mode: 'add' | 'remove') => {
    setGraphCaseMode(mode);
    setGraphCaseDialogOpen(true);
  }, []);

  // Cache per la clipboard - mantiene i dati dei nodi copiati e il contenuto originale della clipboard
  const clipboardCache = useRef<{
    id: string;
    nodes: FlowNode[];
    edges: Edge[];
    originalClipboard: string;
  } | null>(null);

  const prevNodesCount = useRef(0);
  const isLoadingFromStorage = useRef(true); // Flag per evitare auto-layout al caricamento iniziale

  const { canUndo, canRedo, undo, redo, resetHistory, commitHistory } = useGraphHistory({
    canEditSnapshot,
    mounted,
    nodes: nodes as any,
    edges,
    setNodes: setNodes as any,
    setEdges
  });

  const { resolvedTheme } = useTheme();
  const edgeReconnectSuccessful = useRef(true);
  const connectingNodeId = useRef<{
    nodeId: string;
    handleId: string | null;
  } | null>(null);
  const sourceNodePosition = useRef<{ x: number; y: number } | null>(null);
  const [previewNodePosition, setPreviewNodePosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [previewNodeOffset, setPreviewNodeOffset] = useState<{
    x: number;
    y: number;
  }>({ x: 0, y: 0 });
  const [suggestedNodeType, setSuggestedNodeType] =
    useState<OSINTNodeData['type']>('person');
  const lastAddedNodeType = useRef<OSINTNodeData['type']>('person');
  const recentNodeTypes = useRef<OSINTNodeData['type'][]>([]);
  const previewNodeTimeout = useRef<NodeJS.Timeout | null>(null);
  const nodeTypeRotationInterval = useRef<NodeJS.Timeout | null>(null);
  const [graphName, setGraphName] = useState('');
  const [graphDescription, setGraphDescription] = useState<string | null>(null);
  const [activeGraphCase, setActiveGraphCase] = useState<{ id: string; name: string } | null>(
    null
  );
  const saveStatus = useSaveStatus();
  const setTabTitle = useWorkspaceTabsStore((s) => s.setTabTitle);

  const openAddToCase = useCallback((nodesToAdd: FlowNode[]) => {
    setAddToCaseNodes(nodesToAdd);
    setAddToCaseOpen(true);
  }, []);

  const refreshRecentCases = useCallback(async () => {
    try {
      const res = await fetch('/api/cases');
      if (!res.ok) throw new Error('cases');
      const data = await res.json();
      const list = Array.isArray(data.cases) ? data.cases : [];
      setRecentCases(
        list.slice(0, 5).map((c: any) => ({ id: c.id as string, name: c.name as string }))
      );
    } catch {
      setRecentCases([]);
    }
  }, []);

  const addNodesToCase = useCallback(
    async (args: { caseId: string; nodes: FlowNode[] }) => {
      if (!args.nodes.length) return;
      for (const node of args.nodes) {
        const data = node.data as OSINTNodeData | undefined;
        if (!data?.type || typeof data.label !== 'string') continue;
        const res = await fetch(`/api/cases/${args.caseId}/entities/pin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: data.type,
            value: String(data.label ?? '').trim(),
            label:
              typeof data.metadata?.customTitle === 'string'
                ? data.metadata.customTitle
                : undefined,
            metadata: data.metadata ?? {},
            source: {
              kind: 'graph_node',
              graphId: graphId ?? null,
              graphNodeId: node.id
            }
          })
        });
        if (!res.ok) throw new Error('pin_failed');
      }
      toast.success('Added to case');
      refreshRecentCases();
    },
    [graphId, refreshRecentCases]
  );

  const openNewCaseDialogForNodes = useCallback((nodesToAdd: FlowNode[]) => {
    setCreateCaseNodes(nodesToAdd);
    setCreateCaseOpen(true);
  }, []);

  // Carica i plugin una sola volta per tutto il grafo
  const {
    builtinPlugins,
    communityPlugins,
    customPlugins,
    addons,
    isLoading: pluginsLoading
  } = usePlugins();

  // Calcola gli ID dei plugin abilitati
  const enabledPluginIds = useMemo(() => {
    const enabled: string[] = [];

    for (const plugin of builtinPlugins) {
      if (plugin.enabled) enabled.push(plugin.id);
    }
    for (const plugin of communityPlugins) {
      if (plugin.enabled) enabled.push(plugin.id);
    }
    for (const plugin of customPlugins) {
      enabled.push(plugin.id);
    }
    for (const addon of addons) {
      if (addon.enabled) enabled.push(addon.id);
    }

    return enabled.length > 0 ? enabled : null;
  }, [builtinPlugins, communityPlugins, customPlugins, addons]);

  // Helper per creare un hash stabile dello stato
  const createStateHash = useCallback((nodes: FlowNode[], edges: Edge[]) => {
    return createGraphStateHash(nodes as any, edges);
  }, []);

  const {
    markSavedState,
    flush,
    idle: waitForGraphSaves,
    isDirty: isGraphDirty
  } = useGraphAutosave({
    graphId,
    mounted,
    nodes: nodes as any,
    edges,
    isLoadingFromStorageRef: isLoadingFromStorage,
    createStateHash: createStateHash as any,
    saveStatus,
    writeVersionRef: graphWriteVersionRef,
    canEditSnapshot,
    canSaveSnapshot,
    blockedRef
  });

  // Imposta che siamo nella pagina del grafo (solo al mount/unmount)
  useEffect(() => {
    if (saveStatus) {
      saveStatus.setIsInGraphPage(true);
    }
    return () => {
      if (saveStatus) {
        saveStatus.setIsInGraphPage(false);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Solo al mount/unmount!

  // Carica dati dal database o localStorage
  useEffect(() => {
    setMounted(true);

    // Carica preferenza background (per-user)
    try {
      const raw = localStorage.getItem(STORAGE_KEY_BACKGROUND_VARIANT);
      if (
        raw === BackgroundVariant.Dots ||
        raw === BackgroundVariant.Lines ||
        raw === BackgroundVariant.Cross
      ) {
        setBackgroundVariant(raw as BackgroundVariant);
      }
    } catch {
      // ignore
    }

    let disposed = false;
    const loadGraph = async () => {
      graphWriteVersionRef.current = undefined;
      if (graphId) {
        // Carica dal database
        try {
          const response = await fetch(`/api/graphs/${graphId}`);
          if (disposed || graphClientCoordinator.frozen(graphId)) return;
          if (response.status === 404) {
            setGraphLoadError('not_found');
            setCanonicalNodes([]);
            setCanonicalEdges([]);
            resetHistory({ nodes: [] as any, edges: [] as any });
            prevNodesCount.current = 0;
            setGraphName('');
            setGraphDescription(null);
            return;
          }
          if (response.status === 401) {
            setGraphLoadError('unauthorized');
            return;
          }
          if (response.ok) {
            const data = await response.json();
            if (disposed || graphClientCoordinator.frozen(graphId)) return;
            if (data.graph) {
              graphWriteVersionRef.current = data.graph.writeState?.locked
                ? undefined
                : (data.graph.writeState?.version ?? 0);
              if (data.graph.writeState)
                acceptSnapshot(graphId, data.graph.writeState);
              setGraphLoadError(null);
              setGraphName(data.graph.name);
              if (typeof data.graph.name === 'string' && data.graph.name && graphId) {
                setTabTitle(`graph:${graphId}`, data.graph.name);
              }
              setGraphDescription(data.graph.description);
              setActiveGraphCase(
                data.graph.activeCase &&
                  typeof data.graph.activeCase.id === 'string' &&
                  typeof data.graph.activeCase.name === 'string'
                  ? { id: data.graph.activeCase.id, name: data.graph.activeCase.name }
                  : null
              );
              const loadedNodes = data.graph.nodes || [];
              const loadedEdges = (data.graph.edges || []).map((e: any) => {
                // Back-compat: vecchi grafi potevano avere edge.type='floating' per la vecchia vista relational su ReactFlow.
                // Ora normalizziamo per evitare dipendenze da edgeTypes legacy.
                if (String(e?.type ?? '') !== 'floating') return e;
                const { sourceHandle, targetHandle, ...rest } = e ?? {};
                return { ...rest, type: 'osint' };
              });
              setCanonicalNodes(loadedNodes);
              setCanonicalEdges(loadedEdges);
              resetHistory({ nodes: loadedNodes as any, edges: loadedEdges });
              prevNodesCount.current = loadedNodes.length;
              // Inizializza l'ultimo stato salvato per evitare salvataggi immediati
              markSavedState(loadedNodes as any, loadedEdges);
            }
          } else {
            setGraphLoadError('unknown');
          }
        } catch {
          setGraphLoadError('unknown');
          toast.error('Failed to load graph');
        } finally {
          // Nascondi loader dopo il caricamento
          setIsLoadingGraph(false);
        }
      } else {
        // Nessun graphId, nascondi loader immediatamente
        setGraphLoadError(null);
        setIsLoadingGraph(false);
        setActiveGraphCase(null);
      }

      // Reset flag dopo un breve delay
      setTimeout(() => {
        isLoadingFromStorage.current = false;
      }, 200);
    };

    loadGraph();
    return () => {
      disposed = true;
    };
  }, [
    acceptSnapshot,
    graphId,
    createStateHash,
    markSavedState,
    resetHistory,
    setCanonicalEdges,
    setCanonicalNodes,
    setTabTitle
  ]);

  // Preload loghi quando apriamo il grafo (retry + cache)
  useEffect(() => {
    if (isLoadingGraph) return;
    if (!nodes.length) return;
    if (typeof window === 'undefined') return;
    let cancelled = false;

    function preloadLogos() {
      const logoUrls = new Set<string>();
      for (const node of nodes) {
        const data = node.data as OSINTNodeData | undefined;
        if (!data) continue;
        const logoUrl = computeLogoUrl({
          type: String(data.type ?? ''),
          label: String(data.label ?? ''),
          metadata: data.metadata
        });
        if (!logoUrl) continue;
        const cached = peekCachedLogo(logoUrl);
        if (cached?.complete) {
          preloadedGraphLogoUrlsRef.current.add(logoUrl);
          continue;
        }
        logoUrls.add(logoUrl);
      }

      for (const url of Array.from(logoUrls)) {
        if (preloadedGraphLogoUrlsRef.current.has(url)) continue;
        preloadedGraphLogoUrlsRef.current.add(url);
        loadLogoWithRetry(url, { maxAttempts: 3, retryDelayMs: 1000 }).catch(() => {
          if (!cancelled) preloadedGraphLogoUrlsRef.current.delete(url);
        });
      }
    }

    if ('requestIdleCallback' in globalThis) {
      (
        globalThis as unknown as {
          requestIdleCallback?: (cb: () => void, args?: { timeout: number }) => void;
        }
      ).requestIdleCallback?.(preloadLogos, { timeout: 2000 });
    } else {
      globalThis.setTimeout(preloadLogos, 0);
    }

    return () => {
      cancelled = true;
    };
  }, [isLoadingGraph, nodes]);

  // Punto centrale: calcolo logo/fill e caching (vale per Investigation + Analysis).
  // Il renderer (AnalysisCanvas / ReactFlow) deve solo consumare i metadata già calcolati.
  const autoColorRafRef = useRef<number | null>(null);
  const pendingAutoColorByNodeIdRef = useRef<Map<string, { colorHex: string }>>(new Map());
  const markSavedStateRef = useRef<((nodes: any, edges: any) => void) | null>(null);
  const analysisLayoutRef = useRef<{ refetch: () => void } | null>(null);

  const refreshGraph = useCallback(async () => {
    if (!graphId) return;
    if (graphClientCoordinator.frozen(graphId)) {
      await graphClientCoordinator.preview(graphId);
      return;
    }
    const scope = graphClientCoordinator.epoch(graphId);
    setIsLoadingGraph(true);
    try {
      const response = await fetch(`/api/graphs/${graphId}`, {
        cache: 'no-store',
        headers: { 'cache-control': 'no-cache' }
      });
      if (!response.ok) throw new Error('graph');
      const data = await response.json();
      if (
        graphClientCoordinator.frozen(graphId) ||
        graphClientCoordinator.epoch(graphId) !== scope
      )
        return;

      const graph = (data?.graph ?? data) as any;
      const loadedNodes = (() => {
        const raw = graph?.nodes;
        if (Array.isArray(raw)) return raw;
        if (typeof raw === 'string') {
          try {
            const parsed = JSON.parse(raw) as unknown;
            if (Array.isArray(parsed)) return parsed;
          } catch {}
        }
        if (raw && typeof raw === 'object' && Array.isArray((raw as any).nodes))
          return (raw as any).nodes;
        return [];
      })();
      const loadedEdgesRaw = (() => {
        const raw = graph?.edges;
        if (Array.isArray(raw)) return raw;
        if (typeof raw === 'string') {
          try {
            const parsed = JSON.parse(raw) as unknown;
            if (Array.isArray(parsed)) return parsed;
          } catch {}
        }
        if (raw && typeof raw === 'object' && Array.isArray((raw as any).edges))
          return (raw as any).edges;
        return [];
      })();
      const loadedEdges = loadedEdgesRaw.map((e: any) => {
        if (String(e?.type ?? '') !== 'floating') return e;
        const { sourceHandle, targetHandle, ...rest } = e ?? {};
        return { ...rest, type: 'osint' };
      });

      // Safety: never wipe a non-empty canvas with an invalid/empty payload.
      // If the backend says there are nodes, we expect them to be present in `nodes`.
      const serverNodeCount = Number(graph?.nodeCount ?? loadedNodes.length);
      const shouldBlockWipe =
        serverNodeCount > 0 && loadedNodes.length === 0 && nodes.length > 0;
      if (shouldBlockWipe) {
        toast.error('Refresh failed: invalid payload (nodes missing)');
        return;
      }

      // Clear selection + load canonical data
      graphWriteVersionRef.current = graph?.writeState?.locked
        ? undefined
        : (graph?.writeState?.version ?? 0);
      if (blockedRef.current && isGraphDirty())
        notifyReplacedDraft(
          {
            graphId,
            nodes: structuredClone(graphNodesSnapshotRef.current),
            edges: structuredClone(graphEdgesSnapshotRef.current)
          },
          'graph-local-draft.json'
        );
      setCanonicalNodes(
        loadedNodes.map((n: any) => ({ ...n, selected: false }))
      );
      setCanonicalEdges(
        loadedEdges.map((e: any) => ({ ...e, selected: false }))
      );
      resetHistory({ nodes: loadedNodes, edges: loadedEdges });
      if (graph.writeState) acceptSnapshot(graphId, graph.writeState);

      setGraphName(typeof graph?.name === 'string' ? graph.name : '');
      setGraphDescription(
        typeof graph?.description === 'string' ? graph.description : null
      );
      setActiveGraphCase(
        graph?.activeCase &&
          typeof graph.activeCase.id === 'string' &&
          typeof graph.activeCase.name === 'string'
          ? { id: graph.activeCase.id, name: graph.activeCase.name }
          : null
      );

      prevNodesCount.current = loadedNodes.length;
      markSavedStateRef.current?.(loadedNodes as any, loadedEdges);
      analysisLayoutRef.current?.refetch();
      toast.success('Graph refreshed');
    } catch {
      toast.error('Failed to refresh graph');
    } finally {
      setIsLoadingGraph(false);
    }
  }, [
    acceptSnapshot,
    blockedRef,
    graphId,
    isGraphDirty,
    nodes.length,
    resetHistory,
    setCanonicalEdges,
    setCanonicalNodes
  ]);
  useStaleReload(writeGuard.status, isLoadingGraph, () => void refreshGraph());

  useGraphParticipant(graphId, {
    kind: 'graph',
    capture: () => ({
      ready: mounted && !isLoadingGraph && !graphLoadError && canSaveSnapshot(),
      version: graphWriteVersionRef.current,
      value: {
        nodes: graphNodesSnapshotRef.current,
        edges: graphEdgesSnapshotRef.current
      },
      dirty: isGraphDirty()
    }),
    idle: waitForGraphSaves,
    flush: (draft) =>
      flush(
        true,
        draft && typeof draft.value !== 'string'
          ? (draft.value as { nodes: FlowNode<OSINTNodeData>[]; edges: Edge[] })
          : undefined
      ),
    invalidate: writeGuard.reject,
    // Only called for editors unchanged since capture or the last live preview:
    // the replaced content is already persisted server-side.
    adopt: (snapshot) => {
      const previous = {
        nodes: graphNodesSnapshotRef.current as FlowNode<OSINTNodeData>[],
        edges: graphEdgesSnapshotRef.current as Edge[]
      };
      const nextNodes = snapshot.nodes as FlowNode<OSINTNodeData>[];
      const nextEdges = snapshot.edges as Edge[];
      commitHistory({ nodes: previous.nodes, edges: previous.edges });
      graphWriteVersionRef.current = snapshot.writeState.version;
      setCanonicalNodes(withPresentation(previous.nodes, nextNodes) as any);
      setCanonicalEdges(withPresentation(previous.edges, nextEdges));
      commitHistory({ nodes: nextNodes as any, edges: nextEdges });
      markSavedState(nextNodes, nextEdges);
      acceptSnapshot(snapshot.graphId, snapshot.writeState);
      analysisLayoutRef.current?.refetch();
    },
    preview: (snapshot) => {
      const previous = {
        nodes: graphNodesSnapshotRef.current as any[],
        edges: graphEdgesSnapshotRef.current as any[]
      };
      const nextNodes = snapshot.nodes as FlowNode<OSINTNodeData>[];
      const nextEdges = snapshot.edges as Edge[];
      commitHistory({ nodes: previous.nodes as any, edges: previous.edges });
      const changes = agentGraphChanges(previous, {
        nodes: nextNodes,
        edges: nextEdges
      });
      setCanonicalNodes(withPresentation(previous.nodes, nextNodes) as any);
      setCanonicalEdges(withPresentation(previous.edges, nextEdges));
      commitHistory({ nodes: nextNodes as any, edges: nextEdges });
      markSavedState(nextNodes, nextEdges);
      analysisLayoutRef.current?.refetch();
      if (changes.nodeIds.length || changes.edgeIds.length)
        setAgentChanges(changes);
    }
  });

  useEffect(() => {
    const handleBlockedSave = (event: Event) => {
      const detail = (event as CustomEvent<{ graphId: string; status: number }>)
        .detail;
      if (detail?.graphId !== graphId) return;
      toast.error(
        detail.status === 423
          ? 'An agent is working on this graph. Local changes have not been saved.'
          : 'The graph changed during an agent run. Local changes have not been saved.'
      );
    };
    window.addEventListener('graph-write-blocked', handleBlockedSave);
    return () =>
      window.removeEventListener('graph-write-blocked', handleBlockedSave);
  }, [graphId]);

  useEffect(() => {
    markSavedStateRef.current = markSavedState as any;
  }, [markSavedState]);

  // Persist preferenza background (per-user)
  useEffect(() => {
    if (!mounted) return;
    try {
      localStorage.setItem(STORAGE_KEY_BACKGROUND_VARIANT, backgroundVariant);
    } catch {
      // ignore
    }
  }, [mounted, backgroundVariant]);

  // Funzioni per Copy/Paste con clipboard di sistema
  const handleCopySelection = useCallback(async () => {
    const selectedNodes = nodes.filter((n) => n.selected);
    const selectedEdges = edges.filter(
      (e) =>
        e.selected ||
        (selectedNodes.some((n) => n.id === e.source) &&
          selectedNodes.some((n) => n.id === e.target))
    );

    if (selectedNodes.length > 0) {
      try {
        if (
          !navigator.clipboard ||
          !navigator.clipboard.readText ||
          !navigator.clipboard.writeText
        ) {
          toast.error('Clipboard not available');
          return;
        }

        // 1. Leggi il contenuto attuale della clipboard
        let originalClipboard = '';
        try {
          originalClipboard = await navigator.clipboard.readText();
        } catch (err) {
          // Se non riusciamo a leggere (permessi), procediamo comunque
          console.warn('Could not read clipboard:', err);
        }

        // 2. Genera un ID univoco per questa operazione di copy
        const copyId = `OSINT_COPY_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // 3. Salva i dati nella cache insieme al contenuto originale della clipboard
        clipboardCache.current = {
          id: copyId,
          nodes: selectedNodes,
          edges: selectedEdges,
          originalClipboard
        };

        if (graphId) {
          storeGraphNodeClipboard(
            copyId,
            selectedNodes.map((node) => ({
              graphId,
              nodeId: node.id
            }))
          );
        }

        // 4. Scrivi solo il marcatore nella clipboard di sistema
        const marker = createGraphNodeClipboardMarker(copyId);
        await navigator.clipboard.writeText(marker);

        toast.success(`Copied ${selectedNodes.length} node(s)`);
      } catch (err) {
        toast.error('Failed to copy');
        console.error('Copy error:', err);
      }
    }
  }, [nodes, edges, graphId]);

  const handlePasteNodesFromCache = useCallback(
    async (copyId: string) => {
      // Recupera i dati dalla cache
      if (!clipboardCache.current || clipboardCache.current.id !== copyId) {
        toast.error('Copied nodes no longer available');
        return;
      }

      const {
        nodes: cachedNodes,
        edges: cachedEdges,
        originalClipboard
      } = clipboardCache.current;

      try {
        const offset = 50;
        const idMapping = new Map<string, string>();

        // Crea nuovi nodi con offset
        const newNodes: FlowNode[] = cachedNodes.map((n) => {
          const newId = `node-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          idMapping.set(n.id, newId);
          return {
            ...n,
            id: newId,
            position: { x: n.position.x + offset, y: n.position.y + offset },
            selected: true
          };
        });

        // Crea nuovi edge che connettono i nuovi nodi
        const newEdges: Edge[] = cachedEdges
          .filter((e) => idMapping.has(e.source) && idMapping.has(e.target))
          .map((e) => ({
            ...e,
            id: `e-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            source: idMapping.get(e.source)!,
            target: idMapping.get(e.target)!,
            selected: false
          }));

        // Deseleziona tutti i nodi esistenti e aggiungi i nuovi
        setNodes((nds) => [
          ...nds.map((n) => ({ ...n, selected: false })),
          ...newNodes
        ]);
        setEdges((eds) => [...eds, ...newEdges]);

        toast.success(`Pasted ${newNodes.length} node(s)`);

        // Ripristina il contenuto originale della clipboard
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(originalClipboard);
          }
        } catch (err) {
          console.warn('Could not restore clipboard:', err);
        }

        // Pulisci la cache dopo l'uso
        clipboardCache.current = null;
      } catch (err) {
        toast.error('Failed to paste nodes');
        console.error('Paste error:', err);
      }
    },
    [setNodes, setEdges]
  );

  const handleDeleteSelection = useCallback(() => {
    if (!canEditSnapshot()) return;
    const selectedNodeIds = nodes.filter((n) => n.selected).map((n) => n.id);
    const selectedEdgeIds = edges.filter((e) => e.selected).map((e) => e.id);

    setNodes((nds) => nds.filter((n) => !selectedNodeIds.includes(n.id)));
    setEdges((eds) =>
      eds.filter(
        (e) =>
          !selectedEdgeIds.includes(e.id) &&
          !selectedNodeIds.includes(e.source) &&
          !selectedNodeIds.includes(e.target)
      )
    );

    const count = selectedNodeIds.length + selectedEdgeIds.length;
    toast.success(`Deleted ${count} element(s)`);
  }, [canEditSnapshot, nodes, edges, setNodes, setEdges]);

  const mergeEligibilityForCheckedSelection = useMemo(() => {
    void graphNodeDataSignature;
    void graphEdgeTopologySignature;
    return getMergeEligibility({
      selectedNodeIds: checkedGraphNodeIds,
      nodes: graphNodesSnapshotRef.current as any,
      edges: graphEdgesSnapshotRef.current
    });
  }, [
    checkedGraphNodeIds,
    graphEdgeTopologySignature,
    graphNodeDataSignature
  ]);

  const [mergeDialog, setMergeDialog] = useState<{
    nodeIds: string[];
    primaryNodeId: string;
    nodeType: string | null;
  } | null>(null);

  const canUnmergeCheckedSelection = useMemo(() => {
    void graphNodeDataSignature;
    if (checkedGraphNodeIds.length !== 1) return false;
    const only = graphNodesSnapshotRef.current.find(
      (node) => String(node.id) === String(checkedGraphNodeIds[0])
    );
    return Boolean(only && canUnmergeNode(only as any));
  }, [checkedGraphNodeIds, graphNodeDataSignature]);

  const handleMergeCheckedSelection = useCallback(() => {
    if (checkedGraphNodeIds.length <= 1) return;
    if (!mergeEligibilityForCheckedSelection.canMerge) {
      toast.error(mergeEligibilityForCheckedSelection.reason ?? 'Merge not available');
      return;
    }

    setMergeDialog({
      nodeIds: checkedGraphNodeIds.map(String),
      primaryNodeId: String(checkedGraphNodeIds[0]),
      nodeType: mergeEligibilityForCheckedSelection.nodeType
    });
  }, [checkedGraphNodeIds, graphViewMode, mergeEligibilityForCheckedSelection]);

  const handleConfirmMerge = useCallback(() => {
    if (!mergeDialog) return;

    const eligibility = getMergeEligibility({
      selectedNodeIds: mergeDialog.nodeIds,
      nodes: nodes as any,
      edges
    });
    if (!eligibility.canMerge) {
      toast.error(eligibility.reason ?? 'Merge not available');
      setMergeDialog(null);
      return;
    }

    try {
      const { nextNodes, nextEdges } = mergeNodes({
        selectedNodeIds: mergeDialog.nodeIds,
        primaryNodeId: mergeDialog.primaryNodeId,
        nodes: nodes as any,
        edges
      });
      setNodes(nextNodes as any);
      setEdges(nextEdges);
      toast.success(`Merged ${mergeDialog.nodeIds.length} nodes`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Merge failed');
    } finally {
      setMergeDialog(null);
    }
  }, [edges, graphViewMode, mergeDialog, nodes, setEdges, setNodes]);

  const handleUnmergeCheckedSelection = useCallback(() => {
    if (checkedGraphNodeIds.length !== 1) return;
    const nodeId = String(checkedGraphNodeIds[0]);
    try {
      const { nextNodes, nextEdges, restoredNodeIds } = unmergeNode({
        nodeId,
        nodes: nodes as any,
        edges
      });
      setNodes(nextNodes as any);
      setEdges(nextEdges);
      toast.success(`Unmerged ${restoredNodeIds.length} nodes`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unmerge failed');
    }
  }, [checkedGraphNodeIds, edges, graphViewMode, nodes, setEdges, setNodes]);

  useGraphKeyboardShortcuts({
    isActive: tabIsActive,
    canEditSnapshot,
    nodes,
    undo,
    redo,
    toggleSidebar,
    toggleRightPanel,
    toggleConsole: () => handleBottomTabClick('console'),
    openCommandPalette,
    handleCopySelection,
    handleDeleteSelection,
    handleMergeSelection: handleMergeCheckedSelection
  });

  // Traccia conteggio nodi (l'auto-layout NON riarrangia tutto automaticamente)
  // Il posizionamento intelligente è ora gestito da osint-node.tsx con positionNewNodesWithoutOverlap
  useEffect(() => {
    prevNodesCount.current = nodes.length;
  }, [nodes.length]);

  // Pulisci handle ID obsoleti dagli edge esistenti
  useEffect(() => {
    setEdges((eds) =>
      eds.map((e) => ({
        ...e,
        sourceHandle: e.sourceHandle?.replace('-target', '') || null,
        targetHandle: e.targetHandle?.replace('-target', '') || null,
        // Safety: assicura arrow marker sugli edge se manca (free/auto-layout)
        markerEnd:
          e.markerEnd ??
          ({
            type: MarkerType.ArrowClosed,
            width: 10,
            height: 10
          } as any)
      }))
    );
  }, [setEdges]);

  const isDark = mounted && resolvedTheme === 'dark';
  const isGraphEmpty = nodes.length === 0 && edges.length === 0;

  useEffect(() => {
    if (isLoadingGraph) return;
    if (!nodes.length) return;
    if (typeof window === 'undefined') return;

    let cancelled = false;

    function shouldAutoColorNode(meta: any) {
      if (meta?.autoColorFromLogo === true) return false;
      const hasManualCustomColor =
        typeof meta?.customColor === 'string' &&
        Boolean(String(meta.customColor).trim()) &&
        meta?.autoColorFromLogo !== true;
      if (hasManualCustomColor) return false;
      return true;
    }

    function scheduleApply() {
      if (autoColorRafRef.current) cancelAnimationFrame(autoColorRafRef.current);
      autoColorRafRef.current = requestAnimationFrame(() => {
        autoColorRafRef.current = null;
        const pending = pendingAutoColorByNodeIdRef.current;
        if (!pending.size) return;
        const pendingIds = new Set(pending.keys());
        let didChange = false;

        setNodes((nds) =>
          nds.map((n) => {
            if (!pendingIds.has(n.id)) return n;
            const entry = pending.get(n.id);
            if (!entry) return n;
            const prevMeta: any = (n.data as any)?.metadata ?? {};
            if (!shouldAutoColorNode(prevMeta)) return n;

            const hasManualHeaderTextColor =
              typeof prevMeta.headerTextColor === 'string' &&
              Boolean(prevMeta.headerTextColor) &&
              prevMeta.autoHeaderTextColorFromLogo !== true;
            const nextHeaderText = hasManualHeaderTextColor
              ? prevMeta.headerTextColor
              : pickReadableHeaderTextColor({ accentHex: entry.colorHex, isDark }) ?? undefined;

            const isSame =
              prevMeta.customColor === entry.colorHex &&
              prevMeta.autoColorFromLogo === true &&
              (hasManualHeaderTextColor ||
                (prevMeta.headerTextColor === nextHeaderText &&
                  prevMeta.autoHeaderTextColorFromLogo === true));
            if (isSame) return n;

            didChange = true;
            return {
              ...n,
              data: {
                ...(n.data as any),
                metadata: {
                  ...prevMeta,
                  customColor: entry.colorHex,
                  autoColorFromLogo: true,
                  ...(hasManualHeaderTextColor
                    ? {}
                    : {
                        headerTextColor: nextHeaderText,
                        autoHeaderTextColorFromLogo: true
                      })
                }
              }
            };
          })
        );

        pending.clear();
        if (!didChange) return;
      });
    }

    async function run() {
      // group by logoUrl (domain)
      const idsByLogoUrl = new Map<string, string[]>();
      for (const node of nodes) {
        const data = node.data as OSINTNodeData | undefined;
        if (!data) continue;
        const meta: any = data.metadata ?? {};
        if (!shouldAutoColorNode(meta)) continue;
        const logoUrl = computeLogoUrl({
          type: String(data.type ?? ''),
          label: String(data.label ?? ''),
          metadata: meta
        });
        if (!logoUrl) continue;
        const list = idsByLogoUrl.get(logoUrl);
        if (list) list.push(node.id);
        else idsByLogoUrl.set(logoUrl, [node.id]);
      }

      function parseHex6(input: string) {
        const raw = String(input ?? '').trim();
        const m = /^#([0-9a-fA-F]{6})$/.exec(raw);
        if (!m) return null;
        const hex = m[1] ?? '';
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;
        return { r, g, b };
      }

      function relLuminance(rgb: { r: number; g: number; b: number }) {
        function toLinear(v: number) {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        }
        const r = toLinear(rgb.r);
        const g = toLinear(rgb.g);
        const b = toLinear(rgb.b);
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      }

      function contrastRatio(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) {
        const la = relLuminance(a);
        const lb = relLuminance(b);
        const lighter = Math.max(la, lb);
        const darker = Math.min(la, lb);
        return (lighter + 0.05) / (darker + 0.05);
      }

      function mixRgb(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }, t: number) {
        const clamped = Math.min(1, Math.max(0, t));
        return {
          r: Math.round(a.r + (b.r - a.r) * clamped),
          g: Math.round(a.g + (b.g - a.g) * clamped),
          b: Math.round(a.b + (b.b - a.b) * clamped)
        };
      }

      function rgbToHex(rgb: { r: number; g: number; b: number }) {
        const toHex = (v: number) => v.toString(16).padStart(2, '0');
        return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
      }

      function pickNodeFillFromLogo(avgHex: string, isSolidLogo: boolean) {
        if (!isSolidLogo) return avgHex;
        const rgb = parseHex6(avgHex);
        if (!rgb) return avgHex;
        // Se il logo è “piatto”, usare lo stesso colore come fill lo rende invisibile.
        // Scegliamo quindi un colore con luminanza opposta e contrasto sufficiente rispetto al logo.
        const white = { r: 255, g: 255, b: 255 };
        const black = { r: 0, g: 0, b: 0 };
        const lum = relLuminance(rgb);
        const target = lum > 0.55 ? black : white;
        // Prova con diversi mix finché raggiungiamo contrasto minimo
        for (const t of [0.55, 0.65, 0.75, 0.85]) {
          const candidate = mixRgb(rgb, target, t);
          const cr = contrastRatio(rgb, candidate);
          if (cr >= 2.2) return rgbToHex(candidate);
        }
        // fallback
        return rgbToHex(mixRgb(rgb, target, 0.75));
      }

      for (const entry of Array.from(idsByLogoUrl.entries())) {
        if (cancelled) return;
        const logoUrl = entry[0];
        const nodeIds = entry[1];
        const cachedAvg = getCachedLogoAverageColor(logoUrl);
        const cachedSolid = getCachedLogoIsSolid(logoUrl);
        const info =
          cachedAvg && typeof cachedSolid === 'boolean'
            ? { avgHex: cachedAvg, isSolid: cachedSolid }
            : await getOrComputeCachedLogoColorInfo(logoUrl);
        const avg = info?.avgHex ?? cachedAvg ?? (await getOrComputeCachedLogoAverageColor(logoUrl));
        if (!avg) continue;
        const isSolid = info?.isSolid ?? getCachedLogoIsSolid(logoUrl) ?? false;
        const fillHex = pickNodeFillFromLogo(avg, isSolid);
        for (const id of nodeIds) pendingAutoColorByNodeIdRef.current.set(id, { colorHex: fillHex });
        scheduleApply();
      }
    }

    void run();
    return () => {
      cancelled = true;
      if (autoColorRafRef.current) cancelAnimationFrame(autoColorRafRef.current);
      autoColorRafRef.current = null;
      pendingAutoColorByNodeIdRef.current.clear();
    };
  }, [isLoadingGraph, nodes, isDark, setNodes]);

  const handleRelationalNodeClick = useCallback(
    (_event: any, node: FlowNode) => {
      if (!tabIsActive) return;
      if (graphViewMode !== 'analysis') return;
      if (!node) return;

      const n: any = node as any;
      const data: any = n.data ?? {};
      const width =
        n.width ||
        n.measured?.width ||
        (typeof n.style?.width === 'number' ? n.style.width : null) ||
        data._relationalSize ||
        20;
      const height =
        n.height ||
        n.measured?.height ||
        (typeof n.style?.height === 'number' ? n.style.height : null) ||
        data._relationalSize ||
        20;
      const pos = n.positionAbsolute ?? n.position ?? { x: 0, y: 0 };
      const centerX = Number(pos.x ?? 0) + Number(width) / 2;
      const centerY = Number(pos.y ?? 0) + Number(height) / 2;
      const zoom =
        typeof (reactFlowInstance as any).getZoom === 'function'
          ? (reactFlowInstance as any).getZoom()
          : (reactFlowInstance as any).getViewport?.().zoom;

      requestAnimationFrame(() => {
        try {
          reactFlowInstance.setCenter(centerX, centerY, {
            duration: 260,
            zoom: typeof zoom === 'number' ? zoom : undefined
          });
        } catch {}
      });
    },
    [graphViewMode, tabIsActive, reactFlowInstance]
  );

  const analysisLayout = useAnalysisLayoutState({
    graphId,
    isActive: tabIsActive && graphViewMode === 'analysis',
    readOnly: writeGuard.blocked,
    canEditSnapshot,
    nodes: nodes as any,
    edges: edges as any
  });
  analysisLayoutRef.current = analysisLayout;

  // Entrando in FREE: normalizza sempre gli handle su {top,right,bottom,left}
  // e rimuove eventuali flags di locked per evitare bug "ereditati".
  const prevModeRef = useRef<'free' | 'locked' | 'analysis' | 'map'>(graphViewMode);
  const lastFreeExitAtRef = useRef<number | null>(null);
  const freeResyncTimeoutRef = useRef<number | null>(null);
  useEffect(() => {
    const prev = prevModeRef.current;
    prevModeRef.current = graphViewMode;
    if (prev === 'free' && graphViewMode !== 'free') {
      lastFreeExitAtRef.current = Date.now();
    }
    if (prev === 'free' || graphViewMode !== 'free') return;

    setEdges((prevEdges) =>
      (prevEdges as any[]).map((e) => {
        const data = (e.data ?? {}) as any;
        if (data?._layoutMode || data?._lockedAxis) {
          const { _layoutMode, _lockedAxis, ...rest } = data;
          return { ...e, data: rest };
        }
        return e;
      })
    );
  }, [graphViewMode, setEdges]);

  // In FREE: dopo "tempo lontano" (soprattutto con grafi grandi), forziamo un resync leggero
  // per prevenire edge glitch/corruzione che a volte si risolve passando a locked e tornando.
  useEffect(() => {
    if (!isActive) return;
    if (graphViewMode !== 'free') return;
    if (!nodes.length) return;

    const now = Date.now();
    const lastExit = lastFreeExitAtRef.current;
    const awayMs = typeof lastExit === 'number' ? now - lastExit : 0;

    const RESYNC_MIN_AWAY_MS = 20_000;
    if (awayMs < RESYNC_MIN_AWAY_MS) return;

    if (freeResyncTimeoutRef.current) window.clearTimeout(freeResyncTimeoutRef.current);

    // Delay: lascia stabilizzare la UI dopo lo switch di modalità, poi ricrea nodes/edges (idempotente)
    freeResyncTimeoutRef.current = window.setTimeout(() => {
      try {
        const vp =
          typeof (reactFlowInstance as any)?.getViewport === 'function'
            ? (reactFlowInstance as any).getViewport()
            : null;

        setNodes((nds) =>
          nds.map((n) => ({
            ...n,
            position: { ...n.position },
            data: { ...(n.data as any) }
          }))
        );
        setEdges((eds) =>
          eds.map((e) => ({
            ...e,
            data: e.data ? { ...(e.data as any) } : e.data
          }))
        );

        // Ripristina viewport (evita jump/fitView impliciti)
        if (vp && typeof (reactFlowInstance as any)?.setViewport === 'function') {
          requestAnimationFrame(() => {
            try {
              (reactFlowInstance as any).setViewport(vp, { duration: 0 });
            } catch {}
          });
        }
      } catch {
        // no-op: fallback silenzioso
      }
    }, 450);

    return () => {
      if (freeResyncTimeoutRef.current) window.clearTimeout(freeResyncTimeoutRef.current);
      freeResyncTimeoutRef.current = null;
    };
  }, [isActive, graphViewMode, nodes.length, reactFlowInstance, setNodes, setEdges]);

  const shouldFitViewAfterAnalysisLayoutRef = useRef(false);

  // Funzione per applicare il layout manualmente
  const applyLayout = useCallback(
    (next?: Partial<LayoutOptions>) => {
      if (!canEditSnapshot()) return;
      if (nodes.length === 0) return;

      const direction = next?.direction ?? layoutSettings.direction;
      const spacingPreset =
        next?.spacingPreset ?? layoutSettings.spacingPreset;
      const quality = next?.quality ?? layoutSettings.quality;
      const considerEdgeLabels =
        typeof next?.considerEdgeLabels === 'boolean'
          ? next.considerEdgeLabels
          : layoutSettings.considerEdgeLabels;

      const { nodes: layoutedNodes, edges: layoutedEdges } =
        getLayoutedElements(nodes, edges, {
          direction,
          spacingPreset,
          quality,
          considerEdgeLabels
        });

      setNodes(layoutedNodes);
      setEdges(layoutedEdges);
      setLayoutSettings((prev) => ({
        ...prev,
        direction,
        spacingPreset,
        quality,
        considerEdgeLabels
      }));

      // Persist new node positions when layout is applied in Manual mode
      if (graphViewMode === 'free') {
        const nextManualPositions: ManualNodePositionsById = {};
        for (const n of layoutedNodes as any[]) {
          const x = Number(n?.position?.x ?? 0);
          const y = Number(n?.position?.y ?? 0);
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
          nextManualPositions[String(n.id)] = { x, y };
        }
        manualNodePositionsByIdRef.current = nextManualPositions;
        schedulePersistManualNodePositions();

        requestAnimationFrame(() => {
          saveStatus?.triggerManualSave?.();
        });
      }

      // Fit view dopo il layout per vedere tutto il grafo
      setTimeout(() => {
        reactFlowInstance.fitView({
          padding: 0.15,
          maxZoom: AUTO_FIT_MAX_ZOOM,
          duration: 300
        });
      }, 50);

      toast.success(`Layout applied (${direction})`);
    },
    [
      nodes,
      edges,
      layoutSettings,
      canEditSnapshot,
      setNodes,
      setEdges,
      reactFlowInstance,
      graphViewMode,
      saveStatus,
      schedulePersistManualNodePositions
    ]
  );

  const applyAnalysisLayout = useCallback(
    (next?: Partial<AnalysisLayoutOptions>) => {
      if (!canEditSnapshot()) return;
      if (!next || Object.keys(next).length === 0) return;
      shouldFitViewAfterAnalysisLayoutRef.current = true;
      analysisLayout.applyLayout(next);
    },
    [analysisLayout, canEditSnapshot]
  );

  // In Analysis: dopo aver applicato (force/hierarchy) facciamo fitView a layout finito.
  useEffect(() => {
    if (!tabIsActive) return;
    if (graphViewMode !== 'analysis') return;
    if (!shouldFitViewAfterAnalysisLayoutRef.current) return;

    const progress = analysisLayout.layoutProgress;
    if (!progress) return;

    // Se il layout si è fermato in errore, evita di "posticipare" un fitView a caso.
    if (!progress.isRunning && progress.stage !== 'done') {
      shouldFitViewAfterAnalysisLayoutRef.current = false;
      return;
    }

    if (progress.isRunning) return;
    if (progress.stage !== 'done') return;

    shouldFitViewAfterAnalysisLayoutRef.current = false;

    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        analysisGraphApiRef.current?.fitView();
      });
    });

    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [
    tabIsActive,
    graphViewMode,
    analysisLayout.layoutProgress?.isRunning,
    analysisLayout.layoutProgress?.stage,
    analysisLayout.layoutProgress
  ]);

  // Verifica se due nodi sono già collegati (in qualsiasi direzione)
  const areNodesConnected = useCallback(
    (sourceId: string | null, targetId: string | null) => {
      if (!sourceId || !targetId) return false;
      return edges.some(
        (e) =>
          (e.source === sourceId && e.target === targetId) ||
          (e.source === targetId && e.target === sourceId)
      );
    },
    [edges]
  );

  // Validazione connessione - impedisce connessioni duplicate e self-loop
  const isValidConnection = useCallback(
    (connection: Connection) => {
      const { source, target } = connection;

      // Non permettere self-loop
      if (source === target) return false;

      // Non permettere connessioni duplicate
      if (areNodesConnected(source, target)) return false;

      return true;
    },
    [areNodesConnected]
  );

  // --- Connessione Standard ---
  const onConnect = useCallback(
    (params: Connection) => {
      // In relational non vogliamo “inquinare” il grafo canonico con handle floating:
      // l'edge viene creato nel grafo canonico come edge standard (osint), e in relational
      // verrà renderizzato come floating dal layout.
      const normalizedParams =
        graphViewMode === 'analysis'
          ? { ...params, sourceHandle: null, targetHandle: null }
          : params;
      // Pulisci l'anteprima del nodo quando connetti a un nodo esistente
      connectingNodeId.current = null;
      sourceNodePosition.current = null;
      setPreviewNodePosition(null);
      setPreviewNodeOffset({ x: 0, y: 0 });
      if (previewNodeTimeout.current) {
        clearTimeout(previewNodeTimeout.current);
        previewNodeTimeout.current = null;
      }
      if (nodeTypeRotationInterval.current) {
        clearInterval(nodeTypeRotationInterval.current);
        nodeTypeRotationInterval.current = null;
      }

      // Verifica se la connessione è valida
      if (!isValidConnection(normalizedParams)) {
        toast.error('These nodes are already connected');
        return;
      }

      // Genera un ID unico per l'edge
      const edgeId = `e-${normalizedParams.source}-${normalizedParams.target}-${Date.now()}`;

      // Normalizza gli handle ID (rimuovi -target se presente)
      const sourceHandle =
        normalizedParams.sourceHandle?.replace('-target', '') || null;
      const targetHandle =
        normalizedParams.targetHandle?.replace('-target', '') || null;

      setEdges((eds) =>
        addEdge(
          {
            ...normalizedParams,
            id: edgeId,
            sourceHandle,
            targetHandle,
            type: 'osint',
            markerEnd: {
              type: MarkerType.ArrowClosed,
              width: 10,
              height: 10
            },
            data: {
              relationship: 'related_to',
              edgeType: currentEdgeType,
              label: '',
              strokeWidth: 2,
              dashed: false,
              hideDirection: false,
              bidirectional: false
            } as OSINTEdgeData
          },
          eds
        )
      );
      toast.success('Connection created');
    },
    [graphViewMode, setEdges, currentEdgeType, isValidConnection]
  );

  // --- Riconnessione Edge ---
  const onConnectStart = useCallback(
    (
      event: React.MouseEvent | React.TouchEvent,
      { nodeId, handleId }: { nodeId: string | null; handleId: string | null }
    ) => {
      if (nodeId) {
        connectingNodeId.current = { nodeId, handleId };

        // Trova e salva la posizione dell'handle specifico del nodo di partenza
        const sourceNode = nodes.find((n) => n.id === nodeId);
        if (sourceNode) {
          const nodeWidth = sourceNode.width || 200;
          const nodeHeight = sourceNode.height || 100;

          // Calcola la posizione dell'handle specifico
          let handleX = sourceNode.position.x + nodeWidth / 2; // default: centro
          let handleY = sourceNode.position.y + nodeHeight / 2; // default: centro

          // Aggiusta in base all'handle da cui parte
          if (handleId === 'top') {
            handleY = sourceNode.position.y; // Top edge
          } else if (handleId === 'right') {
            handleX = sourceNode.position.x + nodeWidth; // Right edge
          } else if (handleId === 'bottom') {
            handleY = sourceNode.position.y + nodeHeight; // Bottom edge
          } else if (handleId === 'left') {
            handleX = sourceNode.position.x; // Left edge
          }

          sourceNodePosition.current = { x: handleX, y: handleY };
        }

        // Funzione per ottenere un tipo di nodo random (escludendo nodi speciali e recenti)
        const getRandomNodeType = () => {
          const availableTypes = nodeTypeOptions
            .filter(
              (opt) =>
                opt.value !== 'ai_insight' &&
                opt.value !== 'group' &&
                opt.value !== 'maps' &&
                opt.value !== 'note' &&
                opt.value !== 'media_url'
            )
            .map((opt) => opt.value as OSINTNodeData['type']);

          // Filtra i tipi recenti (ultimi 3)
          const recentTypes = recentNodeTypes.current.slice(-3);
          const nonRecentTypes = availableTypes.filter(
            (type) => !recentTypes.includes(type)
          );

          // Se ci sono tipi non recenti, scegli da quelli, altrimenti da tutti
          const typesToChooseFrom =
            nonRecentTypes.length > 0 ? nonRecentTypes : availableTypes;
          const selectedType =
            typesToChooseFrom[
              Math.floor(Math.random() * typesToChooseFrom.length)
            ] || 'person';

          // Aggiungi ai tipi recenti
          recentNodeTypes.current.push(selectedType);
          if (recentNodeTypes.current.length > 5) {
            recentNodeTypes.current.shift(); // Mantieni solo gli ultimi 5
          }

          return selectedType;
        };

        // Imposta come primo tipo quello dell'ultimo nodo aggiunto
        setSuggestedNodeType(lastAddedNodeType.current);

        // Avvia timeout per mostrare preview dopo 300ms
        previewNodeTimeout.current = setTimeout(() => {
          setPreviewNodePosition({ x: 0, y: 0 }); // Inizializza, sarà aggiornato dal mousemove
          setPreviewNodeOffset({ x: 80, y: 0 }); // Offset iniziale (a destra)

          // Avvia rotazione del tipo di nodo ogni 1 secondo
          nodeTypeRotationInterval.current = setInterval(() => {
            setSuggestedNodeType(getRandomNodeType());
          }, 1000);
        }, 300);
      }
    },
    [nodes]
  );

  useConnectionPreview({
    isActive,
    connectingNodeId,
    sourceNodePosition,
    previewNodePosition,
    setPreviewNodePosition,
    setPreviewNodeOffset,
    reactFlowInstance
  });

  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent) => {
      // Pulisci sempre timeout e interval
      if (previewNodeTimeout.current) {
        clearTimeout(previewNodeTimeout.current);
        previewNodeTimeout.current = null;
      }
      if (nodeTypeRotationInterval.current) {
        clearInterval(nodeTypeRotationInterval.current);
        nodeTypeRotationInterval.current = null;
      }

      // Se connectingNodeId è già null, significa che onConnect è già stato chiamato
      // (connessione a nodo esistente) - pulisci solo l'anteprima e esci
      if (!connectingNodeId.current) {
        setPreviewNodePosition(null);
        setPreviewNodeOffset({ x: 0, y: 0 });
        sourceNodePosition.current = null;
        return;
      }

      const targetIsPane = (event.target as HTMLElement).classList.contains(
        'react-flow__pane'
      );

      // Crea nuovo nodo SOLO se rilasciato sul pane E c'è un'anteprima attiva
      if (targetIsPane && previewNodePosition) {
        const sourceId = connectingNodeId.current.nodeId;
        const source = reactFlowInstance.getNode(sourceId);

        // In free mode il nodo deve finire dove rilasci il mouse (UX naturale).
        // In locked mode usiamo un posizionamento deterministico vicino al padre,
        // così il ritorno in free non "teletrasporta" nodi in posizioni strane.
        const manualAddDirection: 'down' | 'right' =
          lockedAxis === 'vertical' ? 'right' : 'down';

        // Converti l'offset da screen coordinates a flow coordinates (serve per posizionamento "drop")
        const flowOffsetX = previewNodeOffset.x / reactFlowInstance.getZoom();
        const flowOffsetY = previewNodeOffset.y / reactFlowInstance.getZoom();
        const droppedPosition = {
          x: previewNodePosition.x + flowOffsetX,
          y: previewNodePosition.y + flowOffsetY
        };

        // Crea un nuovo nodo generico nella posizione del preview
        const nodeId = `node-${Date.now()}`;
        const newNode: FlowNode<OSINTNodeData> = {
          id: nodeId,
          type: 'osint',
          position: droppedPosition,
          selected: true,
          data: {
            label: '',
            type: suggestedNodeType, // Tipo suggerito dalle transform disponibili
            metadata: {
              _autoEdit: true
            }
          }
        };

        // Salva l'ultimo tipo aggiunto
        lastAddedNodeType.current = suggestedNodeType;

        const positioned =
          graphViewMode === 'locked'
            ? (positionTransformResultNodes({
                existingNodes: nodes,
                newNodes: [newNode],
                anchorNodeId: sourceId,
                anchorPosition: source?.position,
                direction: manualAddDirection,
                spacingPreset: layoutSettings.spacingPreset
              }) as FlowNode<OSINTNodeData>[])
            : [];

        // Aggiungi il nodo
        setNodes((nds) => [
          ...nds.map((n) => ({ ...n, selected: false })),
          ...(positioned.length ? positioned : [newNode])
        ]);

        if (graphViewMode === 'analysis') {
          setRelationalLabelEditor({
            nodeId,
            initialLabel: '',
            title: 'Set label',
          description: 'Enter a label for the new node.',
          shouldPanOnSubmit: true
          });
        }

        // Crea l'edge di collegamento
        const edgeId = `e-${connectingNodeId.current.nodeId}-${nodeId}-${Date.now()}`;
        const newEdge: Edge = {
          id: edgeId,
          source: sourceId,
          target: nodeId,
          sourceHandle: connectingNodeId.current.handleId,
          type: 'osint',
          data: {
            label: 'related to',
            relation: 'custom'
          },
          markerEnd: { type: MarkerType.ArrowClosed }
        };

        setEdges((eds) => [...eds, newEdge]);
      }

      // Cleanup finale
      connectingNodeId.current = null;
      sourceNodePosition.current = null;
      setPreviewNodePosition(null);
      setPreviewNodeOffset({ x: 0, y: 0 });
    },
    [
      reactFlowInstance,
      setNodes,
      setEdges,
      graphViewMode,
      lockedAxis,
      layoutSettings.spacingPreset,
      previewNodePosition,
      previewNodeOffset,
      suggestedNodeType,
      nodes
    ]
  );

  const onReconnectStart = useCallback(() => {
    edgeReconnectSuccessful.current = false;
  }, []);

  const onReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      edgeReconnectSuccessful.current = true;
      setEdges((els) => reconnectEdge(oldEdge, newConnection, els));
      toast.success('Connection updated');
    },
    [setEdges]
  );

  const onReconnectEnd = useCallback(
    (_: MouseEvent | TouchEvent, edge: Edge) => {
      if (!edgeReconnectSuccessful.current) {
        setEdges((eds) => eds.filter((e) => e.id !== edge.id));
        toast.info('Connection removed');
      }
      edgeReconnectSuccessful.current = true;
    },
    [setEdges]
  );

  // --- Gestione Nodi ---
  const addNode = useCallback(
    (type: OSINTNodeData['type'], position?: { x: number; y: number }) => {
      const typeLabel =
        nodeTypeOptions.find((o) => o.value === type)?.label || type;

      const def =
        (type as NodeType) in nodeTypeByType
          ? nodeTypeByType[type as NodeType]
          : undefined;
      const initialSize = def?.defaults?.initialSize;
      const zIndex = def?.defaults?.zIndex;
      const defaultLabel = def?.defaults?.label;
      const defaultMetadata = def?.defaults?.metadata;
      const shouldAutoEdit = graphViewMode !== 'analysis';

      const nodeId = `node-${Date.now()}`;

      // Calcola posizione: centro della viewport se non specificata
      let nodePosition = position;
      if (!nodePosition) {
        if (graphViewMode === 'analysis' && analysisGraphApiRef.current) {
          const p = analysisGraphApiRef.current.screenToGraph({
            x: window.innerWidth / 2,
            y: window.innerHeight / 2
          });
          nodePosition = { x: p.x - 100, y: p.y - 50 };
        } else {
          const { x, y, zoom } = reactFlowInstance.getViewport();
          const centerX = -x / zoom + window.innerWidth / 2 / zoom;
          const centerY = -y / zoom + window.innerHeight / 2 / zoom;
          nodePosition = { x: centerX - 100, y: centerY - 50 };
        }
      }

      // Crea il nodo temporaneo
      let newNode: FlowNode<OSINTNodeData> = {
        id: nodeId,
        type: 'osint',
        position: nodePosition,
        selected: true, // Seleziona automaticamente il nodo
        data: {
          label: defaultLabel ??
            (type === 'group' ? 'Group' :
             ['document', 'pdf', 'docx', 'xlsx', 'txt', 'csv', 'json'].includes(type) ? 'File' :
             ''),
          type: type,
          metadata:
            defaultMetadata ??
            (type === 'group'
              ? {
                  groupColor: 'rgba(59, 130, 246, 0.08)',
                  groupBorderColor: '#3b82f6',
                  labelVisible: true,
                  _autoEdit: shouldAutoEdit
                }
              : {
                  _autoEdit: shouldAutoEdit
                })
        },
        ...(initialSize && { style: { width: initialSize.width, height: initialSize.height } }),
        ...(typeof zIndex === 'number' && { zIndex })
      };

      // Aggiusta posizione se si sovrappone con altri nodi
      newNode = adjustNodePositionIfOverlapping(newNode, nodes);

      // Salva l'ultimo tipo aggiunto
      lastAddedNodeType.current = type;

      // Deseleziona tutti gli altri nodi e aggiungi il nuovo
      setNodes((nds) => [
        ...nds.map((n) => ({ ...n, selected: false })),
        newNode
      ]);

      if (graphViewMode === 'analysis') {
        setRelationalLabelEditor({
          nodeId,
          initialLabel: String((newNode as any)?.data?.label ?? ''),
          title: 'Set label',
          description: 'Enter a label for the new node.',
          shouldPanOnSubmit: true
        });
      }

      toast.success(`${typeLabel} node added`);
    },
    [setNodes, reactFlowInstance, nodes, graphViewMode]
  );

  const { isDraggingOver, dropPositionRef, handleDragOver, handleDragLeave, handleDrop } =
    useGraphFileDrop({
      isActive: isActive && graphViewMode !== 'analysis',
      dndNodeTypeMime: DND_NODE_TYPE_MIME,
      reactFlowInstance,
      addNode,
      setNodes,
      setEdges
    });

  // Add multiple entities to graph (used by transform results from logger)
  const addResultsToGraph = useCallback(
    (
      allEntities: any[],
      allEdges: any[],
      source: { position: { x: number; y: number }; nodeId?: string },
      selectedIds: string[]
    ) => {
      console.log('📊 addResultsToGraph called:', {
        allEntities: allEntities.length,
        allEdges: allEdges.length,
        selectedIds: selectedIds.length,
        source
      });

      // Get existing node IDs to avoid duplicates
      const existingNodeIds = new Set(nodes.map((n) => n.id));
      const existingNodeIdBySignature = new Map<string, string>();
      for (const n of nodes) {
        const data: any = (n as any)?.data ?? {};
        const type = String(data?.type ?? '').trim();
        const label = String(data?.label ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
        const sig = `${type}::${label}`;
        // keep first occurrence (stable)
        if (!existingNodeIdBySignature.has(sig)) existingNodeIdBySignature.set(sig, String(n.id));
      }

      function computeEntitySignature(entity: any) {
        const type = String(entity?.type ?? '').trim();
        const label = String(entity?.label || entity?.value || '')
          .trim()
          .replace(/\s+/g, ' ')
          .toLowerCase();
        return `${type}::${label}`;
      }

      const entityById = new Map<string, any>();
      for (const e of allEntities) entityById.set(String(e?.id ?? ''), e);

      const selectedEntityIds = selectedIds
        .map((id) => String(id))
        .filter((id) => Boolean(id) && entityById.has(id));

      // Entities selected from results that are NOT already in the graph (id or signature)
      const selectedEntities = selectedEntityIds
        .map((id) => entityById.get(id))
        .filter(Boolean)
        .filter((e) => {
          const id = String(e?.id ?? '');
          if (!id) return false;
          if (existingNodeIds.has(id)) return false;
          const sig = computeEntitySignature(e);
          return !existingNodeIdBySignature.has(sig);
        });

      // For selected entities already present by signature, map result-id -> existing node id.
      const existingSelectedIdMap = new Map<string, string>();
      for (const id of selectedEntityIds) {
        if (existingNodeIds.has(id)) {
          existingSelectedIdMap.set(id, id);
          continue;
        }
        const e = entityById.get(id);
        const sig = e ? computeEntitySignature(e) : '';
        const existingId = sig ? existingNodeIdBySignature.get(sig) : undefined;
        if (existingId) existingSelectedIdMap.set(id, existingId);
      }

      console.log('🔍 Filtering nodes:', {
        selected: selectedIds.length,
        alreadyInGraph: selectedIds.filter((id) => existingNodeIds.has(id))
          .length,
        toAdd: selectedEntities.length,
        existingSelectedBySignature: Array.from(existingSelectedIdMap.values()).filter(
          (v) => !selectedEntityIds.includes(v)
        ).length
      });

      function isHex6Color(input: unknown) {
        return /^#([0-9a-fA-F]{6})$/.test(String(input ?? '').trim());
      }

      function sanitizeMetadata(input: unknown) {
        const meta: any =
          input && typeof input === 'object' && !Array.isArray(input) ? { ...(input as any) } : {};
        // Se plugin/transform mette customColor in formato non-hex, rompe la UI (template `${customColor}15`).
        if (Object.prototype.hasOwnProperty.call(meta, 'customColor')) {
          const c = String(meta.customColor ?? '').trim();
          if (!isHex6Color(c)) delete meta.customColor;
          else meta.customColor = c;
        }
        if (Object.prototype.hasOwnProperty.call(meta, 'headerTextColor')) {
          const c = String(meta.headerTextColor ?? '').trim();
          if (!isHex6Color(c)) delete meta.headerTextColor;
          else meta.headerTextColor = c;
        }
        return meta;
      }

      const FILE_NODE_TYPES = new Set([
        'document',
        'pdf',
        'docx',
        'xlsx',
        'txt',
        'csv',
        'json'
      ]);

      function normalizeNodeType(raw: unknown): OSINTNodeData['type'] {
        const t = String(raw ?? '').trim();
        // External/custom plugins might use `file` as a generic type.
        if (t === 'file') return 'document';
        // Allow any known node registry type; otherwise fallback to custom.
        return (t as any) in nodeTypeByType ? (t as any) : ('custom' as any);
      }

      function normalizeLabel(entity: any, nodeType: OSINTNodeData['type'], meta: any) {
        if (FILE_NODE_TYPES.has(String(nodeType))) {
          const filename =
            typeof meta?.filename === 'string' && meta.filename.trim()
              ? String(meta.filename).trim()
              : '';
          if (filename) return filename;
        }
        const label = String(entity?.label ?? '').trim();
        if (label) return label;
        const value = String(entity?.value ?? '').trim();
        return value;
      }

      function normalizeFileMetadata(args: { nodeType: OSINTNodeData['type']; label: string; meta: any }) {
        if (!FILE_NODE_TYPES.has(String(args.nodeType))) return args.meta;
        const next: any = { ...(args.meta ?? {}) };

        // Allow external plugins to reference an already-uploaded encrypted temp file by id.
        // If they provide `fileId` (or `tempFileId`) but not `fileUrl`, derive it.
        const fileId =
          typeof next.fileId === 'string'
            ? next.fileId
            : typeof next.tempFileId === 'string'
              ? next.tempFileId
              : '';
        if (fileId && !next.fileUrl) next.fileUrl = `/api/upload/temp/${fileId}`;

        // Best-effort extension
        if (!next.extension) {
          const fromName = String(next.filename ?? args.label ?? '').split('.').pop() ?? '';
          if (fromName) next.extension = String(fromName).toUpperCase();
        }
        return next;
      }

      // Create nodes (will be positioned by auto-layout)
      const tempNodes: FlowNode<OSINTNodeData>[] = selectedEntities.map(
        (entity) => {
          const meta = sanitizeMetadata(entity.metadata);
          const nodeType = normalizeNodeType(entity.type);
          const def =
            (nodeType as NodeType) in nodeTypeByType
              ? nodeTypeByType[nodeType as NodeType]
              : undefined;
          const dims = def?.defaults?.initialSize;
          const label = normalizeLabel(entity, nodeType, meta);
          const fileMeta = normalizeFileMetadata({ nodeType, label, meta });
          const normalizedMeta = isClassicResultType(nodeType)
            ? withEntityValue(fileMeta, entity?.value, label)
            : fileMeta;
          const size = resultNodeSize(nodeType, normalizedMeta) ?? dims;

          return {
            id: entity.id,
            type: 'osint',
            position: { x: source.position.x, y: source.position.y + 150 },
            data: {
              label,
              type: nodeType,
              metadata: normalizedMeta
            },
            ...(size ? { style: { width: size.width, height: size.height } } : {})
          };
        }
      );

      // Le posizioni "persistite" devono restare sempre quelle del grafo libero:
      // output vicino al padre, senza influenzare altri livelli.
      const positionedNodes = positionTransformResultNodes({
        existingNodes: nodes,
        newNodes: tempNodes,
        anchorNodeId: source.nodeId,
        anchorPosition: source.position,
        direction: 'down',
        spacingPreset: layoutSettings.spacingPreset
      });

      function resolveNodeId(rawId: unknown) {
        const id = String(rawId ?? '');
        if (!id) return id;
        if (existingNodeIds.has(id)) return id;
        const e = entityById.get(id);
        if (!e) return id;
        const sig = computeEntitySignature(e);
        const existingId = existingNodeIdBySignature.get(sig);
        return existingId ?? id;
      }

      // Filter edges: include only edges relevant to selection, and where BOTH endpoints exist
      // Build set of all valid node IDs (existing + new)
      const newNodeIds = new Set(selectedEntities.map((e) => e.id));
      const allValidNodeIds = new Set<string>();
      existingNodeIds.forEach((id) => allValidNodeIds.add(id));
      newNodeIds.forEach((id) => allValidNodeIds.add(id));

      const allowedRawIds = new Set<string>(selectedEntityIds);
      if (source.nodeId) allowedRawIds.add(String(source.nodeId));

      const filteredEdges = allEdges.filter((edge) => {
        const sourceId = edge.sourceId || edge.source;
        const targetId = edge.targetId || edge.target;
        const rawS = String(sourceId ?? '');
        const rawT = String(targetId ?? '');
        if (!allowedRawIds.has(rawS) && !allowedRawIds.has(rawT)) return false;
        const s = resolveNodeId(sourceId);
        const t = resolveNodeId(targetId);
        return Boolean(s) && Boolean(t) && allValidNodeIds.has(s) && allValidNodeIds.has(t);
      });

      console.log('🔗 Edge filtering:', {
        allEdges: allEdges.length,
        filteredEdges: filteredEdges.length,
        existingNodes: existingNodeIds.size,
        newNodes: newNodeIds.size
      });

      function makeUndirectedEdgeKey(a: string, b: string) {
        const x = String(a);
        const y = String(b);
        return x < y ? `${x}↔${y}` : `${y}↔${x}`;
      }

      const existingEdgeKey = new Set<string>();
      for (const e of edges) {
        const s = String((e as any)?.source ?? '');
        const t = String((e as any)?.target ?? '');
        if (!s || !t) continue;
        existingEdgeKey.add(makeUndirectedEdgeKey(s, t));
      }

      const stagedEdgeKey = new Set<string>();
      const newEdges: Edge[] = [];

      // Create edges from transform output (mapping deduped node ids)
      for (let index = 0; index < filteredEdges.length; index += 1) {
        const edge = filteredEdges[index];
        const rawSource = edge.sourceId || edge.source;
        const rawTarget = edge.targetId || edge.target;
        const sourceId = resolveNodeId(rawSource);
        const targetId = resolveNodeId(rawTarget);
        if (!sourceId || !targetId) continue;
        if (sourceId === targetId) continue;

        const key = makeUndirectedEdgeKey(sourceId, targetId);
        if (existingEdgeKey.has(key) || stagedEdgeKey.has(key)) continue;
        stagedEdgeKey.add(key);

        newEdges.push({
          id: edge.id || `edge-${Date.now()}-${index}`,
          source: sourceId,
          target: targetId,
          type: 'osint',
          markerEnd: { type: MarkerType.ArrowClosed },
          data: {
            label: edge.label,
            relationship: edge.relationship,
            edgeType: 'default',
            strokeWidth: filteredEdges.length > 3 ? 1.5 : 2,
            dashed: false,
            _opacity: filteredEdges.length > 5 ? 0.7 : 1
          }
        });
      }

      // Extra rule: if a selected node already exists in the graph (by type+value),
      // still add the edge between the transform source node and that existing node,
      // unless they are already connected.
      const sourceNodeId = String(source.nodeId ?? '');
      if (sourceNodeId) {
        existingSelectedIdMap.forEach((existingId) => {
          const targetId = String(existingId ?? '');
          if (!targetId) return;
          if (targetId === sourceNodeId) return;
          const key = makeUndirectedEdgeKey(sourceNodeId, targetId);
          if (existingEdgeKey.has(key) || stagedEdgeKey.has(key)) return;
          stagedEdgeKey.add(key);
          newEdges.push({
            id: `edge-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            source: sourceNodeId,
            target: targetId,
            type: 'osint',
            markerEnd: { type: MarkerType.ArrowClosed },
            data: {
              label: 'related to',
              relationship: 'custom',
              edgeType: 'default',
              strokeWidth: 2,
              dashed: false,
              _opacity: 1
            }
          });
        });
      }

      console.log('✅ Adding to graph:', {
        newNodes: positionedNodes.length,
        newEdges: newEdges.length
      });

      if (positionedNodes.length === 0 && newEdges.length === 0) {
        return {
          addedNodes: 0,
          addedEdges: 0,
          reason: 'Nothing to add (results already exist or are already connected).'
        };
      }

      if (positionedNodes.length)
        setNodes((nds) => [...nds, ...(positionedNodes as FlowNode<OSINTNodeData>[])]);
      if (newEdges.length) setEdges((eds) => [...eds, ...newEdges]);

      return { addedNodes: positionedNodes.length, addedEdges: newEdges.length, reason: null };
    },
    [
      setNodes,
      setEdges,
      nodes,
      graphViewMode,
      layoutSettings.spacingPreset,
      edges
    ]
  );

  const clearGraph = useCallback(() => {

      setNodes([]);
      setEdges([]);
      toast.success('Graph cleared');

  }, [setNodes, setEdges]);

  useGraphPaste({
    isActive,
    reactFlowInstance,
    setNodes,
    setEdges,
    handlePasteNodesFromCache
  });

  const exportGraph = useCallback(() => {
    exportGraphJson({ nodes, edges });
  }, [nodes, edges]);

  const importGraph = useCallback(() => {
    openGraphImportPicker({
      onImported: (payload) => {
        setNodes(payload.nodes as any);
        setEdges(payload.edges as any);
        toast.success('Graph imported');
      },
      onInvalid: () => toast.error('Import error'),
      onError: () => toast.error('Import error')
    });
  }, [setNodes, setEdges]);

  const exportPNG = useCallback(async () => {
    if (nodes.length === 0) {
      toast.error('Graph is empty');
      return;
    }
    const root = reactFlowRootElRef.current;
    if (!root) {
      toast.error('React Flow not found');
      return;
    }
    await exportGraphPng({
      reactFlowRootEl: root,
      reactFlowInstance,
      isDark,
      pixelRatio: 2,
      filename: `osint-graph-${new Date().toISOString().slice(0, 10)}.png`,
      toastLabel: 'Generating PNG...'
    });
  }, [nodes.length, reactFlowInstance, isDark]);

  const exportPNGHighRes = useCallback(async () => {
    if (nodes.length === 0) {
      toast.error('Graph is empty');
      return;
    }
    const root = reactFlowRootElRef.current;
    if (!root) {
      toast.error('React Flow not found');
      return;
    }
    await exportGraphPng({
      reactFlowRootEl: root,
      reactFlowInstance,
      isDark,
      pixelRatio: 5,
      filename: `osint-graph-max-res-${new Date().toISOString().slice(0, 10)}.png`,
      toastLabel: 'Generating high-resolution PNG...'
    });
  }, [nodes.length, reactFlowInstance, isDark]);

  const exportJPEG = useCallback(async () => {
    if (nodes.length === 0) {
      toast.error('Graph is empty');
      return;
    }
    const root = reactFlowRootElRef.current;
    if (!root) {
      toast.error('React Flow not found');
      return;
    }
    await exportGraphJpeg({
      reactFlowRootEl: root,
      reactFlowInstance,
      isDark,
      filename: `osint-graph-${new Date().toISOString().slice(0, 10)}.jpg`
    });
  }, [nodes.length, reactFlowInstance, isDark]);

  const exportHTML = useCallback(async () => {
    if (nodes.length === 0) {
      toast.error('Graph is empty');
      return;
    }
    const root = reactFlowRootElRef.current;
    if (!root) {
      toast.error('React Flow not found');
      return;
    }
    await exportGraphHtml({
      reactFlowRootEl: root,
      reactFlowInstance,
      isDark,
      graphName,
      graphDescription: graphDescription ?? '',
      filename: `osint-graph-${new Date().toISOString().slice(0, 10)}.html`
    });
  }, [nodes.length, reactFlowInstance, isDark, graphName, graphDescription]);

  // --- Context Menu sulla Pane ---
  const onPaneContextMenu = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();

      // Converti le coordinate dello schermo in coordinate del flow
      const flowPosition = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY
      });

      setPaneContextMenu({
        screen: { x: event.clientX, y: event.clientY },
        flow: flowPosition
      });
    },
    [reactFlowInstance]
  );

  const closeRelationalOverlays = useCallback(() => {
    setRelationalNodeContextMenu(null);
    setRelationalEdgeContextMenu(null);
    setSelectionContextMenu(null);
    setPaneContextMenu(null);
  }, []);

  const onFlowNodeClick = useCallback((event: React.MouseEvent) => {
    if (!tabIsActive) return;
    if (graphViewMode === 'analysis') return;
    // Solo left click deve triggerare l'auto-open del Details panel
    if ((event as any).button !== 0) return;
    if ((event as any).defaultPrevented) return;
    closeRelationalOverlays();

    // Double click: non aprire mai il sidepanel (serve per edit/open dialog)
    if (typeof (event as any).detail === 'number' && (event as any).detail > 1) {
      shouldAutoOpenDetailsPanelRef.current = false;
      if (pendingAutoOpenDetailsTimerRef.current) {
        clearTimeout(pendingAutoOpenDetailsTimerRef.current);
        pendingAutoOpenDetailsTimerRef.current = null;
      }
      return;
    }

    // Single click: apri con un micro-delay; se arriva un double click lo annulliamo.
    if (pendingAutoOpenDetailsTimerRef.current) {
      clearTimeout(pendingAutoOpenDetailsTimerRef.current);
      pendingAutoOpenDetailsTimerRef.current = null;
    }
    shouldAutoOpenDetailsPanelRef.current = false;
    pendingAutoOpenDetailsTimerRef.current = setTimeout(() => {
      pendingAutoOpenDetailsTimerRef.current = null;
      if (!hasSelectionRef.current) return;
      openDetailsPanel();
    }, 170);
  }, [graphViewMode, tabIsActive, closeRelationalOverlays]);

  const onFlowEdgeClick = useCallback((event: React.MouseEvent) => {
    if (!tabIsActive) return;
    if (graphViewMode === 'analysis') return;
    if ((event as any).button !== 0) return;
    if ((event as any).defaultPrevented) return;
    closeRelationalOverlays();

    if (typeof (event as any).detail === 'number' && (event as any).detail > 1) {
      shouldAutoOpenDetailsPanelRef.current = false;
      if (pendingAutoOpenDetailsTimerRef.current) {
        clearTimeout(pendingAutoOpenDetailsTimerRef.current);
        pendingAutoOpenDetailsTimerRef.current = null;
      }
      return;
    }

    if (pendingAutoOpenDetailsTimerRef.current) {
      clearTimeout(pendingAutoOpenDetailsTimerRef.current);
      pendingAutoOpenDetailsTimerRef.current = null;
    }
    shouldAutoOpenDetailsPanelRef.current = false;
    pendingAutoOpenDetailsTimerRef.current = setTimeout(() => {
      pendingAutoOpenDetailsTimerRef.current = null;
      if (!hasSelectionRef.current) return;
      openDetailsPanel();
    }, 170);
  }, [graphViewMode, tabIsActive, closeRelationalOverlays]);

  const clearRelationalSelection = useCallback(() => {
    selectNodes(() => false);
    selectEdges(() => false);
  }, [selectNodes, selectEdges]);

  const onAnalysisBackgroundClick = useCallback(
    (_event: MouseEvent) => {
      if (!tabIsActive) return;
      if (graphViewMode !== 'analysis') return;
      closeRelationalOverlays();
      clearRelationalSelection();
      closeDetailsPanel();
    },
    [graphViewMode, tabIsActive, closeRelationalOverlays, clearRelationalSelection, closeDetailsPanel]
  );

  const onAnalysisNodeClick = useCallback(
    (event: MouseEvent, node: FlowNode) => {
      if (!tabIsActive) return;
      if (graphViewMode !== 'analysis') return;
      if (!node) return;
      closeRelationalOverlays();
      const nodeId = String(node.id);

      // --- Double click detection (ForceGraph doesn't reliably set event.detail) ---
      const now = Date.now();
      const isDoubleClick =
        lastAnalysisClickRef.current.nodeId === nodeId &&
        now - lastAnalysisClickRef.current.ts <= 260;
      lastAnalysisClickRef.current = isDoubleClick ? { ts: 0, nodeId: null } : { ts: now, nodeId };

      // Never auto-open sidepanel immediately in Analysis; we handle it via a timer.
      shouldAutoOpenDetailsPanelRef.current = false;
      if (pendingAutoOpenDetailsTimerRef.current) {
        clearTimeout(pendingAutoOpenDetailsTimerRef.current);
        pendingAutoOpenDetailsTimerRef.current = null;
      }
      if (pendingAnalysisCenterTimerRef.current) {
        clearTimeout(pendingAnalysisCenterTimerRef.current);
        pendingAnalysisCenterTimerRef.current = null;
      }

      // Selezione canonica (per sidebar/menu)
      selectNodes((n) => n.id === node.id);
      selectEdges(() => false);

      // Double click -> open Open Node dialog (only action)
      if (isDoubleClick) {
        setOpenNodeDialogNodeId(nodeId);
        try {
          event.stopPropagation();
        } catch {}
        return;
      }

      // Center + open details with micro-delay (cancelled if a 2nd click arrives)
      const n: any = node as any;
      const data: any = n.data ?? {};
      const size =
        n.width ||
        n.measured?.width ||
        (typeof n.style?.width === 'number' ? n.style.width : null) ||
        data._relationalSize ||
        20;
      const pos = n.position ?? { x: 0, y: 0 };
      const centerX = Number(pos.x ?? 0) + Number(size) / 2;
      const centerY = Number(pos.y ?? 0) + Number(size) / 2;
      pendingAnalysisCenterTimerRef.current = setTimeout(() => {
        pendingAnalysisCenterTimerRef.current = null;
        if (graphViewMode !== 'analysis') return;
        if (!tabIsActive) return;
        if (!hasSelectionRef.current) return;
        if (selectedNodeIdRef.current !== nodeId) return;
        analysisGraphApiRef.current?.centerAt(centerX, centerY);
        openDetailsPanel();
      }, 170);

      // Evita che il click “cada” su background se la libreria propaga
      try {
        event.stopPropagation();
      } catch {}
    },
    [
      closeDetailsPanel,
      closeRelationalOverlays,
      graphViewMode,
      tabIsActive,
      openDetailsPanel,
      selectEdges,
      selectNodes
    ]
  );

  const onAnalysisEdgeClick = useCallback(
    (event: MouseEvent, edge: Edge) => {
      if (!tabIsActive) return;
      if (graphViewMode !== 'analysis') return;
      if (!edge) return;
      closeRelationalOverlays();
      shouldAutoOpenDetailsPanelRef.current = true;

      selectEdges((e) => e.id === edge.id);
      selectNodes(() => false);

      try {
        event.stopPropagation();
      } catch {}
    },
    [graphViewMode, tabIsActive, closeRelationalOverlays, selectEdges, selectNodes]
  );

  const onAnalysisPaneContextMenu = useCallback(
    (event: MouseEvent) => {
      if (!tabIsActive) return;
      if (graphViewMode !== 'analysis') return;
      event.preventDefault();

      // In Analysis: right-click on empty space should ALWAYS show the base pane context menu
      // (same behavior as Manual/Auto).
      setSelectionContextMenu(null);
      setRelationalNodeContextMenu(null);
      setRelationalEdgeContextMenu(null);

      // No selection - show pane context menu
      const world = analysisGraphApiRef.current?.screenToGraph({
        x: event.clientX,
        y: event.clientY
      }) ?? { x: 0, y: 0 };

      setPaneContextMenu({
        screen: { x: event.clientX, y: event.clientY },
        // Re-usa la shape attesa dal menu (world coords per Analysis)
        flow: world as any
      });
    },
    [graphViewMode, tabIsActive]
  );

  const onPaneClick = useCallback(() => {
    if (graphViewMode !== 'analysis') return;
    closeRelationalOverlays();
    closeDetailsPanel();
  }, [graphViewMode, closeRelationalOverlays, closeDetailsPanel]);

  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: FlowNode) => {
      if (!tabIsActive) return;
      if (graphViewMode !== 'analysis') return;
      event.preventDefault();
      shouldAutoOpenDetailsPanelRef.current = false;

      const selectedNodes = nodes.filter((n) => n.selected);
      const selectedEdges = edges.filter((e) => e.selected);
      const isMultiSelected = selectedNodes.length + selectedEdges.length >= 2;
      const isTargetSelected = selectedNodes.some((n) => n.id === node.id);

      // If multi-selected and right-clicking a selected node, show multi-selection context menu
      if (isMultiSelected && isTargetSelected) {
        setPaneContextMenu(null);
        setRelationalNodeContextMenu(null);
        setRelationalEdgeContextMenu(null);
        setSelectionContextMenu({
          position: { x: event.clientX, y: event.clientY },
          nodes: selectedNodes,
          edges: selectedEdges
        });
        return;
      }

      // Otherwise select only this node (sidebar / actions consistent)
      selectNodes((n) => n.id === node.id);
      selectEdges(() => false);

      setPaneContextMenu(null);
      setSelectionContextMenu(null);
      setRelationalEdgeContextMenu(null);
      setRelationalNodeContextMenu({
        position: { x: event.clientX, y: event.clientY },
        nodeId: node.id
      });
    },
    [graphViewMode, tabIsActive, nodes, edges, selectNodes, selectEdges]
  );

  const onEdgeContextMenu = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      if (!tabIsActive) return;
      if (graphViewMode !== 'analysis') return;
      event.preventDefault();

      const selectedNodes = nodes.filter((n) => n.selected);
      const selectedEdges = edges.filter((e) => e.selected);
      const isMultiSelected = selectedNodes.length + selectedEdges.length >= 2;
      const isTargetSelected = selectedEdges.some((e) => e.id === edge.id);

      // If multi-selected and right-clicking a selected edge, show multi-selection context menu
      if (isMultiSelected && isTargetSelected) {
        setPaneContextMenu(null);
        setRelationalNodeContextMenu(null);
        setRelationalEdgeContextMenu(null);
        setSelectionContextMenu({
          position: { x: event.clientX, y: event.clientY },
          nodes: selectedNodes,
          edges: selectedEdges
        });
        return;
      }

      // Otherwise select only this edge
      selectEdges((e) => e.id === edge.id);
      selectNodes(() => false);

      setPaneContextMenu(null);
      setSelectionContextMenu(null);
      setRelationalNodeContextMenu(null);
      setRelationalEdgeContextMenu({
        position: { x: event.clientX, y: event.clientY },
        edgeId: edge.id
      });
    },
    [graphViewMode, tabIsActive, nodes, edges, selectEdges, selectNodes]
  );

  // --- Context Menu sulla Selezione ---
  const onSelectionContextMenu = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();

      const selectedNodes = nodes.filter((n) => n.selected);
      const selectedEdges = edges.filter((e) => e.selected);

      // Mostra il menu solo se c'è una selezione
      if (selectedNodes.length > 0 || selectedEdges.length > 0) {
        setSelectionContextMenu({
          position: { x: event.clientX, y: event.clientY },
          nodes: selectedNodes,
          edges: selectedEdges
        });
      }
    },
    [nodes, edges]
  );

  const openRelationalLabelEditor = useCallback(
    (nodeId: string) => {
      const n: any = nodes.find((x) => x.id === nodeId);
      setRelationalLabelEditor({
        nodeId,
        initialLabel: String(n?.data?.label ?? ''),
        shouldPanOnSubmit: false
      });
    },
    [nodes]
  );

  const applyRelationalNodeType = useCallback(
    (nodeId: string, nextType: string) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, type: nextType } } : n
        )
      );
      toast.success('Type updated');
    },
    [setNodes]
  );

  const deleteRelationalNode = useCallback(
    (nodeId: string) => {
      if (!canEditSnapshot()) return;
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      toast.success('Node deleted');
    },
    [canEditSnapshot, setNodes, setEdges]
  );

  const deleteRelationalEdge = useCallback(
    (edgeId: string) => {
      if (!canEditSnapshot()) return;
      setEdges((eds) => eds.filter((e) => e.id !== edgeId));
      toast.success('Edge deleted');
    },
    [canEditSnapshot, setEdges]
  );

  const updateRelationalEdge = useCallback(
    (edgeId: string, updater: (e: Edge) => Edge) => {
      setEdges((eds) => eds.map((e) => (e.id === edgeId ? updater(e) : e)));
    },
    [setEdges]
  );

  // --- Azioni sulla Selezione ---
  const handleChangeSelectionType = useCallback(
    (newType: string) => {
      const selectedNodeIds = nodes.filter((n) => n.selected).map((n) => n.id);
      setNodes((nds) =>
        nds.map((n) =>
          selectedNodeIds.includes(n.id)
            ? { ...n, data: { ...n.data, type: newType } }
            : n
        )
      );
      toast.success(`Changed ${selectedNodeIds.length} node(s) to ${newType}`);
    },
    [nodes, setNodes]
  );

  const handleLayoutSelection = useCallback(
    (next: Partial<LayoutOptions>) => {
      const selectedNodeIds = new Set(
        nodes.filter((n) => n.selected).map((n) => n.id)
      );
      if (selectedNodeIds.size < 2) {
        toast.error('Select at least 2 nodes to layout');
        return;
      }

      // Filtra nodi e edges selezionati
      const selectedNodes = nodes.filter((n) => selectedNodeIds.has(n.id));
      const selectedEdges = edges.filter(
        (e) => selectedNodeIds.has(e.source) && selectedNodeIds.has(e.target)
      );

      // Calcola offset per mantenere la posizione relativa
      const minX = Math.min(...selectedNodes.map((n) => n.position.x));
      const minY = Math.min(...selectedNodes.map((n) => n.position.y));

      const options: Partial<LayoutOptions> = {
        direction: next.direction ?? layoutSettings.direction,
        spacingPreset: next.spacingPreset ?? layoutSettings.spacingPreset,
        quality: next.quality ?? layoutSettings.quality,
        considerEdgeLabels:
          typeof next.considerEdgeLabels === 'boolean'
            ? next.considerEdgeLabels
            : layoutSettings.considerEdgeLabels
      };

      // Applica layout
      const { nodes: layoutedNodes } = getLayoutedElements(
        selectedNodes,
        selectedEdges,
        options
      );

      // Calcola nuovo offset
      const newMinX = Math.min(...layoutedNodes.map((n) => n.position.x));
      const newMinY = Math.min(...layoutedNodes.map((n) => n.position.y));
      const offsetX = minX - newMinX;
      const offsetY = minY - newMinY;

      // Mappa delle nuove posizioni
      const newPositions = new Map<string, { x: number; y: number }>();
      layoutedNodes.forEach((n) => {
        newPositions.set(n.id, {
          x: n.position.x + offsetX,
          y: n.position.y + offsetY
        });
      });

      // Aggiorna solo i nodi selezionati
      setNodes((nds) =>
        nds.map((n) => {
          const newPos = newPositions.get(n.id);
          return newPos ? { ...n, position: newPos } : n;
        })
      );

      toast.success(`Arranged ${selectedNodeIds.size} nodes`);
    },
    [nodes, edges, setNodes, layoutSettings]
  );

  const handleAlignSelection = useCallback(
    (alignment: 'horizontal' | 'vertical') => {
      const selectedNodes = nodes.filter((n) => n.selected);
      if (selectedNodes.length < 2) {
        toast.error('Select at least 2 nodes to align');
        return;
      }

      const spacing = 50; // Spaziatura tra i nodi

      if (alignment === 'horizontal') {
        // Allinea orizzontalmente (stessa Y) - mantiene l'ordine X e distanzia
        const avgY =
          selectedNodes.reduce((sum, n) => sum + n.position.y, 0) /
          selectedNodes.length;

        // Ordina per posizione X
        const sortedNodes = [...selectedNodes].sort(
          (a, b) => a.position.x - b.position.x
        );

        // Calcola le nuove posizioni mantenendo la distanza
        const newPositions = new Map<string, { x: number; y: number }>();
        let currentX = sortedNodes[0].position.x;

        sortedNodes.forEach((node, index) => {
          // Ottieni larghezza del nodo (considera tipo per dimensioni default)
          const nodeType = (node.data as { type?: string })?.type;
          const defaultWidth =
            nodeType === 'url'
              ? 180
              : nodeType === 'media_url'
                ? 280
                : nodeType === 'ai_insight'
                  ? 350
                  : nodeType === 'maps'
                    ? 320
                    : 220;
          const nodeWidth = (node.style?.width as number) || defaultWidth;

          newPositions.set(node.id, { x: currentX, y: avgY });
          currentX += nodeWidth + spacing; // Sposta per il prossimo nodo
        });

        setNodes((nds) =>
          nds.map((n) => {
            const newPos = newPositions.get(n.id);
            return newPos ? { ...n, position: newPos } : n;
          })
        );
      } else {
        // Allinea verticalmente (stessa X) - mantiene l'ordine Y e distanzia
        const avgX =
          selectedNodes.reduce((sum, n) => sum + n.position.x, 0) /
          selectedNodes.length;

        // Ordina per posizione Y
        const sortedNodes = [...selectedNodes].sort(
          (a, b) => a.position.y - b.position.y
        );

        // Calcola le nuove posizioni mantenendo la distanza
        const newPositions = new Map<string, { x: number; y: number }>();
        let currentY = sortedNodes[0].position.y;

        sortedNodes.forEach((node) => {
          // Ottieni altezza del nodo (considera tipo per dimensioni default)
          const nodeType = (node.data as { type?: string })?.type;
          const defaultHeight =
            nodeType === 'media_url'
              ? 200
              : nodeType === 'ai_insight'
                ? 250
                : nodeType === 'maps'
                  ? 240
                  : nodeType === 'note'
                    ? 120
                    : 80;
          const nodeHeight = (node.style?.height as number) || defaultHeight;

          newPositions.set(node.id, { x: avgX, y: currentY });
          currentY += nodeHeight + spacing; // Sposta per il prossimo nodo
        });

        setNodes((nds) =>
          nds.map((n) => {
            const newPos = newPositions.get(n.id);
            return newPos ? { ...n, position: newPos } : n;
          })
        );
      }

      toast.success(`Aligned ${selectedNodes.length} nodes ${alignment}ly`);
    },
    [nodes, setNodes]
  );

  const handleDuplicateSelection = useCallback(() => {
    const selectedNodes = nodes.filter((n) => n.selected);
    const selectedEdges = edges.filter((e) => e.selected);
    if (selectedNodes.length === 0 && selectedEdges.length === 0) return;

    const offset = 50;
    const baseId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    // Duplicate nodes first and build an id remap
    const nodeIdRemap = new Map<string, string>();
    const newNodes: FlowNode[] = selectedNodes.map((n) => {
      const nextId = `node-${baseId}-${Math.random().toString(36).slice(2, 8)}`;
      nodeIdRemap.set(n.id, nextId);
      return {
        ...n,
        id: nextId,
        position: { x: n.position.x + offset, y: n.position.y + offset },
        selected: false
      };
    });

    // Duplicate selected edges too.
    // - If endpoints were duplicated, rewire to the duplicated nodes.
    // - If not, keep original endpoint(s) (allows duplicating edges-only selections).
    const newEdges: Edge[] = selectedEdges.map((e, idx) => {
      const nextSource = nodeIdRemap.get(e.source) ?? e.source;
      const nextTarget = nodeIdRemap.get(e.target) ?? e.target;
      return {
        ...e,
        id: `e-${nextSource}-${nextTarget}-${baseId}-${idx}`,
        source: nextSource,
        target: nextTarget,
        selected: false
      };
    });

    if (newNodes.length) setNodes((nds) => [...nds, ...newNodes]);
    if (newEdges.length) setEdges((eds) => [...eds, ...newEdges]);

    const parts: string[] = [];
    if (newNodes.length) parts.push(`${newNodes.length} node(s)`);
    if (newEdges.length) parts.push(`${newEdges.length} edge(s)`);
    toast.success(`Duplicated ${parts.join(' and ')}`);
  }, [nodes, edges, setNodes, setEdges]);

  const handleChangeEdgeColor = useCallback(
    (color: string) => {
      const selectedEdgeIds = edges.filter((e) => e.selected).map((e) => e.id);
      setEdges((eds) =>
        eds.map((e) =>
          selectedEdgeIds.includes(e.id)
            ? { ...e, data: { ...e.data, color } }
            : e
        )
      );
      toast.success(`Changed color of ${selectedEdgeIds.length} edge(s)`);
    },
    [edges, setEdges]
  );

  const handleChangeEdgeWidth = useCallback(
    (width: number) => {
      const selectedEdgeIds = edges.filter((e) => e.selected).map((e) => e.id);
      setEdges((eds) =>
        eds.map((e) =>
          selectedEdgeIds.includes(e.id)
            ? { ...e, data: { ...e.data, strokeWidth: width } }
            : e
        )
      );
      toast.success(`Changed width of ${selectedEdgeIds.length} edge(s)`);
    },
    [edges, setEdges]
  );

  const handleChangeEdgeType = useCallback(
    (type: 'default' | 'straight' | 'smoothstep') => {
      const selectedEdgeIds = edges.filter((e) => e.selected).map((e) => e.id);
      setEdges((eds) =>
        eds.map((e) =>
          selectedEdgeIds.includes(e.id)
            ? { ...e, data: { ...e.data, edgeType: type } }
            : e
        )
      );
      toast.success(`Changed style of ${selectedEdgeIds.length} edge(s)`);
    },
    [edges, setEdges]
  );

  const handleToggleEdgeLabelVisible = useCallback(() => {
    const selectedEdgeIds = edges.filter((e) => e.selected).map((e) => e.id);
    setEdges((eds) =>
      eds.map((e) =>
        selectedEdgeIds.includes(e.id)
          ? {
              ...e,
              data: { ...e.data, labelVisible: !(e.data?.labelVisible ?? true) }
            }
          : e
      )
    );
    toast.success(
      `Toggled label visibility for ${selectedEdgeIds.length} edge(s)`
    );
  }, [edges, setEdges]);

  const handleToggleEdgeDashed = useCallback(() => {
    const selectedEdgeIds = edges.filter((e) => e.selected).map((e) => e.id);
    setEdges((eds) =>
      eds.map((e) =>
        selectedEdgeIds.includes(e.id)
          ? { ...e, data: { ...e.data, dashed: !e.data?.dashed } }
          : e
      )
    );
    toast.success(`Toggled dashed style for ${selectedEdgeIds.length} edge(s)`);
  }, [edges, setEdges]);

  const handleToggleEdgeHideDirection = useCallback(() => {
    const selectedEdgeIds = edges.filter((e) => e.selected).map((e) => e.id);
    setEdges((eds) =>
      eds.map((e) =>
        selectedEdgeIds.includes(e.id)
          ? { ...e, data: { ...e.data, hideDirection: !e.data?.hideDirection } }
          : e
      )
    );
    toast.success(
      `Toggled direction visibility for ${selectedEdgeIds.length} edge(s)`
    );
  }, [edges, setEdges]);

  const handleToggleEdgeBidirectional = useCallback(() => {
    const selectedEdgeIds = edges.filter((e) => e.selected).map((e) => e.id);
    setEdges((eds) =>
      eds.map((e) =>
        selectedEdgeIds.includes(e.id)
          ? { ...e, data: { ...e.data, bidirectional: !e.data?.bidirectional } }
          : e
      )
    );
    toast.success(
      `Toggled bidirectional for ${selectedEdgeIds.length} edge(s)`
    );
  }, [edges, setEdges]);

  const handleInvertEdgeDirection = useCallback(() => {
    const selectedEdgeIds = edges.filter((e) => e.selected).map((e) => e.id);
    setEdges((eds) =>
      eds.map((e) => {
        if (selectedEdgeIds.includes(e.id)) {
          return {
            ...e,
            source: e.target,
            target: e.source,
            sourceHandle: e.targetHandle,
            targetHandle: e.sourceHandle
          };
        }
        return e;
      })
    );
    toast.success(`Inverted direction of ${selectedEdgeIds.length} edge(s)`);
  }, [edges, setEdges]);

  // Handler per drag di group locked
  const handleNodeDragStart = useCallback(
    (_event: React.MouseEvent, node: FlowNode) => {
      // Dragging non deve auto-aprire il Details panel
      shouldAutoOpenDetailsPanelRef.current = false;
      // Salva le posizioni iniziali dei nodi
      dragStartPositions.current.clear();
      nodes.forEach((n) => {
        dragStartPositions.current.set(n.id, { ...n.position });
      });
    },
    [nodes]
  );

  const handleNodeDrag = useCallback(
    (_event: React.MouseEvent, node: FlowNode) => {
      // Dragging non deve auto-aprire il Details panel
      shouldAutoOpenDetailsPanelRef.current = false;
      // Se il nodo è un group locked, muovi anche i children
      if (node.data?.type === 'group' && node.data?.metadata?.locked) {
        const groupData = node.data as OSINTNodeData;
        const startPos = dragStartPositions.current.get(node.id);
        if (!startPos) return;

        // Calcola il delta di movimento
        const deltaX = node.position.x - startPos.x;
        const deltaY = node.position.y - startPos.y;

        // Trova i nodi contenuti nel group (basato su posizione geometrica)
        const groupWidth = node.width || 400;
        const groupHeight = node.height || 300;

        setNodes((nds) =>
          nds.map((n) => {
            // Skip il group stesso
            if (n.id === node.id) return n;

            // Controlla se il nodo è dentro il group (usando la posizione iniziale)
            const nStart = dragStartPositions.current.get(n.id);
            if (!nStart) return n;

            const isInside =
              nStart.x >= startPos.x &&
              nStart.x <= startPos.x + groupWidth &&
              nStart.y >= startPos.y &&
              nStart.y <= startPos.y + groupHeight;

            if (isInside) {
              return {
                ...n,
                position: {
                  x: nStart.x + deltaX,
                  y: nStart.y + deltaY
                }
              };
            }
            return n;
          })
        );
      }
    },
    [nodes, setNodes]
  );

  const handleFitView = useCallback(() => {
    if (graphViewMode === 'analysis' && analysisGraphApiRef.current) {
      analysisGraphApiRef.current.fitView();
      return;
    }
    if (graphViewMode === 'map' && mapGraphApiRef.current) {
      mapGraphApiRef.current.fitView();
      return;
    }
    const base =
      graphViewMode === 'analysis'
        ? analysisLayout.getFitViewPadding()
        : getFitViewPaddingForNodeCount(nodes.length);
    const labelExtra = clampNumber(maxLabelLengthForFit / 220, 0, 0.18);
    const padding = clampNumber(base + labelExtra, 0.12, 0.72);
    reactFlowInstance.fitView({ padding, maxZoom: AUTO_FIT_MAX_ZOOM, duration: 420 });
  }, [reactFlowInstance, graphViewMode, analysisLayout, nodes.length, maxLabelLengthForFit]);
  usePanToAddedNode({
    nodes,
    scope: `${graphId}:${graphViewMode}`,
    ready: tabIsActive && mounted && !isLoadingGraph && !graphLoadError && graphViewMode !== 'map',
    panToNode: (nodeId) => {
      if (graphViewMode === 'analysis') {
        analysisGraphApiRef.current?.panToNode(nodeId);
      } else {
        panToFlowNode(reactFlowInstance, nodeId);
      }
    }
  });

  useEffect(() => {
    if (!graphId || !tabIsActive || isLoadingGraph || graphLoadError) return;
    return registerAgentGraphReferences(graphId, {
      nodes,
      onSelectNode: (nodeId) => {
        if (!nodes.some((node) => node.id === nodeId)) return;
        // Selection/navigation is allowed even while the agent owns the write lock.
        setCanonicalEdges((previous) => previous.map((edge) => ({ ...edge, selected: false })));
        setCanonicalNodes((previous) => previous.map((node) => ({ ...node, selected: node.id === nodeId })));
        if (graphViewMode === 'analysis') {
          analysisGraphApiRef.current?.panToNode(nodeId);
        } else if (graphViewMode === 'map') {
          mapGraphApiRef.current?.fitViewToNodeIds([nodeId]);
        } else {
          panToFlowNode(reactFlowInstance, nodeId);
        }
      }
    });
  }, [graphId, tabIsActive, isLoadingGraph, graphLoadError, nodes, setCanonicalEdges, setCanonicalNodes, graphViewMode, reactFlowInstance]);

  const handleFitViewToNodeIds = useCallback(
    (nodeIds: string[]) => {
      const ids = (nodeIds ?? []).map((x) => String(x)).filter(Boolean);
      if (!ids.length) return;

      if (graphViewMode === 'analysis' && analysisGraphApiRef.current) {
        analysisGraphApiRef.current.fitViewToNodeIds(ids);
        return;
      }
      if (graphViewMode === 'map' && mapGraphApiRef.current) {
        mapGraphApiRef.current.fitViewToNodeIds(ids);
        return;
      }

      const targets = ids.map((id) => ({ id }));
      requestAnimationFrame(() => {
        try {
          reactFlowInstance.fitView({
            nodes: targets as any,
            padding: 0.22,
            duration: 420
          });
        } catch {}
      });
    },
    [graphViewMode, reactFlowInstance]
  );

  const selectedNodeIdsForFit = useMemo(() => {
    return (nodes as any[]).filter((n) => (n as any)?.selected).map((n) => String(n.id));
  }, [nodes]);

  const canFitViewToSelected = selectedNodeIdsForFit.length > 0;

  const handleFitViewToSelected = useCallback(() => {
    handleFitViewToNodeIds(selectedNodeIdsForFit);
  }, [handleFitViewToNodeIds, selectedNodeIdsForFit]);

  const handleFitViewSmooth = useCallback(() => {
    // Animated fitView per evitare "scatti" nel passaggio modalità
    const base = getFitViewPaddingForNodeCount(nodes.length);
    const labelExtra = clampNumber(maxLabelLengthForFit / 220, 0, 0.18);
    const padding = clampNumber(base + labelExtra, 0.12, 0.72);
    reactFlowInstance.fitView({ padding, maxZoom: AUTO_FIT_MAX_ZOOM, duration: 420 });
  }, [maxLabelLengthForFit, nodes.length, reactFlowInstance]);

  const handleZoomIn = useCallback(() => {
    if (graphViewMode === 'analysis' && analysisGraphApiRef.current) {
      analysisGraphApiRef.current.zoomIn();
      return;
    }
    if (graphViewMode === 'map' && mapGraphApiRef.current) {
      mapGraphApiRef.current.zoomIn();
      return;
    }
    reactFlowInstance.zoomIn();
  }, [reactFlowInstance, graphViewMode]);

  const handleZoomOut = useCallback(() => {
    if (graphViewMode === 'analysis' && analysisGraphApiRef.current) {
      analysisGraphApiRef.current.zoomOut();
      return;
    }
    if (graphViewMode === 'map' && mapGraphApiRef.current) {
      mapGraphApiRef.current.zoomOut();
      return;
    }
    reactFlowInstance.zoomOut();
  }, [reactFlowInstance, graphViewMode]);

  // UX: entrando in Manual (free) ripristiniamo le posizioni salvate per Manual
  // e facciamo un fitView sempre (anche Auto → Manual), senza dipendere da re-render intermedi.
  const prevModeForManualEnterRef = useRef<'free' | 'locked' | 'analysis' | 'map'>(graphViewMode);
  const pendingManualEnterRef = useRef(false);
  const pendingManualEnterFromRef = useRef<'locked' | 'analysis' | null>(null);
  const manualEnterFitTimeoutRef = useRef<number | null>(null);

  const applyManualPositionsToNodes = useCallback((currentNodes: any[]) => {
    if (!canEditSnapshot()) return;
    const saved = manualNodePositionsByIdRef.current;
    let didUpdateSavedPositions = false;

    if (!Object.keys(saved).length) {
      const next: ManualNodePositionsById = {};
      for (const n of currentNodes) {
        const x = Number(n?.position?.x ?? 0);
        const y = Number(n?.position?.y ?? 0);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        next[n.id] = { x, y };
      }
      manualNodePositionsByIdRef.current = next;
      didUpdateSavedPositions = true;
      if (didUpdateSavedPositions) schedulePersistManualNodePositions();
      return;
    }

    // Init posizioni per nodi nuovi (non ancora in cache)
    for (const n of currentNodes) {
      if (saved[n.id]) continue;
      const x = Number(n?.position?.x ?? 0);
      const y = Number(n?.position?.y ?? 0);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      saved[n.id] = { x, y };
      didUpdateSavedPositions = true;
    }

    // Ripristina posizioni manual su canvas
    let didChange = false;
    const nextNodes = currentNodes.map((n) => {
      const savedPos = saved[n.id];
      if (!savedPos) return n;
      const prevPos = n?.position ?? { x: 0, y: 0 };
      if (prevPos.x === savedPos.x && prevPos.y === savedPos.y) return n;
      didChange = true;
      return { ...n, position: { x: savedPos.x, y: savedPos.y } };
    });
    if (didChange) setNodes(nextNodes as any);
    if (didUpdateSavedPositions) schedulePersistManualNodePositions();
  }, [canEditSnapshot, schedulePersistManualNodePositions, setNodes]);

  useEffect(() => {
    const prev = prevModeForManualEnterRef.current;
    prevModeForManualEnterRef.current = graphViewMode;
    if (prev !== 'free' && graphViewMode === 'free') {
      pendingManualEnterRef.current = true;
      pendingManualEnterFromRef.current = prev === 'analysis' ? 'analysis' : 'locked';
    }
  }, [graphViewMode]);

  useEffect(() => {
    if (!tabIsActive) return;
    if (graphViewMode !== 'free') return;
    if (!pendingManualEnterRef.current) return;
    if (!nodes.length) return;

    pendingManualEnterRef.current = false;
    const from = pendingManualEnterFromRef.current;
    pendingManualEnterFromRef.current = null;
    if (!canEditSnapshot()) {
      handleFitViewSmooth();
      return;
    }

    // Se entriamo in Manual con molti nodi, facciamo un refresh automatico
    // (stessa logica del pulsante Refresh in topbar).
    if (nodes.length > 30) {
      void (async () => {
        await refreshGraph();
        // Dopo il refresh, ripristiniamo le posizioni manual (se presenti) e fitview.
        requestAnimationFrame(() => {
          const latestNodes = reactFlowInstance?.getNodes?.() ?? (nodes as any[]);
          applyManualPositionsToNodes(latestNodes as any[]);
          const delayMs = from === 'analysis' ? 0 : 220;
          if (manualEnterFitTimeoutRef.current)
            window.clearTimeout(manualEnterFitTimeoutRef.current);
          manualEnterFitTimeoutRef.current = window.setTimeout(() => {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                try {
                  handleFitViewSmooth();
                } catch {}
              });
            });
          }, delayMs);
        });
      })();
      return;
    }

    // 1) Ripristina posizioni manual (se presenti) / inizializza cache per nodi nuovi
    applyManualPositionsToNodes(nodes as any[]);

    // 2) FitView:
    // - Analysis → Manual: immediato (funziona già bene)
    // - Auto(locked) → Manual: delay breve per evitare glitch con fitView/viewport della locked
    if (manualEnterFitTimeoutRef.current) window.clearTimeout(manualEnterFitTimeoutRef.current);
    const delayMs = from === 'analysis' ? 0 : 220;
    manualEnterFitTimeoutRef.current = window.setTimeout(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          try {
            handleFitViewSmooth();
          } catch {}
        });
      });
    }, delayMs);
  }, [
    applyManualPositionsToNodes,
    graphViewMode,
    handleFitViewSmooth,
    tabIsActive,
    canEditSnapshot,
    nodes.length,
    reactFlowInstance,
    refreshGraph
  ]);

  useEffect(() => {
    return () => {
      if (manualEnterFitTimeoutRef.current) window.clearTimeout(manualEnterFitTimeoutRef.current);
    };
  }, []);

  const canvasNodeProjectionCacheRef = useRef(
    new Map<string, { source: FlowNode; projected: FlowNode }>()
  );
  const canvasNodes = useMemo(() => {
    const previous = canvasNodeProjectionCacheRef.current;
    const next = new Map<string, { source: FlowNode; projected: FlowNode }>();
    const projected = (nodes as FlowNode[]).map((node) => {
      const cached = previous.get(node.id);
      if (cached?.source === node) {
        next.set(node.id, cached);
        return cached.projected;
      }
      const projectedNode = projectNodeDimensionsForCanvas(node);
      next.set(node.id, { source: node, projected: projectedNode });
      return projectedNode;
    });
    canvasNodeProjectionCacheRef.current = next;
    return projected;
  }, [nodes]);
  const canvasNodeIdsRef = useRef<string[]>([]);
  canvasNodeIdsRef.current = canvasNodes.map((node) => node.id);
  const canvasNodeHandleSignature = canvasNodes
    .map((node) => `${node.id}:${String((node.data as any)?.type ?? '')}`)
    .join('|');

  useEffect(() => {
    if (graphViewMode !== 'free' && graphViewMode !== 'locked') return;
    const frame = requestAnimationFrame(() => {
      updateNodeInternals(canvasNodeIdsRef.current);
    });
    return () => cancelAnimationFrame(frame);
  }, [
    canvasNodeHandleSignature,
    graphViewMode,
    lockedAxis,
    updateNodeInternals
  ]);

  const lockedLayoutInputRef = useRef<{
    nodes: FlowNode[];
    edges: Edge[];
  }>({ nodes: [], edges: [] });
  const lockedLayoutSignature = useMemo(() => {
    if (graphViewMode !== 'locked') {
      lockedLayoutInputRef.current = { nodes: [], edges: [] };
      return '';
    }

    const layoutNodes = canvasNodes.map((node) => {
      const data = (node.data ?? {}) as Record<string, any>;
      return {
        id: node.id,
        type: node.type,
        position: { x: 0, y: 0 },
        width: node.width,
        height: node.height,
        style: {
          width: node.style?.width,
          height: node.style?.height
        },
        data: { type: data.type }
      } as FlowNode;
    });
    const layoutEdges = edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      data: { label: (edge.data as any)?.label }
    })) as Edge[];

    lockedLayoutInputRef.current = {
      nodes: layoutNodes,
      edges: layoutEdges
    };

    return JSON.stringify({
      nodes: layoutNodes.map((node) => [
        node.id,
        node.type,
        (node.data as any)?.type,
        node.width,
        node.height,
        node.style?.width,
        node.style?.height
      ]),
      edges: layoutEdges.map((edge) => [
        edge.id,
        edge.source,
        edge.target,
        edge.label,
        (edge.data as any)?.label
      ])
    });
  }, [canvasNodes, edges, graphViewMode]);

  const lockedLayout = useMemo(() => {
    if (graphViewMode !== 'locked') return null;
    void lockedLayoutSignature;
    const input = lockedLayoutInputRef.current;
    return getLockedLaneLayout({
      nodes: input.nodes as any,
      edges: input.edges as any,
      axis: lockedAxis,
      spacingPreset: layoutSettings.spacingPreset,
      stableOrderById: lockedStableOrderRef.current
    });
  }, [
    graphViewMode,
    lockedLayoutSignature,
    lockedAxis,
    layoutSettings.spacingPreset
  ]);

  // (relational layout moved to `RelationalGraphEditor`)

  // Aggiorna lo stable order DOPO aver calcolato il layout locked, per usarlo nel prossimo tick.
  useEffect(() => {
    if (graphViewMode !== 'locked') return;
    const ln = (lockedLayout?.nodes as any[]) ?? [];
    if (!ln.length) return;
    const next: Record<string, number> = {};
    ln.forEach((n) => {
      // ordine lungo l'asse "stack" (y in vertical-lanes, x in horizontal-lanes)
      next[n.id] = lockedAxis === 'vertical' ? n.position?.y ?? 0 : n.position?.x ?? 0;
    });
    lockedStableOrderRef.current = next;
  }, [graphViewMode, lockedLayout, lockedAxis]);

  const lockedCanvasNodeCacheRef = useRef(
    new Map<
      string,
      {
        source: FlowNode;
        geometry: string;
        projected: FlowNode;
      }
    >()
  );
  const layoutedNodesForCanvas = useMemo(() => {
    if (graphViewMode === 'analysis') return analysisLayout.nodes as any;
    if (graphViewMode !== 'locked') {
      return canvasNodes as any;
    }
    const lockedNodes = (lockedLayout?.nodes as any[]) ?? [];
    const lockedNodeById = new Map(
      lockedNodes.map((node) => [String(node.id), node])
    );
    const sourcePosition =
      lockedAxis === 'vertical' ? Position.Right : Position.Bottom;
    const targetPosition = lockedAxis === 'vertical' ? Position.Left : Position.Top;
    const previous = lockedCanvasNodeCacheRef.current;
    const next = new Map<
      string,
      { source: FlowNode; geometry: string; projected: FlowNode }
    >();

    const projected = canvasNodes.map((node) => {
      const layoutNode = lockedNodeById.get(node.id);
      const x = Number(layoutNode?.position?.x ?? node.position.x);
      const y = Number(layoutNode?.position?.y ?? node.position.y);
      const geometry = `${lockedAxis}:${x}:${y}`;
      const cached = previous.get(node.id);
      if (cached?.source === node && cached.geometry === geometry) {
        next.set(node.id, cached);
        return cached.projected;
      }

      const projectedNode = {
        ...node,
        position: { x, y },
        sourcePosition,
        targetPosition,
        style: {
          ...(node.style ?? {}),
          transition: 'transform 260ms cubic-bezier(0.2, 0, 0, 1)'
        }
      };
      next.set(node.id, {
        source: node,
        geometry,
        projected: projectedNode
      });
      return projectedNode;
    });

    lockedCanvasNodeCacheRef.current = next;
    return projected;
  }, [
    graphViewMode,
    lockedLayout,
    lockedAxis,
    canvasNodes,
    analysisLayout.nodes
  ]);

  const reconnectableCanvasEdgeCacheRef = useRef(
    new Map<
      string,
      { source: Edge; reconnectable: boolean; projected: Edge }
    >()
  );
  const reconnectableEdgesForCanvas = useMemo(() => {
    const previous = reconnectableCanvasEdgeCacheRef.current;
    const next = new Map<
      string,
      { source: Edge; reconnectable: boolean; projected: Edge }
    >();
    const projected = edges.map((edge) => {
      const reconnectable = Boolean(edge.selected);
      const cached = previous.get(edge.id);
      if (
        cached?.source === edge &&
        cached.reconnectable === reconnectable
      ) {
        next.set(edge.id, cached);
        return cached.projected;
      }

      const projectedEdge =
        edge.reconnectable === reconnectable
          ? edge
          : ({ ...edge, reconnectable } as Edge);
      next.set(edge.id, {
        source: edge,
        reconnectable,
        projected: projectedEdge
      });
      return projectedEdge;
    });
    reconnectableCanvasEdgeCacheRef.current = next;
    return projected;
  }, [edges]);

  const lockedCanvasEdgeCacheRef = useRef(
    new Map<string, { source: Edge; axis: string; projected: Edge }>()
  );
  const layoutedEdgesForCanvas = useMemo(() => {
    if (graphViewMode !== 'locked') return reconnectableEdgesForCanvas as any;
    const sourceHandle = lockedAxis === 'vertical' ? 'right' : 'bottom';
    const targetHandle = lockedAxis === 'vertical' ? 'left' : 'top';
    const previous = lockedCanvasEdgeCacheRef.current;
    const next = new Map<
      string,
      { source: Edge; axis: string; projected: Edge }
    >();
    const projected = reconnectableEdgesForCanvas.map((edge) => {
      const cached = previous.get(edge.id);
      if (cached?.source === edge && cached.axis === lockedAxis) {
        next.set(edge.id, cached);
        return cached.projected;
      }
      const projectedEdge = {
        ...edge,
        sourceHandle,
        targetHandle,
        data: {
          ...(edge.data ?? {}),
          _layoutMode: 'locked',
          _lockedAxis: lockedAxis
        }
      } as Edge;
      next.set(edge.id, {
        source: edge,
        axis: lockedAxis,
        projected: projectedEdge
      });
      return projectedEdge;
    });
    lockedCanvasEdgeCacheRef.current = next;
    return projected;
  }, [graphViewMode, lockedAxis, reconnectableEdgesForCanvas]);

  const filteredNodesForReactFlow = useMemo(() => {
    if (graphViewMode === 'analysis') return layoutedNodesForCanvas as any;
    if (!nodeTypeFilter) return layoutedNodesForCanvas as any;
    const allowed = new Set(nodeTypeFilter);
    return (layoutedNodesForCanvas as any[]).map((n) => {
      const t = String((n as any)?.data?.type ?? 'custom');
      const isHidden = !allowed.has(t);
      return {
        ...n,
        hidden: isHidden,
        selected: isHidden ? false : (n as any).selected
      };
    });
  }, [graphViewMode, layoutedNodesForCanvas, nodeTypeFilter]);

  const filteredEdgesForReactFlow = useMemo(() => {
    if (graphViewMode === 'analysis') return layoutedEdgesForCanvas as any;
    if (!nodeTypeFilter) return layoutedEdgesForCanvas as any;
    const visibleNodeIds = new Set(
      (filteredNodesForReactFlow as any[])
        .filter((n) => !(n as any).hidden)
        .map((n) => String(n.id))
    );
    return (layoutedEdgesForCanvas as any[]).map((e) => {
      const isHidden =
        !visibleNodeIds.has(String((e as any).source)) ||
        !visibleNodeIds.has(String((e as any).target));
      return { ...e, hidden: isHidden, selected: isHidden ? false : (e as any).selected };
    });
  }, [filteredNodesForReactFlow, graphViewMode, layoutedEdgesForCanvas, nodeTypeFilter]);

  const filteredNodesForAnalysis = useMemo(() => {
    if (graphViewMode !== 'analysis') return analysisLayout.nodes as any;
    if (!nodeTypeFilter) return analysisLayout.nodes as any;
    const allowed = new Set(nodeTypeFilter);
    return (analysisLayout.nodes as any[]).filter((n) => {
      const t = String((n as any)?.data?.type ?? 'custom');
      return allowed.has(t);
    });
  }, [analysisLayout.nodes, graphViewMode, nodeTypeFilter]);

  const filteredEdgesForAnalysis = useMemo(() => {
    if (graphViewMode !== 'analysis') return analysisLayout.edges as any;
    if (!nodeTypeFilter) return analysisLayout.edges as any;
    const ids = new Set((filteredNodesForAnalysis as any[]).map((n) => String(n.id)));
    return (analysisLayout.edges as any[]).filter(
      (e) => ids.has(String((e as any).source)) && ids.has(String((e as any).target))
    );
  }, [analysisLayout.edges, filteredNodesForAnalysis, graphViewMode, nodeTypeFilter]);

  // FitView automatico SOLO in modalità locked (e quando si entra in locked).
  // In free non deve interferire col drag / layout manuale.
  const fitViewTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevGraphViewModeRef = useRef<'free' | 'locked' | 'analysis' | 'map'>(
    graphViewMode
  );
  const prevLockedAxisRef = useRef<'vertical' | 'horizontal'>(lockedAxis);
  const didFitAnalysisRef = useRef(false);

  function getFitViewPaddingForNodeCount(nodeCount: number) {
    // Pochi nodi => più padding => meno zoom aggressivo
    if (nodeCount <= 0) return 0.25;
    if (nodeCount <= 8) return 0.55;
    if (nodeCount <= 18) return 0.42;
    return 0.25;
  }

  useEffect(() => {
    if (!tabIsActive) return;
    const isModeChanged = prevGraphViewModeRef.current !== graphViewMode;
    const isAxisChanged = prevLockedAxisRef.current !== lockedAxis;
    prevGraphViewModeRef.current = graphViewMode;
    prevLockedAxisRef.current = lockedAxis;

    // FitView SOLO in modalità locked:
    // - quando entriamo in locked
    // - quando cambia l'asse (vertical/horizontal) mentre siamo in locked
    if (isModeChanged && graphViewMode !== 'locked') {
      if (fitViewTimeoutRef.current) clearTimeout(fitViewTimeoutRef.current);
      return;
    }
    if (!isModeChanged && !(graphViewMode === 'locked' && isAxisChanged)) {
      if (fitViewTimeoutRef.current) clearTimeout(fitViewTimeoutRef.current);
      return;
    }
    if (fitViewTimeoutRef.current) clearTimeout(fitViewTimeoutRef.current);
    fitViewTimeoutRef.current = setTimeout(() => {
      reactFlowInstance.fitView({
        padding: clampNumber(
          getFitViewPaddingForNodeCount(nodes.length) +
            clampNumber(maxLabelLengthForFit / 220, 0, 0.18),
          0.12,
          0.72
        ),
        maxZoom: AUTO_FIT_MAX_ZOOM,
        duration: 380
      });
    }, 120);
    return () => {
      if (fitViewTimeoutRef.current) clearTimeout(fitViewTimeoutRef.current);
    };
  }, [
    tabIsActive,
    reactFlowInstance,
    graphViewMode,
    lockedAxis,
    nodes.length
  ]);

  useEffect(() => {
    if (graphViewMode !== 'analysis') {
      didFitAnalysisRef.current = false;
      return;
    }
    if (didFitAnalysisRef.current) return;
    if (isLoadingGraph) return;
    if (!nodes.length) {
      didFitAnalysisRef.current = true;
      return;
    }
    if (!layoutedNodesForCanvas?.length) return;
    if (!analysisGraphApiRef.current) return;
    didFitAnalysisRef.current = true;
    const raf = requestAnimationFrame(() => analysisGraphApiRef.current?.fitView());
    return () => cancelAnimationFrame(raf);
  }, [graphViewMode, layoutedNodesForCanvas?.length, isLoadingGraph, nodes.length]);

  const scheduleManualEdgeHandleUpdate = useCallback(
    (positionChanges: Array<{ id: string; position: ManualNodePosition }>) => {
      for (const change of positionChanges) {
        pendingManualNodePositionsRef.current.set(
          change.id,
          change.position
        );
      }
      if (manualEdgeHandleFrameRef.current !== null) return;

      manualEdgeHandleFrameRef.current = requestAnimationFrame(() => {
        manualEdgeHandleFrameRef.current = null;
        const pendingPositions = new Map(
          pendingManualNodePositionsRef.current
        );
        pendingManualNodePositionsRef.current.clear();
        if (!pendingPositions.size) return;

        const affectedEdgeIds = new Set<string>();
        for (const nodeId of Array.from(pendingPositions.keys())) {
          for (const edgeId of graphEdgeIdsByNodeId.get(nodeId) ?? []) {
            affectedEdgeIds.add(edgeId);
          }
        }
        if (!affectedEdgeIds.size) return;

        const nextHandlesByEdgeId = new Map<
          string,
          { source: ManualEdgeHandle; target: ManualEdgeHandle }
        >();
        for (const edgeId of Array.from(affectedEdgeIds)) {
          const edge = graphEdgeById.get(edgeId);
          if (!edge || edge.source === edge.target) continue;

          const sourceNode = reactFlowInstance.getNode(edge.source);
          const targetNode = reactFlowInstance.getNode(edge.target);
          if (!sourceNode || !targetNode) continue;

          const handles = pickManualEdgeHandles(
            getManualNodeCenter(
              sourceNode,
              pendingPositions.get(sourceNode.id)
            ),
            getManualNodeCenter(
              targetNode,
              pendingPositions.get(targetNode.id)
            )
          );
          if (
            edge.sourceHandle === handles.source &&
            edge.targetHandle === handles.target
          ) {
            continue;
          }
          nextHandlesByEdgeId.set(edgeId, handles);
        }
        if (!nextHandlesByEdgeId.size) return;

        setEdges((previousEdges) => {
          let didChange = false;
          const nextEdges = previousEdges.map((edge) => {
            const handles = nextHandlesByEdgeId.get(edge.id);
            if (!handles) return edge;
            if (
              edge.sourceHandle === handles.source &&
              edge.targetHandle === handles.target
            ) {
              return edge;
            }

            didChange = true;
            return {
              ...edge,
              sourceHandle: handles.source,
              targetHandle: handles.target
            };
          });

          return didChange ? nextEdges : previousEdges;
        });
      });
    },
    [graphEdgeById, graphEdgeIdsByNodeId, reactFlowInstance, setEdges]
  );

  const onNodesChangeForCanvas = useCallback(
    (changes: any) => {
      if (!canEditSnapshot()) {
        onNodesChange(changes);
        return;
      }
      if (graphViewMode === 'analysis') {
        analysisLayout.applyNodesChange(changes);
        // In relational NON dobbiamo modificare posizioni/dimensioni del grafo canonico (free).
        // Manteniamo solo la selection (e remove) per far funzionare sidebar/context menu come nelle altre modalità.
        const canonChanges = Array.isArray(changes)
          ? changes.filter((c: any) => c?.type === 'select' || c?.type === 'remove')
          : [];
        const removedNodeIds = canonChanges
          .filter((c: any) => c?.type === 'remove' && c?.id)
          .map((c: any) => String(c.id));
        if (removedNodeIds.length) {
          const saved = manualNodePositionsByIdRef.current;
          for (const id of removedNodeIds) delete saved[id];
          schedulePersistManualNodePositions();
        }
        if (canonChanges.length) onNodesChange(canonChanges);
        return;
      }

      const removedNodeIds = Array.isArray(changes)
        ? changes.filter((c: any) => c?.type === 'remove' && c?.id).map((c: any) => String(c.id))
        : [];
      if (removedNodeIds.length) {
        const saved = manualNodePositionsByIdRef.current;
        for (const id of removedNodeIds) delete saved[id];
        schedulePersistManualNodePositions();
      }

      if (graphViewMode === 'free' && Array.isArray(changes)) {
        const saved = manualNodePositionsByIdRef.current;
        const positionChanges: Array<{
          id: string;
          position: ManualNodePosition;
        }> = [];
        let didUpdate = false;
        for (const change of changes) {
          if (change?.type !== 'position' || !change?.id) continue;
          const x = Number(change.position?.x);
          const y = Number(change.position?.y);
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
          const id = String(change.id);
          const position = { x, y };
          saved[id] = position;
          positionChanges.push({ id, position });
          didUpdate = true;
        }
        if (didUpdate) {
          schedulePersistManualNodePositions();
          scheduleManualEdgeHandleUpdate(positionChanges);
        }
      }

      onNodesChange(changes);
    },
    [
      canEditSnapshot,
      graphViewMode,
      analysisLayout,
      onNodesChange,
      scheduleManualEdgeHandleUpdate,
      schedulePersistManualNodePositions
    ]
  );

  const onEdgesChangeForCanvas = useCallback(
    (changes: any) => {
      if (!canEditSnapshot()) {
        onEdgesChange(changes);
        return;
      }
      if (graphViewMode === 'analysis') {
        analysisLayout.applyEdgesChange(changes);
        onEdgesChange(changes);
        return;
      }
      onEdgesChange(changes);
    },
    [canEditSnapshot, graphViewMode, analysisLayout, onEdgesChange]
  );

  /**
   * Used by TransformResultsSheet to decide if a result row is selectable:
   * - add_node: node not in graph
   * - add_edge: node exists, but can add edge from source
   * - blocked: already connected / invalid
   */
  const getTransformEntityAddability = useCallback(
    (
      entityId: string,
      signature: string,
      sourceNodeId?: string | null
    ): 'add_node' | 'add_edge' | 'blocked' => {
      const sourceId = String(sourceNodeId ?? '').trim();
      if (!sourceId) {
        // Without a source we cannot decide edge-add, so keep old behavior.
        const exists =
          nodes.some((n) => String(n.id) === String(entityId)) ||
          nodes.some((n) => {
            const data: any = (n as any)?.data ?? {};
            const type = String(data?.type ?? '').trim().toLowerCase();
            const label = String(data?.label ?? '')
              .trim()
              .replace(/\s+/g, ' ')
              .toLowerCase();
            return `${type}::${label}` === String(signature ?? '');
          });
        return exists ? 'blocked' : 'add_node';
      }

      // Resolve "existing node id" by id or by signature.
      let existingId: string | null = null;
      if (nodes.some((n) => String(n.id) === String(entityId))) existingId = String(entityId);
      if (!existingId) {
        for (const n of nodes) {
          const data: any = (n as any)?.data ?? {};
          const type = String(data?.type ?? '').trim().toLowerCase();
          const label = String(data?.label ?? '')
            .trim()
            .replace(/\s+/g, ' ')
            .toLowerCase();
          if (`${type}::${label}` === String(signature ?? '')) {
            existingId = String(n.id);
            break;
          }
        }
      }

      // Not in graph → can add node.
      if (!existingId) return 'add_node';

      // Same as source → nothing to do.
      if (existingId === sourceId) return 'blocked';

      function edgeKey(a: string, b: string) {
        return a < b ? `${a}↔${b}` : `${b}↔${a}`;
      }

      const key = edgeKey(sourceId, existingId);
      const alreadyConnected = edges.some((e) => {
        const s = String((e as any)?.source ?? '');
        const t = String((e as any)?.target ?? '');
        if (!s || !t) return false;
        return edgeKey(s, t) === key;
      });

      return alreadyConnected ? 'blocked' : 'add_edge';
    },
    [nodes, edges]
  );
  const sidebarAddNode = useLatestCallback(addNode);
  const sidebarMergeSelection = useLatestCallback(
    handleMergeCheckedSelection
  );
  const sidebarUnmergeSelection = useLatestCallback(
    handleUnmergeCheckedSelection
  );

  return (
    <GraphMutationContext.Provider value={canEditSnapshot}>
      <TransformLoggerProvider
        graphId={graphId}
        onAddResults={addResultsToGraph}
      >
        <EnabledPluginsProvider
          enabledPluginIds={enabledPluginIds}
          addons={addons as any}
          graphId={graphId}
          isLoading={pluginsLoading}
        >
          <div className='flex h-full min-h-0 w-full flex-col overflow-hidden'>
            {tabIsActive && (
              <TransformResultsAutoSheet
                getEntityAddability={getTransformEntityAddability}
              />
            )}
            <div className='relative flex min-h-0 w-full flex-1 overflow-hidden'>
              <div
                ref={panelGroupElRef}
                className='h-full min-h-0 w-full overflow-hidden'
              >
                <ResizablePanelGroup
                  direction='horizontal'
                  className='h-full w-full'
                >
                  <GraphSidebar
                    isReadOnly={writeGuard.blocked}
                    sidebarPanelRef={sidebarPanelRef}
                    lastOpenSidebarSizeRef={lastOpenSidebarSizeRef}
                    sidebarStateFromResizeRef={sidebarStateFromResizeRef}
                    isSidebarOpen={isSidebarOpen}
                    setIsSidebarOpen={setIsSidebarOpen}
                    sidebarCollapsedSizePct={sidebarCollapsedSizePct}
                    sidebarMinSizePct={sidebarMinSizePct}
                    sidebarMaxSizePct={sidebarMaxSizePct}
                    sidebarTab={sidebarTab}
                    setSidebarTab={setSidebarTab}
                    toggleSidebar={toggleSidebar}
                    sidebarSearchQuery={sidebarSearchQuery}
                    setSidebarSearchQuery={setSidebarSearchQuery}
                    sidebarSearchInputRef={sidebarSearchInputRef}
                    nodeCount={nodes.length}
                    selectedNodeCount={checkedGraphNodeIds.length}
                    selectedNodeIds={checkedGraphNodeIds}
                    onFitViewToSelection={handleFitViewToNodeIds}
                    onSelectAll={handleSelectAllNodes}
                    onDeleteSelection={handleDeleteCheckedGraphNodes}
                    onClearSelection={clearCheckedGraphNodes}
                    canMergeSelection={
                      mergeEligibilityForCheckedSelection.canMerge
                    }
                    onMergeSelection={sidebarMergeSelection}
                    canUnmergeSelection={canUnmergeCheckedSelection}
                    onUnmergeSelection={sidebarUnmergeSelection}
                    nodeTypeOptions={nodeTypeOptions}
                    filteredGraphTreeData={filteredGraphTreeData}
                    getGraphNodeCheckState={getGraphNodeCheckState}
                    toggleCheckedGraphNode={toggleCheckedGraphNode}
                    getMergedChildCount={getMergedChildCountForNodeId}
                    handleSelectNodeFromTree={handleSelectNodeFromTree}
                    nodeRowElByIdRef={nodeRowElByIdRef}
                    setEntitiesScrollRootEl={setEntitiesScrollRootEl}
                    openedAddSidebarCategories={openedAddSidebarCategories}
                    filteredGroupedNodeTypesForSidebar={
                      filteredGroupedNodeTypesForSidebar
                    }
                    normalizeSidebarSearchQuery={normalizeSidebarSearchQuery}
                    addNode={sidebarAddNode}
                    dndNodeTypeMime={DND_NODE_TYPE_MIME}
                  />

                  <ResizablePanel
                    defaultSize={
                      100 -
                      lastOpenSidebarSizeRef.current -
                      lastOpenDetailsSizeRef.current
                    }
                    minSize={55}
                    className='min-w-0 transition-[flex-grow,flex-basis] duration-200 ease-in-out'
                  >
                    <div className='flex h-full w-full flex-col overflow-hidden'>
                      {mounted && (
                        <GraphTopbar
                          isReadOnly={writeGuard.blocked}
                          graphId={graphId}
                          isSidebarOpen={isSidebarOpen}
                          isDetailsPanelOpen={isDetailsPanelOpen}
                          isNotesPanelOpen={isNotesPanelOpen}
                          isBottomDockExpanded={isBottomDockExpanded}
                          canUndo={canUndo}
                          canRedo={canRedo}
                          undo={undo}
                          redo={redo}
                          openTopbarMenuId={openTopbarMenuId}
                          openTopbarMenu={openTopbarMenu}
                          openTopbarMenuOnHover={openTopbarMenuOnHover}
                          scheduleCloseTopbarMenus={scheduleCloseTopbarMenus}
                          cancelCloseTopbarMenus={cancelCloseTopbarMenus}
                          setOpenTopbarMenuId={setOpenTopbarMenuId}
                          activeGraphCase={activeGraphCase}
                          onActiveGraphCaseChange={setActiveGraphCase}
                          edges={edges}
                          setEdges={setEdges}
                          setCurrentEdgeType={setCurrentEdgeType}
                          showGrid={showGrid}
                          setShowGrid={setShowGrid}
                          showMiniMap={showMiniMap}
                          setShowMiniMap={setShowMiniMap}
                          setBackgroundVariant={setBackgroundVariant}
                          graphViewMode={graphViewMode}
                          setGraphViewMode={setGraphViewMode}
                          lockedAxis={lockedAxis}
                          setLockedAxis={setLockedAxis}
                          layoutSettings={layoutSettings}
                          setLayoutSettings={setLayoutSettings}
                          applyLayout={applyLayout}
                          analysisLayoutSettings={analysisLayout.layoutOptions}
                          applyAnalysisLayout={applyAnalysisLayout}
                          analysisLayoutProgress={analysisLayout.layoutProgress}
                          handleFitView={handleFitView}
                          canFitViewToSelected={canFitViewToSelected}
                          handleFitViewToSelected={handleFitViewToSelected}
                          handleZoomIn={handleZoomIn}
                          handleZoomOut={handleZoomOut}
                          exportPNG={exportPNG}
                          exportPNGHighRes={exportPNGHighRes}
                          exportJPEG={exportJPEG}
                          exportHTML={exportHTML}
                          exportGraph={exportGraph}
                          importGraph={importGraph}
                          nodeTypeFilter={nodeTypeFilter}
                          setNodeTypeFilter={setNodeTypeFilter}
                          availableNodeTypes={availableNodeTypes}
                          refreshGraph={refreshGraph}
                          saveStatus={saveStatus}
                          toggleSidebar={toggleSidebar}
                          toggleNotesPanel={toggleNotesPanel}
                          openSidebarEntities={openSidebarEntities}
                          openSidebarAdd={openSidebarAdd}
                          handleBottomTabClick={handleBottomTabClick}
                        />
                      )}

                      <div
                        ref={bottomGroupElRef}
                        className='min-h-0 flex-1 overflow-hidden'
                      >
                        <ResizablePanelGroup
                          direction='vertical'
                          className='h-full w-full'
                        >
                          <ResizablePanel
                            defaultSize={
                              100 - lastOpenBottomDockSizeRef.current
                            }
                            minSize={20}
                            className='min-h-0'
                          >
                            <GraphLayoutSettingsProvider
                              value={graphLayoutSettingsValue}
                            >
                              <div
                                ref={analysisCanvasContainerRef}
                                className='relative h-full'
                              >
                                <AgentChangeHighlight changes={agentChanges} />
                                {graphLoadError === 'not_found' ? (
                                  <div className='flex h-full w-full items-center justify-center'>
                                    <div className='bg-background/60 max-w-md rounded-xl border p-6 text-center shadow-sm backdrop-blur'>
                                      <div className='text-lg font-semibold'>
                                        Graph not found
                                      </div>
                                      <div className='text-muted-foreground mt-2 text-sm'>
                                        The requested graph doesn’t exist (or
                                        you don’t have access).
                                      </div>
                                    </div>
                                  </div>
                                ) : graphLoadError === 'unauthorized' ? (
                                  <div className='flex h-full w-full items-center justify-center'>
                                    <div className='bg-background/60 max-w-md rounded-xl border p-6 text-center shadow-sm backdrop-blur'>
                                      <div className='text-lg font-semibold'>
                                        Unauthorized
                                      </div>
                                      <div className='text-muted-foreground mt-2 text-sm'>
                                        Please sign in again to access this
                                        graph.
                                      </div>
                                    </div>
                                  </div>
                                ) : graphViewMode === 'analysis' ? (
                                  <>
                                    <div
                                      className='h-full w-full'
                                      onDragOver={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        if (!isActive) return;
                                        const isNodeTypeDrag = Array.from(
                                          e.dataTransfer.types
                                        ).includes(DND_NODE_TYPE_MIME);
                                        if (isNodeTypeDrag)
                                          e.dataTransfer.dropEffect = 'copy';
                                      }}
                                      onDrop={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        if (!isActive) return;
                                        if (graphViewMode !== 'analysis')
                                          return;
                                        const droppedNodeType =
                                          e.dataTransfer.getData(
                                            DND_NODE_TYPE_MIME
                                          );
                                        if (!droppedNodeType) return;
                                        const api = analysisGraphApiRef.current;
                                        if (!api) return;
                                        const graphPos = api.screenToGraph({
                                          x: e.clientX,
                                          y: e.clientY
                                        });
                                        addNode(
                                          droppedNodeType as any,
                                          graphPos
                                        );
                                      }}
                                    >
                                      <AnalysisCanvas
                                        isLoadingGraph={isLoadingGraph}
                                        readOnly={writeGuard.blocked}
                                        canEditSnapshot={canEditSnapshot}
                                        isDark={isDark}
                                        nodes={filteredNodesForAnalysis as any}
                                        edges={filteredEdgesForAnalysis as any}
                                        onSelectNodeIds={(nodeIds) => {
                                          if (!tabIsActive) return;
                                          if (graphViewMode !== 'analysis')
                                            return;
                                          closeRelationalOverlays();
                                          const selected = new Set(nodeIds);
                                          shouldAutoOpenDetailsPanelRef.current =
                                            false;
                                          selectNodes((n) => selected.has(n.id));
                                          selectEdges(() => false);
                                        }}
                                        onBoxSelectStateChange={(
                                          isSelecting
                                        ) => {
                                          if (isSelecting)
                                            shouldAutoOpenDetailsPanelRef.current =
                                              false;
                                        }}
                                        layoutOverlay={
                                          analysisLayout.layoutProgress
                                            ?.isRunning
                                            ? {
                                                isRunning: true,
                                                pct: analysisLayout
                                                  .layoutProgress.pct,
                                                label: 'Updating layout'
                                              }
                                            : null
                                        }
                                        onGraphApi={(api) => {
                                          analysisGraphApiRef.current = api;
                                        }}
                                        onNodeClick={(event, node) =>
                                          onAnalysisNodeClick(
                                            event,
                                            node as any
                                          )
                                        }
                                        onEdgeClick={(event, edge) =>
                                          onAnalysisEdgeClick(
                                            event,
                                            edge as any
                                          )
                                        }
                                        onNodesDragEnd={(updates) => {
                                          if (!canEditSnapshot()) return;
                                          const nextPosById = new Map<
                                            string,
                                            { x: number; y: number }
                                          >();
                                          const changes: any[] = [];

                                          for (const u of updates) {
                                            const node = u.node as any;
                                            const data: any = node?.data ?? {};
                                            const size = Number(
                                              data?._relationalSize ??
                                                node?.width ??
                                                16
                                            );
                                            const nextPos = {
                                              x: u.next.x - size / 2,
                                              y: u.next.y - size / 2
                                            };
                                            nextPosById.set(
                                              String(node.id),
                                              nextPos
                                            );
                                            changes.push({
                                              id: String(node.id),
                                              type: 'position',
                                              position: nextPos,
                                              dragging: false
                                            });
                                          }

                                          // aggiorna grafo canonico (persistenza/export/coerenza)
                                          setNodes((nds) =>
                                            nds.map((n) => {
                                              const p = nextPosById.get(
                                                String(n.id)
                                              );
                                              return p
                                                ? { ...n, position: p }
                                                : n;
                                            })
                                          );

                                          // aggiorna layout state (posizioni effettive usate in Analysis)
                                          analysisLayout.applyNodesChange(
                                            changes as any
                                          );
                                        }}
                                        onNodeDragEnd={(node, next) => {
                                          if (!canEditSnapshot()) return;
                                          const data: any =
                                            (node as any).data ?? {};
                                          const size = Number(
                                            data?._relationalSize ??
                                              (node as any).width ??
                                              16
                                          );
                                          const nextPos = {
                                            x: next.x - size / 2,
                                            y: next.y - size / 2
                                          };

                                          // aggiorna grafo canonico (persistenza/export/coerenza)
                                          setNodes((nds) =>
                                            nds.map((n) =>
                                              n.id === node.id
                                                ? { ...n, position: nextPos }
                                                : n
                                            )
                                          );

                                          // aggiorna layout state (posizioni effettive usate in Analysis)
                                          analysisLayout.applyNodesChange([
                                            {
                                              id: node.id,
                                              type: 'position',
                                              position: nextPos,
                                              dragging: false
                                            } as any
                                          ]);
                                        }}
                                        onPaneClick={onAnalysisBackgroundClick}
                                        onPaneContextMenu={
                                          onAnalysisPaneContextMenu
                                        }
                                        onNodeContextMenu={(event, node) =>
                                          onNodeContextMenu(
                                            event as any,
                                            node as any
                                          )
                                        }
                                        onEdgeContextMenu={(event, edge) =>
                                          onEdgeContextMenu(
                                            event as any,
                                            edge as any
                                          )
                                        }
                                      />
                                    </div>
                                  </>
                                ) : graphViewMode === 'map' ? (
                                  <GraphMapView
                                    nodes={filteredNodesForReactFlow as any}
                                    selectedNodeIds={selectedNodeIdsForFit}
                                    onSelectNodeId={(nodeId) => {
                                      selectEdges(() => false);
                                      selectNodes((n) => String(n.id) === String(nodeId));
                                      openDetailsPanel();
                                    }}
                                    onMapApi={(api) => {
                                      mapGraphApiRef.current = api;
                                    }}
                                  />
                                ) : (
                                  <GraphCanvas
                                    graphId={graphId}
                                    isActive={tabIsActive}
                                    isLayoutLocked={graphViewMode === 'locked'}
                                    isReadOnly={writeGuard.blocked}
                                    lockedLanes={lockedLayout?.lanes}
                                    isDark={isDark}
                                    mounted={mounted}
                                    isDraggingOver={isDraggingOver}
                                    dropPosition={dropPositionRef.current}
                                    onDragOver={handleDragOver}
                                    onDragLeave={handleDragLeave}
                                    onDrop={handleDrop}
                                    reactFlowRootElRef={reactFlowRootElRef}
                                    previewNodePosition={previewNodePosition}
                                    previewNodeOffset={previewNodeOffset}
                                    suggestedNodeType={suggestedNodeType}
                                    nodeTypeOptions={nodeTypeOptions as any}
                                    reactFlowInstance={reactFlowInstance}
                                    isLoadingGraph={isLoadingGraph}
                                    graphName={graphName}
                                    recentCases={recentCases}
                                    refreshRecentCases={refreshRecentCases}
                                    addNodesToCase={addNodesToCase as any}
                                    openAddToCase={openAddToCase as any}
                                    openNewCaseDialogForNodes={
                                      openNewCaseDialogForNodes as any
                                    }
                                    layoutOverlay={null}
                                    nodes={filteredNodesForReactFlow as any}
                                    edges={filteredEdgesForReactFlow as any}
                                    onNodesChange={
                                      onNodesChangeForCanvas as any
                                    }
                                    onEdgesChange={
                                      onEdgesChangeForCanvas as any
                                    }
                                    onConnect={onConnect as any}
                                    onConnectStart={onConnectStart as any}
                                    onConnectEnd={onConnectEnd as any}
                                    onReconnect={onReconnect as any}
                                    onReconnectStart={onReconnectStart as any}
                                    onReconnectEnd={onReconnectEnd as any}
                                    onNodeClick={onFlowNodeClick as any}
                                    onEdgeClick={onFlowEdgeClick as any}
                                    onPaneContextMenu={onPaneContextMenu as any}
                                    onPaneClick={onPaneClick as any}
                                    onSelectionContextMenu={
                                      onSelectionContextMenu as any
                                    }
                                    onSelectionDragStart={() => {
                                      shouldAutoOpenDetailsPanelRef.current =
                                        false;
                                    }}
                                    onSelectionDragStop={() => {
                                      shouldAutoOpenDetailsPanelRef.current =
                                        false;
                                    }}
                                    onNodeContextMenu={onNodeContextMenu as any}
                                    onEdgeContextMenu={onEdgeContextMenu as any}
                                    onNodeDragStart={handleNodeDragStart as any}
                                    onNodeDrag={handleNodeDrag as any}
                                    isValidConnection={isValidConnection as any}
                                    nodeTypes={nodeTypes as any}
                                    edgeTypes={edgeTypes as any}
                                    showGrid={
                                      showGrid &&
                                      !(
                                        graphViewMode === 'free' && isGraphEmpty
                                      )
                                    }
                                    backgroundPatternId={backgroundPatternId}
                                    backgroundVariant={backgroundVariant}
                                    showMiniMap={showMiniMap}
                                    nodeColorMap={nodeColorMap}
                                    defaultEdgeOptions={defaultEdgeOptions}
                                    snapToGrid
                                  />
                                )}

                                {mounted &&
                                tabIsActive &&
                                isGraphEmpty &&
                                !isLoadingGraph &&
                                !graphLoadError ? (
                                  <EmptyGraphLegend
                                    onToggleSidebar={toggleSidebar}
                                    onToggleDetailsPanel={toggleDetailsPanel}
                                    onToggleConsole={() =>
                                      handleBottomTabClick('console')
                                    }
                                    onOpenCommandPalette={openCommandPalette}
                                  />
                                ) : null}
                              </div>
                            </GraphLayoutSettingsProvider>
                          </ResizablePanel>

                          <ResizableHandle className='bg-border/30 dark:bg-white/5' />

                          <ResizablePanel
                            ref={bottomDockPanelRef}
                            defaultSize={
                              isBottomDockExpanded
                                ? lastOpenBottomDockSizeRef.current
                                : bottomCollapsedSizePct
                            }
                            collapsible
                            collapsedSize={bottomCollapsedSizePct}
                            minSize={bottomMinSizePct}
                            maxSize={bottomMaxSizePct}
                            onResize={(size) => {
                              const collapseAt = bottomCollapsedSizePct + 0.5;
                              const expandAt = bottomCollapsedSizePct + 2;

                              if (size <= collapseAt && isBottomDockExpanded) {
                                setIsBottomDockExpanded(false);
                                return;
                              }
                              if (size >= expandAt && !isBottomDockExpanded)
                                setIsBottomDockExpanded(true);
                              if (size >= expandAt)
                                lastOpenBottomDockSizeRef.current = size;
                            }}
                            className='min-h-0 transition-[flex-grow,flex-basis] duration-200 ease-in-out'
                          >
                            <GraphBottomDock
                              isReadOnly={writeGuard.blocked}
                              isActive={tabIsActive}
                              bottomDockTab={bottomDockTab}
                              onBottomDockTabClick={handleBottomTabClick}
                              isBottomDockExpanded={isBottomDockExpanded}
                              setIsBottomDockExpanded={(next) => {
                                setIsBottomDockExpanded(next);
                                requestAnimationFrame(() => {
                                  if (!bottomDockPanelRef.current) return;
                                  bottomDockPanelRef.current.resize(
                                    next
                                      ? lastOpenBottomDockSizeRef.current
                                      : bottomCollapsedSizePct
                                  );
                                });
                              }}
                              consoleClearSignal={consoleClearSignal}
                              requestConsoleClear={requestConsoleClear}
                            />
                          </ResizablePanel>
                        </ResizablePanelGroup>
                      </div>
                    </div>
                  </ResizablePanel>

                  {retainedRightPanel === 'details' ? (
                    <GraphDetailsPanel
                      isReadOnly={writeGuard.blocked}
                      detailsPanelRef={detailsPanelRef}
                      lastOpenDetailsSizeRef={lastOpenDetailsSizeRef}
                      detailsStateFromResizeRef={detailsStateFromResizeRef}
                      isDetailsPanelOpen={isDetailsPanelOpen}
                      setIsDetailsPanelOpen={setIsDetailsPanelOpen}
                      detailsCollapsedSizePct={detailsCollapsedSizePct}
                      detailsMinSizePct={detailsMinSizePct}
                      detailsMaxSizePct={detailsMaxSizePct}
                      closeDetailsPanel={closeDetailsPanel}
                      isDark={isDark}
                      graphViewMode={graphViewMode}
                      nodes={nodes}
                      edges={edges}
                      onUpdateNode={({ nodeId, label, metadata }) => {
                        setNodes((prev) =>
                          prev.map((n) => {
                            if (String(n.id) !== String(nodeId)) return n;
                            const data = (n.data ?? {}) as any;
                            return {
                              ...n,
                              data: {
                                ...data,
                                label,
                                metadata
                              }
                            } as any;
                          })
                        );
                      }}
                      onSelectNodeId={(nodeId) => {
                        selectEdges(() => false);
                        selectNodes((n) => String(n.id) === String(nodeId));
                        openDetailsPanel();
                      }}
                      onSelectEdgeId={(edgeId) => {
                        selectNodes(() => false);
                        selectEdges((e) => String(e.id) === String(edgeId));
                        openDetailsPanel();
                      }}
                    />
                  ) : null}

                  {retainedRightPanel === 'notes' || isNotesPanelDetached ? (
                    <GraphNotesPanel
                      graphId={graphId}
                      graphName={graphName}
                      nodes={nodes}
                      notesPanelRef={notesPanelRef}
                      lastOpenNotesSizeRef={lastOpenNotesSizeRef}
                      notesStateFromResizeRef={notesStateFromResizeRef}
                      isNotesPanelOpen={isNotesPanelOpen}
                      setIsNotesPanelOpen={setIsNotesPanelOpen}
                      isDetached={isNotesPanelDetached}
                      detachNotesPanel={detachNotesPanel}
                      attachNotesPanel={attachNotesPanel}
                      notesCollapsedSizePct={notesCollapsedSizePct}
                      notesMinSizePct={notesMinSizePct}
                      notesMaxSizePct={notesMaxSizePct}
                      closeNotesPanel={closeNotesPanel}
                      onSelectNodeId={(nodeId) => {
                        selectEdges(() => false);
                        selectNodes((node) => String(node.id) === String(nodeId));
                        requestAnimationFrame(() =>
                          handleFitViewToNodeIds([nodeId])
                        );
                      }}
                    />
                  ) : null}
                </ResizablePanelGroup>
              </div>
            </div>

            {/* Context Menu per la Pane */}
            {tabIsActive && paneContextMenu && (
              <PaneContextMenu
                position={paneContextMenu.screen}
                flowPosition={paneContextMenu.flow}
                graphViewMode={graphViewMode}
                lockedAxis={lockedAxis}
                analysisLayoutEngine={analysisLayout.layoutOptions.engine}
                onClose={() => setPaneContextMenu(null)}
                onAddNode={(type, pos) =>
                  addNode(type as OSINTNodeData['type'], pos)
                }
                onFitView={handleFitView}
                onZoomIn={handleZoomIn}
                onZoomOut={handleZoomOut}
                onApplyLayout={(next) => applyLayout(next)}
                onSetLockedAxis={(next) => setLockedAxis(next)}
                onApplyAnalysisLayout={(next) => applyAnalysisLayout(next)}
                onRequestClearGraph={() => setIsClearGraphConfirmOpen(true)}
              />
            )}

            <AlertDialog
              open={isActive && isClearGraphConfirmOpen}
              onOpenChange={(open) => {
                if (!open) setIsClearGraphConfirmOpen(false);
              }}
            >
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear graph?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will remove all nodes and edges from the graph. This
                    action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      setIsClearGraphConfirmOpen(false);
                      clearGraph();
                    }}
                  >
                    Clear
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <AlertDialog
              open={isActive && Boolean(mergeDialog)}
              onOpenChange={(open) => {
                if (!open) setMergeDialog(null);
              }}
            >
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Merge nodes?</AlertDialogTitle>
                  <AlertDialogDescription>
                    You can merge nodes even if they have different parents.
                    Only the metadata of one node will be kept. Choose the
                    primary node (metadata source).
                  </AlertDialogDescription>
                </AlertDialogHeader>

                {mergeDialog ? (
                  <div className='space-y-3'>
                    <div className='text-muted-foreground text-xs'>
                      Type:{' '}
                      <span className='text-foreground font-medium'>
                        {mergeDialog.nodeType ?? '—'}
                      </span>
                    </div>

                    <div className='paranod-scrollbar max-h-[260px] overflow-auto pr-1'>
                      <div className='grid grid-cols-2 gap-2'>
                        {mergeDialog.nodeIds.map((id) => {
                          const n = (nodes as any[]).find(
                            (x) => String(x.id) === String(id)
                          );
                          const data = (n as any)?.data ?? {};
                          const label = String(
                            data?.label ?? data?.value ?? id
                          );
                          const isActive =
                            String(mergeDialog.primaryNodeId) === String(id);

                          return (
                            <button
                              key={id}
                              type='button'
                              className={cn(
                                'border-border/40 min-w-0 rounded-md border p-2 text-left transition-colors',
                                'hover:bg-accent/25',
                                isActive
                                  ? 'border-indigo-300 bg-indigo-50 text-indigo-950 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-50'
                                  : 'bg-background'
                              )}
                              onClick={() =>
                                setMergeDialog((prev) =>
                                  prev
                                    ? { ...prev, primaryNodeId: String(id) }
                                    : prev
                                )
                              }
                            >
                              <div className='min-w-0'>
                                <div className='min-w-0 truncate text-xs font-semibold'>
                                  {label}
                                </div>
                                <div className='text-muted-foreground mt-0.5 truncate text-[11px]'>
                                  {String(data?.type ?? '')}
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className='space-y-1'>
                      <div className='text-xs font-semibold'>
                        Metadata preview
                      </div>
                      {(() => {
                        const active = (nodes as any[]).find(
                          (x) =>
                            String(x.id) === String(mergeDialog.primaryNodeId)
                        );
                        const meta = (active as any)?.data?.metadata ?? null;
                        let text = 'No metadata';
                        try {
                          if (meta && typeof meta === 'object')
                            text = JSON.stringify(meta, null, 2);
                        } catch {
                          text = 'No metadata';
                        }
                        if (text.length > 8000)
                          text = text.slice(0, 8000) + '\n…';

                        return (
                          <div className='bg-muted/20 border-border/40 max-h-[240px] overflow-auto rounded-md border p-2'>
                            <pre className='text-[11px] leading-snug break-words whitespace-pre-wrap'>
                              {text}
                            </pre>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                ) : null}

                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleConfirmMerge}
                    disabled={!mergeDialog}
                  >
                    Merge
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            {/* Context Menu per la Selezione Multipla */}
            {tabIsActive && selectionContextMenu && (
              <SelectionContextMenu
                position={selectionContextMenu.position}
                selectedNodes={selectionContextMenu.nodes}
                selectedEdges={selectionContextMenu.edges}
                graphViewMode={graphViewMode}
                onClose={() => setSelectionContextMenu(null)}
                recentCases={recentCases}
                onRefreshRecentCases={() => {
                  refreshRecentCases();
                }}
                onQuickAddToCase={(caseId, nodesToAdd) => {
                  addNodesToCase({ caseId, nodes: nodesToAdd });
                }}
                onOpenAllCases={(nodesToAdd) => openAddToCase(nodesToAdd)}
                onOpenNewCase={(nodesToAdd) =>
                  openNewCaseDialogForNodes(nodesToAdd)
                }
                onChangeNodeType={handleChangeSelectionType}
                onLayoutSelection={handleLayoutSelection}
                onAlignSelection={handleAlignSelection}
                onDeleteSelection={handleDeleteSelection}
                onDuplicateSelection={handleDuplicateSelection}
                onCopySelection={handleCopySelection}
                onChangeEdgeColor={handleChangeEdgeColor}
                onChangeEdgeWidth={handleChangeEdgeWidth}
                onChangeEdgeType={handleChangeEdgeType}
                onToggleEdgeLabelVisible={handleToggleEdgeLabelVisible}
                onToggleEdgeDashed={handleToggleEdgeDashed}
                onToggleEdgeHideDirection={handleToggleEdgeHideDirection}
                onToggleEdgeBidirectional={handleToggleEdgeBidirectional}
                onInvertEdgeDirection={handleInvertEdgeDirection}
                canMergeSelection={
                  getMergeEligibility({
                    selectedNodeIds: selectionContextMenu.nodes.map((n) =>
                      String(n.id)
                    ),
                    nodes: nodes as any,
                    edges
                  }).canMerge
                }
                canUnmergeSelection={
                  selectionContextMenu.nodes.length === 1 &&
                  canUnmergeNode(selectionContextMenu.nodes[0] as any)
                }
                onMergeSelection={handleMergeCheckedSelection}
                onUnmergeSelection={handleUnmergeCheckedSelection}
              />
            )}

            {tabIsActive &&
            graphViewMode === 'analysis' &&
            relationalNodeContextMenu ? (
              <NodeContextMenu
                position={relationalNodeContextMenu.position}
                graphViewMode='analysis'
                nodeId={relationalNodeContextMenu.nodeId}
                nodeType={String(
                  (graphNodeById.get(relationalNodeContextMenu.nodeId) as any)
                    ?.data?.type ?? 'custom'
                )}
                nodeLabel={String(
                  (graphNodeById.get(relationalNodeContextMenu.nodeId) as any)
                    ?.data?.label ?? ''
                )}
                nodeMetadata={
                  ((graphNodeById.get(relationalNodeContextMenu.nodeId) as any)
                    ?.data?.metadata ?? null) as any
                }
                sourcePosition={{
                  x:
                    (graphNodeById.get(relationalNodeContextMenu.nodeId) as any)
                      ?.position?.x ?? 0,
                  y:
                    (graphNodeById.get(relationalNodeContextMenu.nodeId) as any)
                      ?.position?.y ?? 0
                }}
                onClose={() => setRelationalNodeContextMenu(null)}
                getSelectedNodes={() => nodes.filter((n) => n.selected) as any}
                addToCase={{
                  recentCases,
                  refreshRecentCases: () => {
                    void refreshRecentCases();
                  },
                  addNodesToCase: ({ caseId, nodes: nodesToAdd }) => {
                    void addNodesToCase({ caseId, nodes: nodesToAdd as any });
                  },
                  openAllCasesDialog: (nodesToAdd) =>
                    openAddToCase(nodesToAdd as any),
                  openNewCaseDialog: (nodesToAdd) =>
                    openNewCaseDialogForNodes(nodesToAdd as any)
                }}
                onOpenNode={() => {
                  setOpenNodeDialogNodeId(relationalNodeContextMenu.nodeId);
                }}
                onEditLabel={() =>
                  openRelationalLabelEditor(relationalNodeContextMenu.nodeId)
                }
                onDuplicate={handleDuplicateSelection}
                onChangeType={(nextType) =>
                  applyRelationalNodeType(
                    relationalNodeContextMenu.nodeId,
                    nextType
                  )
                }
                canUnmerge={canUnmergeNode(
                  graphNodeById.get(relationalNodeContextMenu.nodeId) as any
                )}
                onUnmerge={handleUnmergeCheckedSelection}
                onDelete={() =>
                  deleteRelationalNode(relationalNodeContextMenu.nodeId)
                }
              />
            ) : null}

            {(() => {
              const nodeId = openNodeDialogNodeId;
              const node = nodeId ? (graphNodeById.get(nodeId) as any) : null;
              const nodeData = (node?.data ?? null) as any;
              const type = String(nodeData?.type ?? 'custom');
              const typeUi =
                (nodeTypeByType as any)[type] ?? (nodeTypeByType as any).custom;
              const Icon = (typeUi?.icon ??
                (nodeTypeByType as any).custom?.icon) as any;
              const headerBg = typeUi?.ui?.headerBg ?? 'bg-muted';
              const headerText = typeUi?.ui?.headerText ?? '';
              const titleLabel = typeUi?.label ?? type;

              if (!nodeId || !nodeData) return null;

              // Ripristina preview "speciali" (file / maps) come in `osint-node.tsx`.
              if (type === 'maps') {
                return (
                  <MapPreviewDialog
                    open={tabIsActive && Boolean(openNodeDialogNodeId)}
                    onOpenChange={(open) => {
                      if (open) return;
                      setOpenNodeDialogNodeId(null);
                    }}
                    panelProps={{
                      nodeId: String(nodeId),
                      nodeData,
                      headerBgClassName: headerBg,
                      headerTextClassName: headerText,
                      titleLabel,
                      Icon,
                      logoUrl: null,
                      isEditMode: analysisOpenNodeDialogState.isEditMode,
                      setIsEditMode: (next) =>
                        setAnalysisOpenNodeDialogState((prev) => ({
                          ...prev,
                          isEditMode: next
                        })),
                      editedLabel: analysisOpenNodeDialogState.editedLabel,
                      setEditedLabel: (next) =>
                        setAnalysisOpenNodeDialogState((prev) => ({
                          ...prev,
                          editedLabel: next
                        })),
                      editedMetadata:
                        analysisOpenNodeDialogState.editedMetadata,
                      setEditedMetadata: (next) =>
                        setAnalysisOpenNodeDialogState((prev) => ({
                          ...prev,
                          editedMetadata: next
                        })),
                      newMetaKey: analysisOpenNodeDialogState.newMetaKey,
                      setNewMetaKey: (next) =>
                        setAnalysisOpenNodeDialogState((prev) => ({
                          ...prev,
                          newMetaKey: next
                        })),
                      newMetaValue: analysisOpenNodeDialogState.newMetaValue,
                      setNewMetaValue: (next) =>
                        setAnalysisOpenNodeDialogState((prev) => ({
                          ...prev,
                          newMetaValue: next
                        })),
                      onUpdateMetadataValue: (key, value) =>
                        setAnalysisOpenNodeDialogState((prev) => ({
                          ...prev,
                          editedMetadata: {
                            ...(prev.editedMetadata ?? {}),
                            [key]: value
                          }
                        })),
                      onRemoveMetadataKey: (key) =>
                        setAnalysisOpenNodeDialogState((prev) => {
                          const next = { ...(prev.editedMetadata ?? {}) };
                          delete next[key];
                          return { ...prev, editedMetadata: next };
                        }),
                      onAddMetadataKeyValue: () => {
                        setAnalysisOpenNodeDialogState((prev) => {
                          const k = String(prev.newMetaKey ?? '').trim();
                          if (!k) return prev;
                          return {
                            ...prev,
                            editedMetadata: {
                              ...(prev.editedMetadata ?? {}),
                              [k]: prev.newMetaValue
                            },
                            newMetaKey: '',
                            newMetaValue: ''
                          };
                        });
                      },
                      onSave: () => {
                        setNodes((prev) =>
                          prev.map((n) => {
                            if (String(n.id) !== String(nodeId)) return n;
                            const d = (n.data ?? {}) as any;
                            return {
                              ...n,
                              data: {
                                ...d,
                                label: analysisOpenNodeDialogState.editedLabel,
                                metadata:
                                  analysisOpenNodeDialogState.editedMetadata
                              }
                            } as any;
                          })
                        );
                        setOpenNodeDialogNodeId(null);
                      },
                      onDelete: () => {
                        setOpenNodeDialogNodeId(null);
                        deleteRelationalNode(String(nodeId));
                      },
                      availableTransformNames: []
                    }}
                  />
                );
              }

              if (FILE_PREVIEW_NODE_TYPES.has(type)) {
                const meta: any = nodeData?.metadata ?? {};
                const fileUrl = String(meta?.fileUrl || nodeData?.label || '');
                const fileName = String(
                  meta?.filename || nodeData?.label || ''
                );
                const fileExtension = String(meta?.extension || '');
                if (fileUrl) {
                  return (
                    <FilePreviewDialog
                      key={fileUrl}
                      open={tabIsActive && Boolean(openNodeDialogNodeId)}
                      onOpenChange={(open) => {
                        if (open) return;
                        setOpenNodeDialogNodeId(null);
                      }}
                      fileUrl={fileUrl}
                      fileName={fileName}
                      fileType={String(nodeData?.type ?? type)}
                      fileExtension={fileExtension}
                      panelProps={{
                        nodeId: String(nodeId),
                        nodeData,
                        headerBgClassName: headerBg,
                        headerTextClassName: headerText,
                        titleLabel,
                        Icon,
                        logoUrl: null,
                        isEditMode: analysisOpenNodeDialogState.isEditMode,
                        setIsEditMode: (next) =>
                          setAnalysisOpenNodeDialogState((prev) => ({
                            ...prev,
                            isEditMode: next
                          })),
                        editedLabel: analysisOpenNodeDialogState.editedLabel,
                        setEditedLabel: (next) =>
                          setAnalysisOpenNodeDialogState((prev) => ({
                            ...prev,
                            editedLabel: next
                          })),
                        editedMetadata:
                          analysisOpenNodeDialogState.editedMetadata,
                        setEditedMetadata: (next) =>
                          setAnalysisOpenNodeDialogState((prev) => ({
                            ...prev,
                            editedMetadata: next
                          })),
                        newMetaKey: analysisOpenNodeDialogState.newMetaKey,
                        setNewMetaKey: (next) =>
                          setAnalysisOpenNodeDialogState((prev) => ({
                            ...prev,
                            newMetaKey: next
                          })),
                        newMetaValue: analysisOpenNodeDialogState.newMetaValue,
                        setNewMetaValue: (next) =>
                          setAnalysisOpenNodeDialogState((prev) => ({
                            ...prev,
                            newMetaValue: next
                          })),
                        onUpdateMetadataValue: (key, value) =>
                          setAnalysisOpenNodeDialogState((prev) => ({
                            ...prev,
                            editedMetadata: {
                              ...(prev.editedMetadata ?? {}),
                              [key]: value
                            }
                          })),
                        onRemoveMetadataKey: (key) =>
                          setAnalysisOpenNodeDialogState((prev) => {
                            const next = { ...(prev.editedMetadata ?? {}) };
                            delete next[key];
                            return { ...prev, editedMetadata: next };
                          }),
                        onAddMetadataKeyValue: () => {
                          setAnalysisOpenNodeDialogState((prev) => {
                            const k = String(prev.newMetaKey ?? '').trim();
                            if (!k) return prev;
                            return {
                              ...prev,
                              editedMetadata: {
                                ...(prev.editedMetadata ?? {}),
                                [k]: prev.newMetaValue
                              },
                              newMetaKey: '',
                              newMetaValue: ''
                            };
                          });
                        },
                        onSave: () => {
                          setNodes((prev) =>
                            prev.map((n) => {
                              if (String(n.id) !== String(nodeId)) return n;
                              const d = (n.data ?? {}) as any;
                              return {
                                ...n,
                                data: {
                                  ...d,
                                  label:
                                    analysisOpenNodeDialogState.editedLabel,
                                  metadata:
                                    analysisOpenNodeDialogState.editedMetadata
                                }
                              } as any;
                            })
                          );
                          setOpenNodeDialogNodeId(null);
                        },
                        onDelete: () => {
                          setOpenNodeDialogNodeId(null);
                          deleteRelationalNode(String(nodeId));
                        },
                        availableTransformNames: []
                      }}
                    />
                  );
                }
              }

              return (
                <OpenNodeDialog
                  open={tabIsActive && Boolean(openNodeDialogNodeId)}
                  onOpenChange={(open) => {
                    if (open) return;
                    setOpenNodeDialogNodeId(null);
                  }}
                  nodeId={String(nodeId)}
                  nodeData={nodeData}
                  headerBgClassName={headerBg}
                  headerTextClassName={headerText}
                  titleLabel={titleLabel}
                  Icon={Icon}
                  logoUrl={null}
                  isEditMode={analysisOpenNodeDialogState.isEditMode}
                  setIsEditMode={(next) =>
                    setAnalysisOpenNodeDialogState((prev) => ({
                      ...prev,
                      isEditMode: next
                    }))
                  }
                  editedLabel={analysisOpenNodeDialogState.editedLabel}
                  setEditedLabel={(next) =>
                    setAnalysisOpenNodeDialogState((prev) => ({
                      ...prev,
                      editedLabel: next
                    }))
                  }
                  editedMetadata={analysisOpenNodeDialogState.editedMetadata}
                  setEditedMetadata={(next) =>
                    setAnalysisOpenNodeDialogState((prev) => ({
                      ...prev,
                      editedMetadata: next
                    }))
                  }
                  newMetaKey={analysisOpenNodeDialogState.newMetaKey}
                  setNewMetaKey={(next) =>
                    setAnalysisOpenNodeDialogState((prev) => ({
                      ...prev,
                      newMetaKey: next
                    }))
                  }
                  newMetaValue={analysisOpenNodeDialogState.newMetaValue}
                  setNewMetaValue={(next) =>
                    setAnalysisOpenNodeDialogState((prev) => ({
                      ...prev,
                      newMetaValue: next
                    }))
                  }
                  onUpdateMetadataValue={(key, value) =>
                    setAnalysisOpenNodeDialogState((prev) => ({
                      ...prev,
                      editedMetadata: {
                        ...(prev.editedMetadata ?? {}),
                        [key]: value
                      }
                    }))
                  }
                  onRemoveMetadataKey={(key) =>
                    setAnalysisOpenNodeDialogState((prev) => {
                      const next = { ...(prev.editedMetadata ?? {}) };
                      delete next[key];
                      return { ...prev, editedMetadata: next };
                    })
                  }
                  onAddMetadataKeyValue={() => {
                    setAnalysisOpenNodeDialogState((prev) => {
                      const k = String(prev.newMetaKey ?? '').trim();
                      if (!k) return prev;
                      return {
                        ...prev,
                        editedMetadata: {
                          ...(prev.editedMetadata ?? {}),
                          [k]: prev.newMetaValue
                        },
                        newMetaKey: '',
                        newMetaValue: ''
                      };
                    });
                  }}
                  onSave={() => {
                    setNodes((prev) =>
                      prev.map((n) => {
                        if (String(n.id) !== String(nodeId)) return n;
                        const d = (n.data ?? {}) as any;
                        return {
                          ...n,
                          data: {
                            ...d,
                            label: analysisOpenNodeDialogState.editedLabel,
                            metadata: analysisOpenNodeDialogState.editedMetadata
                          }
                        } as any;
                      })
                    );
                    setOpenNodeDialogNodeId(null);
                  }}
                  onDelete={() => {
                    setOpenNodeDialogNodeId(null);
                    deleteRelationalNode(String(nodeId));
                  }}
                  availableTransformNames={[]}
                />
              );
            })()}

            {tabIsActive &&
            graphViewMode === 'analysis' &&
            relationalEdgeContextMenu ? (
              <AnalysisEdgeContextMenu
                position={relationalEdgeContextMenu.position}
                onClose={() => setRelationalEdgeContextMenu(null)}
                onChangeColor={(color) =>
                  updateRelationalEdge(
                    relationalEdgeContextMenu.edgeId,
                    (e) => ({
                      ...e,
                      data: { ...(e.data ?? {}), color }
                    })
                  )
                }
                onChangeWidth={(width) =>
                  updateRelationalEdge(
                    relationalEdgeContextMenu.edgeId,
                    (e) => ({
                      ...e,
                      data: { ...(e.data ?? {}), strokeWidth: width }
                    })
                  )
                }
                onChangeType={(type) =>
                  updateRelationalEdge(
                    relationalEdgeContextMenu.edgeId,
                    (e) => ({
                      ...e,
                      data: { ...(e.data ?? {}), edgeType: type }
                    })
                  )
                }
                onInvertDirection={() =>
                  updateRelationalEdge(
                    relationalEdgeContextMenu.edgeId,
                    (e) => ({
                      ...e,
                      source: e.target,
                      target: e.source,
                      sourceHandle: e.targetHandle,
                      targetHandle: e.sourceHandle
                    })
                  )
                }
                onDelete={() =>
                  deleteRelationalEdge(relationalEdgeContextMenu.edgeId)
                }
              />
            ) : null}

            {isActive &&
            graphViewMode === 'analysis' &&
            relationalLabelEditor ? (
              <AnalysisEditNodeLabelDialog
                open={true}
                title={relationalLabelEditor.title}
                description={relationalLabelEditor.description}
                initialValue={relationalLabelEditor.initialLabel}
                onOpenChange={(open) => {
                  if (!open) setRelationalLabelEditor(null);
                }}
                onSubmit={(nextLabel) => {
                  const nodeId = relationalLabelEditor.nodeId;
                  const shouldPan = Boolean(
                    relationalLabelEditor.shouldPanOnSubmit
                  );
                  setNodes((nds) =>
                    nds.map((n) =>
                      n.id === nodeId
                        ? {
                            ...n,
                            data: {
                              ...n.data,
                              label: nextLabel,
                              metadata: {
                                ...((n.data as any)?.metadata ?? {}),
                                _autoEdit: false
                              }
                            }
                          }
                        : n
                    )
                  );
                  setRelationalLabelEditor(null);
                  toast.success('Label updated');

                  // Dopo la conferma del nome, centra il nuovo nodo senza cambiare zoom.
                  if (shouldPan && graphViewMode === 'analysis') {
                    let raf2 = 0;
                    const raf1 = requestAnimationFrame(() => {
                      raf2 = requestAnimationFrame(() => {
                        analysisGraphApiRef.current?.panToNode(nodeId);
                      });
                    });
                    // best-effort cleanup
                    setTimeout(() => {
                      cancelAnimationFrame(raf1);
                      if (raf2) cancelAnimationFrame(raf2);
                    }, 1200);
                  }
                }}
              />
            ) : null}

            {isActive ? (
              <AddToCaseDialog
                open={addToCaseOpen}
                graphId={graphId}
                nodes={addToCaseNodes}
                onClose={() => {
                  setAddToCaseOpen(false);
                  setAddToCaseNodes([]);
                }}
              />
            ) : null}

            {isActive ? (
              <GraphCaseDialog
                open={graphCaseDialogOpen}
                graphId={graphId}
                mode={graphCaseMode}
                onClose={() => setGraphCaseDialogOpen(false)}
              />
            ) : null}

            {isActive ? (
              <CreateCaseDialog
                open={createCaseOpen}
                defaultName={graphName ? `${graphName} – Case` : 'New Case'}
                onClose={() => setCreateCaseOpen(false)}
                onCreated={async (created) => {
                  // From graph: always link current graph to the new case if we have graphId
                  if (graphId) {
                    await fetch(`/api/cases/${created.id}/graphs`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ graphId })
                    }).catch(() => {});
                  }
                  // If this was invoked from Add-to-Case on nodes, also pin them
                  if (createCaseNodes.length) {
                    await addNodesToCase({
                      caseId: created.id,
                      nodes: createCaseNodes
                    });
                    setCreateCaseNodes([]);
                  }
                  await refreshRecentCases();
                }}
              />
            ) : null}

            <CommandDialog
              open={tabIsActive && isCommandPaletteOpen}
              onOpenChange={setIsCommandPaletteOpen}
              title='Command Palette'
              description='Search for a command to run...'
            >
              <CommandInput placeholder='Type a command…' />
              <CommandList>
                <CommandEmpty>No results found.</CommandEmpty>
                <CommandGroup heading='Navigation & panels'>
                  <CommandItem
                    value='toggle-analysis-panel'
                    onSelect={() => {
                      toggleRightPanel();
                      setIsCommandPaletteOpen(false);
                    }}
                  >
                    Toggle last used right panel
                    <CommandShortcut>Ctrl+L</CommandShortcut>
                  </CommandItem>
                  <CommandItem
                    value='toggle-panel'
                    onSelect={() => {
                      toggleSidebar();
                      setIsCommandPaletteOpen(false);
                    }}
                  >
                    Toggle panel
                    <CommandShortcut>Ctrl+B</CommandShortcut>
                  </CommandItem>
                  <CommandItem
                    value='toggle-console'
                    onSelect={() => {
                      handleBottomTabClick('console');
                      setIsCommandPaletteOpen(false);
                    }}
                  >
                    Toggle console
                    <CommandShortcut>Ctrl+D</CommandShortcut>
                  </CommandItem>
                </CommandGroup>
                <CommandSeparator />
                <CommandGroup heading='Commands'>
                  <CommandItem value='open-command-palette' onSelect={() => {}}>
                    Open command palette
                    <CommandShortcut>Ctrl+J</CommandShortcut>
                  </CommandItem>
                </CommandGroup>
              </CommandList>
            </CommandDialog>
          </div>
        </EnabledPluginsProvider>
      </TransformLoggerProvider>
    </GraphMutationContext.Provider>
  );
}

// NOTE: GraphViewPage wrapper lives in `src/features/graph/components/graph-view-page.tsx`.

'use client';

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
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup
} from '@/components/ui/resizable';
import { Textarea } from '@/components/ui/textarea';
import { FlowRunsDialog } from '@/features/flow/components/flow-runs-dialog';
import { createFlowGuideNoteNode } from '@/features/flow/lib/flow-guide-note';
import type {
  FlowNodeData,
  FlowTransformNodeData,
  FlowTriggerNodeData
} from '@/features/flow/types';
import { GraphBottomDock } from '@/features/graph/components/graph-editor/components/graph-bottom-dock';
import {
  clampNumber,
  pxToPercent
} from '@/features/graph/components/graph-editor/utils/sizing';
import { TransformLoggerProvider } from '@/features/graph/contexts/transform-logger-context';
import { matchesInputType, type EntityType } from '@/features/plugins';
import { useEnabledPlugins } from '@/features/plugins/hooks/use-enabled-plugins';
import { usePlugins } from '@/features/plugins/hooks/use-plugins';
import { useWorkspaceTabsStore } from '@/features/workspace/store/workspace-tabs-store';
import { cn } from '@/lib/utils';
import { useTheme } from 'next-themes';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ImperativePanelHandle } from 'react-resizable-panels';
import ReactFlow, {
  addEdge,
  Background,
  BackgroundVariant,
  Connection,
  Edge,
  MiniMap,
  Node,
  Position,
  useEdgesState,
  useNodesState,
  useReactFlow
} from 'reactflow';
import { toast } from 'sonner';
import { FlowNodeContextMenu } from './components/flow-node-context-menu';
import { FlowPaneContextMenu } from './components/flow-pane-context-menu';
import { FlowSidepanel } from './components/flow-sidepanel';
import { FlowTestDialog } from './components/flow-test-dialog';
import { FlowTopbar } from './components/flow-topbar';
import { OpenTransformNodeDialog } from './components/open-transform-node-dialog';
import { FlowEdge } from './edges/flow-edge';
import type { FlowTransformPickerItem } from './flow-connection-filter-context';
import { FlowConnectionFilterProvider } from './flow-connection-filter-context';
import { useFlowAutosave } from './hooks/use-flow-autosave';
import { useFlowHistory } from './hooks/use-flow-history';
import { FlowNoteNode } from './nodes/flow-note-node';
import { FlowTransformNode } from './nodes/flow-transform-node';
import { FlowTriggerNode } from './nodes/flow-trigger-node';
import { createFlowStateHash } from './utils/flow-hash';
import { exportFlowJson, openFlowImportPicker } from './utils/flow-io';

type FlowNode = Node<FlowNodeData>;

interface FlowEditorProps {
  flowId?: string;
  isActive?: boolean;
  className?: string;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function getEstimatedFlowNodeDimensions(node: Node): {
  width: number;
  height: number;
} {
  if (node.width && node.height)
    return { width: node.width, height: node.height };

  const nodeType = String(node.type ?? '');
  if (nodeType === 'trigger') return { width: 120, height: 96 };
  if (nodeType === 'transform') return { width: 240, height: 116 };
  return { width: 280, height: 170 };
}

function rectsOverlap(a: Rect, b: Rect, spacingPx: number) {
  return !(
    a.x + a.width + spacingPx < b.x ||
    a.x > b.x + b.width + spacingPx ||
    a.y + a.height + spacingPx < b.y ||
    a.y > b.y + b.height + spacingPx
  );
}

function buildSpiralOffsets(args: {
  stepX: number;
  stepY: number;
  maxRadius: number;
}): Array<{ dx: number; dy: number }> {
  const out: Array<{ dx: number; dy: number }> = [{ dx: 0, dy: 0 }];
  for (let r = 1; r <= args.maxRadius; r++) {
    // top + bottom edges
    for (let x = -r; x <= r; x++) {
      out.push({ dx: x * args.stepX, dy: -r * args.stepY });
      out.push({ dx: x * args.stepX, dy: r * args.stepY });
    }
    // left + right edges (skip corners already added)
    for (let y = -r + 1; y <= r - 1; y++) {
      out.push({ dx: -r * args.stepX, dy: y * args.stepY });
      out.push({ dx: r * args.stepX, dy: y * args.stepY });
    }
  }
  return out;
}

function adjustFlowNodePositionIfOverlapping(
  nodeToAdjust: Node,
  otherNodes: Node[],
  spacingPx: number = 28
): Node {
  const dims = getEstimatedFlowNodeDimensions(nodeToAdjust);
  const start = nodeToAdjust.position;

  const existingRects: Rect[] = otherNodes
    .filter((n) => n.id !== nodeToAdjust.id)
    .map((n) => {
      const d = getEstimatedFlowNodeDimensions(n);
      return {
        x: n.position.x,
        y: n.position.y,
        width: d.width,
        height: d.height
      };
    });

  const offsets = buildSpiralOffsets({
    stepX: dims.width + spacingPx,
    stepY: dims.height + spacingPx,
    maxRadius: 8
  });

  for (const off of offsets) {
    const testRect: Rect = {
      x: start.x + off.dx,
      y: start.y + off.dy,
      width: dims.width,
      height: dims.height
    };
    const overlaps = existingRects.some((r) =>
      rectsOverlap(testRect, r, spacingPx)
    );
    if (!overlaps) {
      if (!off.dx && !off.dy) return nodeToAdjust;
      return { ...nodeToAdjust, position: { x: testRect.x, y: testRect.y } };
    }
  }

  // fallback: keep original
  return nodeToAdjust;
}

function getFlowSourceHandleId(args: {
  node: Node;
  outType: string;
  edges: Edge[];
}) {
  const outType = String(args.outType);
  if (String(args.node.type ?? '') === 'trigger') {
    return `out:${outType}:0`;
  }

  const data: any = args.node.data ?? {};
  const raw = Array.isArray(data?.outputTypes)
    ? (data.outputTypes as any[]).map((type) => String(type))
    : [];
  const counts = new Map<string, number>();
  const matchingHandleIds: string[] = [];
  for (const type of raw) {
    const index = counts.get(type) ?? 0;
    counts.set(type, index + 1);
    if (type === outType) matchingHandleIds.push(`out:${outType}:${index}`);
  }
  if (!matchingHandleIds.length) return `out:${outType}:0`;

  const usedHandleIds = new Set(
    args.edges
      .filter((edge) => String(edge.source) === args.node.id)
      .map((edge) => String(edge.sourceHandle ?? ''))
      .filter(Boolean)
  );
  return (
    matchingHandleIds.find((handleId) => !usedHandleIds.has(handleId)) ??
    matchingHandleIds[0]
  );
}

function getLinearFlowLayout(nodes: Node[], edges: Edge[]): Node[] {
  const flowNodes = nodes.filter((node) =>
    ['trigger', 'transform'].includes(String(node.type ?? ''))
  );
  if (!flowNodes.length) return nodes;

  const flowNodeIds = new Set(flowNodes.map((node) => node.id));
  const childrenById = new Map<string, string[]>();
  const indegreeById = new Map<string, number>();
  const depthById = new Map<string, number>();
  const nodeOrderById = new Map(
    flowNodes.map((node, index) => [node.id, index])
  );

  for (const node of flowNodes) {
    childrenById.set(node.id, []);
    indegreeById.set(node.id, 0);
  }

  for (const edge of edges) {
    if (!flowNodeIds.has(edge.source) || !flowNodeIds.has(edge.target))
      continue;
    childrenById.get(edge.source)?.push(edge.target);
    indegreeById.set(edge.target, (indegreeById.get(edge.target) ?? 0) + 1);
  }

  const trigger = flowNodes.find((node) => node.type === 'trigger');
  const rootIds = flowNodes
    .filter((node) => (indegreeById.get(node.id) ?? 0) === 0)
    .map((node) => node.id);
  const orderedRootIds = trigger
    ? [trigger.id, ...rootIds.filter((nodeId) => nodeId !== trigger.id)]
    : rootIds;
  const queue = [...orderedRootIds];

  for (const rootId of orderedRootIds) {
    depthById.set(rootId, trigger && rootId !== trigger.id ? 1 : 0);
  }

  const remainingIndegree = new Map(indegreeById);
  while (queue.length) {
    const nodeId = queue.shift()!;
    const depth = depthById.get(nodeId) ?? 0;
    for (const childId of childrenById.get(nodeId) ?? []) {
      depthById.set(childId, Math.max(depthById.get(childId) ?? 0, depth + 1));
      const nextIndegree = (remainingIndegree.get(childId) ?? 0) - 1;
      remainingIndegree.set(childId, nextIndegree);
      if (nextIndegree === 0) queue.push(childId);
    }
  }

  let fallbackDepth = Math.max(0, ...Array.from(depthById.values())) + 1;
  for (const node of flowNodes) {
    if (depthById.has(node.id)) continue;
    depthById.set(node.id, fallbackDepth);
    fallbackDepth += 1;
  }

  const nodesByDepth = new Map<number, Node[]>();
  for (const node of flowNodes) {
    const depth = depthById.get(node.id) ?? 0;
    const levelNodes = nodesByDepth.get(depth) ?? [];
    levelNodes.push(node);
    nodesByDepth.set(depth, levelNodes);
  }
  for (const levelNodes of Array.from(nodesByDepth.values())) {
    levelNodes.sort(
      (a: Node, b: Node) =>
        (nodeOrderById.get(a.id) ?? 0) - (nodeOrderById.get(b.id) ?? 0)
    );
  }

  const anchorNode = trigger ?? flowNodes[0];
  const anchorDimensions = getEstimatedFlowNodeDimensions(anchorNode);
  const anchorCenterY = anchorNode.position.y + anchorDimensions.height / 2;
  const sortedDepths = Array.from(nodesByDepth.keys()).sort((a, b) => a - b);
  const positionsById = new Map<string, { x: number; y: number }>();
  const levelGapX = 56;
  const siblingGapY = 22;
  let levelX = anchorNode.position.x;
  let previousLevelWidth = 0;

  sortedDepths.forEach((depth, levelIndex) => {
    const levelNodes = nodesByDepth.get(depth) ?? [];
    const dimensions = levelNodes.map(getEstimatedFlowNodeDimensions);
    const levelWidth = Math.max(...dimensions.map((dims) => dims.width), 0);
    if (levelIndex > 0) levelX += previousLevelWidth + levelGapX;

    const totalHeight =
      dimensions.reduce((total, dims) => total + dims.height, 0) +
      Math.max(0, levelNodes.length - 1) * siblingGapY;
    let y = anchorCenterY - totalHeight / 2;

    levelNodes.forEach((node, index) => {
      positionsById.set(node.id, { x: levelX, y });
      y += dimensions[index].height + siblingGapY;
    });

    previousLevelWidth = levelWidth;
  });

  return nodes.map((node) => {
    const position = positionsById.get(node.id);
    if (!position) return node;
    return {
      ...node,
      position,
      sourcePosition: Position.Right,
      targetPosition: Position.Left
    };
  });
}

export function FlowEditor({
  flowId,
  isActive = true,
  className
}: FlowEditorProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const lastAutosaveErrorRef = useRef<{ at: number; msg: string } | null>(null);
  const mountedRef = useRef(false);
  const [mounted, setMounted] = useState(false);
  const isLoadingFromStorageRef = useRef(false);
  const reactFlowInstance = useReactFlow();
  const reactFlowWrapperRef = useRef<HTMLDivElement | null>(null);
  const [panelGroupWidthPx, setPanelGroupWidthPx] = useState<number | null>(
    null
  );
  const panelGroupElRef = useRef<HTMLDivElement | null>(null);

  // Test run dialog
  const [isTestDialogOpen, setIsTestDialogOpen] = useState(false);
  const [isRunsDialogOpen, setIsRunsDialogOpen] = useState(false);

  // Descrizione flow (mostrata nella card dei flows sul grafo)
  const [flowDescription, setFlowDescription] = useState('');
  const [isDetailsDialogOpen, setIsDetailsDialogOpen] = useState(false);
  const [detailsDraft, setDetailsDraft] = useState('');
  const [isSavingDetails, setIsSavingDetails] = useState(false);

  // Sidebar parity with GraphEditor
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const sidebarPanelRef = useRef<ImperativePanelHandle | null>(null);
  const lastOpenSidebarSizeRef = useRef(28);
  const sidebarStateFromResizeRef = useRef(false);
  const sidebarSearchInputRef = useRef<HTMLInputElement | null>(null);
  const [sidebarSearchQuery, setSidebarSearchQuery] = useState('');
  const [sidebarTab, setSidebarTab] = useState<'nodes' | 'add' | 'trigger'>(
    'add'
  );
  const [pendingAddTransformFrom, setPendingAddTransformFrom] = useState<{
    sourceNodeId: string;
    outType: string;
  } | null>(null);

  const sidebarMinWidthPx = 400;
  const sidebarMaxWidthPx = 860;
  const sidebarCollapsedSizePct = 0;
  const sidebarMinSizePct = useMemo(() => {
    if (!panelGroupWidthPx) return 20;
    return clampNumber(
      pxToPercent(sidebarMinWidthPx, panelGroupWidthPx),
      10,
      60
    );
  }, [panelGroupWidthPx]);
  const sidebarMaxSizePct = useMemo(() => {
    if (!panelGroupWidthPx) return 55;
    return clampNumber(
      pxToPercent(sidebarMaxWidthPx, panelGroupWidthPx),
      20,
      80
    );
  }, [panelGroupWidthPx]);

  const toggleSidebar = useCallback(() => {
    setIsSidebarOpen((v) => !v);
  }, []);

  useEffect(() => {
    if (isSidebarOpen && sidebarTab === 'add') return;
    setPendingAddTransformFrom(null);
  }, [isSidebarOpen, sidebarTab]);

  // Bottom dock parity (reuse GraphBottomDock)
  const [bottomDockTab, setBottomDockTab] = useState<'console' | 'activity'>(
    'console'
  );
  const [isBottomDockExpanded, setIsBottomDockExpanded] = useState(false);
  const bottomDockPanelRef = useRef<ImperativePanelHandle | null>(null);
  const lastOpenBottomDockSizeRef = useRef(28);
  const [bottomGroupHeightPx, setBottomGroupHeightPx] = useState<number | null>(
    null
  );
  const bottomGroupElRef = useRef<HTMLDivElement | null>(null);

  const bottomCollapsedHeightPx = 32;
  const bottomMinHeightPx = 220;
  const bottomMaxHeightPx = 520;

  const bottomCollapsedSizePct = useMemo(() => {
    if (!bottomGroupHeightPx) return 6;
    return clampNumber(
      pxToPercent(bottomCollapsedHeightPx, bottomGroupHeightPx),
      3,
      20
    );
  }, [bottomGroupHeightPx]);

  const bottomMinSizePct = useMemo(() => {
    if (!bottomGroupHeightPx) return 20;
    return clampNumber(
      pxToPercent(bottomMinHeightPx, bottomGroupHeightPx),
      10,
      80
    );
  }, [bottomGroupHeightPx]);

  const bottomMaxSizePct = useMemo(() => {
    if (!bottomGroupHeightPx) return 70;
    return clampNumber(
      pxToPercent(bottomMaxHeightPx, bottomGroupHeightPx),
      20,
      95
    );
  }, [bottomGroupHeightPx]);

  const toggleConsoleDock = useCallback(() => {
    setBottomDockTab('console');
    setIsBottomDockExpanded((prev) => {
      const nextExpanded = bottomDockTab === 'console' ? !prev : true;
      requestAnimationFrame(() => {
        if (!bottomDockPanelRef.current) return;
        bottomDockPanelRef.current.resize(
          nextExpanded
            ? lastOpenBottomDockSizeRef.current
            : bottomCollapsedSizePct
        );
      });
      return nextExpanded;
    });
  }, [bottomCollapsedSizePct, bottomDockTab]);

  // Flow should own Cmd/Ctrl+B and Cmd/Ctrl+D (prevent global shortcuts)
  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          (target as any).isContentEditable)
      ) {
        return;
      }

      if ((e.metaKey || e.ctrlKey) && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        e.stopPropagation();
        (
          e as unknown as { stopImmediatePropagation?: () => void }
        ).stopImmediatePropagation?.();
        toggleSidebar();
      }

      if ((e.metaKey || e.ctrlKey) && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        e.stopPropagation();
        (
          e as unknown as { stopImmediatePropagation?: () => void }
        ).stopImmediatePropagation?.();
        toggleConsoleDock();
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () =>
      window.removeEventListener('keydown', handleKeyDown, {
        capture: true
      } as any);
  }, [isActive, toggleConsoleDock, toggleSidebar]);

  const [consoleClearSignal, setConsoleClearSignal] = useState(0);
  const requestConsoleClear = useCallback(() => {
    setConsoleClearSignal((v) => v + 1);
  }, []);

  const [showMiniMap, setShowMiniMap] = useState(true);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const { enabledPluginIds } = useEnabledPlugins();
  const {
    builtinPlugins,
    communityPlugins,
    customPlugins,
    addons,
    isLoading: isPluginsLoading
  } = usePlugins();

  const tabTitle = useWorkspaceTabsStore((s) => {
    if (!flowId) return 'Flow';
    const id = `flow:${flowId}`;
    return s.tabs.find((t) => t.id === id)?.title ?? 'Flow';
  });

  const nodeTypes = useMemo(
    () => ({
      transform: FlowTransformNode,
      trigger: FlowTriggerNode,
      osint: FlowNoteNode
    }),
    []
  );
  const edgeTypes = useMemo(() => ({ flow: FlowEdge }), []);

  const enabledSet = useMemo(() => {
    if (!enabledPluginIds) return null;
    return new Set(enabledPluginIds);
  }, [enabledPluginIds]);

  const transformCatalog = useMemo(() => {
    // Full catalog (all plugins returned by API), with "enabled" derived from enabledSet.
    const allPlugins = [
      ...builtinPlugins,
      ...communityPlugins,
      ...customPlugins,
      ...addons
    ].map((p: any) => {
      const pluginId = String(p?.id ?? '');
      const pluginName = String(p?.name ?? pluginId);
      const pluginIcon = p?.icon ? String(p.icon) : null;
      const pluginLogoUrl = p?.logoUrl ? String(p.logoUrl) : null;
      const enabled = enabledSet ? enabledSet.has(pluginId) : true;
      const transforms = Array.isArray(p?.transforms) ? p.transforms : [];
      const transformsById = new Map(
        transforms
          .map((t: any) => {
            const id = String(t?.id ?? '');
            if (!id) return null;
            return [
              id,
              {
                id,
                name: String(t?.name ?? id),
                description: String(t?.description ?? ''),
                inputType: t?.inputType ? String(t.inputType) : null,
                outputTypes: Array.isArray(t?.outputTypes)
                  ? t.outputTypes.map((x: any) => String(x))
                  : null
              }
            ] as const;
          })
          .filter(Boolean) as Array<
          readonly [
            string,
            {
              id: string;
              name: string;
              description: string;
              inputType: string | null;
              outputTypes: string[] | null;
            }
          ]
        >
      );
      return {
        pluginId,
        pluginName,
        pluginIcon,
        pluginLogoUrl,
        enabled,
        transformsById
      };
    });

    const byId = new Map(allPlugins.map((p) => [p.pluginId, p]));
    return byId;
  }, [builtinPlugins, communityPlugins, customPlugins, addons, enabledSet]);

  const paletteGroups = useMemo(() => {
    const allPlugins = [
      ...builtinPlugins,
      ...communityPlugins,
      ...customPlugins,
      ...addons
    ].filter((p: any) => {
      const id = String(p?.id ?? '');
      if (!id) return false;
      // enabledSet === null means "allow all"
      if (!enabledSet) return true;
      return enabledSet.has(id);
    });

    const groups = allPlugins
      .map((p: any) => {
        const pluginId = String(p.id);
        const pluginName = String(p.name ?? pluginId);
        const pluginIcon = p.icon ? String(p.icon) : null;
        const pluginLogoUrl = p.logoUrl ? String(p.logoUrl) : null;
        const transforms = Array.isArray(p.transforms) ? p.transforms : [];
        const filteredTransforms = transforms
          .map((t: any) => ({
            pluginId,
            pluginName,
            pluginIcon,
            pluginLogoUrl,
            transformId: String(t.id ?? ''),
            name: String(t.name ?? ''),
            description: String(t.description ?? ''),
            inputType: t.inputType ? String(t.inputType) : null,
            outputTypes: Array.isArray(t.outputTypes)
              ? t.outputTypes.map((x: any) => String(x))
              : null
          }))
          .filter((t: any) => {
            return Boolean(t.transformId && t.name);
          });

        return {
          pluginId,
          pluginName,
          pluginIcon,
          pluginLogoUrl,
          transforms: filteredTransforms
        };
      })
      .filter((g) => g.transforms.length > 0)
      .sort((a, b) => a.pluginName.localeCompare(b.pluginName));

    return groups;
  }, [builtinPlugins, communityPlugins, customPlugins, addons, enabledSet]);

  const buildNodeId = useCallback((pluginId: string, transformId: string) => {
    const suffix =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : String(Date.now());
    return `flow-node:${pluginId}:${transformId}:${suffix}`;
  }, []);

  const DND_TRIGGER_NODE_TYPE_MIME =
    'application/paranod-flow-trigger-node-type';
  const buildTriggerNodeId = useCallback((nodeType: string) => {
    const suffix =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : String(Date.now());
    return `flow-trigger:${String(nodeType)}:${suffix}`;
  }, []);

  const flowLayoutFrameRef = useRef<number | null>(null);
  const scheduleLinearFlowLayout = useCallback(() => {
    if (flowLayoutFrameRef.current !== null) {
      window.cancelAnimationFrame(flowLayoutFrameRef.current);
    }
    flowLayoutFrameRef.current = window.requestAnimationFrame(() => {
      setNodes(
        (currentNodes) =>
          getLinearFlowLayout(
            currentNodes as Node[],
            reactFlowInstance.getEdges()
          ) as FlowNode[]
      );
      flowLayoutFrameRef.current = window.requestAnimationFrame(() => {
        flowLayoutFrameRef.current = null;
        const executableNodes = reactFlowInstance
          .getNodes()
          .filter((node) =>
            ['trigger', 'transform'].includes(String(node.type ?? ''))
          );
        if (!executableNodes.length) return;
        void reactFlowInstance.fitView({
          nodes: executableNodes,
          padding: 0.3,
          duration: 300,
          maxZoom: 1
        });
      });
    });
  }, [reactFlowInstance, setNodes]);

  useEffect(
    () => () => {
      if (flowLayoutFrameRef.current !== null) {
        window.cancelAnimationFrame(flowLayoutFrameRef.current);
      }
    },
    []
  );

  const addTransformNode = useCallback(
    (args: {
      pluginId: string;
      pluginName: string;
      pluginIcon: string | null;
      pluginLogoUrl: string | null;
      transformId: string;
      name: string;
      description: string;
      inputType: string | null;
      outputTypes: string[] | null;
      clientX: number;
      clientY: number;
    }) => {
      const position = reactFlowInstance.screenToFlowPosition({
        x: args.clientX,
        y: args.clientY
      });

      const nodeId = buildNodeId(args.pluginId, args.transformId);
      const next: FlowNode = {
        id: nodeId,
        type: 'transform',
        position,
        data: {
          pluginId: args.pluginId,
          transformId: args.transformId,
          name: args.name,
          description: args.description,
          inputType: args.inputType,
          outputTypes: args.outputTypes,
          pluginName: args.pluginName,
          pluginIcon: args.pluginIcon,
          pluginLogoUrl: args.pluginLogoUrl
        }
      };
      setNodes((nds) =>
        nds.concat(
          adjustFlowNodePositionIfOverlapping(next as any, nds as any) as any
        )
      );
      scheduleLinearFlowLayout();
      return nodeId;
    },
    [buildNodeId, reactFlowInstance, scheduleLinearFlowLayout, setNodes]
  );

  const addTransformFromSource = useCallback(
    (args: {
      sourceNodeId: string;
      outType: string;
      transform: FlowTransformPickerItem;
    }) => {
      const sourceNode = reactFlowInstance.getNode(args.sourceNodeId);
      if (!sourceNode) return;

      const transform = args.transform;
      const inputType = String(transform.inputType ?? '').trim();
      if (
        !inputType ||
        !matchesInputType(String(args.outType) as EntityType, inputType)
      ) {
        toast.error('This transform is not compatible with the trigger type.');
        return;
      }

      const sourceDimensions = getEstimatedFlowNodeDimensions(sourceNode);
      const nodeId = buildNodeId(transform.pluginId, transform.transformId);
      const nextNode: FlowNode = {
        id: nodeId,
        type: 'transform',
        position: {
          x: sourceNode.position.x + sourceDimensions.width + 90,
          y: sourceNode.position.y - 20
        },
        data: {
          pluginId: transform.pluginId,
          transformId: transform.transformId,
          name: transform.name,
          description: transform.description,
          inputType: transform.inputType,
          outputTypes: transform.outputTypes,
          pluginName: transform.pluginName,
          pluginIcon: transform.pluginIcon,
          pluginLogoUrl: transform.pluginLogoUrl
        }
      };

      setNodes((currentNodes) =>
        currentNodes.concat(
          adjustFlowNodePositionIfOverlapping(
            nextNode as any,
            currentNodes as any
          ) as any
        )
      );
      setEdges((currentEdges) => {
        const sourceHandle = getFlowSourceHandleId({
          node: sourceNode,
          outType: args.outType,
          edges: currentEdges
        });
        return addEdge(
          {
            source: args.sourceNodeId,
            target: nodeId,
            sourceHandle,
            targetHandle: `in:${inputType}`,
            type: 'flow',
            animated: true
          } as any,
          currentEdges
        );
      });
      scheduleLinearFlowLayout();
    },
    [
      buildNodeId,
      reactFlowInstance,
      scheduleLinearFlowLayout,
      setEdges,
      setNodes
    ]
  );

  function getNodeOutputTypes(node: Node): string[] {
    if (String(node.type ?? '') === 'trigger') {
      const nodeType = String((node.data as any)?.nodeType ?? '').trim();
      return nodeType ? [nodeType] : [];
    }
    if (String(node.type ?? '') !== 'transform') return [];
    return Array.isArray((node.data as any)?.outputTypes)
      ? ((node.data as any).outputTypes as unknown[])
          .map((type) => String(type ?? '').trim())
          .filter(Boolean)
      : [];
  }

  const applyFlowLayout = useCallback(() => {
    try {
      const layoutedNodes = getLinearFlowLayout(
        nodes as Node[],
        edges
      ) as FlowNode[];
      const executableNodes = layoutedNodes.filter((node) =>
        ['trigger', 'transform'].includes(String(node.type ?? ''))
      );
      setNodes(layoutedNodes);
      if (!executableNodes.length) return;
      requestAnimationFrame(() => {
        void reactFlowInstance.fitView({
          padding: 0.18,
          duration: 260,
          maxZoom: 1.4,
          nodes: executableNodes as any
        });
      });
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to apply layout');
    }
  }, [edges, nodes, reactFlowInstance, setNodes]);

  const clearFlow = useCallback(() => {
    setNodes([]);
    setEdges([]);
    toast.success('Flow cleared');
  }, [setEdges, setNodes]);

  const activeTriggerNodeType = useMemo(() => {
    const selected = nodes.find(
      (n) => Boolean((n as any)?.selected) && String(n.type) === 'trigger'
    );
    if (selected) return String((selected.data as any)?.nodeType ?? '');
    const anyTrigger = nodes.find((n) => String(n.type) === 'trigger');
    return anyTrigger ? String((anyTrigger.data as any)?.nodeType ?? '') : null;
  }, [nodes]);

  const addTriggerNode = useCallback(
    (args: { nodeType: string; clientX: number; clientY: number }) => {
      const nodeType = String(args.nodeType);
      const existingTriggers = nodes.filter(
        (n) => String(n.type) === 'trigger'
      );

      // Max un trigger per flow: se esiste già, sostituiscilo in place
      // (stessa posizione, edge in uscita ricollegati al nuovo tipo).
      if (existingTriggers.length > 0) {
        const primary = existingTriggers[0];
        const extraIds = new Set(existingTriggers.slice(1).map((n) => n.id));

        if (
          String((primary.data as any)?.nodeType ?? '') === nodeType &&
          extraIds.size === 0
        ) {
          setNodes((nds) =>
            nds.map((n) => ({ ...n, selected: n.id === primary.id }))
          );
          return;
        }

        const nextId = buildTriggerNodeId(nodeType);
        setNodes((nds) =>
          nds
            .filter((n) => !extraIds.has(n.id))
            .map((n) =>
              n.id === primary.id
                ? ({
                    ...n,
                    id: nextId,
                    data: { nodeType },
                    selected: true
                  } as any)
                : { ...n, selected: false }
            )
        );
        setEdges((eds) =>
          eds
            .filter(
              (e) =>
                !extraIds.has(String(e.source)) &&
                !extraIds.has(String(e.target))
            )
            .map((e) =>
              String(e.source) === primary.id
                ? { ...e, source: nextId, sourceHandle: `out:${nodeType}:0` }
                : e
            )
        );
        toast.success(`Trigger Node changed to "${nodeType}"`);
        scheduleLinearFlowLayout();
        return;
      }

      const position = reactFlowInstance.screenToFlowPosition({
        x: args.clientX,
        y: args.clientY
      });

      const next: Node<FlowTriggerNodeData> = {
        id: buildTriggerNodeId(nodeType),
        type: 'trigger',
        position,
        data: { nodeType }
      };

      setNodes((nds) => {
        const cleared = nds.map((n) => ({ ...n, selected: false }));
        const adjusted = adjustFlowNodePositionIfOverlapping(
          { ...(next as any), selected: true } as any,
          cleared as any
        ) as any;
        return cleared.concat(adjusted);
      });
      scheduleLinearFlowLayout();
    },
    [
      buildTriggerNodeId,
      nodes,
      reactFlowInstance,
      scheduleLinearFlowLayout,
      setEdges,
      setNodes
    ]
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (!isActive) return;

      const triggerNodeType =
        e.dataTransfer.getData(DND_TRIGGER_NODE_TYPE_MIME) ||
        e.dataTransfer.getData('text/plain');
      if (triggerNodeType) {
        addTriggerNode({
          nodeType: triggerNodeType,
          clientX: e.clientX,
          clientY: e.clientY
        });
        return;
      }

      const payload = e.dataTransfer.getData(
        'application/paranod-flow-transform'
      );
      if (!payload) return;
      try {
        const parsed = JSON.parse(payload) as any;
        if (!parsed?.pluginId || !parsed?.transformId) return;
        const outputTypes = Array.isArray(parsed.outputTypes)
          ? parsed.outputTypes.map((x: any) => String(x))
          : null;

        const transform: FlowTransformPickerItem = {
          pluginId: String(parsed.pluginId),
          pluginName: String(parsed.pluginName ?? parsed.pluginId),
          pluginIcon: parsed.pluginIcon ? String(parsed.pluginIcon) : null,
          pluginLogoUrl: parsed.pluginLogoUrl
            ? String(parsed.pluginLogoUrl)
            : null,
          transformId: String(parsed.transformId),
          name: String(parsed.name ?? ''),
          description: String(parsed.description ?? ''),
          inputType: parsed.inputType ? String(parsed.inputType) : null,
          outputTypes
        };

        if (pendingAddTransformFrom) {
          const source = pendingAddTransformFrom;
          setPendingAddTransformFrom(null);
          addTransformFromSource({
            sourceNodeId: source.sourceNodeId,
            outType: source.outType,
            transform
          });
          return;
        }

        const dropPosition = reactFlowInstance.screenToFlowPosition({
          x: e.clientX,
          y: e.clientY
        });
        const sourceNode = reactFlowInstance
          .getIntersectingNodes(
            {
              x: dropPosition.x,
              y: dropPosition.y,
              width: 1,
              height: 1
            },
            true
          )
          .find((node) =>
            ['trigger', 'transform'].includes(String(node.type ?? ''))
          );
        const inputType = String(transform.inputType ?? '').trim();
        const compatibleOutType = sourceNode
          ? getNodeOutputTypes(sourceNode).find((outType) =>
              matchesInputType(outType as EntityType, inputType)
            )
          : undefined;
        if (sourceNode && compatibleOutType) {
          addTransformFromSource({
            sourceNodeId: sourceNode.id,
            outType: compatibleOutType,
            transform
          });
          return;
        }

        addTransformNode({
          ...transform,
          clientX: e.clientX,
          clientY: e.clientY
        });
      } catch {
        // ignore invalid payload
      }
    },
    [
      DND_TRIGGER_NODE_TYPE_MIME,
      addTransformFromSource,
      addTransformNode,
      addTriggerNode,
      isActive,
      pendingAddTransformFrom,
      reactFlowInstance
    ]
  );

  const loadFlow = useCallback(async () => {
    if (!flowId) return;
    isLoadingFromStorageRef.current = true;
    try {
      const res = await fetch(`/api/flows/${flowId}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? 'Failed to load flow');

      const f = data?.flow;
      setFlowDescription(
        typeof f?.description === 'string' ? f.description : ''
      );
      const nextNodesRaw = Array.isArray(f?.nodes)
        ? (f.nodes as FlowNode[])
        : [];
      const nextEdgesRaw = Array.isArray(f?.edges) ? (f.edges as Edge[]) : [];

      const createdAt = Date.parse(String(f?.createdAt ?? ''));
      const updatedAt = Date.parse(String(f?.updatedAt ?? ''));
      const isUntouchedEmptyFlow =
        nextNodesRaw.length === 0 &&
        nextEdgesRaw.length === 0 &&
        Number.isFinite(createdAt) &&
        Number.isFinite(updatedAt) &&
        Math.abs(updatedAt - createdAt) < 1000;

      let nextNodes = isUntouchedEmptyFlow
        ? ([createFlowGuideNoteNode()] as FlowNode[])
        : nextNodesRaw;
      const hasTriggerNode = nextNodesRaw.some(
        (n) => String(n.type) === 'trigger'
      );
      if (!hasTriggerNode) {
        // Migration: older dev builds used `data.isTrigger` on transform nodes.
        const legacy = nextNodesRaw.find(
          (n) =>
            String(n.type) === 'transform' &&
            Boolean((n.data as any)?.isTrigger)
        );
        if (legacy) {
          const d: any = legacy.data ?? {};
          const nodeTypeCandidate = String(
            d?.outputTypes?.[0] ?? d?.inputType ?? 'custom'
          );
          const triggerNode: Node<FlowTriggerNodeData> = {
            id: buildTriggerNodeId(nodeTypeCandidate),
            type: 'trigger',
            position: { x: legacy.position.x - 320, y: legacy.position.y },
            data: { nodeType: nodeTypeCandidate }
          };
          nextNodes = nextNodesRaw.concat(triggerNode as any);
        }
      }

      // Max un trigger per flow: dedupe di dati legacy con più trigger
      // (il server rifiuta i salvataggi con più di uno).
      let prunedTriggerIds: Set<string> | null = null;
      const loadedTriggers = nextNodes.filter(
        (n) => String(n.type) === 'trigger'
      );
      if (loadedTriggers.length > 1) {
        prunedTriggerIds = new Set(
          loadedTriggers.slice(1).map((n) => String(n.id))
        );
        nextNodes = nextNodes.filter(
          (n) => !prunedTriggerIds!.has(String(n.id))
        );
        toast.warning(
          'This flow had multiple trigger nodes: kept the first one.'
        );
      }

      const nextEdges = nextEdgesRaw
        .filter(
          (e: any) =>
            !prunedTriggerIds ||
            (!prunedTriggerIds.has(String(e?.source)) &&
              !prunedTriggerIds.has(String(e?.target)))
        )
        .map((e: any) => ({
          ...e,
          type: e?.type ?? 'flow',
          animated: typeof e?.animated === 'boolean' ? e.animated : true
        }));

      setNodes(nextNodes);
      setEdges(nextEdges);
      markSavedState(nextNodes as any, nextEdges as any);
      const guideNote = nextNodes.find(
        (node) => (node.data as any)?.metadata?.flowDecoration === true
      );
      if (guideNote) {
        window.setTimeout(() => {
          void reactFlowInstance.fitView({
            nodes: [guideNote] as any,
            padding: 0.4,
            duration: 420,
            maxZoom: 1
          });
        }, 220);
      }
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to load flow');
    } finally {
      isLoadingFromStorageRef.current = false;
      setHasLoadedOnce(true);
    }
  }, [flowId, reactFlowInstance, setEdges, setNodes]);

  const saveFlowDescription = useCallback(async () => {
    if (!flowId) return;
    setIsSavingDetails(true);
    try {
      const res = await fetch(`/api/flows/${flowId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: detailsDraft.trim() || null })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok)
        throw new Error(data?.error ?? 'Failed to update description');
      setFlowDescription(detailsDraft.trim());
      setIsDetailsDialogOpen(false);
      localStorage.setItem('flows-need-refresh', 'true');
      toast.success('Description updated');
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to update description');
    } finally {
      setIsSavingDetails(false);
    }
  }, [detailsDraft, flowId]);

  useEffect(() => {
    // Reconcile nodes against current transforms catalog.
    // - If plugin/transform is missing or disabled, mark node as missing (do not delete).
    // - If it becomes available again, clear missingReason and refresh display metadata.
    setNodes((nds) =>
      nds.map((n) => {
        if (n.type !== 'transform') return n;
        const data: any = n.data ?? {};
        const pluginId = String(data?.pluginId ?? '');
        const transformId = String(data?.transformId ?? '');
        if (!pluginId || !transformId) {
          return {
            ...n,
            data: {
              ...(n.data as any),
              missingReason: 'Invalid transform reference.'
            }
          };
        }

        const plugin = transformCatalog.get(pluginId);
        if (!plugin) {
          return {
            ...n,
            data: {
              ...(n.data as any),
              missingReason: 'Plugin not found (removed from workspace).'
            }
          };
        }
        if (!plugin.enabled) {
          return {
            ...n,
            data: {
              ...(n.data as any),
              pluginName: plugin.pluginName,
              pluginIcon: plugin.pluginIcon,
              pluginLogoUrl: plugin.pluginLogoUrl,
              missingReason: 'Plugin disabled.'
            }
          };
        }

        const t = plugin.transformsById.get(transformId);
        if (!t) {
          return {
            ...n,
            data: {
              ...(n.data as any),
              pluginName: plugin.pluginName,
              pluginIcon: plugin.pluginIcon,
              pluginLogoUrl: plugin.pluginLogoUrl,
              missingReason: 'Transform not found (removed or renamed).'
            }
          };
        }

        const nextData: FlowTransformNodeData = {
          ...(n.data as any),
          pluginId,
          transformId,
          name: t.name,
          description: t.description,
          inputType: t.inputType,
          outputTypes: t.outputTypes,
          pluginName: plugin.pluginName,
          pluginIcon: plugin.pluginIcon,
          pluginLogoUrl: plugin.pluginLogoUrl,
          missingReason: null
        };

        return { ...n, data: nextData };
      })
    );
  }, [setNodes, transformCatalog]);

  useEffect(() => {
    mountedRef.current = true;
    setMounted(true);
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const el = panelGroupElRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      setPanelGroupWidthPx(rect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Match GraphEditor: expand/collapse sidebar via panel ref
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
        (
          sidebarPanelRef.current as unknown as { expand?: () => void }
        ).expand?.();
      } else {
        (
          sidebarPanelRef.current as unknown as { collapse?: () => void }
        ).collapse?.();
        sidebarPanelRef.current.resize(sidebarCollapsedSizePct);
      }
    });
  }, [isSidebarOpen, sidebarCollapsedSizePct]);

  // Track bottom group height like GraphEditor (for collapsed size %)
  useEffect(() => {
    const el = bottomGroupElRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      setBottomGroupHeightPx(rect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const saveToDatabaseSilent = useCallback(
    async (nodesToSave: FlowNode[], edgesToSave: Edge[]) => {
      if (!flowId) return;
      const triggerCount = nodesToSave.filter(
        (n) => String(n.type) === 'trigger'
      ).length;
      if (triggerCount !== 1) {
        const msg = 'Warning: this flow should have exactly one Trigger Node.';
        const now = Date.now();
        const prev = lastAutosaveErrorRef.current;
        const shouldToast = !prev || prev.msg !== msg || now - prev.at > 8000;
        lastAutosaveErrorRef.current = { at: now, msg };
        if (shouldToast) toast.warning(msg);
      }
      setIsSaving(true);
      try {
        const res = await fetch(`/api/flows/${flowId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nodes: nodesToSave,
            edges: edgesToSave
          })
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error ?? 'Failed to save flow');
        localStorage.setItem('flows-need-refresh', 'true');
        setLastSavedAt(new Date());
      } catch (e: any) {
        const msg = String(e?.message ?? 'Failed to save flow');
        const now = Date.now();
        const prev = lastAutosaveErrorRef.current;
        // Throttle: don't spam toasts while typing/moving nodes
        const shouldToast = !prev || prev.msg !== msg || now - prev.at > 8000;
        lastAutosaveErrorRef.current = { at: now, msg };
        if (shouldToast) toast.error(msg);
      } finally {
        setIsSaving(false);
      }
    },
    [flowId]
  );

  const { markSavedState } = useFlowAutosave({
    flowId,
    mounted,
    nodes,
    edges,
    isLoadingFromStorageRef,
    createStateHash: createFlowStateHash,
    saveToDatabase: saveToDatabaseSilent,
    debounceMs: 2000
  });

  const { canUndo, canRedo, undo, redo, resetHistory } = useFlowHistory({
    mounted,
    nodes: nodes as any,
    edges,
    setNodes: (next) => setNodes(next as any),
    setEdges
  });

  useEffect(() => {
    if (!mountedRef.current) return;
    void loadFlow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowId]);

  const saveFlow = useCallback(async () => {
    if (!flowId) return;
    const triggerCount = nodes.filter(
      (n) => String(n.type) === 'trigger'
    ).length;
    if (triggerCount !== 1) {
      toast.warning('Warning: this flow should have exactly one Trigger Node.');
    }
    setIsSaving(true);
    try {
      const body: Record<string, unknown> = {
        nodes,
        edges
      };

      const res = await fetch(`/api/flows/${flowId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? 'Failed to save flow');
      localStorage.setItem('flows-need-refresh', 'true');
      markSavedState(nodes as any, edges);
      setLastSavedAt(new Date());
      resetHistory({ nodes: nodes as any, edges });
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to save flow');
    } finally {
      setIsSaving(false);
    }
  }, [edges, flowId, markSavedState, nodes, resetHistory]);

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            type: 'flow',
            animated: true
          },
          eds
        )
      );
      scheduleLinearFlowLayout();
    },
    [scheduleLinearFlowLayout, setEdges]
  );

  const isValidConnection = useCallback((connection: Connection) => {
    const sourceHandle = connection.sourceHandle
      ? String(connection.sourceHandle)
      : '';
    const targetHandle = connection.targetHandle
      ? String(connection.targetHandle)
      : '';
    if (!sourceHandle.startsWith('out:')) return false;
    if (!targetHandle.startsWith('in:')) return false;
    const outType = sourceHandle.slice('out:'.length).split(':')[0] ?? '';
    const inType = targetHandle.slice('in:'.length) ?? '';
    if (!outType || !inType) return false;
    return matchesInputType(outType as EntityType, inType);
  }, []);

  // Normalize any existing edges that predate defaultEdgeOptions (or loaded/imported)
  useEffect(() => {
    setEdges((eds) => {
      const needsNormalize = eds.some(
        (e: any) => e?.type !== 'flow' || typeof e?.animated !== 'boolean'
      );
      if (!needsNormalize) return eds;
      return eds.map((e: any) => ({
        ...e,
        type: 'flow',
        animated: typeof e?.animated === 'boolean' ? e.animated : true
      }));
    });
  }, [setEdges]);

  const missingNodeCount = useMemo(
    () =>
      nodes.filter(
        (n) => n.type === 'transform' && Boolean((n.data as any)?.missingReason)
      ).length,
    [nodes]
  );
  const orphanEdgeCount = useMemo(() => {
    const ids = new Set(nodes.map((n) => n.id));
    return edges.filter(
      (e) => !ids.has(String(e.source)) || !ids.has(String(e.target))
    ).length;
  }, [edges, nodes]);

  const [paneContextMenu, setPaneContextMenu] = useState<{
    position: { x: number; y: number };
    flowPosition: { x: number; y: number };
  } | null>(null);
  const [isClearFlowConfirmOpen, setIsClearFlowConfirmOpen] = useState(false);

  const [nodeContextMenu, setNodeContextMenu] = useState<{
    position: { x: number; y: number };
    nodeId: string;
    nodeLabel: string;
    nodeType: 'transform' | 'trigger';
    triggerNodeType?: string | null;
    transformOutputTypes?: string[] | null;
  } | null>(null);

  const [openTransformNodeDialog, setOpenTransformNodeDialog] = useState<{
    nodeId: string;
    nodeData: FlowTransformNodeData;
  } | null>(null);
  const [activeConnectOutType, setActiveConnectOutType] = useState<
    string | null
  >(null);
  const [connectingSourceNodeId, setConnectingSourceNodeId] = useState<
    string | null
  >(null);
  const isFlowEmpty =
    !nodes.some((node) =>
      ['trigger', 'transform'].includes(String(node.type ?? ''))
    ) && edges.length === 0;
  const hasAutoOpenedTriggerPanelRef = useRef(false);

  useEffect(() => {
    if (!mounted) return;
    if (!isActive) return;
    if (!hasLoadedOnce) return;
    if (!isFlowEmpty) return;
    if (hasAutoOpenedTriggerPanelRef.current) return;
    hasAutoOpenedTriggerPanelRef.current = true;

    setSidebarTab('trigger');
    setIsSidebarOpen(true);
    requestAnimationFrame(() => sidebarSearchInputRef.current?.focus());
  }, [hasLoadedOnce, isActive, isFlowEmpty, mounted]);

  function duplicateNodeById(nodeId: string) {
    const existing = nodes.find((n) => n.id === nodeId);
    if (!existing) return;
    if (String(existing.type) === 'trigger') {
      toast.error(
        'Trigger Node cannot be duplicated. Use Trigger Node tab to change it.'
      );
      return;
    }
    const data: any = existing.data ?? {};
    const pluginId = String(data?.pluginId ?? '');
    const transformId = String(data?.transformId ?? '');
    if (!pluginId || !transformId) return;
    const nextId = buildNodeId(pluginId, transformId);
    setNodes((nds) =>
      nds
        .map((n) => ({ ...n, selected: false }))
        .concat({
          ...existing,
          id: nextId,
          position: {
            x: existing.position.x + 40,
            y: existing.position.y + 40
          },
          selected: true
        } as any)
    );
    scheduleLinearFlowLayout();
  }

  function deleteNodeById(nodeId: string) {
    setNodes((nds) => nds.filter((n) => n.id !== nodeId));
    setEdges((eds) =>
      eds.filter(
        (e) => String(e.source) !== nodeId && String(e.target) !== nodeId
      )
    );
  }

  return (
    <TransformLoggerProvider>
      <div
        className={cn('flex h-full w-full flex-col overflow-hidden', className)}
      >
        <div className='relative flex h-full w-full overflow-hidden'>
          <div
            ref={panelGroupElRef}
            className='h-full min-h-0 w-full overflow-hidden'
          >
            <ResizablePanelGroup
              direction='horizontal'
              className='h-full w-full'
            >
              <FlowSidepanel
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
                nodeItems={nodes
                  .filter((n) => String(n.type) === 'transform')
                  .map((n) => ({
                    id: n.id,
                    title: String((n.data as any)?.name ?? n.id),
                    subtitle: (n.data as any)?.pluginName ?? null,
                    pluginId: (n.data as any)?.pluginId ?? null,
                    pluginIcon: (n.data as any)?.pluginIcon ?? null,
                    pluginLogoUrl: (n.data as any)?.pluginLogoUrl ?? null,
                    inputType: (n.data as any)?.inputType ?? null
                  }))}
                onSelectNodeId={(nodeId) => {
                  setNodes((nds) =>
                    nds.map((n) => ({ ...n, selected: n.id === nodeId }))
                  );
                  setEdges((eds) =>
                    eds.map((e) => ({ ...e, selected: false }))
                  );
                  try {
                    const target = nodes.find((n) => n.id === nodeId);
                    if (target)
                      reactFlowInstance.setCenter(
                        target.position.x,
                        target.position.y,
                        {
                          zoom: 1.2,
                          duration: 220
                        }
                      );
                  } catch {
                    // ignore
                  }
                }}
                selectedNodeCount={
                  nodes.filter((n) => Boolean((n as any)?.selected)).length
                }
                selectedNodeIds={nodes
                  .filter((n) => Boolean((n as any)?.selected))
                  .map((n) => n.id)}
                onFitViewToSelection={(nodeIds) => {
                  try {
                    const byId = new Set(nodeIds);
                    const targets = nodes.filter((n) => byId.has(n.id));
                    if (!targets.length) return;
                    void reactFlowInstance.fitView({
                      padding: 0.22,
                      duration: 220,
                      maxZoom: 1.6,
                      nodes: targets as any
                    });
                  } catch {
                    // ignore
                  }
                }}
                onClearSelection={() => {
                  setNodes((nds) =>
                    nds.map((n) => ({ ...n, selected: false }))
                  );
                  setEdges((eds) =>
                    eds.map((e) => ({ ...e, selected: false }))
                  );
                }}
                onDeleteSelection={() => {
                  const selectedIds = new Set(
                    nodes
                      .filter((n) => Boolean((n as any)?.selected))
                      .map((n) => n.id)
                  );
                  if (!selectedIds.size) return;
                  setNodes((nds) => nds.filter((n) => !selectedIds.has(n.id)));
                  setEdges((eds) =>
                    eds.filter(
                      (e) =>
                        !selectedIds.has(String(e.source)) &&
                        !selectedIds.has(String(e.target))
                    )
                  );
                }}
                transformGroups={paletteGroups as any}
                onAddTransform={(t) => {
                  if (pendingAddTransformFrom) {
                    const source = pendingAddTransformFrom;
                    setPendingAddTransformFrom(null);
                    addTransformFromSource({
                      sourceNodeId: source.sourceNodeId,
                      outType: source.outType,
                      transform: t
                    });
                    return;
                  }

                  const rect =
                    reactFlowWrapperRef.current?.getBoundingClientRect();
                  const cx = rect
                    ? rect.left + rect.width / 2
                    : window.innerWidth / 2;
                  const cy = rect
                    ? rect.top + rect.height / 2
                    : window.innerHeight / 2;
                  addTransformNode({
                    ...t,
                    clientX: cx,
                    clientY: cy
                  });
                }}
                activeTriggerNodeType={activeTriggerNodeType}
                onSetTriggerNodeType={(nodeType) => {
                  const rect =
                    reactFlowWrapperRef.current?.getBoundingClientRect();
                  const cx = rect
                    ? rect.left + rect.width / 2
                    : window.innerWidth / 2;
                  const cy = rect
                    ? rect.top + rect.height / 2
                    : window.innerHeight / 2;
                  addTriggerNode({ nodeType, clientX: cx, clientY: cy });
                }}
                missingNodeCount={missingNodeCount}
                orphanEdgeCount={orphanEdgeCount}
              />

              <ResizableHandle className='bg-border/30 dark:bg-white/5' />

              <ResizablePanel
                defaultSize={100 - lastOpenSidebarSizeRef.current}
                minSize={55}
                className='min-w-0 transition-[flex-grow,flex-basis] duration-200 ease-in-out'
              >
                <div className='flex h-full w-full flex-col overflow-hidden'>
                  <FlowTopbar
                    onManualSave={() => void saveFlow()}
                    isSaving={isSaving}
                    lastSavedAt={lastSavedAt}
                    openSidebarNodes={() => {
                      setSidebarTab('nodes');
                      setIsSidebarOpen(true);
                      requestAnimationFrame(() =>
                        sidebarSearchInputRef.current?.focus()
                      );
                    }}
                    openSidebarAdd={() => {
                      setSidebarTab('add');
                      setIsSidebarOpen(true);
                      requestAnimationFrame(() =>
                        sidebarSearchInputRef.current?.focus()
                      );
                    }}
                    canUndo={canUndo}
                    canRedo={canRedo}
                    onUndo={undo}
                    onRedo={redo}
                    onFitView={() => {
                      void reactFlowInstance.fitView({
                        padding: 0.18,
                        duration: 220,
                        maxZoom: 1.5
                      });
                    }}
                    canFitViewToSelected={nodes.some((n) =>
                      Boolean((n as any)?.selected)
                    )}
                    onFitViewToSelected={() => {
                      try {
                        const selected = nodes.filter((n) =>
                          Boolean((n as any)?.selected)
                        );
                        if (!selected.length) return;
                        void reactFlowInstance.fitView({
                          padding: 0.22,
                          duration: 220,
                          maxZoom: 1.6,
                          nodes: selected as any
                        });
                      } catch {
                        // ignore
                      }
                    }}
                    onExportJson={() => exportFlowJson({ nodes, edges })}
                    onImportJson={() => {
                      openFlowImportPicker({
                        onImported: (payload) => {
                          let nextNodes = Array.isArray(payload.nodes)
                            ? (payload.nodes as any[])
                            : [];
                          let nextEdges = Array.isArray(payload.edges)
                            ? (payload.edges as any[])
                            : [];

                          // Max un trigger per flow: se il JSON ne ha di più, tieni il primo.
                          const importedTriggers = nextNodes.filter(
                            (n) => String(n?.type) === 'trigger'
                          );
                          if (importedTriggers.length > 1) {
                            const dropIds = new Set(
                              importedTriggers
                                .slice(1)
                                .map((n: any) => String(n.id))
                            );
                            nextNodes = nextNodes.filter(
                              (n: any) => !dropIds.has(String(n.id))
                            );
                            nextEdges = nextEdges.filter(
                              (e: any) =>
                                !dropIds.has(String(e?.source)) &&
                                !dropIds.has(String(e?.target))
                            );
                            toast.warning(
                              'Imported flow had multiple trigger nodes: kept the first one.'
                            );
                          }
                          setNodes(nextNodes as any);
                          setEdges(
                            (nextEdges as any[]).map((e) => ({
                              ...e,
                              type: e?.type ?? 'flow',
                              animated:
                                typeof e?.animated === 'boolean'
                                  ? e.animated
                                  : true
                            })) as any
                          );
                          markSavedState(nextNodes as any, nextEdges as any);
                          resetHistory({
                            nodes: nextNodes as any,
                            edges: nextEdges as any
                          });
                          toast.success('Flow imported');
                        },
                        onInvalid: () => toast.error('Invalid flow JSON'),
                        onError: () => toast.error('Failed to import')
                      });
                    }}
                    onDuplicate={async () => {
                      if (!flowId) return;
                      try {
                        const detailRes = await fetch(`/api/flows/${flowId}`);
                        const detail = await detailRes.json().catch(() => null);
                        if (!detailRes.ok)
                          throw new Error(
                            detail?.error ?? 'Failed to load flow'
                          );
                        const createRes = await fetch('/api/flows', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            name: `${tabTitle} (copy)`,
                            description: detail?.flow?.description ?? null
                          })
                        });
                        const created = await createRes
                          .json()
                          .catch(() => null);
                        if (!createRes.ok)
                          throw new Error(
                            created?.error ?? 'Failed to duplicate flow'
                          );
                        await fetch(`/api/flows/${created.flow.id}`, {
                          method: 'PUT',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            nodes: detail?.flow?.nodes ?? [],
                            edges: detail?.flow?.edges ?? []
                          })
                        });
                        localStorage.setItem('flows-need-refresh', 'true');
                        toast.success('Flow duplicated');
                      } catch (e: any) {
                        toast.error(e?.message ?? 'Failed to duplicate flow');
                      }
                    }}
                    onRefresh={() => {
                      void loadFlow();
                    }}
                    onTest={() => setIsTestDialogOpen(true)}
                    onShowRuns={
                      flowId ? () => setIsRunsDialogOpen(true) : undefined
                    }
                    onEditDescription={
                      flowId
                        ? () => {
                            setDetailsDraft(flowDescription);
                            setIsDetailsDialogOpen(true);
                          }
                        : undefined
                    }
                  />
                  <FlowTestDialog
                    open={isTestDialogOpen}
                    onOpenChange={setIsTestDialogOpen}
                    nodes={nodes}
                    edges={edges}
                    flowId={flowId}
                  />
                  {flowId ? (
                    <FlowRunsDialog
                      open={isRunsDialogOpen}
                      onOpenChange={setIsRunsDialogOpen}
                      flowId={flowId}
                    />
                  ) : null}

                  <Dialog
                    open={isDetailsDialogOpen}
                    onOpenChange={setIsDetailsDialogOpen}
                  >
                    <DialogContent className='sm:max-w-md'>
                      <DialogHeader>
                        <DialogTitle>Flow description</DialogTitle>
                        <DialogDescription>
                          Shown in the flow card when running flows from the
                          graph.
                        </DialogDescription>
                      </DialogHeader>
                      <div className='space-y-1'>
                        <Label htmlFor='flow-description'>Description</Label>
                        <Textarea
                          id='flow-description'
                          value={detailsDraft}
                          onChange={(e) => setDetailsDraft(e.target.value)}
                          placeholder='What does this flow do?'
                          rows={4}
                        />
                      </div>
                      <DialogFooter>
                        <Button
                          variant='outline'
                          onClick={() => setIsDetailsDialogOpen(false)}
                          disabled={isSavingDetails}
                        >
                          Cancel
                        </Button>
                        <Button
                          onClick={() => void saveFlowDescription()}
                          disabled={isSavingDetails}
                        >
                          {isSavingDetails ? 'Saving…' : 'Save'}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>

                  <div
                    ref={bottomGroupElRef}
                    className='min-h-0 flex-1 overflow-hidden'
                  >
                    <ResizablePanelGroup
                      direction='vertical'
                      className='h-full w-full'
                    >
                      <ResizablePanel
                        defaultSize={100 - lastOpenBottomDockSizeRef.current}
                        minSize={20}
                        className='min-h-0'
                      >
                        <div
                          ref={reactFlowWrapperRef}
                          className='relative h-full min-h-0 w-full'
                          onDrop={onDrop}
                          onDragOver={onDragOver}
                        >
                          <FlowConnectionFilterProvider
                            value={{
                              activeOutType: activeConnectOutType,
                              sourceNodeId: connectingSourceNodeId,
                              canEdit: isActive,
                              transformGroups: paletteGroups,
                              onAddTransformFromSource: addTransformFromSource
                            }}
                          >
                            <ReactFlow
                              nodes={nodes}
                              edges={edges}
                              onNodesChange={onNodesChange}
                              onEdgesChange={onEdgesChange}
                              onConnect={onConnect}
                              isValidConnection={isValidConnection}
                              onConnectStart={(_e, params: any) => {
                                const nodeId = params?.nodeId
                                  ? String(params.nodeId)
                                  : null;
                                const handleId = params?.handleId
                                  ? String(params.handleId)
                                  : null;
                                setConnectingSourceNodeId(nodeId);
                                if (handleId?.startsWith('out:')) {
                                  const outType =
                                    handleId
                                      .slice('out:'.length)
                                      .split(':')[0] ?? null;
                                  setActiveConnectOutType(outType || null);
                                  return;
                                }
                                setActiveConnectOutType(null);
                              }}
                              onConnectEnd={() => {
                                setActiveConnectOutType(null);
                                setConnectingSourceNodeId(null);
                              }}
                              nodeTypes={nodeTypes}
                              edgeTypes={edgeTypes}
                              defaultEdgeOptions={{
                                type: 'flow',
                                animated: true
                              }}
                              fitView
                              fitViewOptions={{ padding: 0.4, maxZoom: 1 }}
                              className='bg-canvas flow-reactflow'
                              snapToGrid
                              snapGrid={[15, 15]}
                              nodesDraggable={isActive}
                              nodesConnectable={isActive}
                              elementsSelectable={isActive}
                              minZoom={0.04}
                              maxZoom={4}
                              onNodeDoubleClick={(e, node) => {
                                e.preventDefault();
                                const data = (node.data ?? null) as any;
                                if (!data || String(node.type) !== 'transform')
                                  return;
                                setOpenTransformNodeDialog({
                                  nodeId: String(node.id),
                                  nodeData: data as FlowTransformNodeData
                                });
                              }}
                              onPaneContextMenu={(e) => {
                                e.preventDefault();
                                if (!isActive) return;
                                const flowPosition =
                                  reactFlowInstance.screenToFlowPosition({
                                    x: e.clientX,
                                    y: e.clientY
                                  });
                                setPaneContextMenu({
                                  position: { x: e.clientX, y: e.clientY },
                                  flowPosition
                                });
                                setNodeContextMenu(null);
                              }}
                              onNodeContextMenu={(e, node) => {
                                e.preventDefault();
                                if (!isActive) return;
                                const isTrigger =
                                  String(node.type) === 'trigger';
                                const label = isTrigger
                                  ? String(
                                      (node.data as any)?.nodeType ?? 'Trigger'
                                    )
                                  : String((node.data as any)?.name ?? node.id);
                                setNodeContextMenu({
                                  position: { x: e.clientX, y: e.clientY },
                                  nodeId: String(node.id),
                                  nodeLabel: label,
                                  nodeType: isTrigger ? 'trigger' : 'transform',
                                  triggerNodeType: isTrigger
                                    ? String((node.data as any)?.nodeType ?? '')
                                    : null,
                                  transformOutputTypes: !isTrigger
                                    ? Array.isArray(
                                        (node.data as any)?.outputTypes
                                      )
                                      ? (
                                          (node.data as any)
                                            .outputTypes as any[]
                                        ).map((t) => String(t))
                                      : null
                                    : null
                                });
                                setPaneContextMenu(null);
                              }}
                            >
                              <Background
                                variant={BackgroundVariant.Dots}
                                color={
                                  isDark ? 'rgba(255,255,255,0.18)' : '#71717a'
                                }
                                gap={24}
                                size={1.5}
                              />
                              {showMiniMap && (
                                <MiniMap
                                  nodeColor={() => '#6b7280'}
                                  nodeStrokeColor={
                                    isDark ? '#374151' : '#d1d5db'
                                  }
                                  nodeBorderRadius={8}
                                  maskColor={
                                    isDark
                                      ? 'rgba(0, 0, 0, 0.7)'
                                      : 'rgba(255, 255, 255, 0.7)'
                                  }
                                  style={{
                                    width: 150,
                                    height: 105,
                                    backgroundColor: isDark
                                      ? '#18181b'
                                      : '#ffffff',
                                    border: isDark
                                      ? '1px solid #27272a'
                                      : '1px solid #e5e7eb',
                                    borderRadius: '8px',
                                    opacity: 0.5
                                  }}
                                />
                              )}
                            </ReactFlow>
                          </FlowConnectionFilterProvider>

                          {paneContextMenu ? (
                            <FlowPaneContextMenu
                              position={paneContextMenu.position}
                              flowPosition={paneContextMenu.flowPosition}
                              paletteGroups={paletteGroups as any}
                              onFitView={() => {
                                void reactFlowInstance.fitView({
                                  padding: 0.18,
                                  duration: 220,
                                  maxZoom: 1.5
                                });
                              }}
                              onZoomIn={() => {
                                try {
                                  reactFlowInstance.zoomIn({ duration: 160 });
                                } catch {
                                  // ignore
                                }
                              }}
                              onZoomOut={() => {
                                try {
                                  reactFlowInstance.zoomOut({ duration: 160 });
                                } catch {
                                  // ignore
                                }
                              }}
                              onApplyLayout={() => {
                                applyFlowLayout();
                              }}
                              onRequestClearFlow={() => {
                                setIsClearFlowConfirmOpen(true);
                              }}
                              onAddTransformHere={(t, client) => {
                                addTransformNode({
                                  ...t,
                                  clientX: client.x,
                                  clientY: client.y
                                });
                              }}
                              onClose={() => setPaneContextMenu(null)}
                            />
                          ) : null}

                          <AlertDialog
                            open={isClearFlowConfirmOpen}
                            onOpenChange={(open) => {
                              if (!open) setIsClearFlowConfirmOpen(false);
                            }}
                          >
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Clear flow?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will remove all nodes and edges from the
                                  flow. This action cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => {
                                    setIsClearFlowConfirmOpen(false);
                                    clearFlow();
                                  }}
                                >
                                  Clear
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>

                          {nodeContextMenu ? (
                            <FlowNodeContextMenu
                              position={nodeContextMenu.position}
                              nodeId={nodeContextMenu.nodeId}
                              nodeLabel={nodeContextMenu.nodeLabel}
                              nodeType={nodeContextMenu.nodeType}
                              triggerNodeType={nodeContextMenu.triggerNodeType}
                              transformOutputTypes={
                                nodeContextMenu.transformOutputTypes
                              }
                              onOpenTransform={() => {
                                const node = nodes.find(
                                  (n) => n.id === nodeContextMenu.nodeId
                                );
                                if (!node || node.type !== 'transform') return;
                                setOpenTransformNodeDialog({
                                  nodeId: String(node.id),
                                  nodeData: (node.data ?? {}) as any
                                });
                              }}
                              onAddTransformForInputType={(inputType) => {
                                setSidebarTab('add');
                                setIsSidebarOpen(true);
                                setSidebarSearchQuery(
                                  `in:${String(inputType)}`
                                );
                                setPendingAddTransformFrom({
                                  sourceNodeId: nodeContextMenu.nodeId,
                                  outType: String(inputType)
                                });
                                requestAnimationFrame(() =>
                                  sidebarSearchInputRef.current?.focus()
                                );
                              }}
                              onFitNode={() => {
                                try {
                                  const target = nodes.find(
                                    (n) => n.id === nodeContextMenu.nodeId
                                  );
                                  if (!target) return;
                                  void reactFlowInstance.fitView({
                                    padding: 0.22,
                                    duration: 220,
                                    maxZoom: 1.6,
                                    nodes: [target] as any
                                  });
                                } catch {
                                  // ignore
                                }
                              }}
                              onDuplicate={() =>
                                duplicateNodeById(nodeContextMenu.nodeId)
                              }
                              onDelete={() =>
                                deleteNodeById(nodeContextMenu.nodeId)
                              }
                              onClose={() => setNodeContextMenu(null)}
                            />
                          ) : null}
                          <div className='pointer-events-none absolute inset-0 z-[5] shadow-[inset_0_0_90px_rgba(0,0,0,0.01)] dark:shadow-[inset_0_0_110px_rgba(0,0,0,0.02)]' />
                        </div>
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
                          isActive={isActive}
                          bottomDockTab={bottomDockTab}
                          onBottomDockTabClick={setBottomDockTab}
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
            </ResizablePanelGroup>
          </div>
        </div>
      </div>
      {openTransformNodeDialog ? (
        <OpenTransformNodeDialog
          open
          onOpenChange={(open) => {
            if (open) return;
            setOpenTransformNodeDialog(null);
          }}
          nodeId={openTransformNodeDialog.nodeId}
          nodeData={openTransformNodeDialog.nodeData}
        />
      ) : null}
    </TransformLoggerProvider>
  );
}

'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import type { Edge, Node } from 'reactflow';
import {
  SidebarSimpleIcon as IconSidebar,
  CheckIcon as IconCheck,
  CornersOutIcon as IconFitView,
  MinusSquareIcon as IconMinusSquare,
  PlusSquareIcon as IconPlusSquare,
  PencilSimpleIcon as IconEdit,
  PlusIcon as IconPlus,
  XIcon as IconX
} from '@/components/icons';
import type { ImperativePanelHandle } from 'react-resizable-panels';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ResizableHandle, ResizablePanel } from '@/components/ui/resizable';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { cn } from '@/lib/utils';
import { getNodeDisplayLabel } from '@/features/graph/utils/display-label';
import type { OSINTNodeData } from '@/features/graph/types';
import type { OSINTEdgeData } from '@/features/graph/components/osint-edge';
import { nodeTypeByType, type NodeType, getLogoUrlForDomain, getLogoUrlForNodeType } from '@/features/osint/node-registry';
import { LinkableText } from '@/features/graph/components/linkable-text';
import { LogoOrIcon } from './logo-or-icon';
import type {
  AnalysisGraphData,
  AnalysisGraphLink,
  AnalysisGraphNode
} from '../analysis/canvas/analysis-transform';
import { transformRelationalToAnalysisGraphData } from '../analysis/canvas/analysis-transform';
import { renderAnalysisNode } from '../analysis/canvas/render-node';
import { renderAnalysisLink } from '../analysis/canvas/render-link';
import { loadTablerIcon } from '../analysis/canvas/icon-cache';
import { loadLogoWithRetry } from '../analysis/canvas/logo-cache';
import { computeRelationalPositions } from '@/features/graph/relational-layout/relational-layout-client';
import type {
  RelationalLayoutEdgeInput,
  RelationalLayoutNodeInput
} from '@/features/graph/relational-layout/types';
import { GraphSidepanelBottomBar } from './graph-sidepanel-bottom-bar';

interface GraphDetailsPanelProps {
  isReadOnly?: boolean;
  detailsPanelRef: React.MutableRefObject<ImperativePanelHandle | null>;
  lastOpenDetailsSizeRef: React.MutableRefObject<number>;
  detailsStateFromResizeRef: React.MutableRefObject<boolean>;
  isDetailsPanelOpen: boolean;
  setIsDetailsPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  detailsCollapsedSizePct: number;
  detailsMinSizePct: number;
  detailsMaxSizePct: number;
  closeDetailsPanel: () => void;
  isDark: boolean;
  graphViewMode: 'free' | 'locked' | 'analysis' | 'map';
  nodes: ReadonlyArray<Node>;
  edges: ReadonlyArray<Edge>;
  onUpdateNode: (args: { nodeId: string; label: string; metadata: Record<string, unknown> }) => void;
  onSelectNodeId: (nodeId: string) => void;
  onSelectEdgeId: (edgeId: string) => void;
}

const SESSION_KEY_DETAILS_MINIMAP_VISIBLE = 'paranod:details-panel:minimap-visible';

const ForceGraph2D = dynamic(() => import('react-force-graph-2d').then((m) => m.default), {
  ssr: false
});

interface RelationItem {
  edgeId: string;
  direction: 'in' | 'out' | 'loop';
  otherId: string;
  otherLabel: string;
  otherType: string | null;
  edgeRelation: string;
}

function getNodeLabel(node: Node | undefined) {
  if (!node) return '—';
  const data = node.data as OSINTNodeData | undefined;
  if (!data?.label) return node.id;
  return getNodeDisplayLabel({
    type: data.type,
    label: data.label,
    metadata: data.metadata
  });
}

function getNodeTypeLabel(typeValue: string | undefined) {
  if (!typeValue) return '—';
  if (Object.prototype.hasOwnProperty.call(nodeTypeByType, typeValue))
    return nodeTypeByType[typeValue as NodeType]?.label ?? typeValue;
  return typeValue;
}

function getEdgeLabel(edgeData: OSINTEdgeData | undefined) {
  if (!edgeData?.label && !edgeData?.relationship) return '—';
  if (edgeData.label && edgeData.relationship) return `${edgeData.label} • ${edgeData.relationship}`;
  return edgeData.label ?? edgeData.relationship ?? '—';
}

function getEdgeRelation(edgeData: OSINTEdgeData | undefined) {
  // For "Relations" table we want a single relation label (like the graph edge label),
  // and avoid duplicates like "subdomain • subdomain".
  const a = String(edgeData?.relationship ?? '').trim();
  const b = String(edgeData?.label ?? '').trim();
  if (a && b && a.toLowerCase() === b.toLowerCase()) return a;
  return (a || b || '—').trim();
}

function getNodeTitle(data: OSINTNodeData | undefined) {
  if (!data) return 'Node details';
  if (data.type === 'ai_insight' && data.metadata?.title) return String(data.metadata.title);
  return nodeTypeByType[data.type]?.label ?? data.type;
}

function getNodeLogoUrl(data: OSINTNodeData | undefined) {
  if (!data) return undefined;
  const rawValue = String(data.label ?? '').trim();
  const type = String(data.type ?? '');
  const isDynamicType = type === 'domain' || type === 'subdomain' || type === 'url';
  if (!rawValue) return getLogoUrlForNodeType(data.type as NodeType, { size: 256 }) ?? undefined;

  function tryParseDomainFromUrl(value: string) {
    try {
      const parsed = new URL(value);
      return parsed.hostname;
    } catch {
      return undefined;
    }
  }

  if (isDynamicType) {
    const fromUrl = rawValue.includes('://') ? tryParseDomainFromUrl(rawValue) : undefined;
    const asUrlWithScheme = !fromUrl ? tryParseDomainFromUrl(`https://${rawValue}`) : undefined;
    const domain = fromUrl ?? asUrlWithScheme ?? rawValue.replace(/^https?:\/\//, '').split('/')[0];
    if (domain) return getLogoUrlForDomain({ domain, size: 256 }) ?? undefined;
  }

  return getLogoUrlForNodeType(data.type as NodeType, { size: 256 }) ?? undefined;
}

function isMergeInternalMetadataKey(key: string) {
  return key === '__merge';
}

const RESERVED_MERGE_METADATA_KEYS = new Set(['__merge', 'merge', 'merged', 'mergedChildCount']);
function isReservedMergeMetadataKey(key: string) {
  return RESERVED_MERGE_METADATA_KEYS.has(String(key));
}

// Metadata di stile interni: nascosti dal display (sidepanel/dialog) ma
// preservati sul nodo (NON usare nel filtro di salvataggio).
const HIDDEN_DISPLAY_METADATA_KEYS = new Set([
  'customColor',
  'headerTextColor',
  'autoColorFromLogo',
  'autoHeaderTextColorFromLogo',
  'nodeView',
  'logoDomain'
]);
function isHiddenDisplayMetadataKey(key: string) {
  return HIDDEN_DISPLAY_METADATA_KEYS.has(String(key));
}

function isMergedList(value: unknown): value is Array<{ label?: unknown; value?: unknown; id?: unknown; type?: unknown }> {
  return Array.isArray(value);
}

function formatMetadataKey(key: string) {
  return key.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').trim();
}

function renderMetadataValue(value: unknown) {
  if (value === null || value === undefined)
    return <span className='text-muted-foreground italic'>null</span>;
  if (typeof value === 'boolean')
    return <Badge variant={value ? 'default' : 'secondary'}>{value ? 'Yes' : 'No'}</Badge>;
  if (Array.isArray(value))
    return (
      <div className='flex flex-wrap gap-1'>
        {value.map((v, i) => (
          <Badge key={i} variant='outline' className='text-xs'>
            <LinkableText text={String(v)} />
          </Badge>
        ))}
      </div>
    );
  if (typeof value === 'object')
    return (
      <pre className='bg-muted overflow-x-auto rounded p-2 text-xs'>
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  const strValue = String(value);
  if (strValue.length > 50)
    return <LinkableText text={strValue} className='font-mono text-sm break-all' />;
  return <LinkableText text={strValue} className='text-sm font-medium' />;
}

function getMiniGraphNodesForNode(args: { nodeId: string; nodes: Node[]; edges: Edge[] }) {
  // Include BOTH outgoing and incoming edges for the selected node.
  const outgoing = args.edges.filter((edge) => String(edge.source) === args.nodeId);
  const incoming = args.edges.filter((edge) => String(edge.target) === args.nodeId);
  // Dedup edges by id (in case of unusual data)
  const byId = new Map<string, Edge>();
  for (const e of [...outgoing, ...incoming]) byId.set(String(e.id), e);
  const primaryEdges = Array.from(byId.values());
  const nodeIds = new Set<string>([args.nodeId]);
  primaryEdges.forEach((edge) => {
    nodeIds.add(String(edge.source) === args.nodeId ? String(edge.target) : String(edge.source));
  });
  return {
    nodes: args.nodes.filter((node) => nodeIds.has(node.id)),
    edges: primaryEdges
  };
}

function MiniGraph(props: {
  data: AnalysisGraphData;
  isDark: boolean;
  selectedNodeId?: string | null;
  selectedEdgeId?: string | null;
  canDragNodes: boolean;
}) {
  const graphRef = React.useRef<any>(null);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [size, setSize] = React.useState({ width: 0, height: 0 });
  const labelCollisionRef = React.useRef<Array<{ x: number; y: number; w: number; h: number }>>(
    []
  );
  const [localData, setLocalData] = React.useState<AnalysisGraphData>(() => ({
    nodes: props.data.nodes.map((n) => ({ ...(n as any) })),
    links: props.data.links.map((l) => ({ ...(l as any) }))
  }));
  const localDataRef = React.useRef(localData);
  React.useEffect(() => {
    localDataRef.current = localData;
  }, [localData]);

  const fitTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const layoutAbortRef = React.useRef<AbortController | null>(null);

  function clampNumber(min: number, value: number, max: number) {
    return Math.max(min, Math.min(max, value));
  }

  function computeFitViewport(args: {
    nodes: ReadonlyArray<{ x: number; y: number; nodeSize?: unknown; nodeLabel?: unknown }>;
    widthPx: number;
    heightPx: number;
    paddingPx: number;
    minZoom?: number;
    maxZoom?: number;
  }) {
    const widthPx = Math.max(0, Math.floor(args.widthPx));
    const heightPx = Math.max(0, Math.floor(args.heightPx));
    if (widthPx <= 0 || heightPx <= 0) return null;
    if (!args.nodes.length) return null;

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    function computeBounds(zoomForLabels: number) {
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;

      const z = Math.max(0.001, zoomForLabels);

      for (const n of args.nodes) {
        const x = Number(n.x);
        const y = Number(n.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

        const size = Math.max(14, Number(n.nodeSize) || 16);
        const r = size / 2;

        minX = Math.min(minX, x - r);
        maxX = Math.max(maxX, x + r);
        minY = Math.min(minY, y - r);
        maxY = Math.max(maxY, y + r);

        // Include node label bounds (robust fitView): approximate the same math as `renderAnalysisNode`.
        const label = String(n.nodeLabel ?? '').trim();
        if (!label) continue;

        const fontSizePx = 12;
        const minPx = 10;
        const px = Math.max(minPx, fontSizePx / Math.max(0.65, z));
        const approxCharW = px * 0.58;
        const paddingX = Math.max(7, 9 / Math.max(0.8, z));
        const paddingY = Math.max(3, 5 / Math.max(0.8, z));
        const textW = label.length * approxCharW;
        const boxW = Math.max(26, textW + paddingX * 2);
        const boxH = px + paddingY * 2;

        const lx = x - boxW / 2;
        const ly = y + r * 0.15 + px * 0.45;
        minX = Math.min(minX, lx);
        maxX = Math.max(maxX, lx + boxW);
        minY = Math.min(minY, ly);
        maxY = Math.max(maxY, ly + boxH);
      }

      if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY))
        return null;

      return { minX, minY, maxX, maxY };
    }

    // Iterate a couple of times so label-size (which depends on zoom) stabilizes.
    const pad = Math.max(0, Math.min(Math.floor(args.paddingPx), Math.floor(Math.min(widthPx, heightPx) / 2) - 1));
    const minZoom = typeof args.minZoom === 'number' ? args.minZoom : 0.05;
    const maxZoom = typeof args.maxZoom === 'number' ? args.maxZoom : 12;

    let zoomGuess = 1;
    let bounds = computeBounds(zoomGuess);
    if (!bounds) return null;

    for (let i = 0; i < 3; i++) {
      const spanX = Math.max(1, bounds.maxX - bounds.minX);
      const spanY = Math.max(1, bounds.maxY - bounds.minY);
      const zoomX = (widthPx - pad * 2) / spanX;
      const zoomY = (heightPx - pad * 2) / spanY;
      const next = clampNumber(minZoom, Math.min(zoomX, zoomY), maxZoom);

      if (Math.abs(next - zoomGuess) < 0.02) {
        zoomGuess = next;
        break;
      }
      zoomGuess = next;
      const b2 = computeBounds(zoomGuess);
      if (!b2) break;
      bounds = b2;
    }

    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    return { centerX, centerY, zoom: zoomGuess };
  }

  function estimateLabelExtraPaddingPx(nodes: AnalysisGraphData['nodes']) {
    const maxLen = nodes.reduce((acc, n) => {
      const len = String((n as any)?.nodeLabel ?? '').trim().length;
      return len > acc ? len : acc;
    }, 0);
    if (maxLen <= 0) return 0;

    const approxCharPx = 7.2;
    const paddingX = 18;
    const boxW = Math.max(26, maxLen * approxCharPx + paddingX);
    const halfW = boxW / 2;
    const verticalNeed = 44;
    const extra = Math.max(halfW, verticalNeed);
    // minimappa: evita padding enormi che causano zoom-out estremo
    return clampNumber(0, Math.round(extra), 70);
  }

  function getMiniMapPaddingForNodeCount(nodeCount: number) {
    // Obiettivo: massimizzare lo zoom (vedere i nodi "grandi") senza clipping.
    if (nodeCount <= 0) return 10;
    if (nodeCount <= 1) return 14;
    if (nodeCount <= 2) return 12;
    if (nodeCount <= 6) return 10;
    if (nodeCount <= 14) return 8;
    return 7;
  }

  const applyInitialView = React.useCallback(() => {
    const ref = graphRef.current;
    if (!ref) return;
    const data = localDataRef.current;
    if (!data.nodes.length) return;
    if (size.width <= 0 || size.height <= 0) return;

    const nodeCount = data.nodes.length;
    const labelExtra = Math.round(estimateLabelExtraPaddingPx(data.nodes) * 0.55);
    const paddingPx = getMiniMapPaddingForNodeCount(nodeCount) + clampNumber(0, labelExtra, 28);
    const vp = computeFitViewport({
      nodes: data.nodes,
      widthPx: size.width,
      heightPx: size.height,
      paddingPx,
      minZoom: 0.08,
      maxZoom: 12
    });
    if (!vp) return;

    // Start a bit more zoomed-out, then after 1s we run the "maximize zoom" fitView.
    const initialZoom = Math.min(vp.zoom, 0.75);
    if (typeof ref.centerAt === 'function') ref.centerAt(vp.centerX, vp.centerY, 0);
    if (typeof ref.zoom === 'function') ref.zoom(initialZoom, 0);
  }, [size.width, size.height]);

  const fitView = React.useCallback(() => {
    if (!graphRef.current) return;
    const data = localDataRef.current;
    if (!data.nodes.length) return;
    if (size.width <= 0 || size.height <= 0) return;

    const nodeCount = data.nodes.length;
    // FitView (minimappa): include label padding so labels don't clip outside.
    const labelExtra = Math.round(estimateLabelExtraPaddingPx(data.nodes) * 0.65);
    const paddingPx = getMiniMapPaddingForNodeCount(nodeCount) + clampNumber(0, labelExtra, 32);
    const ref = graphRef.current;
    const vp = computeFitViewport({
      nodes: data.nodes,
      widthPx: size.width,
      heightPx: size.height,
      paddingPx,
      minZoom: 0.1,
      // minimappa: consenti "zoom massimo possibile" quando ci sta
      maxZoom: 12
    });
    if (!vp) return;
    const durationMs = 420;
    if (typeof ref.centerAt === 'function') ref.centerAt(vp.centerX, vp.centerY, durationMs);
    if (typeof ref.zoom === 'function') ref.zoom(vp.zoom, durationMs);
  }, [size.width, size.height]);

  React.useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    function update() {
      const rect = el.getBoundingClientRect();
      setSize({ width: Math.floor(rect.width), height: Math.floor(rect.height) });
    }
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  React.useEffect(() => {
    // Minimappa: stesso comportamento “mappa grande” sul layout, ma SOLO force.
    // Non tocchiamo lo stato globale: layout locale e safe.
    layoutAbortRef.current?.abort();
    const abort = new AbortController();
    layoutAbortRef.current = abort;

    async function run() {
      // IMPORTANT: on selection changes `props.data` changes; don't rely on async state/ref updates.
      const baseData: AnalysisGraphData = {
        nodes: props.data.nodes.map((n) => ({ ...(n as any) })),
        links: props.data.links.map((l) => ({ ...(l as any) }))
      };
      localDataRef.current = baseData;
      setLocalData(baseData);
      if (!baseData.nodes.length) return;

      const degreeById = new Map<string, number>();
      for (const l of baseData.links) {
        const s = String((l as any).source);
        const t = String((l as any).target);
        degreeById.set(s, (degreeById.get(s) ?? 0) + 1);
        degreeById.set(t, (degreeById.get(t) ?? 0) + 1);
      }

      const nodeInputs: RelationalLayoutNodeInput[] = baseData.nodes.map((n) => {
        const size = Math.max(16, Number((n as any).nodeSize) || 16);
        return { id: n.id, width: size, height: size, degree: degreeById.get(n.id) ?? 0 };
      });

      const edgeInputs: RelationalLayoutEdgeInput[] = baseData.links
        .filter((e) => String((e as any).source) !== String((e as any).target))
        .map((e) => ({ source: String((e as any).source), target: String((e as any).target) }));

      const positions = await computeRelationalPositions({
        engine: 'force',
        nodes: nodeInputs,
        edges: edgeInputs,
        options: {
          iterations: 180,
          linkDistance: 140,
          repulsionBase: 320,
          repulsionDegreeFactor: 58,
          collisionPadding: 10,
          gravityStrength: 0.06,
          maxRadius: 520
        },
        signal: abort.signal
      });

      if (abort.signal.aborted) return;
      const posById = new Map(positions.map((p) => [p.id, p]));
      const sizeById = new Map(nodeInputs.map((n) => [n.id, { w: n.width, h: n.height }]));

      const laidOut: AnalysisGraphData = {
        ...baseData,
        nodes: baseData.nodes.map((n: any) => {
          const p = posById.get(String(n.id));
          const s = sizeById.get(String(n.id)) ?? { w: 16, h: 16 };
          if (!p) return n;
          const cx = Number(p.x ?? 0) + s.w / 2;
          const cy = Number(p.y ?? 0) + s.h / 2;
          return { ...n, x: cx, y: cy, fx: cx, fy: cy };
        })
      };
      localDataRef.current = laidOut;
      setLocalData(laidOut);

      // Center immediately with a lower initial zoom (requested),
      // then run fitView after everything has “settled”.
      requestAnimationFrame(() => {
        if (abort.signal.aborted) return;
        applyInitialView();
      });

      // FitView after everything has “settled” (request)
      if (fitTimerRef.current) clearTimeout(fitTimerRef.current);
      fitTimerRef.current = setTimeout(() => {
        fitTimerRef.current = null;
        fitView();
      }, 1000);
    }

    void run().catch(() => {});

    return () => {
      abort.abort();
      if (fitTimerRef.current) clearTimeout(fitTimerRef.current);
      fitTimerRef.current = null;
    };
  }, [props.data, fitView, applyInitialView]);

  React.useEffect(() => {
    const tasks: Array<Promise<unknown>> = [];
    for (const node of props.data.nodes) {
      if (node.nodeLogoUrl)
        tasks.push(loadLogoWithRetry(node.nodeLogoUrl, { maxAttempts: 3, retryDelayMs: 900 }));
      const def: any = (nodeTypeByType as any)[node.nodeType];
      const Icon = def?.icon as any;
      if (Icon) {
        const sizePx = Math.max(14, Math.min(26, Math.round((node.nodeSize / 2) * 1.2)));
        tasks.push(loadTablerIcon({ icon: Icon, sizePx, color: '#ffffff' }));
      }
    }
    void Promise.allSettled(tasks);
  }, [props.data.nodes]);

  React.useEffect(() => {
    // reset collision ogni frame render
    if (!graphRef.current) return;
  }, []);

  React.useEffect(() => {
    // il fit iniziale è gestito da `onEngineStop` (docsforce-style)
  }, []);

  const nodeById = React.useMemo(() => {
    return new Map(localData.nodes.map((node) => [node.id, node]));
  }, [localData.nodes]);

  const [hoverNodeId, setHoverNodeId] = React.useState<string | null>(null);
  const [hoverEdgeId, setHoverEdgeId] = React.useState<string | null>(null);
  const [highlightNodeIds, setHighlightNodeIds] = React.useState<Set<string>>(() => new Set());
  const [highlightEdgeIds, setHighlightEdgeIds] = React.useState<Set<string>>(() => new Set());
  const rafRef = React.useRef<number | null>(null);

  const scheduleHighlights = React.useCallback((next: { nodes: Set<string>; edges: Set<string> }) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      setHighlightNodeIds(next.nodes);
      setHighlightEdgeIds(next.edges);
      rafRef.current = null;
    });
  }, []);

  React.useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const clearHighlights = React.useCallback(() => {
    scheduleHighlights({ nodes: new Set(), edges: new Set() });
  }, [scheduleHighlights]);

  const handleNodeHover = React.useCallback(
    (node: AnalysisGraphNode | null) => {
      if (!node) {
        setHoverNodeId(null);
        clearHighlights();
        return;
      }
      setHoverNodeId(node.id);
      const nodes = new Set<string>([node.id, ...node.neighbors.map((n) => n.id)]);
      const edges = new Set<string>(node.links.map((l) => l.id));
      scheduleHighlights({ nodes, edges });
    },
    [clearHighlights, scheduleHighlights]
  );

  const handleLinkHover = React.useCallback(
    (link: AnalysisGraphLink | null) => {
      function getEndpointId(v: unknown) {
        if (typeof v === 'string' || typeof v === 'number') return String(v);
        if (v && typeof v === 'object' && 'id' in v) return String((v as any).id ?? '');
        return '';
      }

      if (!link) {
        setHoverEdgeId(null);
        if (hoverNodeId) return;
        clearHighlights();
        return;
      }

      setHoverEdgeId(link.id);
      const nodes = new Set<string>([
        getEndpointId((link as any).source),
        getEndpointId((link as any).target)
      ]);
      const edges = new Set<string>([link.id]);
      scheduleHighlights({ nodes, edges });
    },
    [clearHighlights, hoverNodeId, scheduleHighlights]
  );

  const isNodeHighlighted = React.useCallback((id: string) => highlightNodeIds.has(id), [highlightNodeIds]);
  const isEdgeHighlighted = React.useCallback((id: string) => highlightEdgeIds.has(id), [highlightEdgeIds]);
  const isNodeSelected = React.useCallback((id: string) => id === String(props.selectedNodeId ?? ''), [props.selectedNodeId]);
  const isEdgeSelected = React.useCallback((id: string) => id === String(props.selectedEdgeId ?? ''), [props.selectedEdgeId]);
  const isNodeHover = React.useCallback((id: string) => hoverNodeId === id, [hoverNodeId]);
  const isEdgeHover = React.useCallback((id: string) => hoverEdgeId === id, [hoverEdgeId]);

  const renderNode = React.useCallback(
    (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      renderAnalysisNode({
        node: node as AnalysisGraphNode,
        ctx,
        globalScale,
        isDark: props.isDark,
        isHighlighted: isNodeHighlighted,
        isSelected: isNodeSelected,
        isHover: isNodeHover,
        // Minimappa: le label devono essere sempre visibili, senza collision detection e senza gating sullo zoom.
        labelConfig: { showWhenScaleGte: 0, fontSizePx: 9, minPx: 8 }
      });
    },
    [props.isDark, props.selectedNodeId, props.data.nodes]
  );

  const renderLink = React.useCallback(
    (link: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      renderAnalysisLink({
        link: link as AnalysisGraphLink,
        ctx,
        globalScale,
        isDark: props.isDark,
        getNodeById: (id) => nodeById.get(id),
        isHighlighted: isEdgeHighlighted,
        isSelected: isEdgeSelected,
        isHover: isEdgeHover,
        isEndpointHovered: () => false,
        isEndpointSelected: () => false
      });
    },
    [props.isDark, props.selectedEdgeId, nodeById]
  );

  return (
    <div
      ref={containerRef}
      className='relative h-full w-full overflow-hidden rounded-lg border bg-canvas'
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className='absolute right-2 top-2 z-10'>
        <Button
          type='button'
          variant='secondary'
          size='icon'
          className="h-7 w-7 bg-background/80 shadow-sm backdrop-blur [&_svg:not([class*='size-'])]:!size-4"
          onClick={fitView}
          title='Fit view'
        >
          <IconFitView className='h-4 w-4' />
        </Button>
      </div>
      {size.width > 0 && size.height > 0 ? (
        <ForceGraph2D
          ref={graphRef}
          width={size.width}
          height={size.height}
          graphData={localData as any}
          cooldownTicks={0}
          enableNodeDrag={props.canDragNodes}
          enableZoomInteraction={true}
          enablePanInteraction={true}
          enablePointerInteraction={true}
          backgroundColor='transparent'
          nodeLabel={() => ''}
          nodeCanvasObjectMode={() => 'replace'}
          nodeCanvasObject={renderNode}
          nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
            const size = Math.max(10, Number(node?.nodeSize) || 16);
            const radius = size / 2;
            const padding = 6;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(Number(node?.x ?? 0), Number(node?.y ?? 0), radius + padding, 0, Math.PI * 2);
            ctx.fill();
          }}
          linkCanvasObjectMode={() => 'replace'}
          linkCanvasObject={renderLink}
          linkCurvature={(l: any) => Number(l?.curvature ?? 0)}
        onRenderFramePre={() => {}}
          onNodeHover={handleNodeHover as any}
          onLinkHover={handleLinkHover as any}
          onNodeDragEnd={(n: any) => {
            if (!props.canDragNodes) return;
            const node = n as AnalysisGraphNode;
            // Persistiamo solo nella copia locale (minimappa standalone)
            setLocalData((prev) => ({
              ...prev,
              nodes: prev.nodes.map((nn: any) =>
                nn.id === node.id
                  ? { ...nn, x: node.x, y: node.y, fx: node.x, fy: node.y }
                  : nn
              )
            }));
          }}
        />
      ) : null}
    </div>
  );
}

export function GraphDetailsPanel(props: GraphDetailsPanelProps) {
  const selectedNode = React.useMemo(
    () => props.nodes.find((node) => node.selected),
    [props.nodes]
  );
  const selectedEdge = React.useMemo(
    () => props.edges.find((edge) => edge.selected),
    [props.edges]
  );
  const selectedNodeData = selectedNode?.data as OSINTNodeData | undefined;
  const selectedEdgeData = selectedEdge?.data as OSINTEdgeData | undefined;
  const selectionKind = selectedNode ? 'node' : selectedEdge ? 'edge' : 'none';

  const [isEditMode, setIsEditMode] = React.useState(false);
  const [editedLabel, setEditedLabel] = React.useState('');
  const [editedMetadata, setEditedMetadata] = React.useState<Record<string, unknown>>({});
  const [newMetaKey, setNewMetaKey] = React.useState('');
  const [newMetaValue, setNewMetaValue] = React.useState('');
  const [isMiniMapVisible, setIsMiniMapVisible] = React.useState(true);

  React.useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY_DETAILS_MINIMAP_VISIBLE);
      if (raw === null) return;
      setIsMiniMapVisible(raw === '1');
    } catch {
      // ignore
    }
  }, []);

  const toggleMiniMap = React.useCallback(() => {
    setIsMiniMapVisible((prev) => {
      const next = !prev;
      try {
        sessionStorage.setItem(SESSION_KEY_DETAILS_MINIMAP_VISIBLE, next ? '1' : '0');
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  React.useEffect(() => {
    if (!selectedNode || !selectedNodeData) {
      setIsEditMode(false);
      setEditedLabel('');
      setEditedMetadata({});
      setNewMetaKey('');
      setNewMetaValue('');
      return;
    }
    setIsEditMode(false);
    setEditedLabel(String(selectedNodeData.label ?? ''));
    setEditedMetadata(
      (selectedNodeData.metadata && typeof selectedNodeData.metadata === 'object'
        ? (selectedNodeData.metadata as Record<string, unknown>)
        : {}) ?? {}
    );
    setNewMetaKey('');
    setNewMetaValue('');
  }, [selectedNode?.id, props.isReadOnly]);

  const handleUpdateMetadata = React.useCallback((key: string, value: string) => {
    if (props.isReadOnly) return;
    setEditedMetadata((prev) => ({ ...prev, [key]: value }));
  }, [props.isReadOnly]);

  const handleRemoveMetadata = React.useCallback((key: string) => {
    if (props.isReadOnly) return;
    setEditedMetadata((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, [props.isReadOnly]);

  const handleAddMetadata = React.useCallback(() => {
    if (props.isReadOnly) return;
    const key = newMetaKey.trim();
    if (!key) return;
    if (isReservedMergeMetadataKey(key)) return;
    setEditedMetadata((prev) => ({ ...prev, [key]: newMetaValue }));
    setNewMetaKey('');
    setNewMetaValue('');
  }, [newMetaKey, newMetaValue, props.isReadOnly]);

  const handleCancelEdit = React.useCallback(() => {
    if (!selectedNode || !selectedNodeData) {
      setIsEditMode(false);
      return;
    }
    setEditedLabel(String(selectedNodeData.label ?? ''));
    setEditedMetadata((selectedNodeData.metadata ?? {}) as any);
    setNewMetaKey('');
    setNewMetaValue('');
    setIsEditMode(false);
  }, [selectedNode?.id]);

  const handleSaveEdit = React.useCallback(() => {
    if (props.isReadOnly || !selectedNode) return;
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(editedMetadata ?? {})) {
      if (isReservedMergeMetadataKey(k)) continue;
      cleaned[k] = v;
    }
    props.onUpdateNode({
      nodeId: String(selectedNode.id),
      label: editedLabel,
      metadata: cleaned
    });
    setIsEditMode(false);
  }, [editedLabel, editedMetadata, props, selectedNode]);

  const nodeById = React.useMemo(() => {
    return new Map(props.nodes.map((node) => [node.id, node]));
  }, [props.nodes]);

  const relations = React.useMemo<RelationItem[]>(() => {
    if (!selectedNode) return [];
    const nodeId = selectedNode.id;

    return props.edges
      .filter((edge) => String(edge.source) === nodeId || String(edge.target) === nodeId)
      .map((edge) => {
        const isLoop = String(edge.source) === nodeId && String(edge.target) === nodeId;
        const direction = isLoop ? 'loop' : String(edge.source) === nodeId ? 'out' : 'in';
        const otherId = isLoop
          ? nodeId
          : String(edge.source) === nodeId
            ? String(edge.target)
            : String(edge.source);
        const otherNode = nodeById.get(otherId);
        const otherData = otherNode?.data as OSINTNodeData | undefined;
        const edgeData = edge.data as OSINTEdgeData | undefined;
        const edgeRelation = getEdgeRelation(edgeData);

        return {
          edgeId: edge.id,
          direction,
          otherId,
          otherLabel: getNodeLabel(otherNode),
          otherType: otherData?.type ?? null,
          edgeRelation
        };
      });
  }, [selectedNode, props.edges, nodeById]);

  const sourceNode = selectedEdge ? nodeById.get(selectedEdge.source) : undefined;
  const targetNode = selectedEdge ? nodeById.get(selectedEdge.target) : undefined;


  const miniGraphData = React.useMemo<AnalysisGraphData>(() => {
    if (selectionKind === 'node' && selectedNode) {
      const subset = getMiniGraphNodesForNode({
        nodeId: selectedNode.id,
        nodes: props.nodes as Node[],
        edges: props.edges as Edge[]
      });
      const data = transformRelationalToAnalysisGraphData({
        nodes: subset.nodes,
        edges: subset.edges
      });
      return data;
    }

    if (selectionKind === 'edge' && selectedEdge) {
      const subsetNodes = props.nodes.filter(
        (node) => node.id === selectedEdge.source || node.id === selectedEdge.target
      );
      const data = transformRelationalToAnalysisGraphData({
        nodes: subsetNodes,
        edges: [selectedEdge]
      });
      return data;
    }

    return { nodes: [], links: [] };
  }, [selectionKind, selectedNode, selectedEdge, props.nodes, props.edges]);

  const relationRows = React.useMemo(() => {
    if (selectionKind === 'node' && selectedNode) {
      const selectedLabel = getNodeLabel(selectedNode);
      const selectedType = (selectedNode.data as OSINTNodeData | undefined)?.type ?? null;
      return relations.map((r) => {
        const rel = String(r.edgeRelation ?? '—').trim().toUpperCase();
        if (r.direction === 'in')
          return {
            edgeId: r.edgeId,
            source: r.otherLabel,
            relation: rel,
            target: selectedLabel,
            sourceNodeId: r.otherId,
            targetNodeId: selectedNode.id,
            sourceType: r.otherType,
            targetType: selectedType
          };
        if (r.direction === 'out')
          return {
            edgeId: r.edgeId,
            source: selectedLabel,
            relation: rel,
            target: r.otherLabel,
            sourceNodeId: selectedNode.id,
            targetNodeId: r.otherId,
            sourceType: selectedType,
            targetType: r.otherType
          };
        return {
          edgeId: r.edgeId,
          source: selectedLabel,
          relation: rel,
          target: selectedLabel,
          sourceNodeId: selectedNode.id,
          targetNodeId: selectedNode.id,
          sourceType: selectedType,
          targetType: selectedType
        };
      });
    }
    if (selectionKind === 'edge' && selectedEdge) {
      const sourceType = (sourceNode?.data as OSINTNodeData | undefined)?.type ?? null;
      const targetType = (targetNode?.data as OSINTNodeData | undefined)?.type ?? null;
      return [
        {
          edgeId: selectedEdge.id,
          source: getNodeLabel(sourceNode),
          relation: String(getEdgeRelation(selectedEdgeData) ?? '—').trim().toUpperCase(),
          target: getNodeLabel(targetNode),
          sourceNodeId: selectedEdge.source,
          targetNodeId: selectedEdge.target,
          sourceType,
          targetType
        }
      ];
    }
    return [];
  }, [selectionKind, relations, selectedNode, selectedEdge, sourceNode, targetNode, selectedEdgeData]);

  return (
    <>
      <ResizableHandle
        withHandle
        className={cn(
          'bg-border/60 dark:bg-white/10',
          'group/resize-handle [&>div]:opacity-0 group-hover/graph-details-panel:[&>div]:opacity-100',
          props.isDetailsPanelOpen ? '' : 'hidden'
        )}
      />
      <ResizablePanel
        ref={props.detailsPanelRef}
        defaultSize={
          props.isDetailsPanelOpen
            ? props.lastOpenDetailsSizeRef.current
            : props.detailsCollapsedSizePct
        }
        collapsible
        collapsedSize={props.detailsCollapsedSizePct}
        minSize={props.detailsMinSizePct}
        maxSize={props.detailsMaxSizePct}
        onResize={(size) => {
          const collapseAt = props.detailsCollapsedSizePct + 0.5;
          const expandAt = props.detailsCollapsedSizePct + 2;

          if (size <= collapseAt && props.isDetailsPanelOpen) {
            props.detailsStateFromResizeRef.current = true;
            props.setIsDetailsPanelOpen(false);
            return;
          }

          if (size >= expandAt && !props.isDetailsPanelOpen) {
            props.detailsStateFromResizeRef.current = true;
            props.setIsDetailsPanelOpen(true);
          }

          if (size >= expandAt) props.lastOpenDetailsSizeRef.current = size;
        }}
        className='min-w-0 transition-[flex-grow,flex-basis] duration-200 ease-in-out'
      >
        <aside
          className={cn(
            'group/graph-details-panel relative flex h-full flex-col overflow-hidden bg-background text-foreground',
            'border-l border-border/20 dark:border-white/5'
          )}
        >
          <div className='flex h-11 items-center gap-1 border-b border-border/40 px-3'>
            <div className='min-w-0 flex-1 truncate text-sm font-semibold'>
              Details
            </div>
            <div className='flex items-center gap-0.5'>
              <Button
                type='button'
                variant='ghost'
                size='icon'
                className="size-8 [&_svg:not([class*='size-'])]:!size-5"
                onClick={toggleMiniMap}
                title={isMiniMapVisible ? 'Hide minimap' : 'Show minimap'}
              >
                {isMiniMapVisible ? (
                  <IconMinusSquare className='h-4 w-4' />
                ) : (
                  <IconPlusSquare className='h-4 w-4' />
                )}
              </Button>

              {selectionKind === 'node' && selectedNode ? (
                isEditMode ? (
                  <>
                    <Button
                      type='button'
                      variant='outline'
                      size='icon'
                      className="size-8 [&_svg:not([class*='size-'])]:!size-5"
                      onClick={handleSaveEdit}
                      disabled={props.isReadOnly}
                      title='Save'
                    >
                      <IconCheck className='h-4 w-4' />
                    </Button>
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon'
                      className="size-8 [&_svg:not([class*='size-'])]:!size-5"
                      onClick={handleCancelEdit}
                      title='Cancel'
                    >
                      <IconX className='h-4 w-4' />
                    </Button>
                  </>
                ) : (
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className="size-8 [&_svg:not([class*='size-'])]:!size-5"
                    onClick={() => {
                      if (props.isReadOnly) return;
                      setEditedLabel(String(selectedNodeData?.label ?? ''));
                      setEditedMetadata((selectedNodeData?.metadata ?? {}) as Record<string, unknown>);
                      setNewMetaKey('');
                      setNewMetaValue('');
                      setIsEditMode(true);
                    }}
                    disabled={props.isReadOnly}
                    title='Edit'
                  >
                    <IconEdit className='h-4 w-4' />
                  </Button>
                )
              ) : null}

              <Button
                type='button'
                variant='ghost'
                size='icon'
                className="size-8 [&_svg:not([class*='size-'])]:!size-5"
                onClick={props.closeDetailsPanel}
                title='Hide details'
              >
                <IconSidebar className='h-4 w-4 rotate-180' />
              </Button>
            </div>
          </div>

          <div className='min-h-0 flex-1 overflow-hidden px-3 py-3'>
            <div className='flex h-full flex-col'>
              {/* Details: slightly larger */}
              <div
                className={cn(
                  'min-h-0 overflow-hidden',
                  isMiniMapVisible ? 'flex-[1.25]' : 'flex-[1.4]'
                )}
              >
                <ScrollArea className='h-full'>
                  <div className='space-y-4 pr-3'>
                    {selectionKind === 'none' ? (
                      <div className='flex items-center justify-center h-32 text-muted-foreground text-sm text-center'>
                        Select a node or an edge to see details.
                      </div>
                    ) : selectionKind === 'node' ? (
                      <>
                        <div>
                          <p className='text-muted-foreground mb-1.5 text-xs font-medium tracking-wide uppercase'>
                            {selectedNodeData?.type === 'media_url' ? 'URL' : 'Value'}
                          </p>
                          <div className='bg-muted/50 rounded-lg border p-3'>
                            {isEditMode ? (
                              selectedNodeData?.type === 'note' || selectedNodeData?.type === 'ai_insight' ? (
                                <textarea
                                  value={editedLabel}
                                  readOnly={props.isReadOnly}
                                  onChange={(e) => {
                                    if (!props.isReadOnly) setEditedLabel(e.target.value);
                                  }}
                                  className='bg-background/60 min-h-[120px] w-full resize-none rounded-md border border-border/40 p-2 text-sm outline-none'
                                  placeholder='Enter value...'
                                />
                              ) : (
                                <Input
                                  value={editedLabel}
                                  readOnly={props.isReadOnly}
                                  onChange={(e) => {
                                    if (!props.isReadOnly) setEditedLabel(e.target.value);
                                  }}
                                  className='h-9'
                                  placeholder='Enter value...'
                                />
                              )
                            ) : selectedNodeData?.label ? (
                              <LinkableText
                                text={getNodeDisplayLabel({
                                  type: selectedNodeData.type,
                                  label: selectedNodeData.label,
                                  metadata: selectedNodeData.metadata
                                })}
                                className='text-sm font-medium break-all whitespace-pre-wrap'
                              />
                            ) : (
                              <span className='text-muted-foreground text-sm italic'>Empty</span>
                            )}
                          </div>
                        </div>

                        {!isEditMode && Array.isArray((selectedNodeData as any)?.metadata?.merged) ? (
                          <div>
                            <Accordion type='single' collapsible>
                              <AccordionItem value='merged' className='border-b-0'>
                                <AccordionTrigger className='py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:no-underline'>
                                  <span className='flex items-center gap-2'>
                                    <span>Merged</span>
                                    <Badge variant='outline' className='h-5 text-[10px]'>
                                      {(selectedNodeData as any).metadata.merged.length}
                                    </Badge>
                                  </span>
                                </AccordionTrigger>
                                <AccordionContent className='pb-0'>
                                  <div className='paranod-scrollbar max-h-[260px] overflow-auto pr-1'>
                                    <div className='grid gap-2'>
                                      {(selectedNodeData as any).metadata.merged.map(
                                        (item: any, idx: number) => {
                                          const label = item?.label ?? null;
                                          const value = item?.value ?? null;
                                          const primary = String(label ?? value ?? '').trim();
                                          const secondary =
                                            label && value && String(label) !== String(value)
                                              ? String(value)
                                              : null;

                                          return (
                                            <div
                                              key={`m-${idx}`}
                                              className='bg-background flex min-w-0 items-start justify-between gap-3 rounded-md border border-border/40 px-2 py-1.5'
                                            >
                                              <div className='min-w-0 flex-1'>
                                                <div className='min-w-0 text-sm font-medium'>
                                                  <LinkableText
                                                    text={primary || '—'}
                                                    truncate
                                                    maxLength={90}
                                                  />
                                                </div>
                                                {secondary ? (
                                                  <div className='text-muted-foreground min-w-0 text-[11px]'>
                                                    <LinkableText
                                                      text={secondary}
                                                      className='break-all'
                                                      truncate
                                                      maxLength={120}
                                                    />
                                                  </div>
                                                ) : null}
                                              </div>
                                            </div>
                                          );
                                        }
                                      )}
                                    </div>
                                  </div>
                                </AccordionContent>
                              </AccordionItem>
                            </Accordion>
                          </div>
                        ) : null}

                        <div>
                          <p className='text-muted-foreground mb-1.5 text-xs font-medium tracking-wide uppercase'>
                            Metadata
                          </p>
                          <div className='space-y-2'>
                            {(() => {
                              const raw = (isEditMode ? editedMetadata : selectedNodeData?.metadata || {}) as Record<
                                string,
                                unknown
                              >;
                              const entries = Object.entries(raw).filter(
                                ([k]) =>
                                  !isReservedMergeMetadataKey(k) &&
                                  !isHiddenDisplayMetadataKey(k)
                              );
                              if (isEditMode) {
                                return (
                                  <>
                                    {entries.map(([key, value]) => (
                                      <div
                                        key={key}
                                        className='bg-background flex items-center gap-2 rounded-lg border p-2'
                                      >
                                        <span className='text-muted-foreground w-24 shrink-0 truncate text-xs capitalize'>
                                          {formatMetadataKey(key)}
                                        </span>
                                        <Input
                                          value={String(value ?? '')}
                                          readOnly={props.isReadOnly}
                                          onChange={(e) => handleUpdateMetadata(key, e.target.value)}
                                          className='h-8 flex-1 text-sm'
                                          placeholder='Value...'
                                        />
                                        <Button
                                          variant='ghost'
                                          size='icon'
                                          className='h-8 w-8 shrink-0 text-red-500 hover:text-red-600'
                                          onClick={() => handleRemoveMetadata(key)}
                                          disabled={props.isReadOnly}
                                          title='Remove'
                                        >
                                          <IconX className='h-4 w-4' />
                                        </Button>
                                      </div>
                                    ))}

                                    {entries.length === 0 ? (
                                      <div className='text-muted-foreground text-xs'>
                                        No metadata yet. Add one below.
                                      </div>
                                    ) : null}

                                    <div className='flex items-center gap-2 pt-2'>
                                      <Input
                                        value={newMetaKey}
                                        readOnly={props.isReadOnly}
                                        onChange={(e) => {
                                          if (!props.isReadOnly) setNewMetaKey(e.target.value);
                                        }}
                                        className='h-8 w-28 text-xs'
                                        placeholder='Key...'
                                      />
                                      <Input
                                        value={newMetaValue}
                                        readOnly={props.isReadOnly}
                                        onChange={(e) => {
                                          if (!props.isReadOnly) setNewMetaValue(e.target.value);
                                        }}
                                        className='h-8 flex-1 text-xs'
                                        placeholder='Value...'
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') handleAddMetadata();
                                        }}
                                      />
                                      <Button
                                        variant='outline'
                                        size='sm'
                                        className='h-8 gap-1'
                                        onClick={handleAddMetadata}
                                        disabled={props.isReadOnly || !newMetaKey.trim() || isReservedMergeMetadataKey(newMetaKey.trim())}
                                        title={
                                          isReservedMergeMetadataKey(newMetaKey.trim())
                                            ? 'This key is managed internally.'
                                            : 'Add'
                                        }
                                      >
                                        <IconPlus className='h-3.5 w-3.5' />
                                        Add
                                      </Button>
                                    </div>
                                  </>
                                );
                              }

                              if (entries.length === 0)
                                return (
                                  <div className='text-muted-foreground text-sm'>
                                    No metadata available.
                                  </div>
                                );

                              return entries.map(([key, value]) => (
                                <div
                                  key={key}
                                  className='bg-background flex items-start justify-between gap-4 rounded-lg border p-2.5'
                                >
                                  <span className='text-muted-foreground shrink-0 text-xs capitalize'>
                                    {formatMetadataKey(key)}
                                  </span>
                                  <div className='text-right'>{renderMetadataValue(value)}</div>
                                </div>
                              ));
                            })()}
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className='space-y-2'>
                          <div className='text-sm font-semibold'>Edge</div>
                          <div className='flex flex-wrap items-center gap-2'>
                            <Badge variant='secondary'>{getEdgeLabel(selectedEdgeData)}</Badge>
                            <Badge variant='outline'>ID: {selectedEdge?.id}</Badge>
                          </div>
                        </div>

                        <Separator />

                        <div className='space-y-2'>
                          <div className='text-sm font-semibold'>Connection</div>
                          <div className='space-y-2'>
                            <div className='bg-muted/20 rounded-lg border border-border/30 px-3 py-2'>
                              <div className='text-xs font-semibold uppercase tracking-wide'>Source</div>
                              <div className='text-sm'>{getNodeLabel(sourceNode)}</div>
                              <div className='text-muted-foreground text-xs'>
                                {getNodeTypeLabel((sourceNode?.data as OSINTNodeData | undefined)?.type)}
                              </div>
                            </div>
                            <div className='bg-muted/20 rounded-lg border border-border/30 px-3 py-2'>
                              <div className='text-xs font-semibold uppercase tracking-wide'>Target</div>
                              <div className='text-sm'>{getNodeLabel(targetNode)}</div>
                              <div className='text-muted-foreground text-xs'>
                                {getNodeTypeLabel((targetNode?.data as OSINTNodeData | undefined)?.type)}
                              </div>
                            </div>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </ScrollArea>
              </div>

              {isMiniMapVisible ? (
                <>
                  <div className='my-3 h-px w-full -mx-3 bg-border/40' />

                  {/* Mini map: slightly smaller */}
                  <div className='min-h-0 flex-[0.85] overflow-hidden'>
                    {selectionKind === 'none' ? (
                      <div className='text-muted-foreground flex h-full items-center justify-center text-sm'>
                        No selection.
                      </div>
                    ) : (
                      <MiniGraph
                        data={miniGraphData}
                        isDark={props.isDark}
                        selectedNodeId={selectedNode?.id}
                        selectedEdgeId={selectedEdge?.id}
                        canDragNodes={true}
                      />
                    )}
                  </div>

                  <div className='my-3 h-px w-full -mx-3 bg-border/40' />
                </>
              ) : (
                <div className='my-3 h-px w-full -mx-3 bg-border/40' />
              )}

              {/* Relations */}
              <div className={cn('min-h-0 overflow-hidden', isMiniMapVisible ? 'flex-1' : 'flex-[1.1]')}>
                <div className='paranod-scrollbar h-full overflow-auto'>
                  {relationRows.length === 0 ? (
                    <div className='text-muted-foreground px-3 py-3 text-sm'>
                      No relations available.
                    </div>
                  ) : (
                    <div className='space-y-2 px-2 py-2'>
                      {relationRows.map((row) => (
                        <div
                          key={row.edgeId}
                          className='grid grid-cols-3 items-center gap-2'
                        >
                          {(() => {
                            const sourceBg =
                              row.sourceType && Object.prototype.hasOwnProperty.call(nodeTypeByType, row.sourceType)
                                ? nodeTypeByType[row.sourceType as NodeType]?.ui?.headerBg
                                : null;
                            const targetBg =
                              row.targetType && Object.prototype.hasOwnProperty.call(nodeTypeByType, row.targetType)
                                ? nodeTypeByType[row.targetType as NodeType]?.ui?.headerBg
                                : null;

                            return (
                              <>
                                <button
                                  type='button'
                                  className='group relative min-w-0 cursor-pointer select-none overflow-hidden rounded-md border border-border/70 bg-muted/5 px-2 py-2 text-left'
                                  onClick={() => props.onSelectNodeId(String(row.sourceNodeId))}
                                  title={row.source}
                                >
                                  <div
                                    className={cn('pointer-events-none absolute inset-0 opacity-20', sourceBg)}
                                  />
                                  <div className='relative min-w-0 truncate select-none text-xs font-medium group-hover:underline underline-offset-4'>
                                    {row.source || '—'}
                                  </div>
                                </button>

                                <button
                                  type='button'
                                  className='group min-w-0 cursor-pointer select-none truncate rounded-md border border-border/70 bg-muted/10 px-2 py-2 text-center text-[11px] font-semibold tracking-wide text-muted-foreground hover:text-foreground'
                                  onClick={() => props.onSelectEdgeId(String(row.edgeId))}
                                  title={row.relation}
                                >
                                  <span className='select-none group-hover:underline underline-offset-4'>
                                    {row.relation || '—'}
                                  </span>
                                </button>

                                <button
                                  type='button'
                                  className='group relative min-w-0 cursor-pointer select-none overflow-hidden rounded-md border border-border/70 bg-muted/5 px-2 py-2 text-right'
                                  onClick={() => props.onSelectNodeId(String(row.targetNodeId))}
                                  title={row.target}
                                >
                                  <div
                                    className={cn('pointer-events-none absolute inset-0 opacity-20', targetBg)}
                                  />
                                  <div className='relative min-w-0 truncate select-none text-xs font-medium group-hover:underline underline-offset-4'>
                                    {row.target || '—'}
                                  </div>
                                </button>
                              </>
                            );
                          })()}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <GraphSidepanelBottomBar className='border-l-0' />
        </aside>
      </ResizablePanel>
    </>
  );
}

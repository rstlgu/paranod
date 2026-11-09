'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import type { Edge, Node } from 'reactflow';
import { cn } from '@/lib/utils';
import { transformRelationalToAnalysisGraphData } from './analysis-transform';
import type { AnalysisGraphData, AnalysisGraphLink, AnalysisGraphNode } from './analysis-transform';
import { renderAnalysisNode } from './render-node';
import { renderAnalysisLink } from './render-link';
import { loadTablerIcon } from './icon-cache';
import { loadLogoWithRetry, peekCachedLogo } from './logo-cache';
import { nodeTypeByType } from '@/features/osint/node-registry';
import { useTransformLogger } from '@/features/graph/contexts/transform-logger-context';
import { useAnalysisMutationGuard } from '../state/use-analysis-mutation-guard';

// `react-force-graph-2d` non è SSR-safe (usa `window` a top-level).
// Lo carichiamo quindi solo lato client.
const ForceGraph2D = dynamic(() => import('react-force-graph-2d').then((m) => m.default), {
  ssr: false
});

export interface AnalysisGraphApi {
  fitView: () => void;
  fitViewToNodeIds: (nodeIds: string[]) => void;
  panToNode: (nodeId: string) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  centerAt: (x: number, y: number) => void;
  screenToGraph: (args: { x: number; y: number }) => { x: number; y: number };
  graphToScreen: (args: { x: number; y: number }) => { x: number; y: number };
}

export interface AnalysisCanvasProps {
  isLoadingGraph?: boolean;
  readOnly?: boolean;
  canEditSnapshot?: () => boolean;
  className?: string;
  style?: React.CSSProperties;
  isDark: boolean;
  nodes: Node[];
  edges: Edge[];
  layoutOverlay?: { isRunning: boolean; pct?: number; label?: string } | null;

  onGraphApi?: (api: AnalysisGraphApi | null) => void;

  onNodeClick?: (event: MouseEvent, node: Node) => void;
  onEdgeClick?: (event: MouseEvent, edge: Edge) => void;
  onPaneClick?: (event: MouseEvent) => void;
  onNodeDragEnd?: (node: Node, next: { x: number; y: number }) => void;
  onNodesDragEnd?: (updates: Array<{ node: Node; next: { x: number; y: number } }>) => void;
  onSelectNodeIds?: (nodeIds: string[]) => void;
  onBoxSelectStateChange?: (isSelecting: boolean) => void;

  onNodeContextMenu?: (event: MouseEvent, node: Node) => void;
  onEdgeContextMenu?: (event: MouseEvent, edge: Edge) => void;
  onPaneContextMenu?: (event: MouseEvent) => void;
}

function clampNumber(min: number, value: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

const ANALYSIS_CLICK_SLOP_PX = 6;

function analysisPoint(
  value: unknown,
  nodes: Map<string, AnalysisGraphNode>
) {
  if (value && typeof value === 'object' && 'x' in value && 'y' in value) {
    const point = value as { x?: unknown; y?: unknown; id?: unknown };
    if (Number.isFinite(point.x) && Number.isFinite(point.y))
      return { x: Number(point.x), y: Number(point.y) };
    const node = nodes.get(String(point.id ?? ''));
    if (node) return { x: node.x, y: node.y };
  }
  const node = nodes.get(String(value ?? ''));
  return node ? { x: node.x, y: node.y } : null;
}

function distanceToSegment(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number }
) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = dx * dx + dy * dy;
  if (length === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = clampNumber(
    0,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / length,
    1
  );
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function analysisClickTarget(
  point: { x: number; y: number },
  nodes: AnalysisGraphNode[],
  links: AnalysisGraphLink[],
  zoom: number
) {
  let nodeHit: AnalysisGraphNode | null = null;
  let nodeDistance = Infinity;
  for (const node of nodes) {
    const radius = Math.max(18, Number(node.nodeSize) || 20) / 2 + 6;
    const distance = Math.hypot(node.x - point.x, node.y - point.y);
    if (distance <= radius && distance < nodeDistance) {
      nodeHit = node;
      nodeDistance = distance;
    }
  }
  if (nodeHit) return { kind: 'node' as const, node: nodeHit };

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const tolerance = 8 / Math.max(zoom, 0.05);
  let linkHit: AnalysisGraphLink | null = null;
  let linkDistance = Infinity;
  for (const link of links) {
    const start = analysisPoint(link.source, byId);
    const end = analysisPoint(link.target, byId);
    if (!start || !end) continue;
    const distance = distanceToSegment(point, start, end);
    if (distance <= tolerance && distance < linkDistance) {
      linkHit = link;
      linkDistance = distance;
    }
  }
  return linkHit ? { kind: 'link' as const, link: linkHit } : null;
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

  for (const n of args.nodes) {
    const x = Number(n.x);
    const y = Number(n.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const size = Math.max(18, Number(n.nodeSize) || 20);
    const r = size / 2;
    minX = Math.min(minX, x - r);
    maxX = Math.max(maxX, x + r);
    minY = Math.min(minY, y - r);
    maxY = Math.max(maxY, y + r);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY))
    return null;

  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  // Cap del padding:
  // - non può superare metà canvas (ovvio)
  // - deve lasciare comunque una "inner area" minima, altrimenti su canvas stretti
  //   (es. sidebar aperta) il fit su 1 nodo collassa verso minZoom ⇒ mega zoom-out.
  const halfCap = Math.floor(Math.min(widthPx, heightPx) / 2) - 1;
  const minInnerPx = 120;
  const maxPadX = Math.floor((widthPx - minInnerPx) / 2);
  const maxPadY = Math.floor((heightPx - minInnerPx) / 2);
  const innerCap = Math.max(0, Math.min(maxPadX, maxPadY));
  const padCap = Math.max(0, Math.min(halfCap, innerCap));
  const pad = Math.max(0, Math.min(Math.floor(args.paddingPx), padCap));

  const zoomX = (widthPx - pad * 2) / spanX;
  const zoomY = (heightPx - pad * 2) / spanY;
  let zoom = Math.min(zoomX, zoomY);

  const minZoom = typeof args.minZoom === 'number' ? args.minZoom : 0.05;
  const maxZoom = typeof args.maxZoom === 'number' ? args.maxZoom : 12;
  zoom = clampNumber(minZoom, zoom, maxZoom);

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  return { centerX, centerY, zoom };
}

function estimateLabelExtraPaddingPx(nodes: ReadonlyArray<{ nodeLabel?: unknown }>) {
  // Le label vengono troncate con ellipsis (max width), quindi qui stimiamo un extra padding
  // stabile e non proporzionale alla lunghezza massima del testo.
  const hasAnyLabel = nodes.some((n) => String(n.nodeLabel ?? '').trim().length > 0);
  if (!hasAnyLabel) return 0;
  const maxLabelWidthPx = 260; // keep in sync with `render-node.ts` (MAX_NODE_LABEL_WIDTH_PX)
  const halfW = maxLabelWidthPx / 2;
  const verticalNeed = 44;
  const extra = Math.max(halfW, verticalNeed);
  return clampNumber(0, Math.round(extra), 220);
}

function getFitViewPaddingForNodeCount(nodeCount: number) {
  // Padding dinamico (px) per avere un fit "normale" e NON super-zoommato su pochi nodi.
  // Più pochi nodi => più padding => meno zoom aggressivo.
  if (nodeCount <= 0) return 110;
  if (nodeCount <= 1) return 420;
  if (nodeCount <= 2) return 300;
  if (nodeCount <= 4) return 160;
  if (nodeCount <= 8) return 120;
  if (nodeCount <= 16) return 95;
  if (nodeCount <= 28) return 80;
  return 65;
}

export function AnalysisCanvas(props: AnalysisCanvasProps) {
  const canEdit = useAnalysisMutationGuard(props);
  const graphRef = React.useRef<any>(null);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = React.useState({ width: 0, height: 0 });
  const refreshRafRef = React.useRef<number | null>(null);
  const dragRefreshRafRef = React.useRef<number | null>(null);
  const preloadedLogoUrlsRef = React.useRef<Set<string>>(new Set());
  const preloadedIconKeysRef = React.useRef<Set<string>>(new Set());
  const labelCollisionRef = React.useRef<{
    frameKey: string | null;
    rects: Array<{ x: number; y: number; w: number; h: number }>;
  }>({ frameKey: null, rects: [] });
  const { logs } = useTransformLogger();
  const runningNodeIds = React.useMemo(
    () =>
      new Set(
        logs
          .filter((log) => log.status === 'running' && log.sourceNodeId)
          .map((log) => String(log.sourceNodeId))
      ),
    [logs]
  );
  const runningNodeIdsKey = React.useMemo(
    () => Array.from(runningNodeIds).sort().join(','),
    [runningNodeIds]
  );

  const isBoxSelectingRef = React.useRef(false);
  const selectionStartRef = React.useRef<{ x: number; y: number } | null>(null);
  const selectionEndRef = React.useRef<{ x: number; y: number } | null>(null);
  const [isBoxSelecting, setIsBoxSelecting] = React.useState(false);
  const lastBoxSelectedKeyRef = React.useRef<string>('');
  const selectionRafRef = React.useRef<number | null>(null);
  const [selectionRect, setSelectionRect] = React.useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  const selectedNodeIdSet = React.useMemo(() => {
    const ids = new Set<string>();
    for (const n of props.nodes) {
      if ((n as any)?.selected) ids.add(String((n as any).id ?? ''));
    }
    return ids;
  }, [props.nodes]);

  const dragGroupRef = React.useRef<{
    anchorId: string;
    anchorStart: { x: number; y: number };
    startById: Map<string, { x: number; y: number; rfNode: Node }>;
  } | null>(null);
  const dragCanEditRef = React.useRef<(() => boolean) | null>(null);
  const dragCancelledRef = React.useRef(false);
  const pointerGestureRef = React.useRef<{ x: number; y: number } | null>(null);
  const nativeClickRef = React.useRef(false);

  function scheduleDragRefresh() {
    if (dragRefreshRafRef.current) cancelAnimationFrame(dragRefreshRafRef.current);
    dragRefreshRafRef.current = requestAnimationFrame(() => {
      graphRef.current?.refresh?.();
      dragRefreshRafRef.current = null;
    });
  }

  React.useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    function update() {
      const rect = el.getBoundingClientRect();
      setContainerSize({ width: Math.floor(rect.width), height: Math.floor(rect.height) });
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

  // Forza redraw quando un asset (logo/icona) finisce di caricare.
  // Con `autoPauseRedraw`, senza refresh esplicito i dot restano “vuoti”.
  React.useEffect(() => {
    function scheduleRefresh() {
      if (refreshRafRef.current) cancelAnimationFrame(refreshRafRef.current);
      refreshRafRef.current = requestAnimationFrame(() => {
        graphRef.current?.refresh?.();
        refreshRafRef.current = null;
      });
    }

    window.addEventListener('analysis-canvas-asset-loaded', scheduleRefresh);
    return () => {
      window.removeEventListener('analysis-canvas-asset-loaded', scheduleRefresh);
      if (refreshRafRef.current) cancelAnimationFrame(refreshRafRef.current);
    };
  }, []);

  React.useEffect(() => {
    const animationFrame = requestAnimationFrame(() => {
      graphRef.current?.refresh?.();
    });
    return () => cancelAnimationFrame(animationFrame);
  }, [runningNodeIdsKey]);

  const graphData: AnalysisGraphData = React.useMemo(() => {
    return transformRelationalToAnalysisGraphData({ nodes: props.nodes, edges: props.edges });
  }, [props.nodes, props.edges]);

  const cancelNodeDrag = React.useCallback(() => {
    dragCancelledRef.current = true;
    dragCanEditRef.current = null;
    dragGroupRef.current = null;
    if (dragRefreshRafRef.current) cancelAnimationFrame(dragRefreshRafRef.current);
    dragRefreshRafRef.current = null;
    // ForceGraph mutates its node objects during a gesture. Restore the view
    // without emitting the persistence callbacks for an interrupted drag.
    for (const node of graphData.nodes) {
      node.x = node.fx = node.rfNode.position.x + node.nodeSize / 2;
      node.y = node.fy = node.rfNode.position.y + node.nodeSize / 2;
    }
    graphRef.current?.refresh?.();
  }, [graphData.nodes]);

  React.useEffect(() => {
    if (!canEdit()) cancelNodeDrag();
  }, [canEdit, cancelNodeDrag]);

  React.useEffect(() => {
    return () => {
      if (dragRefreshRafRef.current) cancelAnimationFrame(dragRefreshRafRef.current);
    };
  }, []);

  // Initial zoomToFit only once per canvas mount. Structural updates must preserve the viewport.
  const hasPerformedInitialZoomRef = React.useRef(false);
  React.useEffect(() => {
    // An empty, loaded graph must not zoom when its first node is added.
    if (!props.isLoadingGraph && !graphData.nodes.length) {
      hasPerformedInitialZoomRef.current = true;
    }
  }, [props.isLoadingGraph, graphData.nodes.length]);

  const updateSelectionRect = React.useCallback(() => {
    if (!containerRef.current) return;
    const start = selectionStartRef.current;
    const end = selectionEndRef.current;
    if (!start || !end) {
      setSelectionRect(null);
      return;
    }
    const rect = containerRef.current.getBoundingClientRect();
    const x1 = start.x - rect.left;
    const y1 = start.y - rect.top;
    const x2 = end.x - rect.left;
    const y2 = end.y - rect.top;
    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);
    setSelectionRect({
      left: Math.max(0, left),
      top: Math.max(0, top),
      width,
      height
    });
  }, []);

  const endBoxSelection = React.useCallback(() => {
    if (!isBoxSelectingRef.current) return;
    isBoxSelectingRef.current = false;
    const start = selectionStartRef.current;
    const end = selectionEndRef.current;
    selectionStartRef.current = null;
    selectionEndRef.current = null;
    setSelectionRect(null);
    if (!start || !end) return;
    if (!graphRef.current) return;
    if (typeof graphRef.current.screen2GraphCoords !== 'function') return;
    if (!containerRef.current) return;

    // IMPORTANT: ForceGraph screen2GraphCoords expects coordinates relative to the canvas,
    // not viewport client coords. When panels open/close, the canvas shifts.
    const rect = containerRef.current.getBoundingClientRect();
    const a = graphRef.current.screen2GraphCoords(start.x - rect.left, start.y - rect.top);
    const b = graphRef.current.screen2GraphCoords(end.x - rect.left, end.y - rect.top);
    const minX = Math.min(Number(a.x ?? 0), Number(b.x ?? 0));
    const maxX = Math.max(Number(a.x ?? 0), Number(b.x ?? 0));
    const minY = Math.min(Number(a.y ?? 0), Number(b.y ?? 0));
    const maxY = Math.max(Number(a.y ?? 0), Number(b.y ?? 0));

    const ids = graphData.nodes
      .filter(
        (n) =>
          Number(n.x) >= minX &&
          Number(n.x) <= maxX &&
          Number(n.y) >= minY &&
          Number(n.y) <= maxY
      )
      .map((n) => n.id);
    props.onSelectNodeIds?.(ids);
  }, [graphData.nodes, props.onSelectNodeIds]);

  const computeAndEmitBoxSelection = React.useCallback(() => {
    const start = selectionStartRef.current;
    const end = selectionEndRef.current;
    if (!start || !end) return;
    if (!graphRef.current) return;
    if (typeof graphRef.current.screen2GraphCoords !== 'function') return;
    if (!containerRef.current) return;

    // Use current container rect to account for layout shifts (sidepanels open/close)
    const rect = containerRef.current.getBoundingClientRect();
    const a = graphRef.current.screen2GraphCoords(start.x - rect.left, start.y - rect.top);
    const b = graphRef.current.screen2GraphCoords(end.x - rect.left, end.y - rect.top);
    const minX = Math.min(Number(a.x ?? 0), Number(b.x ?? 0));
    const maxX = Math.max(Number(a.x ?? 0), Number(b.x ?? 0));
    const minY = Math.min(Number(a.y ?? 0), Number(b.y ?? 0));
    const maxY = Math.max(Number(a.y ?? 0), Number(b.y ?? 0));

    const ids = graphData.nodes
      .filter(
        (n) =>
          Number(n.x) >= minX &&
          Number(n.x) <= maxX &&
          Number(n.y) >= minY &&
          Number(n.y) <= maxY
      )
      .map((n) => n.id);

    // Evita spam: invia solo se la selezione è cambiata
    const key = ids.slice().sort().join(',');
    if (key === lastBoxSelectedKeyRef.current) return;
    lastBoxSelectedKeyRef.current = key;
    props.onSelectNodeIds?.(ids);
  }, [graphData.nodes, props.onSelectNodeIds]);

  // Preload icone/loghi e forza redraw quando pronti (autoPauseRedraw altrimenti non ridisegna)
  React.useEffect(() => {
    let cancelled = false;
    const ref = graphRef;

    async function preload() {
      const tasks: Array<Promise<unknown>> = [];

      for (const n of graphData.nodes) {
        // Logo (se presente)
        if (n.nodeLogoUrl) {
          const cachedLogo = peekCachedLogo(n.nodeLogoUrl);
          if (cachedLogo?.complete) {
            preloadedLogoUrlsRef.current.add(n.nodeLogoUrl);
            continue;
          }
          if (preloadedLogoUrlsRef.current.has(n.nodeLogoUrl)) continue;
          preloadedLogoUrlsRef.current.add(n.nodeLogoUrl);
          tasks.push(
            loadLogoWithRetry(n.nodeLogoUrl, { maxAttempts: 3, retryDelayMs: 1000 })
              .then(() => {
                if (cancelled) return;
                ref.current?.refresh?.();
              })
              .catch(() => {
                if (!cancelled) preloadedLogoUrlsRef.current.delete(n.nodeLogoUrl ?? '');
              })
          );
        }

        // Icona fallback: carichiamo la stessa size/colore usata dal renderer
        const def: any = (nodeTypeByType as any)[n.nodeType];
        const Icon = def?.icon as any;
        if (Icon) {
          const size = Math.max(18, Number(n.nodeSize) || 20);
          const radius = size / 2;
          const iconSize = Math.max(14, Math.min(26, Math.round(radius * 1.2)));
          const iconColor = String((n as any).nodeIconColor ?? '#ffffff');
          const iconKey = `${iconColor}__${iconSize}__${(Icon as any)?.displayName ?? (Icon as any)?.name ?? 'icon'}`;
          if (preloadedIconKeysRef.current.has(iconKey)) continue;
          preloadedIconKeysRef.current.add(iconKey);
          tasks.push(
            loadTablerIcon({ icon: Icon, sizePx: iconSize, color: iconColor })
              .then(() => {
                if (cancelled) return;
                ref.current?.refresh?.();
              })
              .catch(() => {})
          );
        }
      }

      // Attendi in background (non blocchiamo UI)
      void Promise.allSettled(tasks);
    }

    void preload();
    return () => {
      cancelled = true;
    };
  }, [graphData.nodes]);

  const nodeById = React.useMemo(() => {
    return new Map(graphData.nodes.map((n) => [n.id, n]));
  }, [graphData.nodes]);

  const selectedNodeIds = React.useMemo(() => {
    return new Set(props.nodes.filter((n: any) => n?.selected).map((n) => n.id));
  }, [props.nodes]);

  const selectedEdgeIds = React.useMemo(() => {
    return new Set(props.edges.filter((e: any) => e?.selected).map((e) => e.id));
  }, [props.edges]);

  const [hoverNodeId, setHoverNodeId] = React.useState<string | null>(null);
  const [hoverEdgeId, setHoverEdgeId] = React.useState<string | null>(null);
  // Delay only for the "de-emphasis" (grey-out) to avoid flicker on quick hovers.
  const [delayedHoverNodeId, setDelayedHoverNodeId] = React.useState<string | null>(null);
  const [delayedHoverEdgeId, setDelayedHoverEdgeId] = React.useState<string | null>(null);
  const delayedHoverNodeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const delayedHoverEdgeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
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
        if (delayedHoverNodeTimerRef.current) clearTimeout(delayedHoverNodeTimerRef.current);
        delayedHoverNodeTimerRef.current = null;
        setDelayedHoverNodeId(null);
        clearHighlights();
        return;
      }

      setHoverNodeId(node.id);
      if (delayedHoverNodeTimerRef.current) clearTimeout(delayedHoverNodeTimerRef.current);
      delayedHoverNodeTimerRef.current = setTimeout(() => {
        delayedHoverNodeTimerRef.current = null;
        setDelayedHoverNodeId(node.id);
        // node-hover focus should win over edge-hover focus
        setDelayedHoverEdgeId(null);
      }, 300);
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
        if (delayedHoverEdgeTimerRef.current) clearTimeout(delayedHoverEdgeTimerRef.current);
        delayedHoverEdgeTimerRef.current = null;
        setDelayedHoverEdgeId(null);
        // Se stiamo hoverando un nodo, l'highlight lo gestisce handleNodeHover.
        // Altrimenti, reset completo (hover non deve lasciare stato “sticky”).
        if (hoverNodeId) return;
        clearHighlights();
        return;
      }

      setHoverEdgeId(link.id);
      if (delayedHoverEdgeTimerRef.current) clearTimeout(delayedHoverEdgeTimerRef.current);
      delayedHoverEdgeTimerRef.current = setTimeout(() => {
        delayedHoverEdgeTimerRef.current = null;
        setDelayedHoverEdgeId(link.id);
        setDelayedHoverNodeId(null);
      }, 300);
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
  const isNodeSelected = React.useCallback((id: string) => selectedNodeIds.has(id), [selectedNodeIds]);
  const isEdgeSelected = React.useCallback((id: string) => selectedEdgeIds.has(id), [selectedEdgeIds]);
  const isNodeHover = React.useCallback((id: string) => hoverNodeId === id, [hoverNodeId]);
  const isEdgeHover = React.useCallback((id: string) => hoverEdgeId === id, [hoverEdgeId]);

  const isEdgeEndpointHovered = React.useCallback(
    (edgeId: string) => {
      const e = props.edges.find((x) => x.id === edgeId);
      if (!e) return false;
      return hoverNodeId === e.source || hoverNodeId === e.target;
    },
    [props.edges, hoverNodeId]
  );

  const isEdgeEndpointSelected = React.useCallback(
    (edgeId: string) => {
      const e = props.edges.find((x) => x.id === edgeId);
      if (!e) return false;
      return selectedNodeIds.has(String(e.source)) || selectedNodeIds.has(String(e.target));
    },
    [props.edges, selectedNodeIds]
  );

  const hasFocusMode = React.useMemo(() => {
    return (
      Boolean(delayedHoverNodeId) ||
      Boolean(delayedHoverEdgeId) ||
      selectedNodeIds.size > 0 ||
      selectedEdgeIds.size > 0
    );
  }, [delayedHoverNodeId, delayedHoverEdgeId, selectedNodeIds, selectedEdgeIds]);

  const focusEndpointNodeIds = React.useMemo(() => {
    if (!hasFocusMode) return new Set<string>();
    const focusEdgeIds = new Set<string>(Array.from(selectedEdgeIds));
    if (delayedHoverEdgeId) focusEdgeIds.add(String(delayedHoverEdgeId));
    if (!focusEdgeIds.size) return new Set<string>();
    const ids = new Set<string>();
    for (const e of props.edges) {
      if (!focusEdgeIds.has(String(e.id))) continue;
      ids.add(String(e.source));
      ids.add(String(e.target));
    }
    return ids;
  }, [hasFocusMode, selectedEdgeIds, delayedHoverEdgeId, props.edges]);

  const focusSelectedNeighborhoodNodeIds = React.useMemo(() => {
    if (!hasFocusMode) return new Set<string>();
    if (!selectedNodeIds.size) return new Set<string>();
    const ids = new Set<string>();
    for (const id of Array.from(selectedNodeIds)) {
      const n = nodeById.get(String(id));
      if (!n) continue;
      ids.add(String(n.id));
      for (const nb of n.neighbors ?? []) ids.add(String(nb.id));
    }
    return ids;
  }, [hasFocusMode, selectedNodeIds, nodeById]);

  const focusSelectedNeighborhoodEdgeIds = React.useMemo(() => {
    if (!hasFocusMode) return new Set<string>();
    if (!selectedNodeIds.size) return new Set<string>();
    const ids = new Set<string>();
    for (const id of Array.from(selectedNodeIds)) {
      const n = nodeById.get(String(id));
      if (!n) continue;
      for (const l of n.links ?? []) ids.add(String(l.id));
    }
    return ids;
  }, [hasFocusMode, selectedNodeIds, nodeById]);

  const isNodeDeemphasized = React.useCallback(
    (id: string) => {
      if (!hasFocusMode) return false;
      const nodeId = String(id);
      return !(
        focusSelectedNeighborhoodNodeIds.has(nodeId) ||
        focusEndpointNodeIds.has(nodeId) ||
        selectedNodeIds.has(nodeId) ||
        delayedHoverNodeId === nodeId ||
        highlightNodeIds.has(nodeId)
      );
    },
    [
      hasFocusMode,
      focusSelectedNeighborhoodNodeIds,
      focusEndpointNodeIds,
      selectedNodeIds,
      delayedHoverNodeId,
      highlightNodeIds
    ]
  );

  const isEdgeDeemphasized = React.useCallback(
    (id: string) => {
      if (!hasFocusMode) return false;
      const edgeId = String(id);
      return !(
        focusSelectedNeighborhoodEdgeIds.has(edgeId) ||
        selectedEdgeIds.has(edgeId) ||
        delayedHoverEdgeId === edgeId ||
        highlightEdgeIds.has(edgeId) ||
        isEdgeEndpointHovered(edgeId) ||
        isEdgeEndpointSelected(edgeId)
      );
    },
    [
      hasFocusMode,
      focusSelectedNeighborhoodEdgeIds,
      selectedEdgeIds,
      delayedHoverEdgeId,
      highlightEdgeIds,
      isEdgeEndpointHovered,
      isEdgeEndpointSelected
    ]
  );

  // Expose minimal graph controls to parent (topbar buttons)
  React.useEffect(() => {
    if (!props.onGraphApi) return;
    const api: AnalysisGraphApi = {
      fitView: () => {
        const ref = graphRef.current;
        if (!ref) return;
        const nodeCount = graphData.nodes.length;
        const paddingPx =
          getFitViewPaddingForNodeCount(nodeCount) + estimateLabelExtraPaddingPx(graphData.nodes);
        const vp = computeFitViewport({
          nodes: graphData.nodes,
          widthPx: containerSize.width,
          heightPx: containerSize.height,
          paddingPx,
          minZoom: 0.08,
          // Evita mega-zoom su 1-2 nodi ma lascia comunque la possibilità di zoom manuale dopo.
          maxZoom: nodeCount <= 1 ? 1.12 : nodeCount <= 2 ? 1.18 : 2.2
        });
        if (!vp) return;
        const durationMs = 420;
        if (typeof ref.centerAt === 'function') ref.centerAt(vp.centerX, vp.centerY, durationMs);
        if (typeof ref.zoom === 'function') ref.zoom(vp.zoom, durationMs);
      },
      fitViewToNodeIds: (nodeIds) => {
        const ref = graphRef.current;
        if (!ref) return;
        const ids = new Set((nodeIds ?? []).map((x) => String(x)));
        const subset = graphData.nodes.filter((n) => ids.has(String(n.id)));
        if (!subset.length) return;
        const nodeCount = subset.length;
        const paddingPx =
          getFitViewPaddingForNodeCount(nodeCount) + estimateLabelExtraPaddingPx(subset);
        const vp = computeFitViewport({
          nodes: subset,
          widthPx: containerSize.width,
          heightPx: containerSize.height,
          paddingPx,
          minZoom: 0.08,
          maxZoom: nodeCount <= 1 ? 1.12 : nodeCount <= 2 ? 1.18 : 2.2
        });
        if (!vp) return;
        const durationMs = 420;
        if (typeof ref.centerAt === 'function') ref.centerAt(vp.centerX, vp.centerY, durationMs);
        if (typeof ref.zoom === 'function') ref.zoom(vp.zoom, durationMs);
      },
      panToNode: (nodeId) => {
        const node = graphData.nodes.find((n) => String(n.id) === nodeId);
        if (!node || !Number.isFinite(node.x) || !Number.isFinite(node.y)) return;
        graphRef.current?.centerAt?.(node.x, node.y, 380);
      },
      zoomIn: () => {
        if (!graphRef.current) return;
        const z = typeof graphRef.current.zoom === 'function' ? graphRef.current.zoom() : 1;
        if (typeof graphRef.current.zoom === 'function') graphRef.current.zoom(z * 1.18, 160);
      },
      zoomOut: () => {
        if (!graphRef.current) return;
        const z = typeof graphRef.current.zoom === 'function' ? graphRef.current.zoom() : 1;
        if (typeof graphRef.current.zoom === 'function') graphRef.current.zoom(z / 1.18, 160);
      },
      centerAt: (x, y) => {
        if (typeof graphRef.current?.centerAt === 'function') graphRef.current.centerAt(x, y, 260);
      },
      screenToGraph: ({ x, y }) => {
        if (typeof graphRef.current?.screen2GraphCoords === 'function') return graphRef.current.screen2GraphCoords(x, y);
        return { x: 0, y: 0 };
      },
      graphToScreen: ({ x, y }) => {
        if (typeof graphRef.current?.graph2ScreenCoords === 'function') return graphRef.current.graph2ScreenCoords(x, y);
        return { x: 0, y: 0 };
      }
    };
    props.onGraphApi(api);
    return () => props.onGraphApi?.(null);
  }, [props.onGraphApi, containerSize.width, containerSize.height, graphData.nodes]);

  const handleEngineStop = React.useCallback(() => {
    if (hasPerformedInitialZoomRef.current) return;
    if (!graphData.nodes.length) return;
    const ref = graphRef.current;
    if (!ref) return;
    if (containerSize.width <= 0 || containerSize.height <= 0) return;
    const nodeCount = graphData.nodes.length;
    const paddingPx = getFitViewPaddingForNodeCount(nodeCount) + estimateLabelExtraPaddingPx(graphData.nodes);
    const vp = computeFitViewport({
      nodes: graphData.nodes,
      widthPx: containerSize.width,
      heightPx: containerSize.height,
      paddingPx,
      minZoom: 0.08,
      maxZoom: nodeCount <= 1 ? 1.12 : nodeCount <= 2 ? 1.18 : 2.2
    });
    if (!vp) return;
    hasPerformedInitialZoomRef.current = true;
    if (typeof ref.centerAt === 'function') ref.centerAt(vp.centerX, vp.centerY, 0);
    if (typeof ref.zoom === 'function') ref.zoom(vp.zoom, 0);
  }, [containerSize.width, containerSize.height, graphData.nodes.length]);

  // Fallback: se `onEngineStop` non scatta quando serve, facciamo comunque un fit one-shot appena
  // abbiamo size + nodi + ref disponibili (stesso comportamento di "initial zoom").
  React.useEffect(() => {
    if (hasPerformedInitialZoomRef.current) return;
    if (!graphRef.current) return;
    if (!graphData.nodes.length) return;
    if (containerSize.width <= 0 || containerSize.height <= 0) return;
    const raf = requestAnimationFrame(() => {
      handleEngineStop();
    });
    return () => cancelAnimationFrame(raf);
  }, [handleEngineStop, containerSize.width, containerSize.height, graphData.nodes.length]);

  const renderNode = React.useCallback(
    (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      function intersects(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
        return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
      }

      function tryPlaceLabelRect(rect: { x: number; y: number; w: number; h: number }) {
        // Collision detection semplice: evitiamo label sovrapposte. È O(k^2) sul numero di label visibili.
        const placed = labelCollisionRef.current.rects;
        for (const r of placed) {
          if (intersects(rect, r)) return false;
        }
        placed.push(rect);
        return true;
      }

      renderAnalysisNode({
        node: node as AnalysisGraphNode,
        ctx,
        globalScale,
        isDark: props.isDark,
        isHighlighted: isNodeHighlighted,
        isSelected: isNodeSelected,
        isHover: isNodeHover,
        isRunning: (nodeId) => runningNodeIds.has(nodeId),
        isDeemphasized: isNodeDeemphasized,
        tryPlaceLabelRect
      });
    },
    [
      props.isDark,
      isNodeHighlighted,
      isNodeSelected,
      isNodeHover,
      isNodeDeemphasized,
      graphData.nodes,
      runningNodeIds
    ]
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
        isEndpointHovered: isEdgeEndpointHovered,
        isEndpointSelected: isEdgeEndpointSelected,
        isDeemphasized: isEdgeDeemphasized
      });
    },
    [
      props.isDark,
      nodeById,
      isEdgeHighlighted,
      isEdgeSelected,
      isEdgeHover,
      isEdgeEndpointHovered,
      isEdgeEndpointSelected,
      isEdgeDeemphasized
    ]
  );

  const handleNodeClick = React.useCallback(
    (node: any, event: MouseEvent) => {
      nativeClickRef.current = true;
      const n = node as AnalysisGraphNode;
      props.onNodeClick?.(event, n.rfNode);
    },
    [props]
  );

  const handleLinkClick = React.useCallback(
    (link: any, event: MouseEvent) => {
      nativeClickRef.current = true;
      const l = link as AnalysisGraphLink;
      props.onEdgeClick?.(event, l.rfEdge);
    },
    [props]
  );

  const handleBackgroundClick = React.useCallback((event: MouseEvent) => {
    nativeClickRef.current = true;
    props.onPaneClick?.(event);
  }, [props]);

  const dispatchSwallowedClick = React.useCallback(
    (
      clientX: number,
      clientY: number,
      event: { stopPropagation(): void }
    ) => {
      const clickEvent = event as MouseEvent;
      const graph = graphRef.current;
      const rect = containerRef.current?.getBoundingClientRect();
      const point =
        typeof graph?.screen2GraphCoords === 'function'
          ? graph.screen2GraphCoords(
              clientX - (rect?.left ?? 0),
              clientY - (rect?.top ?? 0)
            )
          : null;
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        props.onPaneClick?.(clickEvent);
        return;
      }
      const zoom = typeof graph.zoom === 'function' ? Number(graph.zoom()) : 1;
      const hit = analysisClickTarget(
        point,
        graphData.nodes,
        graphData.links,
        Number.isFinite(zoom) ? zoom : 1
      );
      if (hit?.kind === 'node') props.onNodeClick?.(clickEvent, hit.node.rfNode);
      else if (hit?.kind === 'link') props.onEdgeClick?.(clickEvent, hit.link.rfEdge);
      else props.onPaneClick?.(clickEvent);
    },
    [graphData.links, graphData.nodes, props]
  );

  const handleNodeDragEnd = React.useCallback(
    (node: any) => {
      if (
        !canEdit() ||
        dragCancelledRef.current ||
        (dragCanEditRef.current && !dragCanEditRef.current())
      ) {
        cancelNodeDrag();
        return;
      }
      dragCanEditRef.current = null;
      const n = node as AnalysisGraphNode;
      const x = Number((node as any).x ?? 0);
      const y = Number((node as any).y ?? 0);
      // pin come refs: evita “drift”
      (node as any).fx = x;
      (node as any).fy = y;

      const activeGroup = dragGroupRef.current;
      if (activeGroup && activeGroup.anchorId === String(n.id) && activeGroup.startById.size > 1) {
        const dx = x - activeGroup.anchorStart.x;
        const dy = y - activeGroup.anchorStart.y;
        const updates: Array<{ node: Node; next: { x: number; y: number } }> = [];
        activeGroup.startById.forEach((start, id) => {
          const next = { x: start.x + dx, y: start.y + dy };
          const live = nodeById.get(id);
          if (live) {
            (live as any).x = next.x;
            (live as any).y = next.y;
            (live as any).fx = next.x;
            (live as any).fy = next.y;
          }
          updates.push({ node: start.rfNode, next });
        });
        dragGroupRef.current = null;
        scheduleDragRefresh();
        if (props.onNodesDragEnd) props.onNodesDragEnd(updates);
        else props.onNodeDragEnd?.(n.rfNode, { x, y });
        return;
      }

      dragGroupRef.current = null;
      props.onNodeDragEnd?.(n.rfNode, { x, y });
    },
    [props, nodeById, canEdit, cancelNodeDrag]
  );

  const handleNodeDrag = React.useCallback(
    (node: any) => {
      if (
        !canEdit() ||
        dragCancelledRef.current ||
        (dragCanEditRef.current && !dragCanEditRef.current())
      ) {
        cancelNodeDrag();
        return;
      }
      dragCanEditRef.current ??= canEdit;
      const n = node as AnalysisGraphNode;
      const draggedId = String(n.id ?? '');
      if (!draggedId) return;
      if (!selectedNodeIdSet.has(draggedId)) return;
      if (selectedNodeIdSet.size <= 1) return;

      const x = Number((node as any).x ?? 0);
      const y = Number((node as any).y ?? 0);

      if (!dragGroupRef.current) {
        const startById = new Map<string, { x: number; y: number; rfNode: Node }>();
        const ids = Array.from(selectedNodeIdSet);
        for (let i = 0; i < ids.length; i += 1) {
          const id = String(ids[i] ?? '');
          if (!id) continue;
          const live = nodeById.get(id);
          if (!live) continue;
          startById.set(id, {
            x: Number((live as any).x ?? 0),
            y: Number((live as any).y ?? 0),
            rfNode: live.rfNode
          });
        }
        if (startById.size <= 1) return;
        dragGroupRef.current = { anchorId: draggedId, anchorStart: { x, y }, startById };
      }

      const active = dragGroupRef.current;
      if (!active) return;
      if (active.anchorId !== draggedId) return;

      const dx = x - active.anchorStart.x;
      const dy = y - active.anchorStart.y;
      active.startById.forEach((start, id) => {
        if (id === draggedId) return;
        const live = nodeById.get(id);
        if (!live) return;
        const nextX = start.x + dx;
        const nextY = start.y + dy;
        (live as any).x = nextX;
        (live as any).y = nextY;
        (live as any).fx = nextX;
        (live as any).fy = nextY;
      });
      scheduleDragRefresh();
    },
    [nodeById, selectedNodeIdSet, canEdit, cancelNodeDrag]
  );

  const handleNodeRightClick = React.useCallback(
    (node: any, event: MouseEvent) => {
      const n = node as AnalysisGraphNode;
      props.onNodeContextMenu?.(event, n.rfNode);
    },
    [props]
  );

  const handleLinkRightClick = React.useCallback(
    (link: any, event: MouseEvent) => {
      const l = link as AnalysisGraphLink;
      props.onEdgeContextMenu?.(event, l.rfEdge);
    },
    [props]
  );

  const handleBackgroundRightClick = React.useCallback((event: MouseEvent) => {
    props.onPaneContextMenu?.(event);
  }, [props]);

  return (
    <div
      ref={containerRef}
      className={cn('relative h-full w-full overflow-hidden bg-canvas', props.className)}
      style={props.style}
      data-analysis-canvas
      onPointerDownCapture={(e) => {
        if (e.button !== 0) return;
        if (!e.shiftKey) {
          // Only a new gesture can resume edits after a drag was interrupted.
          dragCanEditRef.current = canEdit;
          dragCancelledRef.current = !canEdit();
          dragGroupRef.current = null;
          nativeClickRef.current = false;
          pointerGestureRef.current = { x: e.clientX, y: e.clientY };
          return;
        }
        pointerGestureRef.current = null;
        // Box select: Shift + drag
        isBoxSelectingRef.current = true;
        setIsBoxSelecting(true);
        props.onBoxSelectStateChange?.(true);
        lastBoxSelectedKeyRef.current = '';
        selectionStartRef.current = { x: e.clientX, y: e.clientY };
        selectionEndRef.current = { x: e.clientX, y: e.clientY };
        updateSelectionRect();
        computeAndEmitBoxSelection();
        try {
          (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
        } catch {}
        e.preventDefault();
        e.stopPropagation();
      }}
      onPointerMoveCapture={(e) => {
        if (!isBoxSelectingRef.current) return;
        selectionEndRef.current = { x: e.clientX, y: e.clientY };
        updateSelectionRect();
        if (selectionRafRef.current) cancelAnimationFrame(selectionRafRef.current);
        selectionRafRef.current = requestAnimationFrame(() => {
          selectionRafRef.current = null;
          computeAndEmitBoxSelection();
        });
        e.preventDefault();
        e.stopPropagation();
      }}
      onPointerUpCapture={(e) => {
        const start = pointerGestureRef.current;
        pointerGestureRef.current = null;
        if (!isBoxSelectingRef.current && start && e.button === 0) {
          const dx = e.clientX - start.x;
          const dy = e.clientY - start.y;
          if (dx * dx + dy * dy <= ANALYSIS_CLICK_SLOP_PX ** 2) {
            const clientX = e.clientX;
            const clientY = e.clientY;
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                if (nativeClickRef.current) {
                  nativeClickRef.current = false;
                  return;
                }
                dispatchSwallowedClick(clientX, clientY, e);
              });
            });
          }
        }
        if (!isBoxSelectingRef.current) return;
        selectionEndRef.current = { x: e.clientX, y: e.clientY };
        if (selectionRafRef.current) cancelAnimationFrame(selectionRafRef.current);
        selectionRafRef.current = null;
        computeAndEmitBoxSelection();
        endBoxSelection();
        setIsBoxSelecting(false);
        props.onBoxSelectStateChange?.(false);
        try {
          (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
        } catch {}
        e.preventDefault();
        e.stopPropagation();
      }}
      onPointerCancelCapture={() => {
        if (!isBoxSelectingRef.current) return;
        if (selectionRafRef.current) cancelAnimationFrame(selectionRafRef.current);
        selectionRafRef.current = null;
        endBoxSelection();
        setIsBoxSelecting(false);
        props.onBoxSelectStateChange?.(false);
      }}
    >
      {selectionRect ? (
        <div
          className='pointer-events-none absolute z-50 rounded-md border border-primary/70 bg-primary/10'
          style={{
            left: selectionRect.left,
            top: selectionRect.top,
            width: selectionRect.width,
            height: selectionRect.height
          }}
        />
      ) : null}
      {props.layoutOverlay?.isRunning ? (
        <div className='pointer-events-none absolute left-3 top-3 z-50'>
          <div className='bg-background/80 text-foreground flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs shadow-sm backdrop-blur'>
            <span className='font-medium'>{props.layoutOverlay.label ?? 'Layout…'}</span>
            {typeof props.layoutOverlay.pct === 'number' ? (
              <span className='text-muted-foreground'>{Math.round(props.layoutOverlay.pct * 100)}%</span>
            ) : null}
          </div>
        </div>
      ) : null}

      <ForceGraph2D
        ref={graphRef}
        width={containerSize.width}
        height={containerSize.height}
        graphData={graphData as any}
        // In Analysis: posizioni già calcolate, quindi niente simulazione runtime
        cooldownTicks={0}
        enableNodeDrag={!isBoxSelecting && canEdit()}
        enablePointerInteraction={!isBoxSelecting}
        enableZoomInteraction={!isBoxSelecting}
        enablePanInteraction={!isBoxSelecting}
        // Lo spinner è disegnato nel canvas: durante un run serve un redraw continuo
        // (equivalente visivo a `animate-spin` su un elemento DOM).
        autoPauseRedraw={runningNodeIds.size === 0}
        backgroundColor='transparent'
        nodeLabel={() => ''}
        nodeCanvasObjectMode={() => 'replace'}
        nodeCanvasObject={renderNode}
        nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
          // Allarga l’area di hit-testing (hover/click) rispetto al disegno reale.
          // ForceGraph usa questo canvas invisibile per il picking.
          const size = Math.max(18, Number(node?.nodeSize) || 20);
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
        onRenderFramePre={() => {
          // reset per-frame per collision detection label
          labelCollisionRef.current.rects = [];
          labelCollisionRef.current.frameKey = null;
        }}
        onNodeHover={handleNodeHover as any}
        onLinkHover={handleLinkHover as any}
        onNodeClick={handleNodeClick as any}
        onLinkClick={handleLinkClick as any}
        onBackgroundClick={handleBackgroundClick as any}
        onNodeDrag={handleNodeDrag as any}
        onNodeDragEnd={handleNodeDragEnd as any}
        onNodeRightClick={handleNodeRightClick as any}
        onLinkRightClick={handleLinkRightClick as any}
        onBackgroundRightClick={handleBackgroundRightClick as any}
        onEngineStop={handleEngineStop as any}
      />
    </div>
  );
}

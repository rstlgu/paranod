'use client';

import * as React from 'react';
import type { Edge, EdgeChange, Node, NodeChange } from 'reactflow';
import { MarkerType, applyEdgeChanges, applyNodeChanges } from 'reactflow';
import { nodePaletteItems, nodeTypeByType } from '@/features/osint/node-registry';
import { computeRelationalPositions } from '@/features/graph/relational-layout/relational-layout-client';
import type {
  RelationalLayoutEngine,
  RelationalLayoutEdgeInput,
  RelationalLayoutNodeInput
} from '@/features/graph/relational-layout/types';
import { useAnalysisMutationGuard } from './use-analysis-mutation-guard';

function clampNumber(min: number, value: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export interface AnalysisLayoutState {
  isLoading: boolean;
  nodes: Node[];
  edges: Edge[];
  layoutProgress: { pct: number; stage: string; isRunning: boolean } | null;
}

export interface AnalysisLayoutOptions {
  engine: RelationalLayoutEngine;
  hierarchyDirection: 'TB' | 'LR';
  density: 'compact' | 'normal' | 'relaxed';
  quality: 'fast' | 'balanced' | 'precise';
  showLabels: boolean;
  gravityStrength: number;
  maxRadius: number | null;
}

function getFitViewPaddingForNodeCount(nodeCount: number) {
  if (nodeCount <= 0) return 0.25;
  if (nodeCount <= 8) return 0.55;
  if (nodeCount <= 18) return 0.42;
  return 0.25;
}

function getAnalysisLayoutDefaults(): AnalysisLayoutOptions {
  return {
    engine: 'force',
    hierarchyDirection: 'TB',
    density: 'normal',
    quality: 'balanced',
    showLabels: true,
    gravityStrength: 0.06,
    maxRadius: null
  };
}

function computeColorByType() {
  const colorByType: Record<string, string> = {};
  (nodePaletteItems as any[]).forEach((opt) => {
    if (opt?.value && opt?.color) colorByType[String(opt.value)] = String(opt.color);
  });
  Object.keys(nodeTypeByType).forEach((k) => {
    const def: any = (nodeTypeByType as any)[k];
    if (def?.colorHex && !colorByType[k]) colorByType[k] = def.colorHex;
  });
  return colorByType;
}

function computeDegreeById(nodes: Node[], edges: Edge[]) {
  const deg = new Map<string, number>();
  nodes.forEach((n) => deg.set(n.id, 0));
  edges.forEach((e) => {
    if (!deg.has(e.source) || !deg.has(e.target)) return;
    if (e.source === e.target) return;
    deg.set(e.source, (deg.get(e.source) ?? 0) + 1);
    deg.set(e.target, (deg.get(e.target) ?? 0) + 1);
  });
  return deg;
}

function computeNodeSize(degree: number) {
  // Analysis: nodi leggermente più grandi per leggibilità.
  const dot = 20;
  const minDot = 18;
  const maxDot = 40;
  const k = 3.4;
  const s = dot + Math.sqrt(Math.max(0, degree)) * k;
  return Math.max(minDot, Math.min(maxDot, s));
}

function getMergedChildCountFromMetadata(meta: unknown): number {
  const m: any = meta ?? {};
  const direct = Number(m?.mergedChildCount);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const fromPayload = Array.isArray(m?.__merge?.nodeIds) ? m.__merge.nodeIds.length : 0;
  const n = Number(fromPayload);
  if (Number.isFinite(n) && n > 0) return n;
  return 0;
}

function computeMergedSize(baseSize: number, mergedChildCount: number) {
  if (!Number.isFinite(mergedChildCount) || mergedChildCount <= 1) return baseSize;
  // Smooth growth with a cap (non troppo).
  const extra = Math.min(18, Math.sqrt(Math.max(0, mergedChildCount - 1)) * 5);
  return Math.min(56, baseSize + extra);
}

function estimateLabelBoxForLayout(args: {
  label: string;
  density: AnalysisLayoutOptions['density'];
}) {
  const text = String(args.label ?? '').trim();
  if (!text) return { w: 0, h: 0 };
  // Approx: in analysis-canvas we use a ~12px font with padding; this is "graph unit" friendly.
  const approxCharPx = 7.2;
  const paddingX = 18; // ~9px per side
  const paddingY = 10; // ~5px per side
  const minW = 26;
  const maxW = args.density === 'compact' ? 140 : args.density === 'relaxed' ? 240 : 180;
  const w = Math.max(minW, Math.min(maxW, text.length * approxCharPx + paddingX));
  const h = Math.max(18, 12 + paddingY);
  return { w, h };
}

function countApproxLabelOverlaps(args: {
  nodes: Node[];
  positionsById: Map<string, { x: number; y: number }>;
  density: AnalysisLayoutOptions['density'];
  sampleSize: number;
}) {
  type Rect = { x: number; y: number; w: number; h: number };
  const items: Array<{ id: string; rect: Rect }> = [];

  const labeled = args.nodes
    .map((n) => {
      const d: any = (n as any).data ?? {};
      const label = String(d?.label ?? '').trim();
      return { id: n.id, node: n, label };
    })
    .filter((x) => x.label.length > 0)
    .sort((a, b) => b.label.length - a.label.length)
    .slice(0, Math.max(0, Math.floor(args.sampleSize)));

  for (const it of labeled) {
    const p = args.positionsById.get(it.id);
    if (!p) continue;
    const d: any = (it.node as any).data ?? {};
    const size = Number((d?._relationalSize as any) ?? (it.node as any)?.style?.width ?? 16);
    const radius = Math.max(7, size / 2);
    const centerX = Number(p.x ?? 0) + size / 2;
    const centerY = Number(p.y ?? 0) + size / 2;

    const box = estimateLabelBoxForLayout({ label: it.label, density: args.density });
    if (!box.w || !box.h) continue;

    const px = 12;
    const x = centerX - box.w / 2;
    const y = centerY + radius * 0.15 + px * 0.45;
    items.push({ id: it.id, rect: { x, y, w: box.w, h: box.h } });
  }

  function overlaps(a: Rect, b: Rect) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  let count = 0;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (overlaps(items[i]!.rect, items[j]!.rect)) count += 1;
    }
  }
  return count;
}

function buildAnalysisNodes(args: {
  sourceNodes: Node[];
  sourceEdges: Edge[];
  showLabels: boolean;
  positionsById?: Map<string, { x: number; y: number }>;
}) {
  const degreeById = computeDegreeById(args.sourceNodes, args.sourceEdges);
  const colorByType = computeColorByType();
  const idsByDegree = args.sourceNodes
    .map((n) => n.id)
    .sort((a, b) => (degreeById.get(b) ?? 0) - (degreeById.get(a) ?? 0));
  const labelTopK = args.showLabels ? 16 : 0;
  const showLabel = new Set(idsByDegree.slice(0, labelTopK));

  const labelOffsetsById = computeLabelOffsets({
    nodes: args.sourceNodes,
    edges: args.sourceEdges,
    positionsById: args.positionsById,
    showLabels: args.showLabels
  });

  return args.sourceNodes.map((base, i) => {
    const d: any = (base as any).data ?? {};
    const degree = degreeById.get(base.id) ?? 0;
    const mergedCount = getMergedChildCountFromMetadata(d?.metadata);
    const size = computeMergedSize(computeNodeSize(degree), mergedCount);
    const p = args.positionsById?.get(base.id);
    const fallback = (() => {
      const angle = (i / Math.max(1, args.sourceNodes.length)) * Math.PI * 2;
      const r = 60 + (i % 17) * 4;
      return { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
    })();

    return {
      ...base,
      draggable: true,
      selectable: true,
      position: p ?? (base.position ?? fallback),
      style: {
        width: size,
        height: size,
        borderRadius: 9999,
        transition: 'transform 480ms cubic-bezier(0.2, 0, 0, 1)',
        willChange: 'transform'
      },
      data: {
        ...(d ?? {}),
        _relationalDegree: degree,
        _relationalShowLabel: showLabel.has(base.id),
        _relationalColor: colorByType[String(d?.type ?? '')],
        _relationalSize: size,
        _relationalLabelOffset: labelOffsetsById.get(base.id) ?? { x: 0, y: 0 }
      }
    } as Node;
  });
}

function computeLabelOffsets(args: {
  nodes: Node[];
  edges: Edge[];
  positionsById?: Map<string, { x: number; y: number }>;
  showLabels: boolean;
}) {
  const degreeById = computeDegreeById(args.nodes, args.edges);
  const idsByDegree = args.nodes
    .map((n) => n.id)
    .sort((a, b) => (degreeById.get(b) ?? 0) - (degreeById.get(a) ?? 0));
  const labelTopK = args.showLabels ? 16 : 0;
  const labelCandidates = new Set(idsByDegree.slice(0, labelTopK));

  type Item = {
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
    ox: number;
    oy: number;
    anchorX: number;
    anchorY: number;
  };

  const items: Item[] = [];
  for (let i = 0; i < args.nodes.length; i++) {
    const n = args.nodes[i]!;
    const data: any = (n as any).data ?? {};
    const label = String(data?.label ?? '');
    if (!label) continue;
    if (!labelCandidates.has(n.id)) continue;

    const size = computeNodeSize(degreeById.get(n.id) ?? 0);
    const pos = args.positionsById?.get(n.id) ?? n.position ?? { x: 0, y: 0 };

    const w = Math.min(160, Math.max(36, label.length * 6 + 14));
    const h = 16;

    const anchorX = pos.x + size / 2;
    const anchorY = pos.y + size + 2;

    items.push({
      id: n.id,
      ox: 0,
      oy: 0,
      x: anchorX - w / 2,
      y: anchorY,
      w,
      h,
      anchorX,
      anchorY
    });
  }

  function overlaps(a: Item, b: Item) {
    return !(
      a.x + a.w < b.x ||
      b.x + b.w < a.x ||
      a.y + a.h < b.y ||
      b.y + b.h < a.y
    );
  }

  const iters = 26;
  for (let iter = 0; iter < iters; iter++) {
    for (let i = 0; i < items.length; i++) {
      const a = items[i]!;
      let dx = 0;
      let dy = 0;
      for (let j = 0; j < items.length; j++) {
        if (i === j) continue;
        const b = items[j]!;
        if (!overlaps(a, b)) continue;

        const ax = a.x + a.w / 2;
        const ay = a.y + a.h / 2;
        const bx = b.x + b.w / 2;
        const by = b.y + b.h / 2;

        const vx = ax - bx;
        const vy = ay - by;
        const dist = Math.max(1, Math.hypot(vx, vy));
        const push = 4.5 / dist;

        dx += (vx / dist) * push;
        dy += (vy / dist) * push * 1.35;
      }

      const targetX = a.anchorX - a.w / 2;
      const targetY = a.anchorY;
      dx += (targetX - a.x) * 0.05;
      dy += (targetY - a.y) * 0.06;

      a.x += dx;
      a.y += dy;
    }
  }

  const out = new Map<string, { x: number; y: number }>();
  for (const a of items) {
    const baseX = a.anchorX - a.w / 2;
    const baseY = a.anchorY;
    const ox = Math.max(-90, Math.min(90, a.x - baseX));
    const oy = Math.max(-8, Math.min(140, a.y - baseY));
    out.set(a.id, { x: ox, y: oy });
  }
  return out;
}

function buildAnalysisEdges(args: { sourceEdges: Edge[]; nodeIdSet: Set<string> }) {
  return args.sourceEdges
    .filter((e) => args.nodeIdSet.has(e.source) && args.nodeIdSet.has(e.target) && e.source !== e.target)
    .map((e) => ({
      ...e,
      type: 'analysis',
      sourceHandle: 'floating',
      targetHandle: 'floating',
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 8,
        height: 8,
        color: String((e.data as any)?.color ?? 'rgba(148, 163, 184, 0.9)')
      } as any,
      style: {
        stroke: String((e.data as any)?.color ?? 'rgba(148, 163, 184, 0.9)'),
        strokeWidth: 1.35,
        strokeLinecap: 'round',
        strokeDasharray: (e.data as any)?.dashed ? '10 6' : 'none'
      },
      data: { ...(e.data ?? {}), _layoutMode: 'analysis' }
    })) as Edge[];
}

function buildIncrementalPositionSeeds(args: {
  sourceNodes: Node[];
  sourceEdges: Edge[];
  previousPositions: Map<string, { x: number; y: number }>;
  sizeById: Map<string, { width: number; height: number }>;
  density: AnalysisLayoutOptions['density'];
}) {
  const nodeById = new Map(args.sourceNodes.map((node) => [node.id, node]));
  const existingIds = new Set(
    args.sourceNodes.map((node) => node.id).filter((id) => args.previousPositions.has(id))
  );
  const newIds = args.sourceNodes.map((node) => node.id).filter((id) => !existingIds.has(id));
  const newIdSet = new Set(newIds);
  if (!newIds.length) return new Map<string, { x: number; y: number }>();

  const neighborsById = new Map<string, string[]>();
  for (const node of args.sourceNodes) neighborsById.set(node.id, []);
  for (const edge of args.sourceEdges) {
    if (edge.source === edge.target) continue;
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) continue;
    neighborsById.get(edge.source)?.push(edge.target);
    neighborsById.get(edge.target)?.push(edge.source);
  }

  const getSize = (id: string) => args.sizeById.get(id) ?? { width: 28, height: 28 };
  const getCenter = (id: string, positions: Map<string, { x: number; y: number }>) => {
    const position = positions.get(id);
    if (!position) return null;
    const size = getSize(id);
    return { x: position.x + size.width / 2, y: position.y + size.height / 2 };
  };

  const occupiedCenters = Array.from(existingIds)
    .map((id) => ({ id, center: getCenter(id, args.previousPositions) }))
    .filter((item): item is { id: string; center: { x: number; y: number } } => Boolean(item.center));
  const directionCandidates = [
    { x: 0, y: 1 },
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: -1 },
    { x: Math.SQRT1_2, y: Math.SQRT1_2 },
    { x: -Math.SQRT1_2, y: Math.SQRT1_2 },
    { x: Math.SQRT1_2, y: -Math.SQRT1_2 },
    { x: -Math.SQRT1_2, y: -Math.SQRT1_2 }
  ];

  function pickOpenDirection(anchorId: string) {
    const anchor = getCenter(anchorId, args.previousPositions);
    if (!anchor) return directionCandidates[0]!;
    let best = directionCandidates[0]!;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const candidate of directionCandidates) {
      let score = 0;
      for (const item of occupiedCenters) {
        if (item.id === anchorId) continue;
        const dx = item.center.x - anchor.x;
        const dy = item.center.y - anchor.y;
        const distance = Math.hypot(dx, dy);
        if (distance <= 0 || distance > 700) continue;
        const alignment = Math.max(0, (dx * candidate.x + dy * candidate.y) / distance);
        score += alignment * alignment * (1 - distance / 700);
      }
      if (score < bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    return best;
  }

  const parentById = new Map<string, string>();
  const rootById = new Map<string, string>();
  const queue = Array.from(existingIds);
  const visited = new Set(queue);
  for (const id of queue) rootById.set(id, id);
  for (let index = 0; index < queue.length; index += 1) {
    const parentId = queue[index]!;
    for (const neighborId of neighborsById.get(parentId) ?? []) {
      if (visited.has(neighborId) || !newIdSet.has(neighborId)) continue;
      visited.add(neighborId);
      parentById.set(neighborId, parentId);
      rootById.set(neighborId, rootById.get(parentId) ?? parentId);
      queue.push(neighborId);
    }
  }

  const childrenByParent = new Map<string, string[]>();
  for (const id of newIds) {
    const parentId = parentById.get(id);
    if (!parentId) continue;
    const children = childrenByParent.get(parentId) ?? [];
    children.push(id);
    childrenByParent.set(parentId, children);
  }

  const spacing =
    args.density === 'compact'
      ? { layer: 130, sibling: 115 }
      : args.density === 'relaxed'
        ? { layer: 210, sibling: 190 }
        : { layer: 165, sibling: 150 };
  const positions = new Map(args.previousPositions);
  const directionByRoot = new Map<string, { x: number; y: number }>();
  for (const rootId of Array.from(existingIds)) {
    directionByRoot.set(rootId, pickOpenDirection(rootId));
  }

  for (const parentId of queue) {
    const children = childrenByParent.get(parentId) ?? [];
    if (!children.length) continue;
    const parentCenter = getCenter(parentId, positions);
    if (!parentCenter) continue;
    const rootId = rootById.get(parentId) ?? parentId;
    const direction = directionByRoot.get(rootId) ?? directionCandidates[0]!;
    const perpendicular = { x: -direction.y, y: direction.x };
    const perRow = Math.min(6, children.length);

    children.forEach((childId, childIndex) => {
      const row = Math.floor(childIndex / perRow);
      const rowStart = row * perRow;
      const rowCount = Math.min(perRow, children.length - rowStart);
      const column = childIndex - rowStart;
      const offset = (column - (rowCount - 1) / 2) * spacing.sibling;
      const distance = spacing.layer + row * spacing.layer * 0.72;
      const size = getSize(childId);
      const centerX = parentCenter.x + direction.x * distance + perpendicular.x * offset;
      const centerY = parentCenter.y + direction.y * distance + perpendicular.y * offset;
      positions.set(childId, { x: centerX - size.width / 2, y: centerY - size.height / 2 });
    });
  }

  const disconnected = newIds.filter((id) => !positions.has(id));
  if (disconnected.length) {
    const center = occupiedCenters.length
      ? occupiedCenters.reduce(
          (acc, item) => ({
            x: acc.x + item.center.x / occupiedCenters.length,
            y: acc.y + item.center.y / occupiedCenters.length
          }),
          { x: 0, y: 0 }
        )
      : { x: 0, y: 0 };
    disconnected.forEach((id, index) => {
      const size = getSize(id);
      const column = index % 5;
      const row = Math.floor(index / 5);
      positions.set(id, {
        x: center.x + (column - 2) * spacing.sibling - size.width / 2,
        y: center.y + spacing.layer + row * spacing.layer - size.height / 2
      });
    });
  }

  return new Map(newIds.map((id) => [id, positions.get(id)!]));
}

export function useAnalysisLayoutState(args: {
  graphId?: string;
  isActive: boolean;
  readOnly?: boolean;
  canEditSnapshot?: () => boolean;
  nodes: Node[];
  edges: Edge[];
}) {
  const canEdit = useAnalysisMutationGuard({
    readOnly: args.readOnly,
    canEditSnapshot: args.canEditSnapshot,
    scope: args.graphId
  });
  const [epoch, setEpoch] = React.useState(0);
  const [layoutOptions, setLayoutOptions] = React.useState<AnalysisLayoutOptions>(getAnalysisLayoutDefaults());
  const layoutOptionsRef = React.useRef<AnalysisLayoutOptions>(getAnalysisLayoutDefaults());
  const [state, setState] = React.useState<AnalysisLayoutState>({
    isLoading: false,
    nodes: [],
    edges: [],
    layoutProgress: null
  });
  const fitViewPaddingRef = React.useRef(0.25);
  const sourceNodesRef = React.useRef<Node[]>(args.nodes);
  const sourceEdgesRef = React.useRef<Edge[]>(args.edges);
  const abortRef = React.useRef<AbortController | null>(null);
  const lastPositionsRef = React.useRef<Map<string, { x: number; y: number }> | null>(null);
  const lastTickAtRef = React.useRef<number>(0);
  const fullLayoutRequestedRef = React.useRef(true);

  const refetch = React.useCallback(async () => {
    fullLayoutRequestedRef.current = true;
    setEpoch((v) => v + 1);
  }, []);

  React.useEffect(() => {
    sourceNodesRef.current = args.nodes;
    sourceEdgesRef.current = args.edges;
  }, [args.nodes, args.edges]);

  React.useEffect(() => {
    lastPositionsRef.current = null;
    fullLayoutRequestedRef.current = true;
  }, [args.graphId]);

  const structureSignature = React.useMemo(() => {
    const nodePart = args.nodes
      .map((n) => {
        const data: any = (n as any).data ?? {};
        return [n.id, String(data?.type ?? '')].join('|');
      })
      .sort()
      .join(';');
    const edgePart = args.edges
      .map((e) => [e.id, e.source, e.target, String((e as any)?.data?.relationship ?? '')].join('|'))
      .sort()
      .join(';');
    return `${nodePart}__${edgePart}`;
  }, [args.nodes, args.edges]);

  const nodeDataSignature = React.useMemo(() => {
    return args.nodes
      .map((n) => {
        const data: any = (n as any).data ?? {};
        const meta: any = data?.metadata ?? {};
        const visualKey = [
          String(meta?.customColor ?? ''),
          String(meta?.headerTextColor ?? ''),
          String(meta?.autoColorFromLogo ?? ''),
          String(meta?.autoHeaderTextColorFromLogo ?? '')
        ].join(',');
        return [n.id, String(data?.type ?? ''), String(data?.label ?? ''), visualKey].join('|');
      })
      .sort()
      .join(';');
  }, [args.nodes]);

  const selectionSignature = React.useMemo(() => {
    const selNodes = args.nodes.filter((n) => (n as any)?.selected).map((n) => n.id).sort().join(',');
    const selEdges = args.edges.filter((e) => (e as any)?.selected).map((e) => e.id).sort().join(',');
    return `${selNodes}__${selEdges}`;
  }, [args.nodes, args.edges]);

  const applyLayout = React.useCallback((next?: Partial<AnalysisLayoutOptions>) => {
    if (!canEdit()) return;
    if (!next || Object.keys(next).length === 0) return;
    const merged = { ...layoutOptionsRef.current, ...next };
    layoutOptionsRef.current = merged;
    fullLayoutRequestedRef.current = true;
    setLayoutOptions(merged);
    setEpoch((v) => v + 1);
  }, [canEdit]);

  const applyNodesChange = React.useCallback((changes: NodeChange[]) => {
    const allowedChanges = canEdit()
      ? changes
      : changes.filter((change) => change.type === 'select');
    if (!allowedChanges.length) return;
    setState((prev) => {
      if (!prev.nodes.length) return prev;
      const currentChanges = canEdit()
        ? allowedChanges
        : allowedChanges.filter((change) => change.type === 'select');
      if (!currentChanges.length) return prev;
      const nextNodes = applyNodeChanges(currentChanges, prev.nodes) as Node[];
      const positions = new Map(lastPositionsRef.current ?? prev.nodes.map((node) => [node.id, node.position]));
      for (const change of currentChanges) {
        const id = 'id' in change ? change.id : '';
        if (!id) continue;
        if (change?.type === 'remove') positions.delete(id);
        if (change?.type === 'position' && change?.position) {
          positions.set(id, {
            x: Number(change.position.x) || 0,
            y: Number(change.position.y) || 0
          });
        }
      }
      lastPositionsRef.current = positions;
      return { ...prev, nodes: nextNodes };
    });
  }, [canEdit]);

  const applyEdgesChange = React.useCallback((changes: EdgeChange[]) => {
    const allowedChanges = canEdit()
      ? changes
      : changes.filter((change) => change.type === 'select');
    if (!allowedChanges.length) return;
    setState((prev) => {
      if (!prev.edges.length) return prev;
      const currentChanges = canEdit()
        ? allowedChanges
        : allowedChanges.filter((change) => change.type === 'select');
      if (!currentChanges.length) return prev;
      return { ...prev, edges: applyEdgeChanges(currentChanges, prev.edges) };
    });
  }, [canEdit]);

  // Layout computation is local view state, including while edits are locked.
  // Do not persist these derived positions when the mode changes or a run finishes.
  React.useEffect(() => {
    if (!args.isActive) return;

    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    setState((prev) => ({ ...prev, isLoading: true, layoutProgress: { pct: 0, stage: 'start', isRunning: true } }));

    async function run() {
      const sourceNodes = sourceNodesRef.current;
      const sourceEdges = sourceEdgesRef.current;
      const opts = layoutOptionsRef.current;
      const previousPositions = lastPositionsRef.current;
      const isFullLayout = fullLayoutRequestedRef.current || !previousPositions?.size;
      fullLayoutRequestedRef.current = false;

      const nodeIdSet = new Set(sourceNodes.map((n) => n.id));
      const degreeById = computeDegreeById(sourceNodes, sourceEdges);
      const immediateEdges = buildAnalysisEdges({ sourceEdges, nodeIdSet });
      const baseNodes = buildAnalysisNodes({ sourceNodes, sourceEdges, showLabels: opts.showLabels });
      const sizeById = new Map<string, { width: number; height: number }>();
      for (const n of baseNodes) {
        const w = (typeof (n as any).style?.width === 'number' && (n as any).style.width) || (n.data as any)?._relationalSize || 28;
        const h = (typeof (n as any).style?.height === 'number' && (n as any).style.height) || (n.data as any)?._relationalSize || 28;
        const d: any = (n as any).data ?? {};
        const label = String(d?.label ?? '');
        const labelBox = opts.showLabels ? estimateLabelBoxForLayout({ label, density: opts.density }) : { w: 0, h: 0 };
        // Label is drawn under the node; approximate a combined bounding box to reduce overlaps.
        const labelGap = labelBox.w > 0 ? 10 : 0;
        const effectiveW = Math.max(Number(w), Number(labelBox.w || 0));
        const effectiveH = Math.max(Number(h), Number(h) + Number(labelBox.h || 0) + labelGap);
        sizeById.set(n.id, { width: effectiveW, height: effectiveH });
      }

      const incrementalSeeds =
        !isFullLayout && previousPositions
          ? buildIncrementalPositionSeeds({
              sourceNodes,
              sourceEdges,
              previousPositions,
              sizeById,
              density: opts.density
            })
          : new Map<string, { x: number; y: number }>();
      const seedPositions = new Map(previousPositions ?? []);
      for (const [id, position] of Array.from(incrementalSeeds)) {
        seedPositions.set(id, position);
      }

      const immediateNodes = buildAnalysisNodes({
        sourceNodes,
        sourceEdges,
        showLabels: opts.showLabels,
        positionsById: seedPositions.size ? seedPositions : undefined
      });
      setState((prev) => ({ ...prev, nodes: immediateNodes, edges: immediateEdges }));

      const newNodeIds = sourceNodes
        .map((node) => node.id)
        .filter((id) => !previousPositions?.has(id));
      if (!isFullLayout && newNodeIds.length === 0) {
        const retainedPositions = new Map(
          sourceNodes
            .map((node) => [node.id, previousPositions?.get(node.id)] as const)
            .filter((entry): entry is readonly [string, { x: number; y: number }] => Boolean(entry[1]))
        );
        lastPositionsRef.current = retainedPositions;
        setState({
          isLoading: false,
          nodes: buildAnalysisNodes({
            sourceNodes,
            sourceEdges,
            showLabels: opts.showLabels,
            positionsById: retainedPositions
          }),
          edges: immediateEdges,
          layoutProgress: { pct: 1, stage: 'done', isRunning: false }
        });
        return;
      }

      const nodeInputs: RelationalLayoutNodeInput[] = baseNodes.map((n) => {
        const size = sizeById.get(n.id) ?? { width: 28, height: 28 };
        const seed = seedPositions.get(n.id);
        return {
          id: n.id,
          width: size.width,
          height: size.height,
          degree: degreeById.get(n.id) ?? 0,
          ...(seed ? { x: seed.x, y: seed.y } : {}),
          fixed: !isFullLayout && Boolean(previousPositions?.has(n.id))
        };
      });

      const edgeInputs: RelationalLayoutEdgeInput[] = sourceEdges
        .filter((e) => nodeIdSet.has(e.source) && nodeIdSet.has(e.target) && e.source !== e.target)
        .map((e) => ({ source: e.source, target: e.target }));

      const densityPreset = (() => {
        if (opts.density === 'compact') return { linkDistance: 150, collisionPadding: 8, nodesep: 26, ranksep: 54 };
        if (opts.density === 'relaxed') return { linkDistance: 260, collisionPadding: 16, nodesep: 64, ranksep: 118 };
        return { linkDistance: 190, collisionPadding: 12, nodesep: 42, ranksep: 84 };
      })();

      const qualityPreset = (() => {
        if (opts.quality === 'fast') return { iterations: 140, repulsionBase: 340, repulsionDegreeFactor: 60 };
        if (opts.quality === 'precise') return { iterations: 420, repulsionBase: 520, repulsionDegreeFactor: 92 };
        return { iterations: 240, repulsionBase: 420, repulsionDegreeFactor: 74 };
      })();

      const maxLabelW = (() => {
        if (!opts.showLabels) return 0;
        let max = 0;
        for (const n of baseNodes) {
          const d: any = (n as any).data ?? {};
          const label = String(d?.label ?? '');
          const box = estimateLabelBoxForLayout({ label, density: opts.density });
          if (box.w > max) max = box.w;
        }
        return max;
      })();

      const labelFactor = opts.showLabels
        ? clampNumber(1, 1 + Math.max(0, maxLabelW - 240) / 900, 1.06)
        : 1;
      const layoutEngine: RelationalLayoutEngine = isFullLayout ? opts.engine : 'force';

      async function runLayoutOnce(args2: { factor: number; stage: string }) {
        const f = clampNumber(1, args2.factor, 1.7);
        // keep nodes closer; only apply a small extra spacing for very long labels
        const spacing = 1 + (f - 1) * 0.32;
        const repulsion = 1 + (f - 1) * 0.22;
        const degreeRepulsion = 1 + (f - 1) * 0.18;
        const hierarchySep = 1 + (f - 1) * 0.38;
        const hierarchyRank = 1 + (f - 1) * 0.34;

        return await computeRelationalPositions({
          engine: layoutEngine,
          nodes: nodeInputs,
          edges: edgeInputs,
          options:
            layoutEngine === 'force'
              ? {
                  iterations: qualityPreset.iterations,
                  linkDistance: densityPreset.linkDistance * spacing,
                  repulsionBase: qualityPreset.repulsionBase * repulsion,
                  repulsionDegreeFactor: qualityPreset.repulsionDegreeFactor * degreeRepulsion,
                  collisionPadding: densityPreset.collisionPadding * spacing,
                  gravityStrength: opts.gravityStrength,
                  maxRadius: opts.maxRadius
                }
              : {
                  direction: opts.hierarchyDirection,
                  nodesep: densityPreset.nodesep * hierarchySep,
                  ranksep: densityPreset.ranksep * hierarchyRank
                },
          onProgress: (pct, stage) => {
            if (abort.signal.aborted) return;
            setState((prev) => ({
              ...prev,
              layoutProgress: { pct, stage: `${args2.stage}:${stage}`, isRunning: true }
            }));
          },
          onTick:
            layoutEngine === 'force'
              ? (pct, tickPositions) => {
                  if (abort.signal.aborted) return;
                  const now = performance.now();
                  const last = (lastTickAtRef.current ?? 0) as number;
                  if (now - last < 60) return;
                  lastTickAtRef.current = now;

                  const positionsById = new Map(tickPositions.map((p) => [p.id, { x: p.x, y: p.y }]));
                  lastPositionsRef.current = positionsById;

                  setState((prev) => {
                    if (!prev.nodes.length) return prev;
                    return {
                      ...prev,
                      layoutProgress: { pct, stage: 'simulate', isRunning: true },
                      nodes: prev.nodes.map((n) => {
                        const p = positionsById.get(n.id);
                        if (!p) return n;
                        return { ...n, position: p };
                      })
                    };
                  });
                }
              : undefined,
          signal: abort.signal
        });
      }

      let positions = await runLayoutOnce({ factor: labelFactor, stage: 'layout' });
      if (abort.signal.aborted) return;

      // If labels still collide (approx), rerun once with a slightly more relaxed factor
      if (opts.showLabels && labelFactor < 1.6) {
        const positionsById0 = new Map(positions.map((p) => [p.id, { x: p.x, y: p.y }]));
        const overlaps = countApproxLabelOverlaps({
          nodes: baseNodes,
          positionsById: positionsById0,
          density: opts.density,
          sampleSize: 120
        });
        if (overlaps >= 14) {
          const factor2 = clampNumber(1, labelFactor * 1.06, 1.25);
          positions = await runLayoutOnce({ factor: factor2, stage: 'label-space' });
        }
      }

      if (abort.signal.aborted) return;

      const positionsById = new Map(positions.map((p) => [p.id, { x: p.x, y: p.y }]));
      lastPositionsRef.current = positionsById;
      const nextNodes = buildAnalysisNodes({ sourceNodes, sourceEdges, showLabels: opts.showLabels, positionsById });
      const nextEdges = buildAnalysisEdges({ sourceEdges, nodeIdSet });

      fitViewPaddingRef.current = getFitViewPaddingForNodeCount(nextNodes.length);
      setState({ isLoading: false, nodes: nextNodes, edges: nextEdges, layoutProgress: { pct: 1, stage: 'done', isRunning: false } });
    }

    void run().catch((err) => {
      if (abort.signal.aborted) return;
      setState((prev) => ({ ...prev, isLoading: false, layoutProgress: { pct: 1, stage: String(err?.message ?? 'error'), isRunning: false } }));
    });

    return () => abort.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    args.isActive,
    args.graphId,
    epoch,
    structureSignature,
    layoutOptions.engine,
    layoutOptions.hierarchyDirection,
    layoutOptions.density,
    layoutOptions.quality,
    layoutOptions.showLabels,
    layoutOptions.gravityStrength,
    layoutOptions.maxRadius
  ]);

  React.useEffect(() => {
    if (!args.isActive) return;
    const selectedNodes = new Set(sourceNodesRef.current.filter((n) => (n as any)?.selected).map((n) => n.id));
    const selectedEdges = new Set(sourceEdgesRef.current.filter((e) => (e as any)?.selected).map((e) => e.id));
    setState((prev) => {
      if (!prev.nodes.length && !prev.edges.length) return prev;
      return {
        ...prev,
        nodes: prev.nodes.map((n) => ({ ...n, selected: selectedNodes.has(n.id) })),
        edges: prev.edges.map((e) => ({ ...e, selected: selectedEdges.has(e.id) }))
      };
    });
  }, [args.isActive, selectionSignature]);

  React.useEffect(() => {
    if (!args.isActive) return;
    const byId = new Map(sourceNodesRef.current.map((n) => [n.id, (n as any).data ?? {}]));
    setState((prev) => {
      if (!prev.nodes.length) return prev;
      return {
        ...prev,
        nodes: prev.nodes.map((n) => {
          const nextData = byId.get(n.id);
          if (!nextData) return n;
          const merged = { ...(n.data ?? {}), ...(nextData ?? {}) };
          return { ...n, data: merged };
        })
      };
    });
  }, [args.isActive, nodeDataSignature]);

  return {
    ...state,
    refetch,
    layoutOptions,
    applyLayout,
    getFitViewPadding: () => fitViewPaddingRef.current,
    applyNodesChange,
    applyEdgesChange
  };
}

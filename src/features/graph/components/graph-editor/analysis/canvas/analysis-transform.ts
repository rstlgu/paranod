import type { Edge, Node } from 'reactflow';
import { type NodeType } from '@/features/osint/node-registry';
import { getOsintNodeVisualTokens } from '@/features/graph/components/osint-node-visual';

export interface AnalysisGraphNode {
  id: string;
  x: number;
  y: number;
  fx?: number;
  fy?: number;
  rfNode: Node;
  nodeType: NodeType | 'custom';
  nodeLogoUrl?: string;
  nodeLabel: string;
  nodeColor: string;
  nodeIconColor: string;
  nodeBgColor: string;
  nodeSize: number;
  neighbors: AnalysisGraphNode[];
  links: AnalysisGraphLink[];
}

export interface AnalysisGraphLink {
  id: string;
  source: string;
  target: string;
  rfEdge: Edge;
  color: string;
  strokeWidth: number;
  label: string | null;
  curvature: number;
}

export interface AnalysisGraphData {
  nodes: AnalysisGraphNode[];
  links: AnalysisGraphLink[];
}

function computeDegreeById(nodes: Node[], edges: Edge[]) {
  const deg = new Map<string, number>();
  nodes.forEach((n) => deg.set(String(n.id), 0));
  edges.forEach((e) => {
    const s = String(e.source);
    const t = String(e.target);
    if (!deg.has(s) || !deg.has(t)) return;
    if (s === t) return;
    deg.set(s, (deg.get(s) ?? 0) + 1);
    deg.set(t, (deg.get(t) ?? 0) + 1);
  });
  return deg;
}

function computeNodeSize(degree: number) {
  // Match `analysis-layout-state.tsx` sizing so minimap == canvas.
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
  const extra = Math.min(18, Math.sqrt(Math.max(0, mergedChildCount - 1)) * 5);
  return Math.min(56, baseSize + extra);
}

function pickNodeSize(args: { rfNode: Node; degreeById: Map<string, number> }) {
  const data: any = (args.rfNode as any).data ?? {};
  const explicit = Number(data?._relationalSize);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;

  // IMPORTANT: in Analysis we render nodes as circles. Do NOT reuse ReactFlow card widths
  // (note/map/etc) or the minimap will show them gigantic.
  const degree = args.degreeById.get(String(args.rfNode.id)) ?? 0;
  const mergedCount = getMergedChildCountFromMetadata(data?.metadata);
  return computeMergedSize(computeNodeSize(degree), mergedCount);
}

function pickVisualTokens(rfNode: Node) {
  const data: any = (rfNode as any).data ?? {};
  const type = String(data?.type ?? 'custom');
  const label = String(data?.label ?? '').trim();
  const metadata = (data?.metadata ?? {}) as Record<string, unknown>;
  return getOsintNodeVisualTokens({ type, label, metadata });
}

function pickNodeLabel(rfNode: Node) {
  const data: any = (rfNode as any).data ?? {};
  const raw = String(data?.label ?? '').trim();
  return raw.length ? raw : rfNode.id;
}

function pickEdgeColor(rfEdge: Edge) {
  const data: any = (rfEdge as any).data ?? {};
  const style: any = (rfEdge as any).style ?? {};
  const c = String(style?.stroke ?? data?.color ?? 'rgba(148, 163, 184, 0.9)');
  return c;
}

function pickEdgeWidth(rfEdge: Edge) {
  const data: any = (rfEdge as any).data ?? {};
  const style: any = (rfEdge as any).style ?? {};
  const w = Number(style?.strokeWidth ?? data?.strokeWidth ?? 1.35);
  const raw = Number.isFinite(w) ? w : 1.35;
  // Analysis: rendi i link più leggibili (canvas) senza toccare gli altri mode
  return raw * 1.6;
}

function pickEdgeLabel(rfEdge: Edge) {
  const data: any = (rfEdge as any).data ?? {};
  const raw = String(data?.label ?? data?.relationship ?? '').trim();
  return raw.length ? raw : null;
}

export function transformRelationalToAnalysisGraphData(args: {
  nodes: Node[];
  edges: Edge[];
}): AnalysisGraphData {
  const degreeById = computeDegreeById(args.nodes, args.edges);

  const transformedNodes: AnalysisGraphNode[] = args.nodes.map((rfNode) => {
    const data: any = (rfNode as any).data ?? {};
    const pos = (rfNode as any).position ?? { x: 0, y: 0 };
    const size = pickNodeSize({ rfNode, degreeById });
    // ReactFlow position = top-left; ForceGraph usa x/y come center.
    const x = Number(pos.x ?? 0) + size / 2;
    const y = Number(pos.y ?? 0) + size / 2;

    // In Analysis usiamo posizioni già calcolate dal worker: le “pinnamo” (no simulazione runtime).
    const fx = x;
    const fy = y;
    const tokens = pickVisualTokens(rfNode);

    return {
      id: rfNode.id,
      x,
      y,
      fx,
      fy,
      rfNode,
      nodeType: (data?.type as NodeType | undefined) ?? 'custom',
      nodeLogoUrl: tokens.logoUrl,
      nodeLabel: pickNodeLabel(rfNode),
      nodeColor: tokens.accentHex,
      nodeBgColor: tokens.bgHex,
      nodeIconColor: tokens.iconHex,
      nodeSize: size,
      neighbors: [],
      links: []
    };
  });

  const nodeMap = new Map(transformedNodes.map((n) => [n.id, n]));

  // Group edges per (source,target) per curvatura su multi-edge
  const edgeGroups = new Map<string, Edge[]>();
  for (const rfEdge of args.edges) {
    const key = `${rfEdge.source}→${rfEdge.target}`;
    const list = edgeGroups.get(key);
    if (list) list.push(rfEdge);
    else edgeGroups.set(key, [rfEdge]);
  }

  const transformedLinks: AnalysisGraphLink[] = args.edges.map((rfEdge) => {
    const key = `${rfEdge.source}→${rfEdge.target}`;
    const group = edgeGroups.get(key) ?? [rfEdge];
    const groupIndex = Math.max(0, group.indexOf(rfEdge));
    const groupSize = Math.max(1, group.length);
    const curvature = groupSize > 1 ? (groupIndex - (groupSize - 1) / 2) * 0.2 : 0;

    return {
      id: rfEdge.id,
      source: String(rfEdge.source),
      target: String(rfEdge.target),
      rfEdge,
      color: pickEdgeColor(rfEdge),
      strokeWidth: pickEdgeWidth(rfEdge),
      label: pickEdgeLabel(rfEdge),
      curvature
    };
  });

  // Precompute neighbors/links O(1) per hover/highlight
  const neighborsMap = new Map<string, Set<AnalysisGraphNode>>();
  const linksMap = new Map<string, AnalysisGraphLink[]>();

  for (const link of transformedLinks) {
    const s = nodeMap.get(link.source);
    const t = nodeMap.get(link.target);
    if (!s || !t) continue;
    if (s.id === t.id) continue;

    if (!neighborsMap.has(s.id)) neighborsMap.set(s.id, new Set());
    if (!neighborsMap.has(t.id)) neighborsMap.set(t.id, new Set());
    if (!linksMap.has(s.id)) linksMap.set(s.id, []);
    if (!linksMap.has(t.id)) linksMap.set(t.id, []);

    neighborsMap.get(s.id)!.add(t);
    neighborsMap.get(t.id)!.add(s);
    linksMap.get(s.id)!.push(link);
    linksMap.get(t.id)!.push(link);
  }

  for (const n of transformedNodes) {
    n.neighbors = Array.from(neighborsMap.get(n.id) ?? []);
    n.links = linksMap.get(n.id) ?? [];
  }

  return { nodes: transformedNodes, links: transformedLinks };
}

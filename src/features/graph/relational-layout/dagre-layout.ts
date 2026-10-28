import type {
  RelationalHierarchyOptions,
  RelationalLayoutEdgeInput,
  RelationalLayoutNodeInput,
  RelationalLayoutPosition
} from './types';
import dagre from 'dagre';

function bboxCenter(points: Array<{ x: number; y: number; w: number; h: number }>) {
  if (!points.length) return { cx: 0, cy: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + p.w);
    maxY = Math.max(maxY, p.y + p.h);
  }
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

export async function computeHierarchyLayout(args: {
  nodes: RelationalLayoutNodeInput[];
  edges: RelationalLayoutEdgeInput[];
  options: RelationalHierarchyOptions;
  onProgress?: (pct: number, stage: string) => void;
  signal?: AbortSignal;
}): Promise<RelationalLayoutPosition[]> {
  const onProgress = args.onProgress ?? (() => {});
  onProgress(0.05, 'init');
  if (args.signal?.aborted) throw new Error('aborted');

  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: args.options.direction,
    nodesep: args.options.nodesep,
    ranksep: args.options.ranksep,
    marginx: 20,
    marginy: 20
  });
  g.setDefaultEdgeLabel(() => ({}));

  args.nodes.forEach((n) => {
    g.setNode(n.id, { width: n.width, height: n.height });
  });
  onProgress(0.2, 'build');

  args.edges.forEach((e) => {
    if (!g.hasNode(e.source) || !g.hasNode(e.target)) return;
    if (e.source === e.target) return;
    g.setEdge(e.source, e.target);
  });
  onProgress(0.35, 'edges');
  if (args.signal?.aborted) throw new Error('aborted');

  dagre.layout(g);
  onProgress(0.9, 'layout');

  const raw: Array<{ id: string; x: number; y: number; w: number; h: number }> = args.nodes.map(
    (n) => {
      const pos = g.node(n.id) as any;
      const cx = (pos?.x as number | undefined) ?? 0;
      const cy = (pos?.y as number | undefined) ?? 0;
      const x = cx - n.width / 2;
      const y = cy - n.height / 2;
      return { id: n.id, x, y, w: n.width, h: n.height };
    }
  );

  // Center the whole layout around origin for consistent fitView
  const { cx, cy } = bboxCenter(raw);
  const out: RelationalLayoutPosition[] = raw.map((p) => ({
    id: p.id,
    x: p.x - cx,
    y: p.y - cy
  }));

  onProgress(1, 'done');
  return out;
}

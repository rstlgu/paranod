import type {
  RelationalForceOptions,
  RelationalLayoutEdgeInput,
  RelationalLayoutNodeInput,
  RelationalLayoutPosition
} from './types';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationNodeDatum
} from 'd3-force';

interface ForceNode extends SimulationNodeDatum {
  id: string;
  width: number;
  height: number;
  degree: number;
  fixed: boolean;
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function clampToMaxRadius(args: {
  nodes: ForceNode[];
  maxRadius: number;
  centerX: number;
  centerY: number;
}) {
  for (const n of args.nodes) {
    if (n.fixed) continue;
    const x = (n.x ?? 0) - args.centerX;
    const y = (n.y ?? 0) - args.centerY;
    const r = Math.hypot(x, y);
    if (!Number.isFinite(r) || r <= args.maxRadius) continue;
    const k = args.maxRadius / Math.max(1e-6, r);
    n.x = args.centerX + x * k;
    n.y = args.centerY + y * k;
  }
}

export async function computeForceLayout(args: {
  nodes: RelationalLayoutNodeInput[];
  edges: RelationalLayoutEdgeInput[];
  options: RelationalForceOptions;
  onProgress?: (pct: number, stage: string) => void;
  onTick?: (pct: number, positions: RelationalLayoutPosition[]) => void;
  signal?: AbortSignal;
  yieldToMainThread?: boolean;
}): Promise<RelationalLayoutPosition[]> {
  const onProgress = args.onProgress ?? (() => {});
  const onTick = args.onTick ?? null;
  const opts = args.options;
  const iterations = Math.max(1, Math.floor(opts.iterations));

  const nodes: ForceNode[] = args.nodes.map((n, i) => {
    const angle = (i / Math.max(1, args.nodes.length)) * Math.PI * 2;
    const seedR = 40 + (i % 13) * 6;
    const hasSeed =
      typeof (n as any).x === 'number' &&
      Number.isFinite((n as any).x) &&
      typeof (n as any).y === 'number' &&
      Number.isFinite((n as any).y);
    const seedX = hasSeed ? ((n as any).x as number) + n.width / 2 : Math.cos(angle) * seedR;
    const seedY = hasSeed ? ((n as any).y as number) + n.height / 2 : Math.sin(angle) * seedR;
    return {
      id: n.id,
      width: n.width,
      height: n.height,
      degree: n.degree,
      fixed: Boolean(n.fixed && hasSeed),
      x: seedX,
      y: seedY,
      ...(n.fixed && hasSeed ? { fx: seedX, fy: seedY } : {})
    };
  });

  // d3-force expects link objects referencing node objects or ids via .id() accessor
  const links = args.edges.map((e) => ({ source: e.source, target: e.target }));
  const fixedNodes = nodes.filter((node) => node.fixed);
  const gravityCenter = fixedNodes.length
    ? fixedNodes.reduce(
        (center, node) => ({
          x: center.x + Number(node.x ?? 0) / fixedNodes.length,
          y: center.y + Number(node.y ?? 0) / fixedNodes.length
        }),
        { x: 0, y: 0 }
      )
    : { x: 0, y: 0 };

  onProgress(0.02, 'init');

  const sim = forceSimulation(nodes);
  sim
    .force(
      'link',
      forceLink<any, any>(links)
        .id((d: any) => d.id)
        .distance(opts.linkDistance)
        .strength(0.65)
    )
    .force(
      'charge',
      forceManyBody().strength((d: any) => {
        const deg = (d as ForceNode).degree ?? 0;
        const s = opts.repulsionBase + deg * opts.repulsionDegreeFactor;
        return -Math.max(0, s);
      })
    )
    .force(
      'collide',
      forceCollide()
        .radius((d: any) => {
          const n = d as ForceNode;
          const r = Math.max(n.width, n.height) / 2;
          return r + Math.max(0, opts.collisionPadding);
        })
        .iterations(2)
    );

  if (fixedNodes.length) {
    // Incremental layout: do not recenter the whole graph around the origin.
    sim
      .force('gx', forceX(gravityCenter.x).strength(opts.gravityStrength * 0.35))
      .force('gy', forceY(gravityCenter.y).strength(opts.gravityStrength * 0.35));
  } else {
    sim
      .force('center', forceCenter(0, 0))
      .force('gx', forceX(0).strength(opts.gravityStrength))
      .force('gy', forceY(0).strength(opts.gravityStrength));
  }

  // Run deterministically via ticks (no internal timer)
  sim.stop();

  for (let i = 0; i < iterations; i++) {
    if (args.signal?.aborted) throw new Error('aborted');
    sim.tick();

    if (typeof opts.maxRadius === 'number' && Number.isFinite(opts.maxRadius) && opts.maxRadius > 0)
      clampToMaxRadius({ nodes, maxRadius: opts.maxRadius, centerX: 0, centerY: 0 });

    if (i % 8 === 0) {
      onProgress(0.05 + (i / iterations) * 0.9, 'simulate');
      if (onTick) {
        const pct = 0.05 + (i / iterations) * 0.9;
        // throttle: caller decides if to apply; we just emit at this interval
        onTick(
          pct,
          nodes.map((n) => ({
            id: n.id,
            x: (n.x ?? 0) - n.width / 2,
            y: (n.y ?? 0) - n.height / 2
          }))
        );
      }
      if (args.yieldToMainThread) await delay(0);
    }
  }

  onProgress(0.98, 'finalize');

  // Convert center-based positions to ReactFlow top-left.
  const out: RelationalLayoutPosition[] = nodes.map((n) => ({
    id: n.id,
    x: (n.x ?? 0) - n.width / 2,
    y: (n.y ?? 0) - n.height / 2
  }));

  onProgress(1, 'done');
  return out;
}

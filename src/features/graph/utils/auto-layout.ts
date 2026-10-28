/**
 * Auto Layout Utility per React Flow
 * Utilizza dagre per organizzare automaticamente i nodi del grafo
 * Supporta dimensioni dinamiche dei nodi e posizionamento radiale
 */

import dagre from 'dagre';
import { Node, Edge, Position } from 'reactflow';
import { nodeTypeByType, type NodeType } from '@/features/osint/node-registry';

export interface LayoutOptions {
  direction: 'TB' | 'BT' | 'LR' | 'RL'; // Top-Bottom, Bottom-Top, Left-Right, Right-Left
  nodeWidth?: number;
  nodeHeight?: number;
  horizontalSpacing?: number;
  verticalSpacing?: number;
  animate?: boolean;
  /**
   * Preset di densità. Se `horizontalSpacing` / `verticalSpacing` sono definiti,
   * questi vincono sui preset.
   */
  spacingPreset?: 'compact' | 'normal' | 'relaxed';
  /**
   * Qualità del layout (tradeoff tra velocità e riduzione crossing).
   */
  quality?: 'fast' | 'balanced' | 'precise';
  /**
   * Padding “virtuale” attorno ai nodi usato SOLO per il layout, per ridurre overlap
   * e lasciare spazio a handle/label.
   */
  nodePaddingPx?: number;
  /**
   * Se true, il layout tiene conto delle dimensioni delle label sugli edge (stimato).
   */
  considerEdgeLabels?: boolean;
  edgeLabelFontSizePx?: number;
  edgeLabelPaddingPx?: number;
  edgeLabelMaxWidthPx?: number;
}

function getRegistryDimensions(nodeType: string): { width: number; height: number } {
  if (nodeType in nodeTypeByType) {
    const def = nodeTypeByType[nodeType as NodeType];
    if (def.defaults?.initialSize) return def.defaults.initialSize;
  }
  return { width: 220, height: 80 };
}

const defaultOptions: LayoutOptions = {
  direction: 'TB',
  nodeWidth: 220,
  nodeHeight: 80,
  spacingPreset: 'normal',
  quality: 'balanced',
  horizontalSpacing: 120, // fallback (se non usi preset)
  verticalSpacing: 60, // fallback (se non usi preset)
  nodePaddingPx: 16,
  considerEdgeLabels: true,
  edgeLabelFontSizePx: 12,
  edgeLabelPaddingPx: 8,
  edgeLabelMaxWidthPx: 240,
  animate: true
};

function getEdgeLabelText(edge: Edge): string {
  const edgeData = edge.data as { label?: unknown } | undefined;
  if (typeof edgeData?.label === 'string') return edgeData.label.trim();
  if (typeof edge.label === 'string') return edge.label.trim();
  return '';
}

function clampNumber(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function estimateEdgeLabelSize(
  label: string,
  opts: LayoutOptions
): { width: number; height: number } | null {
  const text = label.trim();
  if (!text) return null;

  const fontSizePx = opts.edgeLabelFontSizePx ?? 12;
  const paddingPx = opts.edgeLabelPaddingPx ?? 8;
  const maxWidthPx = opts.edgeLabelMaxWidthPx ?? 240;

  // Stima veloce: larghezza ~ chars * fontSize * factor.
  // (Misura “perfetta” richiede DOM/canvas, ma qui serve solo per spacing.)
  const approxCharWidth = fontSizePx * 0.6;
  const rawWidth = text.length * approxCharWidth + paddingPx * 2;
  const width = clampNumber(rawWidth, paddingPx * 2 + 16, maxWidthPx);
  const height = fontSizePx * 1.35 + paddingPx * 2;
  return { width, height };
}

function resolveSpacing(opts: LayoutOptions): {
  horizontalSpacing: number;
  verticalSpacing: number;
} {
  if (
    typeof opts.horizontalSpacing === 'number' &&
    typeof opts.verticalSpacing === 'number'
  ) {
    return {
      horizontalSpacing: opts.horizontalSpacing,
      verticalSpacing: opts.verticalSpacing
    };
  }

  const preset = opts.spacingPreset ?? 'normal';
  if (preset === 'compact') return { horizontalSpacing: 90, verticalSpacing: 45 };
  if (preset === 'relaxed') return { horizontalSpacing: 160, verticalSpacing: 90 };
  return { horizontalSpacing: 120, verticalSpacing: 60 };
}

function resolveRanker(
  quality: LayoutOptions['quality']
): 'tight-tree' | 'network-simplex' | 'longest-path' {
  if (quality === 'fast') return 'tight-tree';
  if (quality === 'precise') return 'network-simplex';
  return 'network-simplex';
}

function buildAdjacency(nodes: Node[], edges: Edge[]): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  nodes.forEach((n) => adjacency.set(n.id, new Set()));
  edges.forEach((e) => {
    if (!adjacency.has(e.source) || !adjacency.has(e.target)) return;
    adjacency.get(e.source)!.add(e.target);
    adjacency.get(e.target)!.add(e.source);
  });
  return adjacency;
}

function computeLevelsFromRoot(args: {
  rootNodeId: string;
  nodes: Node[];
  edges: Edge[];
  maxDepth?: number;
}): Map<string, number> {
  const { rootNodeId, nodes, edges } = args;
  const maxDepth = args.maxDepth ?? 50;

  const nodeIdSet = new Set(nodes.map((n) => n.id));
  if (!nodeIdSet.has(rootNodeId)) return new Map();

  const adjacency = buildAdjacency(nodes, edges);
  const levels = new Map<string, number>();

  const queue: Array<{ id: string; level: number }> = [
    { id: rootNodeId, level: 0 }
  ];
  levels.set(rootNodeId, 0);

  while (queue.length) {
    const cur = queue.shift()!;
    if (cur.level >= maxDepth) continue;

    const neighbors = adjacency.get(cur.id);
    if (!neighbors) continue;

    neighbors.forEach((nextId) => {
      if (!nodeIdSet.has(nextId)) return;
      if (levels.has(nextId)) return;
      levels.set(nextId, cur.level + 1);
      queue.push({ id: nextId, level: cur.level + 1 });
    });
  }

  return levels;
}

export function getHierarchicalLayoutedElements(args: {
  nodes: Node[];
  edges: Edge[];
  rootNodeId: string;
  options?: Partial<LayoutOptions>;
}): { nodes: Node[]; edges: Edge[] } {
  const opts: LayoutOptions = { ...defaultOptions, ...(args.options ?? {}) };
  if (args.nodes.length === 0) return { nodes: [], edges: [] };

  const levels = computeLevelsFromRoot({
    rootNodeId: args.rootNodeId,
    nodes: args.nodes,
    edges: args.edges
  });

  // Fallback: se root non valido, usa il layout standard.
  if (!levels.size) return getLayoutedElements(args.nodes, args.edges, opts);

  const { horizontalSpacing, verticalSpacing } = resolveSpacing(opts);
  const nodePaddingPx = opts.nodePaddingPx ?? 16;
  const ranker = resolveRanker(opts.quality);

  const nodeDimensions = new Map<string, { width: number; height: number }>();
  args.nodes.forEach((node) => nodeDimensions.set(node.id, getNodeDimensions(node)));

  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({
    rankdir: opts.direction,
    nodesep: horizontalSpacing + 10,
    ranksep: verticalSpacing + 10,
    marginx: 10,
    marginy: 10,
    align: 'UL',
    ranker
  });

  const reachableNodes = args.nodes.filter((n) => levels.has(n.id));
  const reachableNodeIdSet = new Set(reachableNodes.map((n) => n.id));

  reachableNodes.forEach((node) => {
    const dims = nodeDimensions.get(node.id)!;
    dagreGraph.setNode(node.id, {
      width: dims.width + nodePaddingPx * 2,
      height: dims.height + nodePaddingPx * 2
    });
  });

  // Archi “strict”: livello i -> livello i+1 (invertendo se serve) per evitare cicli.
  args.edges.forEach((edge) => {
    if (!reachableNodeIdSet.has(edge.source) || !reachableNodeIdSet.has(edge.target)) return;
    const ls = levels.get(edge.source);
    const lt = levels.get(edge.target);
    if (typeof ls !== 'number' || typeof lt !== 'number') return;

    function setEdge(from: string, to: string) {
      if (opts.considerEdgeLabels) {
        const labelText = getEdgeLabelText(edge);
        const labelSize = estimateEdgeLabelSize(labelText, opts);
        if (labelSize) {
          dagreGraph.setEdge(from, to, {
            width: labelSize.width,
            height: labelSize.height,
            labelpos: 'c',
            labeloffset: 0
          });
          return;
        }
      }
      dagreGraph.setEdge(from, to);
    }

    if (lt === ls + 1) {
      setEdge(edge.source, edge.target);
      return;
    }

    if (ls === lt + 1) {
      setEdge(edge.target, edge.source);
    }
  });

  dagre.layout(dagreGraph);

  const positions = new Map<string, { x: number; y: number }>();
  reachableNodes.forEach((node) => {
    const pos = dagreGraph.node(node.id);
    const dims = nodeDimensions.get(node.id)!;
    const layoutWidth = dims.width + nodePaddingPx * 2;
    const layoutHeight = dims.height + nodePaddingPx * 2;
    positions.set(node.id, {
      x: pos.x - layoutWidth / 2 + nodePaddingPx,
      y: pos.y - layoutHeight / 2 + nodePaddingPx
    });
  });

  const { sourcePosition, targetPosition } = getHandlePositions(opts.direction);

  // Mantieni il root “ancorato” alla posizione corrente per evitare salti eccessivi.
  const rootNode = args.nodes.find((n) => n.id === args.rootNodeId);
  const rootPos = rootNode?.position ?? { x: 0, y: 0 };
  const layoutRootPos = positions.get(args.rootNodeId) ?? rootPos;
  const delta = { x: rootPos.x - layoutRootPos.x, y: rootPos.y - layoutRootPos.y };

  const layoutedNodes = args.nodes.map((node) => {
    const p = positions.get(node.id);
    if (!p) return { ...node, sourcePosition, targetPosition };
    return {
      ...node,
      position: { x: p.x + delta.x, y: p.y + delta.y },
      sourcePosition,
      targetPosition
    };
  });

  return { nodes: layoutedNodes, edges: args.edges };
}

/**
 * Ottiene le dimensioni effettive di un nodo
 */
function getNodeDimensions(node: Node): { width: number; height: number } {
  // Se il nodo ha dimensioni esplicite nello style, usa quelle
  if (node.style?.width && node.style?.height) {
    return {
      width:
        typeof node.style.width === 'number'
          ? node.style.width
          : parseInt(node.style.width as string) || 220,
      height:
        typeof node.style.height === 'number'
          ? node.style.height
          : parseInt(node.style.height as string) || 80
    };
  }

  // Se il nodo ha width/height diretti
  if (node.width && node.height) {
    return { width: node.width, height: node.height };
  }

  // Altrimenti usa le dimensioni basate sul tipo
  const nodeType = (node.data as { type?: string })?.type || 'default';
  return getRegistryDimensions(nodeType);
}

/**
 * Calcola le posizioni per il layout source/target handle in base alla direzione
 */
function getHandlePositions(direction: LayoutOptions['direction']): {
  sourcePosition: Position;
  targetPosition: Position;
} {
  switch (direction) {
    case 'TB':
      return { sourcePosition: Position.Bottom, targetPosition: Position.Top };
    case 'BT':
      return { sourcePosition: Position.Top, targetPosition: Position.Bottom };
    case 'LR':
      return { sourcePosition: Position.Right, targetPosition: Position.Left };
    case 'RL':
      return { sourcePosition: Position.Left, targetPosition: Position.Right };
    default:
      return { sourcePosition: Position.Bottom, targetPosition: Position.Top };
  }
}

/**
 * Trova i componenti connessi nel grafo
 */
function findConnectedComponents(nodes: Node[], edges: Edge[]): Node[][] {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const visited = new Set<string>();
  const components: Node[][] = [];

  // Costruisci la mappa di adiacenza (bidirezionale)
  const adjacency = new Map<string, Set<string>>();
  nodes.forEach((n) => adjacency.set(n.id, new Set()));

  edges.forEach((edge) => {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      adjacency.get(edge.source)?.add(edge.target);
      adjacency.get(edge.target)?.add(edge.source);
    }
  });

  // BFS per trovare componenti
  function bfs(startId: string): string[] {
    const component: string[] = [];
    const queue = [startId];
    let queueIndex = 0;
    visited.add(startId);

    while (queueIndex < queue.length) {
      const nodeId = queue[queueIndex++]!;
      component.push(nodeId);

      const neighbors = adjacency.get(nodeId) || new Set();
      neighbors.forEach((neighborId) => {
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          queue.push(neighborId);
        }
      });
    }

    return component;
  }

  // Trova tutti i componenti
  nodes.forEach((node) => {
    if (!visited.has(node.id)) {
      const componentIds = bfs(node.id);
      const componentNodes = componentIds
        .map((id) => nodeById.get(id))
        .filter(Boolean) as Node[];
      components.push(componentNodes);
    }
  });

  // Ordina per dimensione (più grande prima)
  components.sort((a, b) => b.length - a.length);

  return components;
}

/**
 * Applica il layout dagre a un singolo componente
 */
function layoutComponent(
  nodes: Node[],
  edges: Edge[],
  options: LayoutOptions,
  nodeDimensions: Map<string, { width: number; height: number }>
): Map<string, { x: number; y: number }> {
  const { horizontalSpacing, verticalSpacing } = resolveSpacing(options);
  const nodePaddingPx = options.nodePaddingPx ?? 16;
  const ranker = resolveRanker(options.quality);

  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  dagreGraph.setGraph({
    rankdir: options.direction,
    nodesep: horizontalSpacing + 10,
    ranksep: verticalSpacing + 10,
    marginx: 10,
    marginy: 10,
    align: 'UL',
    ranker
  });

  const nodeIdSet = new Set(nodes.map((n) => n.id));

  nodes.forEach((node) => {
    const dims = nodeDimensions.get(node.id)!;
    dagreGraph.setNode(node.id, {
      width: dims.width + nodePaddingPx * 2,
      height: dims.height + nodePaddingPx * 2
    });
  });

  edges.forEach((edge) => {
    if (nodeIdSet.has(edge.source) && nodeIdSet.has(edge.target)) {
      if (options.considerEdgeLabels) {
        const labelText = getEdgeLabelText(edge);
        const labelSize = estimateEdgeLabelSize(labelText, options);
        if (labelSize) {
          dagreGraph.setEdge(edge.source, edge.target, {
            width: labelSize.width,
            height: labelSize.height,
            labelpos: 'c',
            labeloffset: 0
          });
          return;
        }
      }

      dagreGraph.setEdge(edge.source, edge.target);
    }
  });

  dagre.layout(dagreGraph);

  const positions = new Map<string, { x: number; y: number }>();
  nodes.forEach((node) => {
    const pos = dagreGraph.node(node.id);
    const dims = nodeDimensions.get(node.id)!;
    const layoutWidth = dims.width + nodePaddingPx * 2;
    const layoutHeight = dims.height + nodePaddingPx * 2;
    positions.set(node.id, {
      x: pos.x - layoutWidth / 2 + nodePaddingPx,
      y: pos.y - layoutHeight / 2 + nodePaddingPx
    });
  });

  return positions;
}

/**
 * Calcola il bounding box di un set di posizioni
 */
function getBoundingBox(
  positions: Map<string, { x: number; y: number }>,
  nodeDimensions: Map<string, { width: number; height: number }>
): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
} {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  positions.forEach((pos, nodeId) => {
    const dims = nodeDimensions.get(nodeId) || { width: 220, height: 80 };
    minX = Math.min(minX, pos.x);
    minY = Math.min(minY, pos.y);
    maxX = Math.max(maxX, pos.x + dims.width);
    maxY = Math.max(maxY, pos.y + dims.height);
  });

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY
  };
}

/**
 * Applica il layout dagre ai nodi usando le dimensioni effettive
 * con spaziatura ottimizzata e gestione dei componenti disconnessi
 */
export function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  options: Partial<LayoutOptions> = {}
): { nodes: Node[]; edges: Edge[] } {
  const opts: LayoutOptions = { ...defaultOptions, ...options };

  if (nodes.length === 0) {
    return { nodes: [], edges: [] };
  }

  // Mappa delle dimensioni per ogni nodo
  const nodeDimensions = new Map<string, { width: number; height: number }>();
  nodes.forEach((node) => {
    nodeDimensions.set(node.id, getNodeDimensions(node));
  });

  // Trova i componenti connessi
  const components = findConnectedComponents(nodes, edges);

  // Se c'è un solo componente, usa il layout standard
  if (components.length === 1) {
    const positions = layoutComponent(nodes, edges, opts, nodeDimensions);
    const { sourcePosition, targetPosition } = getHandlePositions(
      opts.direction
    );

    const layoutedNodes = nodes.map((node) => ({
      ...node,
      position: positions.get(node.id) || node.position,
      sourcePosition,
      targetPosition
    }));

    return { nodes: layoutedNodes, edges };
  }

  // Layout per ogni componente e poi posizionali vicini
  const allPositions = new Map<string, { x: number; y: number }>();
  const componentSpacing = 80; // Spazio tra componenti

  let currentX = 0;
  let currentY = 0;
  let rowHeight = 0;
  const maxRowWidth = 2000; // Larghezza massima prima di andare a capo

  components.forEach((componentNodes) => {
    const componentNodeIds = new Set(componentNodes.map((node) => node.id));
    const componentEdges = edges.filter(
      (e) =>
        componentNodeIds.has(e.source) && componentNodeIds.has(e.target)
    );

    // Layout del singolo componente
    const positions = layoutComponent(
      componentNodes,
      componentEdges,
      opts,
      nodeDimensions
    );
    const bbox = getBoundingBox(positions, nodeDimensions);

    // Controlla se dobbiamo andare a capo
    if (currentX > 0 && currentX + bbox.width > maxRowWidth) {
      currentX = 0;
      currentY += rowHeight + componentSpacing;
      rowHeight = 0;
    }

    // Sposta il componente alla posizione corrente
    const offsetX = currentX - bbox.minX;
    const offsetY = currentY - bbox.minY;

    positions.forEach((pos, nodeId) => {
      allPositions.set(nodeId, {
        x: pos.x + offsetX,
        y: pos.y + offsetY
      });
    });

    // Aggiorna la posizione per il prossimo componente
    currentX += bbox.width + componentSpacing;
    rowHeight = Math.max(rowHeight, bbox.height);
  });

  const { sourcePosition, targetPosition } = getHandlePositions(opts.direction);

  const layoutedNodes = nodes.map((node) => ({
    ...node,
    position: allPositions.get(node.id) || node.position,
    sourcePosition,
    targetPosition
  }));

  return { nodes: layoutedNodes, edges };
}

/**
 * Interfaccia per rappresentare un rettangolo (bounding box)
 */
interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function getRectForNode(node: Node): Rect {
  const dims = getNodeDimensions(node);
  return { x: node.position.x, y: node.position.y, width: dims.width, height: dims.height };
}

function resolveTransformSpacingPreset(
  preset: LayoutOptions['spacingPreset']
): {
  siblingGapPx: number;
  levelGapPx: number;
  paddingPx: number;
} {
  if (preset === 'compact') {
    return { siblingGapPx: 32, levelGapPx: 120, paddingPx: 18 };
  }
  if (preset === 'relaxed') {
    return { siblingGapPx: 56, levelGapPx: 210, paddingPx: 24 };
  }
  return { siblingGapPx: 40, levelGapPx: 160, paddingPx: 20 };
}

function applyUniformOffset(
  nodes: Node[],
  offset: { x: number; y: number }
): Node[] {
  return nodes.map((n) => ({
    ...n,
    position: { x: n.position.x + offset.x, y: n.position.y + offset.y }
  }));
}

function hasAnyOverlaps(
  existingRects: Rect[],
  newNodes: Node[],
  padding: number
): boolean {
  const newRects = newNodes.map((n) => getRectForNode(n));

  for (let i = 0; i < newRects.length; i++) {
    const a = newRects[i];

    // Overlap with existing
    if (existingRects.some((b) => rectsOverlap(a, b, padding))) return true;

    // Overlap with siblings
    for (let j = 0; j < i; j++) {
      if (rectsOverlap(a, newRects[j], padding)) return true;
    }
  }

  return false;
}

export function positionTransformResultNodes(args: {
  existingNodes: Node[];
  newNodes: Node[];
  anchorNodeId?: string;
  anchorPosition?: { x: number; y: number };
  direction: 'down' | 'right';
  spacingPreset?: LayoutOptions['spacingPreset'];
}): Node[] {
  if (args.newNodes.length === 0) return [];

  const preset = args.spacingPreset ?? 'normal';
  const { siblingGapPx, levelGapPx, paddingPx } =
    resolveTransformSpacingPreset(preset);

  const anchorNode = args.anchorNodeId
    ? args.existingNodes.find((n) => n.id === args.anchorNodeId)
    : undefined;

  const anchorRect = anchorNode
    ? getRectForNode(anchorNode)
    : {
        x: args.anchorPosition?.x ?? 0,
        y: args.anchorPosition?.y ?? 0,
        width: 220,
        height: 80
      };

  const newDims = args.newNodes.map((n) => getNodeDimensions(n));
  const maxWidth = Math.max(...newDims.map((d) => d.width));
  const maxHeight = Math.max(...newDims.map((d) => d.height));

  let placed: Node[] = [];

  if (args.direction === 'down') {
    const totalWidth =
      newDims.reduce((sum, d) => sum + d.width, 0) +
      (args.newNodes.length - 1) * siblingGapPx;
    const startX = anchorRect.x + anchorRect.width / 2 - totalWidth / 2;
    const startY = anchorRect.y + anchorRect.height + levelGapPx;

    let x = startX;
    placed = args.newNodes.map((n, i) => {
      const dims = newDims[i];
      const y = startY + (maxHeight - dims.height) / 2;
      const next = { ...n, position: { x, y } };
      x += dims.width + siblingGapPx;
      return next;
    });
  } else {
    const totalHeight =
      newDims.reduce((sum, d) => sum + d.height, 0) +
      (args.newNodes.length - 1) * siblingGapPx;
    const startX = anchorRect.x + anchorRect.width + levelGapPx;
    const startY = anchorRect.y + anchorRect.height / 2 - totalHeight / 2;

    let y = startY;
    placed = args.newNodes.map((n, i) => {
      const dims = newDims[i];
      const x = startX + (maxWidth - dims.width) / 2;
      const next = { ...n, position: { x, y } };
      y += dims.height + siblingGapPx;
      return next;
    });
  }

  // Anti-overlap: se collide, shifta tutto il blocco lungo l'asse principale
  const existingRects = args.existingNodes.map((n) => getRectForNode(n));
  const step =
    args.direction === 'down'
      ? Math.max(80, maxHeight + 40)
      : Math.max(120, maxWidth + 80);

  let attempt = 0;
  let result = placed;
  while (attempt < 25 && hasAnyOverlaps(existingRects, result, paddingPx)) {
    attempt += 1;
    result =
      args.direction === 'down'
        ? applyUniformOffset(placed, { x: 0, y: step * attempt })
        : applyUniformOffset(placed, { x: step * attempt, y: 0 });
  }

  return result;
}

export function getLockedLaneLayout(args: {
  nodes: Node[];
  edges: Edge[];
  axis: 'vertical' | 'horizontal';
  spacingPreset?: LayoutOptions['spacingPreset'];
  /**
   * Ordering key per-node (derivato dal layout locked precedente) per evitare
   * che l'aggiunta di nuovi nodi faccia "invertire" root o rimescoli l'ordine.
   */
  stableOrderById?: Record<string, number>;
}): {
  nodes: Node[];
  lanes: {
    axis: 'vertical' | 'horizontal';
    positionsPx: number[];
    stepPx: number;
    anchorPx: number;
  };
} {
  if (args.nodes.length === 0) {
    return {
      nodes: [],
      lanes: { axis: args.axis, positionsPx: [], stepPx: 360, anchorPx: 0 }
    };
  }

  const direction: LayoutOptions['direction'] =
    args.axis === 'vertical' ? 'LR' : 'TB';

  const base = getLayoutedElements(args.nodes, args.edges, {
    direction,
    spacingPreset: args.spacingPreset ?? 'normal',
    quality: 'precise',
    considerEdgeLabels: true,
    nodePaddingPx: 18
  }).nodes;

  // LOCKED lanes devono rappresentare livelli topologici (depth) e NON cluster su coordinate.
  // Questo garantisce che figli di più root (es: facebook/google) finiscano sullo stesso livello.
  const { siblingGapPx } = resolveTransformSpacingPreset(args.spacingPreset ?? 'normal');

  const childrenById = new Map<string, string[]>();
  const parentsById = new Map<string, string[]>();
  args.nodes.forEach((n) => {
    childrenById.set(n.id, []);
    parentsById.set(n.id, []);
  });
  args.edges.forEach((e) => {
    if (!childrenById.has(e.source) || !childrenById.has(e.target)) return;
    childrenById.get(e.source)!.push(e.target);
    parentsById.get(e.target)!.push(e.source);
  });

  const rootIds = args.nodes
    .filter((n) => (parentsById.get(n.id) ?? []).length === 0)
    .map((n) => n.id);

  const depthById = new Map<string, number>();
  const queue: string[] = [];
  let queueIndex = 0;
  const rootsToUse = rootIds.length ? rootIds : [args.nodes[0]!.id];
  rootsToUse.forEach((id) => {
    depthById.set(id, 0);
    queue.push(id);
  });

  while (queueIndex < queue.length) {
    const id = queue[queueIndex++]!;
    const d = depthById.get(id) ?? 0;
    const children = childrenById.get(id) ?? [];
    children.forEach((cid) => {
      const next = d + 1;
      const prev = depthById.get(cid);
      if (typeof prev === 'number' && prev <= next) return;
      depthById.set(cid, next);
      queue.push(cid);
    });
  }

  // lane = depth (compact by construction)
  const laneKeysById = new Map<string, number>();
  args.nodes.forEach((n) => laneKeysById.set(n.id, depthById.get(n.id) ?? 0));

  // Calcola per-lane dimensioni max (serve per step fisso tra lanes)
  const laneMaxPrimary = new Map<number, number>(); // width per vertical, height per horizontal
  base.forEach((n) => {
    const lane = laneKeysById.get(n.id) ?? 0;
    const dims = getNodeDimensions(n);
    const primary = args.axis === 'vertical' ? dims.width : dims.height;
    laneMaxPrimary.set(lane, Math.max(laneMaxPrimary.get(lane) ?? 0, primary));
  });

  const overallLanePrimaryMax = Math.max(...Array.from(laneMaxPrimary.values()), 220);
  const preset = args.spacingPreset ?? 'normal';
  const laneGapBase =
    preset === 'compact' ? 120 : preset === 'relaxed' ? 220 : 160;

  // Step fisso per evitare “buchi”/salti tra livelli (specie in verticale).
  const laneStepPx = overallLanePrimaryMax + laneGapBase;
  const laneCentersPx = new Map<number, number>();
  Array.from(laneMaxPrimary.keys()).forEach((lane) => {
    laneCentersPx.set(lane, lane * laneStepPx + laneStepPx / 2);
  });

  // Costruisci nodi finali: spiedino per lane (una coordinata fissa), stack sull’altra.
  const nodesByLane = new Map<number, Node[]>();
  base.forEach((n) => {
    const lane = laneKeysById.get(n.id) ?? 0;
    const arr = nodesByLane.get(lane) ?? [];
    arr.push(n);
    nodesByLane.set(lane, arr);
  });

  const laneIdsSorted = Array.from(nodesByLane.keys()).sort((a, b) => a - b);
  const laneById = new Map<string, number>();
  laneKeysById.forEach((v, k) => laneById.set(k, v));

  // Per allineare i parent ai figli, posizioniamo prima l'ultima lane e poi risaliamo (bottom-up).
  const resultById = new Map<string, Node>();

  // Spaziatura interna in modalità locked: più “compatta” del preset transforms.
  const lockedGapPx =
    preset === 'compact' ? 18 : preset === 'relaxed' ? 36 : 24;
  const lockedGroupGapPx = lockedGapPx * 2;

  function sizeAlongAxis(node: Node) {
    const dims = getNodeDimensions(node);
    return args.axis === 'vertical' ? dims.height : dims.width;
  }

  function centerAlongAxis(node: Node) {
    const dims = getNodeDimensions(node);
    return args.axis === 'vertical'
      ? node.position.y + dims.height / 2
      : node.position.x + dims.width / 2;
  }

  function setAxisPosition(node: Node, coordCenter: number, laneCenter: number): Node {
    const dims = getNodeDimensions(node);
    if (args.axis === 'vertical') {
      return { ...node, position: { x: laneCenter - dims.width / 2, y: coordCenter - dims.height / 2 } };
    }
    return { ...node, position: { x: coordCenter - dims.width / 2, y: laneCenter - dims.height / 2 } };
  }

  // init: ultima lane -> usa la posizione base (ordinata), poi pack senza overlap
  for (let idxLane = laneIdsSorted.length - 1; idxLane >= 0; idxLane--) {
    const lane = laneIdsSorted[idxLane]!;
    const laneCenter = laneCentersPx.get(lane) ?? 0;
    const laneNodes = (nodesByLane.get(lane) ?? []).slice();

    // desired center: se abbiamo già la lane successiva posizionata, usa baricentro figli,
    // altrimenti usa la coordinate base.
    const desiredById = new Map<string, number>();
    laneNodes.forEach((n) => {
      const children = childrenById.get(n.id) ?? [];
      const childCenters: number[] = [];
      children.forEach((cid) => {
        const ln = laneById.get(cid);
        if (typeof ln !== 'number') return;
        if (ln <= lane) return;
        const placed = resultById.get(cid);
        if (!placed) return;
        childCenters.push(centerAlongAxis(placed));
      });
      if (childCenters.length) {
        const avg = childCenters.reduce((s, v) => s + v, 0) / childCenters.length;
        desiredById.set(n.id, avg);
      } else {
        desiredById.set(n.id, args.axis === 'vertical' ? n.position.y : n.position.x);
      }
    });

    // Root nodes (lane 0): se un root NON ha figli ancora, non deve finire "sparso" lontano.
    // Lo ancoriamo vicino al cluster degli altri root, ma appena ha figli tornerà a centrarsi su di essi.
    if (lane === 0 && rootIds.length) {
      const rootsInLane = laneNodes.filter((n) => rootIds.includes(n.id));
      if (rootsInLane.length >= 2) {
        const rootsWithChildren = rootsInLane.filter(
          (n) => (childrenById.get(n.id) ?? []).length > 0
        );
        const anchorCandidates = (rootsWithChildren.length ? rootsWithChildren : rootsInLane).map(
          (n) => desiredById.get(n.id) ?? (args.axis === 'vertical' ? n.position.y : n.position.x)
        );
        const anchor =
          anchorCandidates.reduce((s, v) => s + v, 0) / Math.max(1, anchorCandidates.length);
        rootsInLane.forEach((n) => {
          if ((childrenById.get(n.id) ?? []).length === 0) desiredById.set(n.id, anchor);
        });
      }
    }

    // Grouping: evita che figli di due padri diversi “si sovrappongano/mischino”.
    // Raggruppiamo per parent nella lane precedente (depth-1). In lane 0, impacchettiamo tutti i root vicini.
    const groups = new Map<string, Node[]>();
    const groupOrderKey = new Map<string, number>();
    const baseById = new Map<string, Node>();
    base.forEach((n) => baseById.set(n.id, n));

    const primaryParentId = (node: Node): string | null => {
      if (lane === 0) return null;
      const parents = parentsById.get(node.id) ?? [];
      if (!parents.length) return null;
      // preferisci parent nella lane immediatamente precedente (depth-1). Se più, scegli quello "più vicino" alla desired.
      const desired = desiredById.get(node.id) ?? 0;
      let best: string | null = null;
      let bestDist = Infinity;
      parents.forEach((pid) => {
        if ((laneById.get(pid) ?? -999) !== lane - 1) return;
        const baseParent = baseById.get(pid);
        const coord =
          baseParent
            ? args.axis === 'vertical'
              ? baseParent.position.y
              : baseParent.position.x
            : 0;
        const dist = Math.abs(coord - desired);
        if (dist < bestDist) {
          bestDist = dist;
          best = pid;
        }
      });
      return best;
    };

    laneNodes.forEach((n) => {
      const pid = primaryParentId(n);
      const key = pid ?? `__ungrouped__:${n.id}`;
      const arr = groups.get(key) ?? [];
      arr.push(n);
      groups.set(key, arr);

      // Ordine dei gruppi: usa la coordinata base del parent se disponibile,
      // altrimenti la desired del nodo.
      if (!groupOrderKey.has(key)) {
        const baseParent = pid ? baseById.get(pid) : undefined;
        const k =
          baseParent
            ? args.axis === 'vertical'
              ? baseParent.position.y
              : baseParent.position.x
            : desiredById.get(n.id)!;
        groupOrderKey.set(key, k);
      }
    });

    const groupKeys = Array.from(groups.keys()).sort((a, b) => {
      const ka = groupOrderKey.get(a) ?? 0;
      const kb = groupOrderKey.get(b) ?? 0;
      if (ka !== kb) return ka - kb;
      return a.localeCompare(b);
    });

    // Calcola desired center per gruppo e size del gruppo
    const groupDesiredCenter = new Map<string, number>();
    const groupHalfSize = new Map<string, number>();
    groupKeys.forEach((key) => {
      // Mantieni ordine stabile quando possibile, altrimenti usa desired.
      const stable = args.stableOrderById ?? {};
      const ns = (groups.get(key) ?? [])
        .slice()
        .sort((a, b) => {
          const sa = stable[a.id];
          const sb = stable[b.id];
          if (typeof sa === 'number' && typeof sb === 'number' && sa !== sb) return sa - sb;
          const da = desiredById.get(a.id) ?? 0;
          const db = desiredById.get(b.id) ?? 0;
          if (da !== db) return da - db;
          return a.id.localeCompare(b.id);
        });
      groups.set(key, ns);
      const total = ns.reduce((sum, n) => sum + sizeAlongAxis(n), 0) + Math.max(0, ns.length - 1) * lockedGapPx;
      groupHalfSize.set(key, total / 2);
      const avgDesired = ns.reduce((s, n) => s + (desiredById.get(n.id) ?? 0), 0) / Math.max(1, ns.length);
      groupDesiredCenter.set(key, avgDesired);
    });

    // Ordine gruppi stabile: usa stableOrderById quando disponibile
    const stable = args.stableOrderById ?? {};
    const groupSortKey = (key: string): number => {
      const repId = key.startsWith('__ungrouped__:') ? key.split(':')[1] ?? key : key;
      const sk = stable[repId];
      if (typeof sk === 'number') return sk;
      return groupOrderKey.get(key) ?? groupDesiredCenter.get(key) ?? 0;
    };
    groupKeys.sort((a, b) => {
      const ka = groupSortKey(a);
      const kb = groupSortKey(b);
      if (ka !== kb) return ka - kb;
      return a.localeCompare(b);
    });

    // Posiziona i gruppi in 1D evitando overlap tra gruppi (non tra singoli nodi)
    const groupCenters = new Map<string, number>();
    groupKeys.forEach((key) => groupCenters.set(key, groupDesiredCenter.get(key) ?? 0));

    // forward
    for (let i = 1; i < groupKeys.length; i++) {
      const prevKey = groupKeys[i - 1]!;
      const curKey = groupKeys[i]!;
      const prevC = groupCenters.get(prevKey)!;
      const curC = groupCenters.get(curKey)!;
      const minC =
        prevC + (groupHalfSize.get(prevKey) ?? 0) + lockedGroupGapPx + (groupHalfSize.get(curKey) ?? 0);
      if (curC < minC) groupCenters.set(curKey, minC);
    }
    // backward
    for (let i = groupKeys.length - 2; i >= 0; i--) {
      const curKey = groupKeys[i]!;
      const nextKey = groupKeys[i + 1]!;
      const curC = groupCenters.get(curKey)!;
      const nextC = groupCenters.get(nextKey)!;
      const maxC =
        nextC - (groupHalfSize.get(nextKey) ?? 0) - lockedGroupGapPx - (groupHalfSize.get(curKey) ?? 0);
      if (curC > maxC) groupCenters.set(curKey, maxC);
    }

    // Posiziona i nodi all'interno di ogni gruppo, packed
    groupKeys.forEach((key) => {
      const ns = groups.get(key) ?? [];
      const center = groupCenters.get(key) ?? 0;
      const total = (groupHalfSize.get(key) ?? 0) * 2;
      let cursor = center - total / 2;
      ns.forEach((n) => {
        const sz = sizeAlongAxis(n);
        const nodeCenter = cursor + sz / 2;
        cursor += sz + lockedGapPx;
        resultById.set(n.id, setAxisPosition(n, nodeCenter, laneCenter));
      });
    });
  }

  // Pass top-down: sposta i gruppi di figli verso il parent se c'è spazio libero sul livello,
  // evitando overlap tra gruppi (i parent possono allontanarsi tra loro).
  const groupGap = lockedGroupGapPx;
  for (let lane = 1; lane <= Math.max(...laneIdsSorted); lane++) {
    const laneCenter = laneCentersPx.get(lane) ?? 0;
    const laneNodes = (nodesByLane.get(lane) ?? []).slice();
    if (!laneNodes.length) continue;

    // Raggruppa per parent nella lane precedente
    const groups = new Map<string, Node[]>();
    laneNodes.forEach((n) => {
      const parents = parentsById.get(n.id) ?? [];
      let bestParent: string | null = null;
      let bestDist = Infinity;
      const desired = centerAlongAxis(resultById.get(n.id) ?? n);
      parents.forEach((pid) => {
        if ((laneById.get(pid) ?? -999) !== lane - 1) return;
        const placedParent = resultById.get(pid);
        if (!placedParent) return;
        const dist = Math.abs(centerAlongAxis(placedParent) - desired);
        if (dist < bestDist) {
          bestDist = dist;
          bestParent = pid;
        }
      });
      const key = bestParent ?? `__ungrouped__:${n.id}`;
      const arr = groups.get(key) ?? [];
      arr.push(n);
      groups.set(key, arr);
    });

    const keys = Array.from(groups.keys());
    const groupHalf = new Map<string, number>();
    const groupCurrent = new Map<string, number>();
    const groupTarget = new Map<string, number>();
    keys.forEach((k) => {
      const ns = groups.get(k) ?? [];
      const total =
        ns.reduce((sum, n) => sum + sizeAlongAxis(n), 0) +
        Math.max(0, ns.length - 1) * lockedGapPx;
      groupHalf.set(k, total / 2);
      const cur =
        ns.reduce((s, n) => s + centerAlongAxis(resultById.get(n.id) ?? n), 0) /
        Math.max(1, ns.length);
      groupCurrent.set(k, cur);
      if (!k.startsWith('__ungrouped__')) {
        const parent = resultById.get(k);
        if (parent) groupTarget.set(k, centerAlongAxis(parent));
        else groupTarget.set(k, cur);
      } else {
        groupTarget.set(k, cur);
      }
    });

    const stable = args.stableOrderById ?? {};
    const keyStable = (k: string): number => {
      const repId = k.startsWith('__ungrouped__:') ? k.split(':')[1] ?? k : k;
      const sk = stable[repId];
      if (typeof sk === 'number') return sk;
      return groupCurrent.get(k) ?? 0;
    };
    const orderedKeys = keys.sort((a, b) => {
      const ka = keyStable(a);
      const kb = keyStable(b);
      if (ka !== kb) return ka - kb;
      return a.localeCompare(b);
    });
    const centers = new Map<string, number>();
    orderedKeys.forEach((k) => centers.set(k, groupTarget.get(k)!));

    // forward constraint
    for (let i = 1; i < orderedKeys.length; i++) {
      const prev = orderedKeys[i - 1]!;
      const cur = orderedKeys[i]!;
      const minC =
        centers.get(prev)! +
        (groupHalf.get(prev) ?? 0) +
        groupGap +
        (groupHalf.get(cur) ?? 0);
      if (centers.get(cur)! < minC) centers.set(cur, minC);
    }
    // backward constraint
    for (let i = orderedKeys.length - 2; i >= 0; i--) {
      const cur = orderedKeys[i]!;
      const next = orderedKeys[i + 1]!;
      const maxC =
        centers.get(next)! -
        (groupHalf.get(next) ?? 0) -
        groupGap -
        (groupHalf.get(cur) ?? 0);
      if (centers.get(cur)! > maxC) centers.set(cur, maxC);
    }

    // apply shift + re-pack inside group (preservando ordine relativo corrente)
    orderedKeys.forEach((k) => {
      const ns = (groups.get(k) ?? []).slice().sort((a, b) => {
        const sa = stable[a.id];
        const sb = stable[b.id];
        if (typeof sa === 'number' && typeof sb === 'number' && sa !== sb) return sa - sb;
        const ca = centerAlongAxis(resultById.get(a.id) ?? a);
        const cb = centerAlongAxis(resultById.get(b.id) ?? b);
        if (ca !== cb) return ca - cb;
        return a.id.localeCompare(b.id);
      });
      const center = centers.get(k)!;
      const total = (groupHalf.get(k) ?? 0) * 2;
      let cursor = center - total / 2;
      ns.forEach((n) => {
        const sz = sizeAlongAxis(n);
        const nodeCenter = cursor + sz / 2;
        cursor += sz + lockedGapPx;
        resultById.set(n.id, setAxisPosition(n, nodeCenter, laneCenter));
      });
    });
  }

  // Mantieni l'ordine originale e preserva eventuali flag (selected, data, etc.)
  const positionsPx = Array.from(laneCentersPx.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, center]) => center);

  const nodes = args.nodes.map((n) => {
    const laid = resultById.get(n.id);
    if (!laid) return n;
    return { ...n, position: laid.position };
  });

  const anchorPx = positionsPx[0] ?? 0;
  return {
    nodes,
    lanes: { axis: args.axis, positionsPx, stepPx: laneStepPx, anchorPx }
  };
}

/**
 * Controlla se due rettangoli si sovrappongono (con padding)
 */
function rectsOverlap(a: Rect, b: Rect, padding: number = 20): boolean {
  return !(
    a.x + a.width + padding <= b.x ||
    b.x + b.width + padding <= a.x ||
    a.y + a.height + padding <= b.y ||
    b.y + b.height + padding <= a.y
  );
}

/**
 * Posiziona nuovi nodi in modo intelligente:
 * 1. Prima prova SOTTO al nodo padre (allineati orizzontalmente)
 * 2. Se non c'è spazio → prova a DESTRA (allineati verticalmente)
 * 3. Se non c'è spazio → prova a SINISTRA (allineati verticalmente)
 * I nodi sono equidistanti e il padre è centrato rispetto ai figli
 */
export function positionNewNodesWithoutOverlap(
  existingNodes: Node[],
  newNodes: Node[],
  sourceNodeId: string,
  options: Partial<LayoutOptions> = {}
): Node[] {
  const opts = { ...defaultOptions, ...options };
  const spacing = 60; // Spaziatura tra nodi

  if (newNodes.length === 0) return [];

  // Trova il nodo sorgente
  const sourceNode = existingNodes.find((n) => n.id === sourceNodeId);
  if (!sourceNode) {
    // Fallback: posiziona in una griglia orizzontale
    let currentX = 100;
    return newNodes.map((node) => {
      const dims = getNodeDimensions(node);
      const result = {
        ...node,
        position: { x: currentX, y: 100 }
      };
      currentX += dims.width + spacing;
      return result;
    });
  }

  const sourceDims = getNodeDimensions(sourceNode);
  const newNodeDims = newNodes.map((n) => getNodeDimensions(n));

  // Costruisci i rettangoli dei nodi esistenti (escludendo il nodo sorgente)
  const existingRects: Rect[] = existingNodes
    .filter((n) => n.id !== sourceNodeId)
    .map((node) => {
      const dims = getNodeDimensions(node);
      return {
        x: node.position.x,
        y: node.position.y,
        width: dims.width,
        height: dims.height
      };
    });

  // Helper: verifica se una lista di posizioni ha sovrapposizioni
  const hasOverlaps = (positions: { x: number; y: number }[]): boolean => {
    for (let i = 0; i < positions.length; i++) {
      const testRect: Rect = {
        x: positions[i].x,
        y: positions[i].y,
        width: newNodeDims[i].width,
        height: newNodeDims[i].height
      };

      // Verifica con nodi esistenti
      if (
        existingRects.some((rect) => rectsOverlap(testRect, rect, spacing / 2))
      ) {
        return true;
      }

      // Verifica con altri nodi della stessa batch
      for (let j = 0; j < i; j++) {
        const otherRect: Rect = {
          x: positions[j].x,
          y: positions[j].y,
          width: newNodeDims[j].width,
          height: newNodeDims[j].height
        };
        if (rectsOverlap(testRect, otherRect, spacing / 2)) {
          return true;
        }
      }
    }
    return false;
  };

  // STRATEGIA 1: Sotto al nodo padre (orizzontale)
  const tryBelow = (): { x: number; y: number }[] | null => {
    const horizontalSpacing = 40; // Spacing ridotto tra i nodi orizzontali
    const verticalSpacing = 120; // Spacing molto aumentato dal padre per respirare

    // Calcola larghezza totale dei nodi
    const totalWidth = newNodeDims.reduce((sum, d) => sum + d.width, 0);
    const totalSpacing = (newNodes.length - 1) * horizontalSpacing;
    const rowWidth = totalWidth + totalSpacing;

    // Calcola maxHeight per allineamento
    const maxHeight = Math.max(...newNodeDims.map((d) => d.height));

    // Posizione Y: sotto il nodo sorgente con spacing maggiore
    const startY = sourceNode.position.y + sourceDims.height + verticalSpacing;

    // Posizione X: centra i figli rispetto al padre
    const sourceCenterX = sourceNode.position.x + sourceDims.width / 2;
    let currentX = sourceCenterX - rowWidth / 2;

    const positions: { x: number; y: number }[] = [];

    newNodeDims.forEach((dims) => {
      // Centra verticalmente in base al maxHeight
      const y = startY + (maxHeight - dims.height) / 2;
      positions.push({ x: currentX, y });
      currentX += dims.width + horizontalSpacing;
    });

    // Verifica sovrapposizioni
    if (!hasOverlaps(positions)) {
      return positions;
    }
    return null;
  };

  // STRATEGIA 2: A destra del nodo padre (verticale)
  const tryRight = (): { x: number; y: number }[] | null => {
    const startX = sourceNode.position.x + sourceDims.width + spacing;

    // Calcola larghezza massima per allineamento
    const maxWidth = Math.max(...newNodeDims.map((d) => d.width));

    // Calcola altezza totale della colonna
    const totalHeight = newNodeDims.reduce((sum, d) => sum + d.height, 0);
    const totalSpacing = (newNodes.length - 1) * spacing;
    const columnHeight = totalHeight + totalSpacing;

    // Centra verticalmente rispetto al padre
    const sourceCenterY = sourceNode.position.y + sourceDims.height / 2;
    let currentY = sourceCenterY - columnHeight / 2;

    const positions: { x: number; y: number }[] = [];

    newNodeDims.forEach((dims) => {
      // Centra orizzontalmente in base al maxWidth
      const x = startX + (maxWidth - dims.width) / 2;
      positions.push({ x, y: currentY });
      currentY += dims.height + spacing;
    });

    if (!hasOverlaps(positions)) {
      return positions;
    }
    return null;
  };

  // STRATEGIA 3: A sinistra del nodo padre (verticale)
  const tryLeft = (): { x: number; y: number }[] | null => {
    // Calcola larghezza massima
    const maxWidth = Math.max(...newNodeDims.map((d) => d.width));
    const startX = sourceNode.position.x - maxWidth - spacing;

    // Calcola altezza totale della colonna
    const totalHeight = newNodeDims.reduce((sum, d) => sum + d.height, 0);
    const totalSpacing = (newNodes.length - 1) * spacing;
    const columnHeight = totalHeight + totalSpacing;

    // Centra verticalmente rispetto al padre
    const sourceCenterY = sourceNode.position.y + sourceDims.height / 2;
    let currentY = sourceCenterY - columnHeight / 2;

    const positions: { x: number; y: number }[] = [];

    newNodeDims.forEach((dims) => {
      // Centra orizzontalmente in base al maxWidth
      const x = startX + (maxWidth - dims.width) / 2;
      positions.push({ x, y: currentY });
      currentY += dims.height + spacing;
    });

    if (!hasOverlaps(positions)) {
      return positions;
    }
    return null;
  };

  // Prova le strategie in ordine: sotto → destra → sinistra
  let positions = tryBelow();
  if (!positions) positions = tryRight();
  if (!positions) positions = tryLeft();

  // Se nessuna strategia funziona, fallback: posiziona a destra forzatamente
  if (!positions) {
    console.warn('No clean placement found, using fallback positioning');
    const startX = sourceNode.position.x + sourceDims.width + spacing * 2;
    const sourceCenterY = sourceNode.position.y + sourceDims.height / 2;
    let currentY = sourceCenterY;

    positions = newNodeDims.map((dims) => {
      const pos = { x: startX, y: currentY };
      currentY += dims.height + spacing;
      return pos;
    });
  }

  // Applica le posizioni ai nodi
  return newNodes.map((node, index) => ({
    ...node,
    position: positions![index]
  }));
}

/**
 * Layout incrementale: posiziona solo i nuovi nodi relativamente al nodo sorgente
 * Questo è un wrapper legacy per compatibilità
 */
export function layoutNewNodes(
  existingNodes: Node[],
  newNodes: Node[],
  sourceNodeId: string,
  edges: Edge[],
  options: Partial<LayoutOptions> = {}
): Node[] {
  return positionNewNodesWithoutOverlap(
    existingNodes,
    newNodes,
    sourceNodeId,
    options
  );
}

/**
 * Riposiziona un singolo nodo se si sovrappone con altri
 * Utile quando un nodo viene aggiunto manualmente
 */
export function adjustNodePositionIfOverlapping(
  nodeToAdjust: Node,
  allOtherNodes: Node[],
  spacing: number = 30
): Node {
  const nodeDims = getNodeDimensions(nodeToAdjust);
  const nodeRect: Rect = {
    x: nodeToAdjust.position.x,
    y: nodeToAdjust.position.y,
    width: nodeDims.width,
    height: nodeDims.height
  };

  const existingRects: Rect[] = allOtherNodes
    .filter((n) => n.id !== nodeToAdjust.id)
    .map((node) => {
      const dims = getNodeDimensions(node);
      return {
        x: node.position.x,
        y: node.position.y,
        width: dims.width,
        height: dims.height
      };
    });

  // Controlla se c'è sovrapposizione
  const hasOverlap = existingRects.some((rect) =>
    rectsOverlap(nodeRect, rect, spacing)
  );

  if (!hasOverlap) {
    return nodeToAdjust;
  }

  // Trova una posizione libera spostandosi a destra
  let newX = nodeToAdjust.position.x;
  let newY = nodeToAdjust.position.y;
  let attempts = 0;
  const maxAttempts = 20;

  while (attempts < maxAttempts) {
    newX += nodeDims.width + spacing;
    const testRect: Rect = {
      x: newX,
      y: newY,
      width: nodeDims.width,
      height: nodeDims.height
    };
    const stillOverlaps = existingRects.some((rect) =>
      rectsOverlap(testRect, rect, spacing)
    );

    if (!stillOverlaps) break;
    attempts++;
  }

  return {
    ...nodeToAdjust,
    position: { x: newX, y: newY }
  };
}

/**
 * Organizza i nodi in modo intelligente mantenendo le relazioni gerarchiche
 * e rispettando le dimensioni effettive
 */
export function smartLayout(
  nodes: Node[],
  edges: Edge[],
  options: Partial<LayoutOptions> = {}
): { nodes: Node[]; edges: Edge[] } {
  if (nodes.length === 0) {
    return { nodes: [], edges: [] };
  }

  // Usa dagre con le dimensioni effettive
  return getLayoutedElements(nodes, edges, options);
}

/**
 * Hook-friendly: calcola il layout e restituisce una funzione per applicarlo
 */
export function createLayouter(options: Partial<LayoutOptions> = {}) {
  return {
    /**
     * Layout completo di tutti i nodi
     */
    layoutAll: (nodes: Node[], edges: Edge[]) => {
      return getLayoutedElements(nodes, edges, options);
    },

    /**
     * Posiziona nuovi nodi senza sovrapposizioni
     */
    positionNewNodes: (
      existingNodes: Node[],
      newNodes: Node[],
      sourceNodeId: string
    ) => {
      return positionNewNodesWithoutOverlap(
        existingNodes,
        newNodes,
        sourceNodeId,
        options
      );
    },

    /**
     * Layout incrementale per nuovi nodi (legacy)
     */
    layoutNew: (
      existingNodes: Node[],
      newNodes: Node[],
      sourceNodeId: string,
      edges: Edge[]
    ) => {
      return layoutNewNodes(
        existingNodes,
        newNodes,
        sourceNodeId,
        edges,
        options
      );
    },

    /**
     * Aggiusta la posizione di un singolo nodo se si sovrappone
     */
    adjustIfOverlapping: (nodeToAdjust: Node, allOtherNodes: Node[]) => {
      return adjustNodePositionIfOverlapping(nodeToAdjust, allOtherNodes);
    },

    /**
     * Aggiorna le opzioni
     */
    setOptions: (newOptions: Partial<LayoutOptions>) => {
      Object.assign(options, newOptions);
    }
  };
}

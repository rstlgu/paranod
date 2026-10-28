import type { Edge, Node } from 'reactflow';

export function createFlowStateHash(nodes: Node[], edges: Edge[]) {
  const nodeData = nodes
    .map((n) => ({
      id: n.id,
      type: n.type,
      x: Math.round(n.position.x / 5) * 5,
      y: Math.round(n.position.y / 5) * 5,
      pluginId: (n.data as any)?.pluginId,
      transformId: (n.data as any)?.transformId,
      missingReason: (n.data as any)?.missingReason ?? null
    }))
    .filter((n) => n.id)
    .sort((a, b) => (a.id || '').localeCompare(b.id || ''));

  const edgeData = edges
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target
    }))
    .filter((e) => e.id)
    .sort((a, b) => (a.id || '').localeCompare(b.id || ''));

  return JSON.stringify({ n: nodeData, e: edgeData });
}

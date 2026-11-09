import type { Edge, Node } from 'reactflow';
import { getFilePreviewKind } from './file-preview';

export function createGraphStateHash(nodes: Node[], edges: Edge[]) {
  // Crea una rappresentazione minimale e ordinata dello stato
  const nodeData = nodes
    .map((n) => ({
      id: n.id,
      type: n.type,
      // Arrotonda le posizioni a 5 pixel per evitare salvataggi per micro-movimenti
      x: Math.round(n.position.x / 5) * 5,
      y: Math.round(n.position.y / 5) * 5,
      // Solo le proprietà essenziali del data (legacy: mantiene i campi usati prima)
      label: (n.data as any)?.label,
      // Media presentation and source changes must trigger autosave even when the label is unchanged.
      media: n.data?.type === 'note' || n.data?.type === 'media_url' || (n.data && getFilePreviewKind(n.data)) ? {
        metadata: n.data.metadata,
        width: n.style?.width,
        height: n.style?.height
      } : undefined,
      entityType: (n.data as any)?.entityType
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

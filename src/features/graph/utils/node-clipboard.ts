'use client';

const GRAPH_NODE_MARKER_PREFIX = '__OSINT_MARKER__';
const GRAPH_NODE_STORAGE_PREFIX = 'paranod:graph-node-clipboard:';
const GRAPH_NODE_CLIPBOARD_TTL_MS = 30 * 60 * 1000;

export interface CopiedGraphNodeReference {
  graphId: string;
  nodeId: string;
}

interface StoredGraphNodeClipboard {
  version: 1;
  createdAt: number;
  nodes: CopiedGraphNodeReference[];
}

export function createGraphNodeClipboardMarker(copyId: string) {
  return `${GRAPH_NODE_MARKER_PREFIX}${copyId}`;
}

export function getGraphNodeClipboardCopyId(value: string) {
  const normalized = value.trim();
  if (!normalized.startsWith(GRAPH_NODE_MARKER_PREFIX)) return null;

  const copyId = normalized.slice(GRAPH_NODE_MARKER_PREFIX.length);
  return copyId.length > 0 ? copyId : null;
}

export function storeGraphNodeClipboard(
  copyId: string,
  nodes: CopiedGraphNodeReference[]
) {
  if (typeof window === 'undefined' || nodes.length === 0) return;

  const payload: StoredGraphNodeClipboard = {
    version: 1,
    createdAt: Date.now(),
    nodes
  };

  try {
    window.sessionStorage.setItem(
      `${GRAPH_NODE_STORAGE_PREFIX}${copyId}`,
      JSON.stringify(payload)
    );
  } catch {
    // Clipboard copy should still work when session storage is unavailable.
  }
}

export function readGraphNodeClipboard(value: string) {
  const copyId = getGraphNodeClipboardCopyId(value);
  if (!copyId || typeof window === 'undefined') return null;

  const storageKey = `${GRAPH_NODE_STORAGE_PREFIX}${copyId}`;

  try {
    const serialized = window.sessionStorage.getItem(storageKey);
    if (!serialized) return null;

    const payload = JSON.parse(serialized) as Partial<StoredGraphNodeClipboard>;
    if (
      payload.version !== 1 ||
      typeof payload.createdAt !== 'number' ||
      !Array.isArray(payload.nodes) ||
      Date.now() - payload.createdAt > GRAPH_NODE_CLIPBOARD_TTL_MS
    ) {
      window.sessionStorage.removeItem(storageKey);
      return null;
    }

    const nodes = payload.nodes.filter(
      (node): node is CopiedGraphNodeReference =>
        typeof node?.graphId === 'string' &&
        node.graphId.length > 0 &&
        typeof node.nodeId === 'string' &&
        node.nodeId.length > 0
    );

    return nodes.length > 0 ? nodes : null;
  } catch {
    return null;
  }
}

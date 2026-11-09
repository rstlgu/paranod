import type { Edge, Node as FlowNode } from 'reactflow';

interface MergePayloadV1 {
  version: 1;
  createdAt: number;
  parentId: string | null;
  primaryNodeId: string;
  nodeType: string;
  nodeIds: string[];
  primaryMetadata: Record<string, unknown> | null;
  nodes: FlowNode[];
  edges: Edge[];
}

export interface MergeEligibility {
  canMerge: boolean;
  reason: string | null;
  parentId: string | null;
  nodeType: string | null;
}

function getMergePayload(node: FlowNode): MergePayloadV1 | null {
  const meta = (node?.data as any)?.metadata;
  const payload = meta?.__merge as MergePayloadV1 | undefined;
  if (!payload || payload.version !== 1) return null;
  if (!Array.isArray(payload.nodeIds) || !Array.isArray(payload.nodes) || !Array.isArray(payload.edges))
    return null;
  return payload;
}

export function canUnmergeNode(node: FlowNode): boolean {
  return Boolean(getMergePayload(node));
}

export function getMergeEligibility(args: {
  selectedNodeIds: string[];
  nodes: FlowNode[];
  edges: Edge[];
}): MergeEligibility {
  const ids = Array.from(new Set(args.selectedNodeIds.map(String))).filter(Boolean);
  if (ids.length <= 1)
    return { canMerge: false, reason: 'Select at least 2 nodes', parentId: null, nodeType: null };

  const byId = new Map(args.nodes.map((n) => [String(n.id), n]));
  const selected = ids.map((id) => byId.get(id)).filter(Boolean) as FlowNode[];
  if (selected.length !== ids.length)
    return { canMerge: false, reason: 'Some nodes are missing', parentId: null, nodeType: null };

  const nodeType = String((selected[0].data as any)?.type ?? '');
  if (!nodeType)
    return { canMerge: false, reason: 'Invalid node type', parentId: null, nodeType: null };

  if (!selected.every((n) => String((n.data as any)?.type ?? '') === nodeType))
    return { canMerge: false, reason: 'Nodes must have the same type', parentId: null, nodeType };

  // We allow merging nodes with different parents.
  // Note: caller must prompt user to pick a primary node (metadata source).
  return { canMerge: true, reason: null, parentId: null, nodeType };
}

function makeEdgeKey(e: Edge) {
  // During merge we want to collapse multiple edges coming from the same "parent"
  // (e.g. multiple incoming edges that become parent -> merged).
  //
  // Important: we still keep ALL original edges inside the merge payload, so `unmerge`
  // can restore them exactly. This key is only for the *collapsed* external edges shown
  // while merged.
  const data = ((e as any)?.data ?? {}) as Record<string, unknown>;
  return [
    String(e.source),
    String(e.target),
    String(e.type ?? ''),
    // Keep visual-affecting attributes so we don't collapse edges with different styling
    String(data.edgeType ?? ''),
    String(data.dashed ?? ''),
    String(data.strokeWidth ?? ''),
    String(data.color ?? '')
    // Intentionally ignore label + handles to reduce duplicates from same parent.
  ].join('|');
}

function getEffectiveTransformValueFromNode(node: FlowNode): string {
  const data: any = (node?.data ?? {}) as any;
  const meta: any = data?.metadata ?? {};
  const candidates = [
    data?.value,
    meta?.hash,
    meta?.address,
    meta?.value,
    String(data?.label ?? '').split('\n')[0]
  ];
  for (const c of candidates) {
    const v = String(c ?? '').trim();
    if (v) return v;
  }
  return '';
}

function toMergedItem(node: FlowNode) {
  const data = (node?.data ?? {}) as any;
  const label = data?.label ?? null;
  // IMPORTANT: le transform spesso usano `metadata.hash/address/value` come input reale.
  // Se nel nodo non abbiamo `data.value`, salviamo comunque un value efficace in `merged`,
  // altrimenti il batch su nodi merged può fallire (mentre sui singoli nodi funziona).
  const value = getEffectiveTransformValueFromNode(node) || null;
  return {
    id: String(node.id),
    type: String(data?.type ?? ''),
    label: label === null ? null : String(label),
    value: value === null ? null : String(value)
  };
}

function stripNodeMetadataForRestore(node: FlowNode): FlowNode {
  const data = (node?.data ?? {}) as any;
  return {
    ...(node as any),
    selected: false,
    data: {
      ...data,
      // When unmerging we restore nodes without metadata (primary metadata is kept only on the merged node).
      metadata: {}
    }
  } as any;
}

function getLeafNodeIds(node: FlowNode): string[] {
  const payload = getMergePayload(node);
  if (payload) return payload.nodeIds.map(String).filter(Boolean);
  return [String(node.id)].filter(Boolean);
}

function getLeafNodesSnapshot(node: FlowNode): FlowNode[] {
  const payload = getMergePayload(node);
  if (payload) return payload.nodes.map((n) => stripNodeMetadataForRestore(n));
  return [stripNodeMetadataForRestore(node)];
}

function getLeafEdgesSnapshot(args: {
  node: FlowNode;
  edges: Edge[];
  selectedMergedNodeIdSet: Set<string>;
}): Edge[] {
  const payload = getMergePayload(args.node);
  if (payload) return payload.edges.map((e) => ({ ...e, selected: false } as any));

  // For non-merged nodes, snapshot its current edges, excluding edges that point to a merged node id
  // (those edges would be invalid after unmerge because merged node ids don't exist).
  const nodeId = String(args.node.id);
  return args.edges
    .filter((e) => String(e.source) === nodeId || String(e.target) === nodeId)
    .filter((e) => {
      const other = String(e.source) === nodeId ? String(e.target) : String(e.source);
      return !args.selectedMergedNodeIdSet.has(other);
    })
    .map((e) => ({ ...e, selected: false } as any));
}

function getPrimaryMetadataForMergedNode(node: FlowNode): Record<string, unknown> {
  const payload = getMergePayload(node);
  const fromPayload = payload?.primaryMetadata;
  const base = (fromPayload ?? ((node?.data as any)?.metadata ?? {})) as Record<string, unknown>;
  const next: any = { ...(base ?? {}) };
  delete next.__merge;
  delete next.merged;
  delete next.mergedChildCount;
  return next;
}

function toMergedItemsDeep(node: FlowNode) {
  const payload = getMergePayload(node);
  if (!payload) return [toMergedItem(node)];
  // Preferiamo i `merged` items già calcolati (con value efficace) se presenti.
  const meta: any = (node?.data as any)?.metadata ?? {};
  const mergedList: any[] = Array.isArray(meta?.merged) ? meta.merged : [];
  if (mergedList.length) {
    return mergedList.map((it) => ({
      id: String(it?.id ?? ''),
      type: String(it?.type ?? ''),
      label: it?.label === null || it?.label === undefined ? null : String(it.label),
      value: it?.value === null || it?.value === undefined ? null : String(it.value)
    }));
  }
  return payload.nodes.map(toMergedItem);
}

export function mergeNodes(args: {
  selectedNodeIds: string[];
  nodes: FlowNode[];
  edges: Edge[];
  primaryNodeId: string;
}): { nextNodes: FlowNode[]; nextEdges: Edge[]; mergedNodeId: string } {
  const ids = Array.from(new Set(args.selectedNodeIds.map(String))).filter(Boolean);
  const eligibility = getMergeEligibility({
    selectedNodeIds: ids,
    nodes: args.nodes,
    edges: args.edges
  });
  if (!eligibility.canMerge || !eligibility.nodeType)
    throw new Error(eligibility.reason ?? 'merge_not_allowed');

  const selectedIdSet = new Set(ids);
  const selectedNodes = args.nodes.filter((n) => selectedIdSet.has(String(n.id)));
  const selectedEdges = args.edges.filter(
    (e) => selectedIdSet.has(String(e.source)) || selectedIdSet.has(String(e.target))
  );

  const primaryNodeId = String(args.primaryNodeId ?? '');
  if (!selectedIdSet.has(primaryNodeId)) throw new Error('primary_node_not_in_selection');

  const selectedMergedNodeIdSet = new Set(
    selectedNodes.filter((n) => canUnmergeNode(n)).map((n) => String(n.id))
  );

  const leafNodeIds = Array.from(
    new Set(selectedNodes.flatMap((n) => getLeafNodeIds(n)).map(String).filter(Boolean))
  );

  // If the chosen "primary" is itself a merged node, map it to its inner primary leaf id.
  const primaryLeafNodeId = (() => {
    const primaryNode = selectedNodes.find((n) => String(n.id) === primaryNodeId);
    const payload = primaryNode ? getMergePayload(primaryNode) : null;
    const leaf = payload ? String(payload.primaryNodeId) : primaryNodeId;
    if (!leafNodeIds.includes(leaf)) throw new Error('primary_leaf_node_not_in_payload');
    return leaf;
  })();

  const mergedNodeId = `merged_${Date.now()}`;
  const avgPos = selectedNodes.reduce(
    (acc, n) => {
      const x = Number((n as any)?.position?.x ?? 0);
      const y = Number((n as any)?.position?.y ?? 0);
      return { x: acc.x + (Number.isFinite(x) ? x : 0), y: acc.y + (Number.isFinite(y) ? y : 0) };
    },
    { x: 0, y: 0 }
  );
  const denom = Math.max(1, selectedNodes.length);
  const position = { x: avgPos.x / denom, y: avgPos.y / denom };

  const base = selectedNodes.find((n) => String(n.id) === primaryNodeId) ?? selectedNodes[0];
  const baseData = (base.data ?? {}) as any;
  const prevMeta = getPrimaryMetadataForMergedNode(base);

  const mergedItems = Array.from(
    new Map(selectedNodes.flatMap(toMergedItemsDeep).map((it) => [String(it.id), it])).values()
  );

  const payload: MergePayloadV1 = {
    version: 1,
    createdAt: Date.now(),
    parentId: null,
    primaryNodeId: primaryLeafNodeId,
    nodeType: String(baseData.type),
    nodeIds: leafNodeIds,
    primaryMetadata: prevMeta,
    // Store a metadata-stripped snapshot so unmerge restores nodes without metadata.
    nodes: selectedNodes.flatMap((n) => getLeafNodesSnapshot(n)),
    edges: Array.from(
      new Map(
        selectedNodes
          .flatMap((n) => getLeafEdgesSnapshot({ node: n, edges: args.edges, selectedMergedNodeIdSet }))
          .map((e) => [String((e as any).id ?? makeEdgeKey(e)), e])
      ).values()
    )
  };

  const mergedNode: FlowNode = {
    ...(base as any),
    id: mergedNodeId,
    position,
    selected: true,
    data: {
      ...baseData,
      label: String(baseData.label ?? ''),
      metadata: {
        ...prevMeta,
        merged: mergedItems,
        __merge: payload,
        mergedChildCount: leafNodeIds.length
      }
    }
  };

  // Build new edges: replace any endpoint in selection with mergedNodeId, drop internal edges,
  // and dedupe edges that collapse to the same shape.
  const externalEdges = selectedEdges
    .filter((e) => !(selectedIdSet.has(String(e.source)) && selectedIdSet.has(String(e.target))))
    .map((e) => {
      const next: Edge = { ...(e as any) };
      const isSourceIn = selectedIdSet.has(String(e.source));
      const isTargetIn = selectedIdSet.has(String(e.target));
      if (isSourceIn) next.source = mergedNodeId;
      if (isTargetIn) next.target = mergedNodeId;
      next.id = `m_${mergedNodeId}_${String(e.id)}`;
      (next as any).selected = false;
      return next;
    });

  const dedupedEdges: Edge[] = [];
  const seen = new Set<string>();
  for (const e of externalEdges) {
    const k = makeEdgeKey(e);
    if (seen.has(k)) continue;
    seen.add(k);
    dedupedEdges.push(e);
  }

  const nextNodes = [
    ...args.nodes.filter((n) => !selectedIdSet.has(String(n.id))).map((n) => ({ ...n, selected: false })),
    mergedNode
  ];
  const nextEdges = [
    ...args.edges
      .filter((e) => !selectedIdSet.has(String(e.source)) && !selectedIdSet.has(String(e.target)))
      .map((e) => ({ ...e, selected: false })),
    ...dedupedEdges
  ];

  return { nextNodes, nextEdges, mergedNodeId };
}

export function unmergeNode(args: {
  nodeId: string;
  nodes: FlowNode[];
  edges: Edge[];
}): { nextNodes: FlowNode[]; nextEdges: Edge[]; restoredNodeIds: string[] } {
  const target = args.nodes.find((n) => String(n.id) === String(args.nodeId));
  if (!target) throw new Error('node_not_found');
  const payload = getMergePayload(target);
  if (!payload) throw new Error('not_a_merged_node');

  const mergedId = String(args.nodeId);

  const restoredNodes = payload.nodes.map((n) => {
    const next = { ...(n as any), hidden: false, selected: true } as any;
    if (String(next.id) === String(payload.primaryNodeId)) {
      const data = (next.data ?? {}) as any;
      next.data = {
        ...data,
        metadata: payload.primaryMetadata ?? {}
      };
    }
    return next as FlowNode;
  });
  const restoredEdges = payload.edges.map((e) => ({ ...(e as any), hidden: false, selected: false }));

  const nextNodes = [
    ...args.nodes.filter((n) => String(n.id) !== mergedId).map((n) => ({ ...n, selected: false })),
    ...restoredNodes
  ];
  const nextEdges = [
    ...args.edges
      .filter((e) => String(e.source) !== mergedId && String(e.target) !== mergedId)
      .map((e) => ({ ...e, selected: false })),
    ...restoredEdges
  ];

  return { nextNodes, nextEdges, restoredNodeIds: payload.nodeIds };
}

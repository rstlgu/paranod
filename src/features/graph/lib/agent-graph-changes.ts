interface GraphItem {
  id: string | number;
  [key: string]: unknown;
}

export interface AgentGraphChanges {
  nodeIds: string[];
  edgeIds: string[];
}

function signature(item: GraphItem) {
  const { data, type, source, target, label } = item;
  return JSON.stringify({ data, type, source, target, label });
}

function changedIds(previous: GraphItem[], next: GraphItem[]) {
  const before = new Map(previous.map((item) => [String(item.id), item]));
  return next
    .filter((item) => {
      const old = before.get(String(item.id));
      return !old || signature(old) !== signature(item);
    })
    .map((item) => String(item.id));
}

// Added or content-changed items to highlight; removals simply disappear.
export function agentGraphChanges(
  previous: { nodes: GraphItem[]; edges: GraphItem[] },
  next: { nodes: GraphItem[]; edges: GraphItem[] }
): AgentGraphChanges {
  return {
    nodeIds: changedIds(previous.nodes, next.nodes),
    edgeIds: changedIds(previous.edges, next.edges)
  };
}

// Preview keeps local presentation state so the canvas does not flash or lose selection.
export function withPresentation<T extends GraphItem>(
  previous: GraphItem[],
  next: T[]
): T[] {
  const before = new Map(previous.map((item) => [String(item.id), item]));
  return next.map((item) => {
    const old = before.get(String(item.id));
    return {
      ...item,
      selected: old?.selected ?? false,
      ...(old?.width !== undefined ? { width: old.width } : {}),
      ...(old?.height !== undefined ? { height: old.height } : {})
    };
  });
}

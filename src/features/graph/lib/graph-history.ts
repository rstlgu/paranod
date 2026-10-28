import type { Edge, Node } from 'reactflow';
import type { OSINTNodeData } from '../types';
import { graphDraftFingerprint } from './graph-client-coordinator';

export interface GraphSnapshot {
  nodes: Node<OSINTNodeData>[];
  edges: Edge[];
}

// Synchronous cursor: consecutive agent commits / keyboard presses must not
// depend on React batching. Compare persisted content, not ReactFlow measures.
export function createGraphHistory(maxHistory = 50) {
  let snapshots: GraphSnapshot[] = [{ nodes: [], edges: [] }];
  let index = 0;
  const copy = (snapshot: GraphSnapshot): GraphSnapshot => {
    const cloned = structuredClone(snapshot);
    for (const item of [...cloned.nodes, ...cloned.edges]) delete item.selected;
    return cloned;
  };
  const equal = (a: GraphSnapshot, b: GraphSnapshot) =>
    graphDraftFingerprint(a) === graphDraftFingerprint(b);
  return {
    get index() {
      return index;
    },
    get canUndo() {
      return index > 0;
    },
    get canRedo() {
      return index < snapshots.length - 1;
    },
    matches(snapshot: GraphSnapshot) {
      return equal(snapshot, snapshots[index]);
    },
    reset(snapshot: GraphSnapshot) {
      snapshots = [copy(snapshot)];
      index = 0;
    },
    commit(snapshot: GraphSnapshot) {
      if (equal(snapshot, snapshots[index])) return false;
      snapshots = [...snapshots.slice(0, index + 1), copy(snapshot)].slice(
        -Math.max(2, maxHistory)
      );
      index = snapshots.length - 1;
      return true;
    },
    undo() {
      return index > 0 ? copy(snapshots[--index]) : null;
    },
    redo() {
      return index < snapshots.length - 1 ? copy(snapshots[++index]) : null;
    }
  };
}

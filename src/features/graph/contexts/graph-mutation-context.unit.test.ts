import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  editable: true,
  flow: { setNodes: vi.fn(), setEdges: vi.fn(), deleteElements: vi.fn() }
}));
vi.mock('react', () => ({
  createContext: () => ({}),
  useContext: () => () => state.editable,
  useCallback: (fn: unknown) => fn
}));
vi.mock('reactflow', () => ({ useReactFlow: () => state.flow }));
import { useGuardedReactFlow } from './graph-mutation-context';

beforeEach(() => {
  vi.clearAllMocks();
  state.editable = true;
});
describe('manual graph mutation guard', () => {
  it('blocks stale node, edge and delete callbacks when the agent acquires the graph', () => {
    const flow = useGuardedReactFlow();
    state.editable = false;
    expect(flow.canEdit()).toBe(false);
    flow.setNodes([]);
    flow.setEdges([]);
    flow.deleteElements({ nodes: [{ id: 'keep' }] });
    expect(state.flow.setNodes).not.toHaveBeenCalled();
    expect(state.flow.setEdges).not.toHaveBeenCalled();
    expect(state.flow.deleteElements).not.toHaveBeenCalled();
  });
  it('rechecks ownership inside pending ReactFlow updates', () => {
    const flow = useGuardedReactFlow();
    const removeNodes = vi.fn(() => []);
    const removeEdges = vi.fn(() => []);
    flow.setNodes(removeNodes);
    flow.setEdges(removeEdges);
    state.editable = false;
    const nodes = [{ id: 'keep' }];
    const edges = [{ id: 'keep-edge' }];
    expect(state.flow.setNodes.mock.calls[0][0](nodes)).toBe(nodes);
    expect(state.flow.setEdges.mock.calls[0][0](edges)).toBe(edges);
    expect(removeNodes).not.toHaveBeenCalled();
    expect(removeEdges).not.toHaveBeenCalled();
  });
  it('permits deletion after editing becomes available again', () => {
    const flow = useGuardedReactFlow();
    state.editable = false;
    flow.deleteElements({ nodes: [{ id: 'node' }] });
    state.editable = true;
    flow.deleteElements({ nodes: [{ id: 'node' }] });
    expect(state.flow.deleteElements).toHaveBeenCalledExactlyOnceWith({
      nodes: [{ id: 'node' }]
    });
  });
});

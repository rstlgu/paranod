import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Edge, Node } from 'reactflow';

// Keep effects and queued updaters separate so lock transitions can happen
// between an event and the React state update it scheduled.
const hooks = vi.hoisted(() => {
  let cursor = 0;
  let deferUpdates = false;
  const cells: any[] = [];
  const effects: Array<() => void> = [];
  const updates: Array<() => void> = [];
  const sameDeps = (a: unknown[], b: unknown[]) =>
    a?.length === b?.length && a.every((value, i) => Object.is(value, b[i]));
  const memoCell = (factory: () => unknown, deps: unknown[]) => {
    const index = cursor++;
    if (!cells[index] || !sameDeps(cells[index].deps, deps)) {
      cells[index] = { value: factory(), deps };
    }
    return cells[index].value;
  };
  return {
    react: {
      useRef(value: unknown) {
        return (cells[cursor++] ??= { current: value });
      },
      useState(initial: unknown) {
        const index = cursor++;
        cells[index] ??= {
          value: typeof initial === 'function' ? initial() : initial
        };
        return [
          cells[index].value,
          (next: any) => {
            const update = () => {
              cells[index].value =
                typeof next === 'function' ? next(cells[index].value) : next;
            };
            if (deferUpdates) updates.push(update);
            else update();
          }
        ];
      },
      useMemo: memoCell,
      useCallback: (callback: unknown, deps: unknown[]) =>
        memoCell(() => callback, deps),
      useEffect(callback: () => (() => void) | void, deps: unknown[]) {
        const index = cursor++;
        const previous = cells[index];
        if (previous && sameDeps(previous.deps, deps)) return;
        cells[index] = { deps, cleanup: previous?.cleanup };
        effects.push(() => {
          cells[index].cleanup?.();
          cells[index].cleanup = callback();
        });
      }
    },
    render<T>(callback: () => T, attach?: (result: T) => void): T {
      cursor = 0;
      const result = callback();
      attach?.(result);
      effects.splice(0).forEach((effect) => effect());
      return result;
    },
    defer() {
      deferUpdates = true;
    },
    flush() {
      deferUpdates = false;
      updates.splice(0).forEach((update) => update());
    },
    reset() {
      cells.forEach((cell) => cell.cleanup?.());
      cells.length = effects.length = updates.length = 0;
      cursor = 0;
      deferUpdates = false;
    }
  };
});

const mocks = vi.hoisted(() => ({
  layout: vi.fn(),
  coordinates: vi.fn(),
  map: {
    setView: vi.fn(),
    fitBounds: vi.fn(),
    panTo: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn()
  },
  graph: {
    zoom: vi.fn(() => 1),
    centerAt: vi.fn(),
    refresh: vi.fn(),
    screen2GraphCoords: vi.fn((x, y) => ({ x, y })),
    graph2ScreenCoords: vi.fn((x, y) => ({ x, y }))
  }
}));

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  ...hooks.react
}));
vi.mock('next/dynamic', () => ({ default: () => 'force-graph' }));
vi.mock('next-themes', () => ({
  useTheme: () => ({ resolvedTheme: 'light' })
}));
vi.mock('leaflet', () => ({
  default: {
    divIcon: (options: unknown) => options,
    latLngBounds: (points: unknown) => points
  }
}));
vi.mock('react-leaflet', () => ({
  MapContainer: 'map-container',
  Marker: 'map-marker',
  TileLayer: 'map-tiles',
  Tooltip: 'map-tooltip',
  useMap: () => mocks.map
}));
vi.mock('@/features/graph/components/map-utils', () => ({
  resolveValueToCoordinates: mocks.coordinates
}));
vi.mock('@/features/graph/relational-layout/relational-layout-client', () => ({
  computeRelationalPositions: mocks.layout
}));
vi.mock('@/features/osint/node-registry', () => ({
  nodePaletteItems: [],
  nodeTypeByType: {}
}));
vi.mock('@/features/graph/components/osint-node-visual', () => ({
  getOsintNodeVisualTokens: () => ({
    accentHex: '#fff',
    bgHex: '#000',
    iconHex: '#fff'
  })
}));
vi.mock('@/features/graph/contexts/transform-logger-context', () => ({
  useTransformLogger: () => ({ logs: [] })
}));
vi.mock('./canvas/render-node', () => ({ renderAnalysisNode: vi.fn() }));
vi.mock('./canvas/render-link', () => ({ renderAnalysisLink: vi.fn() }));
vi.mock('./canvas/icon-cache', () => ({ loadTablerIcon: vi.fn() }));
vi.mock('./canvas/logo-cache', () => ({
  loadLogoWithRetry: vi.fn(),
  peekCachedLogo: vi.fn()
}));

import {
  AnalysisCanvas,
  type AnalysisCanvasProps
} from './canvas/analysis-canvas';
import { useAnalysisLayoutState } from './state/analysis-layout-state';
import {
  GraphMapView,
  type GraphMapViewProps
} from '../components/graph-map-view';

const nodes: Node[] = [
  {
    id: 'a',
    position: { x: 10, y: 20 },
    data: { type: 'location', label: '45,9' }
  },
  {
    id: 'b',
    position: { x: 110, y: 120 },
    data: { type: 'maps', label: '46,10' }
  }
];
const edges: Edge[] = [{ id: 'ab', source: 'a', target: 'b' }];
const box = {
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  setPointerCapture: vi.fn(),
  releasePointerCapture: vi.fn()
};

function findElement(tree: any, predicate: (element: any) => boolean): any {
  if (!tree || typeof tree !== 'object') return undefined;
  if (predicate(tree)) return tree;
  const children = [tree.props?.children].flat(Infinity);
  for (const child of children) {
    const found = findElement(child, predicate);
    if (found) return found;
  }
}

function renderCanvas(overrides: Partial<AnalysisCanvasProps> = {}) {
  const props = { nodes, edges, isDark: false, ...overrides };
  const render = () =>
    hooks.render(
      () => AnalysisCanvas(props),
      (tree: any) => {
        tree.props.ref.current = box;
        findElement(
          tree,
          (element) => element.type === 'force-graph'
        ).props.ref.current = mocks.graph;
      }
    );
  render();
  const tree = render();
  return {
    tree,
    graph: findElement(tree, (element) => element.type === 'force-graph').props
  };
}

async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) =>
    setTimeout(callback, 16)
  );
  vi.stubGlobal('cancelAnimationFrame', (id: ReturnType<typeof setTimeout>) =>
    clearTimeout(id)
  );
  vi.stubGlobal('fetch', vi.fn());
  mocks.layout.mockImplementation(async ({ nodes: inputs }) =>
    inputs.map((node: Node, index: number) => ({
      id: node.id,
      x: index * 200,
      y: index * 160
    }))
  );
  mocks.coordinates.mockImplementation(async (label: string) => {
    const [lat, lng] = label.split(',').map(Number);
    return { coordinates: { lat, lng } };
  });
});

afterEach(() => {
  hooks.reset();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Analysis read-only browsing', () => {
  it('keeps click/details, box selection, zoom, pan and fit available while locked', () => {
    const onNodeClick = vi.fn();
    const onEdgeClick = vi.fn();
    const onPaneClick = vi.fn();
    const onSelectNodeIds = vi.fn();
    const onGraphApi = vi.fn();
    const { tree, graph } = renderCanvas({
      readOnly: true,
      canEditSnapshot: () => false,
      onNodeClick,
      onEdgeClick,
      onPaneClick,
      onSelectNodeIds,
      onGraphApi
    });
    expect(graph.enableNodeDrag).toBe(false);
    expect(graph.enablePointerInteraction).toBe(true);
    expect(graph.enableZoomInteraction).toBe(true);
    expect(graph.enablePanInteraction).toBe(true);
    const event = {};
    graph.onNodeClick(graph.graphData.nodes[0], event);
    graph.onLinkClick(graph.graphData.links[0], event);
    graph.onBackgroundClick(event);
    expect(onNodeClick).toHaveBeenCalledWith(event, nodes[0]);
    expect(onEdgeClick).toHaveBeenCalledWith(event, edges[0]);
    expect(onPaneClick).toHaveBeenCalledWith(event);

    const moved = {
      button: 0,
      clientX: 22,
      clientY: 32,
      pointerId: 2,
      currentTarget: box,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn()
    };
    tree.props.onPointerDownCapture({ ...moved, clientX: 20, clientY: 30 });
    tree.props.onPointerUpCapture(moved);
    vi.advanceTimersByTime(40);
    expect(onNodeClick).toHaveBeenCalledTimes(2);
    expect(onNodeClick).toHaveBeenLastCalledWith(moved, nodes[0]);

    tree.props.onPointerDownCapture({ ...moved, clientX: 400, clientY: 400 });
    tree.props.onPointerUpCapture({ ...moved, clientX: 402, clientY: 401 });
    vi.advanceTimersByTime(40);
    expect(onPaneClick).toHaveBeenCalledTimes(2);

    const pointer = {
      shiftKey: true,
      button: 0,
      clientX: 0,
      clientY: 0,
      pointerId: 1,
      currentTarget: box,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn()
    };
    tree.props.onPointerDownCapture(pointer);
    tree.props.onPointerMoveCapture({ ...pointer, clientX: 80, clientY: 80 });
    vi.advanceTimersByTime(20);
    tree.props.onPointerUpCapture({ ...pointer, clientX: 80, clientY: 80 });
    expect(onSelectNodeIds).toHaveBeenLastCalledWith(['a']);

    const api = onGraphApi.mock.calls.at(-1)![0];
    api.fitView();
    api.fitViewToNodeIds(['a']);
    api.panToNode('b');
    api.centerAt(12, 24);
    api.zoomIn();
    api.zoomOut();
    expect(mocks.graph.centerAt).toHaveBeenCalledWith(12, 24, 260);
    expect(mocks.graph.zoom).toHaveBeenCalledWith(1.18, 160);
    expect(mocks.graph.zoom).toHaveBeenCalledWith(1 / 1.18, 160);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('blocks stale single-node drag handlers even before readOnly rerenders', () => {
    let editable = true;
    const onNodeDragEnd = vi.fn();
    const { graph } = renderCanvas({
      canEditSnapshot: () => editable,
      onNodeDragEnd
    });
    const node = graph.graphData.nodes[0];
    graph.onNodeDrag(node);
    editable = false;
    node.x = 900;
    graph.onNodeDrag(node);
    graph.onNodeDragEnd(node);
    expect(node.x).toBe(nodes[0].position.x + node.nodeSize / 2);
    expect(onNodeDragEnd).not.toHaveBeenCalled();
  });

  it('cancels a group drag across a lock/unlock and permits only a fresh drag', () => {
    const selected = nodes.map((node) => ({ ...node, selected: true }));
    const onNodesDragEnd = vi.fn();
    const onNodeDragEnd = vi.fn();
    const props = { nodes: selected, onNodesDragEnd, onNodeDragEnd };
    const { graph: beforeLock } = renderCanvas(props);
    const node = beforeLock.graphData.nodes[0];
    beforeLock.onNodeDrag(node);
    node.x += 70;
    beforeLock.onNodeDrag(node);
    renderCanvas({ ...props, readOnly: true });
    const { graph: afterLock, tree } = renderCanvas(props);
    beforeLock.onNodeDragEnd(node);
    node.x += 40;
    afterLock.onNodeDrag(node);
    afterLock.onNodeDragEnd(node);
    expect(onNodeDragEnd).not.toHaveBeenCalled();
    expect(onNodesDragEnd).not.toHaveBeenCalled();
    for (const current of afterLock.graphData.nodes) {
      expect(current.x).toBe(current.rfNode.position.x + current.nodeSize / 2);
    }
    tree.props.onPointerDownCapture({ button: 0, shiftKey: false });
    afterLock.onNodeDrag(node);
    node.x += 40;
    afterLock.onNodeDrag(node);
    afterLock.onNodeDragEnd(node);
    expect(onNodesDragEnd).toHaveBeenCalledOnce();
    expect(onNodesDragEnd.mock.calls[0][0]).toHaveLength(2);
  });

  it('does not write through drag callbacks retained after unmount', () => {
    const onNodeDragEnd = vi.fn();
    const { graph } = renderCanvas({ onNodeDragEnd });
    hooks.reset();
    graph.onNodeDragEnd(graph.graphData.nodes[0]);
    expect(onNodeDragEnd).not.toHaveBeenCalled();
  });
});

describe('Analysis layout mutation boundary', () => {
  const base = { graphId: 'graph', isActive: true, nodes, edges };
  const render = (
    overrides: Partial<Parameters<typeof useAnalysisLayoutState>[0]> = {}
  ) => hooks.render(() => useAnalysisLayoutState({ ...base, ...overrides }));

  it('derives a usable local layout during a lock and when switching modes', async () => {
    render({ isActive: false, readOnly: true });
    expect(mocks.layout).not.toHaveBeenCalled();
    render({ readOnly: true });
    await settle();
    const layout = render({ readOnly: true });
    expect(layout.isLoading).toBe(false);
    expect(layout.nodes.map((node) => node.position)).toEqual([
      { x: 0, y: 0 },
      { x: 200, y: 160 }
    ]);
    expect(layout.edges).toHaveLength(1);
    expect(nodes[0].position).toEqual({ x: 10, y: 20 });
    render({ readOnly: false });
    vi.runAllTimers();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('allows selection but rejects position, add, remove and edge mutations while locked', async () => {
    render({ readOnly: true });
    await settle();
    const layout = render({ readOnly: true });
    layout.applyNodesChange([
      { type: 'select', id: 'a', selected: true },
      { type: 'position', id: 'a', position: { x: 900, y: 900 } },
      { type: 'remove', id: 'b' },
      { type: 'add', item: { ...nodes[0], id: 'new' } }
    ]);
    layout.applyEdgesChange([
      { type: 'select', id: 'ab', selected: true },
      { type: 'remove', id: 'ab' },
      { type: 'add', item: { id: 'new-edge', source: 'b', target: 'a' } }
    ]);
    const next = render({ readOnly: true });
    expect(next.nodes.map((node) => node.id)).toEqual(['a', 'b']);
    expect(next.nodes[0].selected).toBe(true);
    expect(next.nodes[0].position).toEqual({ x: 0, y: 0 });
    expect(next.edges.map((edge) => edge.id)).toEqual(['ab']);
    expect(next.edges[0].selected).toBe(true);
  });

  it('drops queued mutations permanently across a lock even when React applies them after unlock', async () => {
    render();
    await settle();
    const before = render();
    hooks.defer();
    before.applyNodesChange([
      { type: 'position', id: 'a', position: { x: 999, y: 999 } }
    ]);
    before.applyEdgesChange([{ type: 'remove', id: 'ab' }]);
    render({ readOnly: true });
    render();
    hooks.flush();
    before.applyNodesChange([{ type: 'remove', id: 'b' }]);
    before.applyEdgesChange([{ type: 'remove', id: 'ab' }]);
    before.applyLayout({ engine: 'hierarchy' });
    const current = render();
    expect(current.nodes).toHaveLength(2);
    expect(current.nodes[0].position).toEqual({ x: 0, y: 0 });
    expect(current.edges).toHaveLength(1);
    expect(current.layoutOptions.engine).toBe('force');
    current.applyNodesChange([
      { type: 'position', id: 'a', position: { x: 50, y: 60 } }
    ]);
    expect(render().nodes[0].position).toEqual({ x: 50, y: 60 });
  });

  it('rechecks the snapshot before executing a queued updater without requiring a rerender', async () => {
    let editable = true;
    const canEditSnapshot = () => editable;
    render({ canEditSnapshot });
    await settle();
    const layout = render({ canEditSnapshot });
    hooks.defer();
    layout.applyNodesChange([{ type: 'remove', id: 'a' }]);
    layout.applyEdgesChange([{ type: 'remove', id: 'ab' }]);
    editable = false;
    hooks.flush();
    const next = render({ canEditSnapshot });
    expect(next.nodes).toHaveLength(2);
    expect(next.edges).toHaveLength(1);
  });

  it('rejects a previous graph scope without blocking the new graph layout', async () => {
    render();
    await settle();
    const previous = render();
    render({ graphId: 'other' });
    await settle();
    previous.applyNodesChange([{ type: 'remove', id: 'a' }]);
    previous.applyEdgesChange([{ type: 'remove', id: 'ab' }]);
    previous.applyLayout({ engine: 'hierarchy' });
    const current = render({ graphId: 'other' });
    expect(current.nodes).toHaveLength(2);
    expect(current.edges).toHaveLength(1);
    expect(current.layoutOptions.engine).toBe('force');
    expect(current.isLoading).toBe(false);
  });

  it('rejects manual layout commands while locked but allows local refetches', async () => {
    render({ readOnly: true });
    await settle();
    const layout = render({ readOnly: true });
    layout.applyLayout({ engine: 'hierarchy' });
    expect(render({ readOnly: true }).layoutOptions.engine).toBe('force');
    expect(mocks.layout).toHaveBeenCalledOnce();
    await layout.refetch();
    render({ readOnly: true });
    await settle();
    expect(mocks.layout).toHaveBeenCalledTimes(2);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('lets an in-flight derived layout finish without persistence after a lock starts', async () => {
    let finish!: (
      positions: Array<{ id: string; x: number; y: number }>
    ) => void;
    mocks.layout.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    render();
    render({ readOnly: true });
    finish([
      { id: 'a', x: 30, y: 40 },
      { id: 'b', x: 300, y: 400 }
    ]);
    await settle();
    expect(render({ readOnly: true }).nodes[0].position).toEqual({
      x: 30,
      y: 40
    });
    render();
    vi.runAllTimers();
    expect(mocks.layout).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('Map browsing', () => {
  it('keeps markers selectable and navigation available without any graph writes', async () => {
    const onSelectNodeId = vi.fn();
    const onMapApi = vi.fn();
    const props: GraphMapViewProps = {
      nodes,
      selectedNodeIds: ['a'],
      onSelectNodeId,
      onMapApi
    };
    hooks.render(() => GraphMapView(props));
    await settle();
    const tree = hooks.render(() => GraphMapView(props));
    const map = findElement(
      tree,
      (element) => element.type === 'map-container'
    );
    expect(map.props.scrollWheelZoom).toBe(true);
    const marker = findElement(
      tree,
      (element) => element.type === 'map-marker'
    );
    expect(marker.props.draggable).toBe(false);
    expect(marker.props.zIndexOffset).toBe(1000);
    marker.props.eventHandlers.click();
    expect(onSelectNodeId).toHaveBeenCalledWith('a');
    const controller = findElement(tree, (element) =>
      Boolean(element.props?.onMapReady)
    );
    controller.props.onMapReady(mocks.map);
    const api = onMapApi.mock.calls.at(-1)![0];
    api.fitView();
    api.fitViewToNodeIds(['a']);
    api.zoomIn();
    api.zoomOut();
    expect(mocks.map.fitBounds).toHaveBeenCalledOnce();
    expect(mocks.map.setView).toHaveBeenCalledWith([45, 9], 14);
    expect(mocks.map.zoomIn).toHaveBeenCalledOnce();
    expect(mocks.map.zoomOut).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });
});

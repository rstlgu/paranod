import { createElement, type ComponentProps, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactFlowInstance, ReactFlowProps } from 'reactflow';

const flow = vi.hoisted(() => ({
  render: vi.fn((props: ReactFlowProps): ReactNode => props.children ?? null),
  background: vi.fn(() => null),
  minimap: vi.fn(() => null)
}));
vi.mock('reactflow', () => ({
  default: flow.render,
  Background: flow.background,
  MiniMap: flow.minimap,
  BackgroundVariant: { Dots: 'dots', Lines: 'lines', Cross: 'cross' },
  ConnectionMode: { Loose: 'loose' },
  MarkerType: { ArrowClosed: 'arrowclosed' },
  useStore: (select: (state: unknown) => unknown) =>
    select({ paneDragging: false, transform: [0, 0, 1] })
}));

import { BackgroundVariant } from 'reactflow';
import { GraphCanvas } from './graph-canvas';

function canvasProps(): ComponentProps<typeof GraphCanvas> {
  return {
    graphId: 'graph',
    isActive: true,
    isReadOnly: true,
    isLayoutLocked: false,
    isDark: false,
    mounted: true,
    isDraggingOver: false,
    dropPosition: null,
    onDragOver: vi.fn(),
    onDragLeave: vi.fn(),
    onDrop: vi.fn(),
    reactFlowRootElRef: { current: null },
    previewNodePosition: null,
    previewNodeOffset: { x: 0, y: 0 },
    suggestedNodeType: 'domain',
    nodeTypeOptions: [],
    reactFlowInstance: {} as ReactFlowInstance,
    isLoadingGraph: false,
    graphName: 'Test graph',
    recentCases: [],
    refreshRecentCases: vi.fn(async () => {}),
    addNodesToCase: vi.fn(async () => {}),
    openAddToCase: vi.fn(),
    openNewCaseDialogForNodes: vi.fn(),
    nodes: [
      {
        id: 'editable',
        position: { x: 10, y: 20 },
        data: { type: 'domain', label: 'example.org' },
        draggable: true,
        connectable: true,
        deletable: true,
        selectable: true,
        selected: true
      },
      {
        id: 'defaults',
        position: { x: 30, y: 40 },
        data: { type: 'domain', label: 'other.org' },
        selected: false
      },
      {
        id: 'restricted',
        position: { x: 50, y: 60 },
        data: { type: 'note', label: 'Keep this note' },
        draggable: false,
        connectable: false,
        deletable: false,
        selectable: false
      }
    ],
    edges: [
      { id: 'edge', source: 'editable', target: 'defaults', selected: true }
    ],
    onNodesChange: vi.fn(),
    onEdgesChange: vi.fn(),
    onConnect: vi.fn(),
    onConnectStart: vi.fn(),
    onConnectEnd: vi.fn(),
    onReconnect: vi.fn(),
    onReconnectStart: vi.fn(),
    onReconnectEnd: vi.fn(),
    onNodeClick: vi.fn(),
    onEdgeClick: vi.fn(),
    onPaneClick: vi.fn(),
    onPaneContextMenu: vi.fn(),
    onSelectionContextMenu: vi.fn(),
    onNodeContextMenu: vi.fn(),
    onEdgeContextMenu: vi.fn(),
    onNodeDragStart: vi.fn(),
    onNodeDrag: vi.fn(),
    isValidConnection: vi.fn(() => true),
    nodeTypes: {},
    edgeTypes: {},
    showGrid: true,
    backgroundPatternId: 'grid',
    backgroundVariant: BackgroundVariant.Dots,
    showMiniMap: true,
    nodeColorMap: {}
  };
}

function render(props: ComponentProps<typeof GraphCanvas>) {
  const html = renderToStaticMarkup(createElement(GraphCanvas, props));
  expect(flow.render).toHaveBeenCalled();
  return { html, canvas: flow.render.mock.calls.at(-1)![0] };
}

beforeEach(() => vi.clearAllMocks());

describe('GraphCanvas read-only interactions', () => {
  it('overrides explicit per-node edit flags without mutating the source graph', () => {
    const props = canvasProps();
    const original = structuredClone(props.nodes);
    props.nodes.forEach((node) => {
      Object.freeze(node.position);
      Object.freeze(node.data);
      Object.freeze(node);
    });
    Object.freeze(props.nodes);
    const { canvas } = render(props);

    expect(canvas.nodes).not.toBe(props.nodes);
    expect(canvas.nodes).toHaveLength(props.nodes.length);
    canvas.nodes!.forEach((node, index) => {
      expect(node).not.toBe(props.nodes[index]);
      expect(node.draggable).toBe(false);
      expect(node.connectable).toBe(false);
      expect(node.deletable).toBe(false);
      expect(node.selected).toBe(props.nodes[index].selected);
      expect(node.selectable).toBe(props.nodes[index].selectable);
      expect(node.position).toBe(props.nodes[index].position);
      expect(node.data).toBe(props.nodes[index].data);
    });
    expect(props.nodes).toEqual(original);
    expect(canvas.edges).toBe(props.edges);
    expect(canvas.nodesDraggable).toBe(false);
    expect(canvas.nodesConnectable).toBe(false);
    expect(canvas.deleteKeyCode).toBeNull();
    expect(canvas.edgesUpdatable).toBe(false);
  });

  it.each([false, true])(
    'keeps selection, pan, zoom and fit enabled with layout locked=%s',
    (isLayoutLocked) => {
      const props = { ...canvasProps(), isLayoutLocked };
      const { canvas, html } = render(props);
      for (const key of [
        'elementsSelectable',
        'panOnDrag',
        'zoomOnScroll',
        'zoomOnPinch',
        'zoomOnDoubleClick',
        'selectionOnDrag'
      ] as const) {
        expect(canvas[key]).toBe(true);
      }
      expect(canvas.multiSelectionKeyCode).toBe('Shift');
      expect(canvas.selectionKeyCode).toBe('Shift');
      expect(canvas.fitView).toBe(true);
      expect(canvas.fitViewOptions).toEqual({ padding: 0.4, maxZoom: 1 });
      expect(canvas.minZoom).toBeLessThan(1);
      expect(canvas.maxZoom).toBeGreaterThan(1);
      expect(html).not.toContain('inert');
      expect(flow.minimap).toHaveBeenCalledOnce();
      expect(flow.background).toHaveBeenCalledTimes(isLayoutLocked ? 0 : 1);
    }
  );

  it('forwards selection changes, detail clicks and inspection menus while locked', () => {
    const props = canvasProps();
    const { canvas } = render(props);
    const nodeChange = [
      { type: 'select' as const, id: 'editable', selected: false }
    ];
    const edgeChange = [
      { type: 'select' as const, id: 'edge', selected: false }
    ];
    canvas.onNodesChange!(nodeChange);
    canvas.onEdgesChange!(edgeChange);
    expect(props.onNodesChange).toHaveBeenCalledExactlyOnceWith(nodeChange);
    expect(props.onEdgesChange).toHaveBeenCalledExactlyOnceWith(edgeChange);
    const event = {} as React.MouseEvent;
    canvas.onNodeClick!(event, props.nodes[0]);
    canvas.onEdgeClick!(event, props.edges[0]);
    canvas.onPaneClick!(event);
    canvas.onNodeContextMenu!(event, props.nodes[0]);
    canvas.onEdgeContextMenu!(event, props.edges[0]);
    canvas.onSelectionContextMenu!(event, props.nodes);
    canvas.onPaneContextMenu!(event);
    expect(props.onNodeClick).toHaveBeenCalledWith(event, props.nodes[0]);
    expect(props.onEdgeClick).toHaveBeenCalledWith(event, props.edges[0]);
    expect(props.onPaneClick).toHaveBeenCalledWith(event);
    expect(props.onNodeContextMenu).toHaveBeenCalledWith(event, props.nodes[0]);
    expect(props.onEdgeContextMenu).toHaveBeenCalledWith(event, props.edges[0]);
    expect(props.onSelectionContextMenu).toHaveBeenCalledWith(
      event,
      props.nodes
    );
    expect(props.onPaneContextMenu).toHaveBeenCalledWith(event);
    expect(props.onConnect).not.toHaveBeenCalled();
    expect(props.onReconnect).not.toHaveBeenCalled();
    expect(props.onNodeDrag).not.toHaveBeenCalled();
  });

  it('uses original node preferences again after unlocking', () => {
    const props = { ...canvasProps(), isReadOnly: false };
    const originalNodes = props.nodes;
    expect(render(props).canvas.nodes).toBe(originalNodes);
    props.isReadOnly = true;
    expect(render(props).canvas.nodes![0].draggable).toBe(false);
    props.isReadOnly = false;
    const { canvas } = render(props);
    expect(canvas.nodes).toBe(originalNodes);
    expect(canvas.nodes![0].draggable).toBe(true);
    expect(canvas.nodes![0].connectable).toBe(true);
    expect(canvas.nodes![0].deletable).toBe(true);
    expect(canvas.nodes![2].draggable).toBe(false);
    expect(canvas.nodesDraggable).toBe(true);
    expect(canvas.nodesConnectable).toBe(true);
    expect(canvas.deleteKeyCode).toBe('Backspace');
  });

  it('hides mutation-only drop and connection previews while keeping the canvas usable', () => {
    const props = canvasProps();
    const flowToScreenPosition = vi.fn(
      (position: { x: number; y: number }) => position
    );
    props.reactFlowInstance = {
      flowToScreenPosition
    } as unknown as ReactFlowInstance;
    props.isDraggingOver = true;
    props.dropPosition = { x: 100, y: 120 };
    props.previewNodePosition = { x: 50, y: 60 };
    props.nodeTypeOptions = [{ value: 'domain', label: 'Domain' }];

    const locked = render(props);
    expect(locked.html).not.toContain('Rilascia file');
    expect(locked.html).not.toContain('New domain...');
    expect(flowToScreenPosition).not.toHaveBeenCalled();
    expect(locked.canvas.elementsSelectable).toBe(true);
    expect(locked.canvas.panOnDrag).toBe(true);
    expect(locked.canvas.zoomOnScroll).toBe(true);

    props.isReadOnly = false;
    const editable = render(props);
    expect(editable.html).toContain('Rilascia file');
    expect(editable.html).toContain('New domain...');
    expect(flowToScreenPosition).toHaveBeenCalledWith(
      props.previewNodePosition
    );
  });

  it('does not enable browsing controls for an inactive tab', () => {
    const { canvas } = render({ ...canvasProps(), isActive: false });
    for (const key of [
      'nodesDraggable',
      'nodesConnectable',
      'elementsSelectable',
      'panOnDrag',
      'zoomOnScroll',
      'zoomOnPinch',
      'zoomOnDoubleClick',
      'selectionOnDrag'
    ] as const) {
      expect(canvas[key]).toBe(false);
    }
    expect(canvas.deleteKeyCode).toBeNull();
    expect(canvas.multiSelectionKeyCode).toBeNull();
    expect(canvas.selectionKeyCode).toBeNull();
  });
});

import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  editable: true,
  epoch: 0,
  frozen: false,
  cells: [] as unknown[],
  refs: [] as { current: unknown }[],
  stateIndex: 0,
  refIndex: 0,
  effects: [] as (() => unknown)[],
  setState: vi.fn(),
  openTab: vi.fn(),
  copy: vi.fn(async () => {}),
  executeTransform: vi.fn(),
  executeFlow: vi.fn(),
  startFlow: vi.fn(async () => 'run'),
  addResults: vi.fn(),
  updateLog: vi.fn(),
  setEdges: vi.fn(),
  deleteElements: vi.fn(),
  participant: null as any,
  transforms: [
    {
      plugin: { id: 'plugin', name: 'Plugin' },
      transform: { id: 'transform', name: 'Run lookup' }
    }
  ]
}));

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useState: (initial: unknown) => {
    const index = state.stateIndex++;
    if (!(index in state.cells)) {
      state.cells[index] = typeof initial === 'function' ? initial() : initial;
    }
    return [
      state.cells[index],
      (value: any) => {
        state.setState(index, value);
        state.cells[index] =
          typeof value === 'function' ? value(state.cells[index]) : value;
      }
    ];
  },
  useRef: (initial: unknown) => {
    const index = state.refIndex++;
    return (state.refs[index] ??= { current: initial });
  },
  useCallback: (callback: unknown) => callback,
  useMemo: (callback: () => unknown) => callback(),
  useEffect: (callback: () => unknown) => {
    state.effects.push(callback);
  }
}));
vi.mock('react-dom', () => ({ createPortal: (children: unknown) => children }));
vi.mock('next/dynamic', () => ({ default: () => 'GraphNotesEditor' }));
vi.mock('framer-motion', () => ({
  AnimatePresence: 'AnimatePresence',
  motion: { div: 'div' }
}));
vi.mock('@/components/icons', async (importOriginal) =>
  Object.fromEntries(
    Object.keys(await importOriginal()).map((key) => [key, key])
  )
);
vi.mock('@/components/ui/adaptive-context-menu', () => ({
  useAdaptiveContextMenu: vi.fn()
}));
vi.mock('@/components/ui/button', () => ({ Button: 'Button' }));
vi.mock('@/components/ui/input', () => ({ Input: 'Input' }));
vi.mock('@/components/ui/badge', () => ({ Badge: 'Badge' }));
vi.mock('@/components/ui/scroll-area', () => ({ ScrollArea: 'ScrollArea' }));
vi.mock('@/components/ui/separator', () => ({ Separator: 'Separator' }));
vi.mock('@/components/ui/skeleton', () => ({ Skeleton: 'Skeleton' }));
vi.mock('@/components/ui/resizable', () => ({
  ResizableHandle: 'ResizableHandle',
  ResizablePanel: 'ResizablePanel'
}));
vi.mock('@/components/ui/accordion', () => ({
  Accordion: 'Accordion',
  AccordionContent: 'AccordionContent',
  AccordionItem: 'AccordionItem',
  AccordionTrigger: 'AccordionTrigger'
}));
vi.mock('@/components/ui/dialog', () => ({
  Dialog: 'Dialog',
  DialogContent: 'DialogContent',
  DialogDescription: 'DialogDescription',
  DialogHeader: 'DialogHeader',
  DialogTitle: 'DialogTitle'
}));
vi.mock('@/features/graph/contexts/graph-mutation-context', () => ({
  useGuardedReactFlow: () => ({
    setEdges: state.setEdges,
    deleteElements: state.deleteElements
  }),
  useGraphCanEdit: () => {
    const epoch = state.epoch;
    return () => state.editable && state.epoch === epoch;
  }
}));
vi.mock('@/features/graph/contexts/enabled-plugins-context', () => ({
  useEnabledPluginsContext: () => ({
    enabledPluginIds: [],
    addons: [],
    graphId: 'graph',
    pluginConfigs: {}
  })
}));
vi.mock('@/features/graph/contexts/transform-logger-context', () => ({
  useTransformLogger: () => ({
    addLog: () => 'log',
    logs: [],
    updateLog: state.updateLog,
    onAddResults: state.addResults
  })
}));
vi.mock('reactflow', () => ({
  useStore: (selector: any) =>
    selector({ transform: [0, 0, 1], edges: [], nodeInternals: new Map() }),
  getBezierPath: () => ['M 0 0 L 100 100', 50, 50],
  getStraightPath: () => ['M 0 0 L 100 100', 50, 50],
  getSmoothStepPath: () => ['M 0 0 L 100 100', 50, 50],
  EdgeLabelRenderer: 'EdgeLabelRenderer',
  BaseEdge: 'BaseEdge',
  Position: { Right: 'right', Left: 'left', Top: 'top', Bottom: 'bottom' }
}));
vi.mock('@/features/plugins', () => ({
  createTransformInput: vi.fn(),
  executeTransform: state.executeTransform,
  getTransformsForEntityType: () => state.transforms,
  matchesInputType: () => true
}));
vi.mock('@/features/plugins/registry', () => ({ findTransform: vi.fn() }));
vi.mock('@/features/flow/hooks/use-flows', () => ({
  fetchFlowDefinition: vi.fn(async () => ({
    nodes: [],
    edges: [],
    name: 'Flow'
  })),
  useFlows: () => ({
    flows: [
      { id: 'flow', name: 'Flow', triggerTypes: ['domain'], nodeCount: 1 }
    ],
    isLoading: false
  })
}));
vi.mock('@/features/flow/lib/execute-flow', () => ({
  executeFlow: state.executeFlow
}));
vi.mock('@/features/flow/lib/flow-run-recorder', () => ({
  startFlowRunRecord: state.startFlow,
  finishFlowRunRecord: vi.fn()
}));
vi.mock('@/features/osint/phosphor-icon-by-key', () => ({
  getPhosphorIconByKey: () => 'Icon'
}));
vi.mock('@/features/osint/node-registry', () => ({
  getGroupedPaletteItems: () => ({
    Entities: {
      _root: [{ value: 'domain', label: 'Domain' }],
      Social: [{ value: 'profile', label: 'Profile' }]
    }
  }),
  nodeTypeByType: {},
  getLogoUrlForDomain: () => null,
  getNodeTypeUiLabel: () => 'Domain'
}));
vi.mock('./logo-or-icon', () => ({ LogoOrIcon: 'LogoOrIcon' }));
vi.mock('@/features/graph/components/linkable-text', () => ({
  LinkableText: 'LinkableText'
}));
vi.mock('@/features/graph/utils/display-label', () => ({
  getNodeDisplayLabel: ({ label }: any) => label
}));
vi.mock('@/hooks/use-floating-panel', () => ({
  useFloatingPanel: () => ({
    floatingBoundsRef: { current: null },
    floatingRect: {},
    beginFloatingInteraction: vi.fn()
  }),
  FLOATING_RESIZE_HANDLES: []
}));
vi.mock('@/features/workspace/store/workspace-tabs-store', () => ({
  useWorkspaceTabsStore: (select: any) => select({ openTab: state.openTab })
}));
vi.mock('../hooks/use-graph-write-guard', () => ({
  useGraphWriteGuard: () => ({
    blocked: !state.editable,
    blockedRef: { current: !state.editable },
    status: state.editable ? 'editable' : 'locked',
    acceptSnapshot: vi.fn(),
    reject: vi.fn(),
    canEditSnapshot: () => state.editable,
    canSaveSnapshot: () => state.editable
  })
}));
vi.mock('../hooks/use-stale-reload', () => ({
  useStaleReload: vi.fn(),
  notifyReplacedDraft: vi.fn()
}));
vi.mock('../hooks/use-graph-participant', () => ({
  useGraphParticipant: (_id: string, participant: any) => {
    state.participant = participant;
  }
}));
vi.mock('@/features/graph/lib/graph-client-coordinator', () => ({
  graphClientCoordinator: {
    frozen: () => state.frozen,
    epoch: () => state.epoch,
    canSave: () => state.editable,
    noteConflict: () => false
  }
}));
vi.mock('./graph-sidepanel-bottom-bar', () => ({
  GraphSidepanelBottomBar: 'GraphSidepanelBottomBar'
}));
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() }
}));

import { OSINTEdge } from '../../osint-edge';
import { AnalysisEdgeContextMenu } from '../analysis/ui/analysis-edge-context-menu';
import { AnalysisNodeContextMenu } from '../analysis/ui/analysis-node-context-menu';
import { AnalysisSelectionContextMenu } from '../analysis/ui/analysis-selection-context-menu';
import { GraphNotesPanel } from './graph-notes-panel';
import { NodeContextMenu } from './node-context-menu';
import { OpenNodeDialogBody } from './open-node-dialog';
import { PaneContextMenu } from './pane-context-menu';
import { SelectionContextMenu } from './selection-context-menu';

type Element = ReactElement<Record<string, any>>;
function elements(tree: ReactNode): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!tree || typeof tree !== 'object' || !('props' in tree)) return [];
  const element = tree as Element;
  return [
    element,
    ...elements(element.props.children),
    ...elements(element.props.compactHeaderEnd)
  ];
}
function label(tree: ReactNode): string {
  if (Array.isArray(tree)) return tree.map(label).join('');
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (!tree || typeof tree !== 'object' || !('props' in tree)) return '';
  return label((tree as Element).props.children);
}
function render(component: (props: any) => ReactNode, props: any): ReactNode {
  state.stateIndex = 0;
  state.refIndex = 0;
  state.effects = [];
  return component(props);
}
function button(tree: ReactNode, name: string) {
  const found = elements(tree).find(
    (el) =>
      ['button', 'Button'].includes(el.type as string) &&
      label(el).trim() === name
  );
  expect(found, name).toBeDefined();
  return found!;
}
function menuProps() {
  const props: Record<string, any> = {
    position: { x: 0, y: 0 },
    flowPosition: { x: 1, y: 2 },
    sourcePosition: { x: 1, y: 2 },
    graphViewMode: 'free',
    lockedAxis: 'vertical',
    analysisLayoutEngine: 'force',
    nodeId: 'node',
    nodeType: 'domain',
    nodeLabel: 'example.com',
    nodeMetadata: {},
    selectedNodes: [{ id: 'one' }, { id: 'two' }],
    selectedEdges: [{ id: 'edge', data: {} }],
    recentCases: [{ id: 'case', name: 'Case' }],
    canMergeSelection: true,
    canUnmergeSelection: true,
    canUnmerge: true
  };
  for (const name of [
    'onClose',
    'onCopyLabel',
    'onOpenNode',
    'onEditLabel',
    'onToggleHeader',
    'onRename',
    'onDuplicate',
    'onChangeType',
    'onChangeColor',
    'onUnmerge',
    'onDelete',
    'onAddNode',
    'onFitView',
    'onZoomIn',
    'onZoomOut',
    'onApplyLayout',
    'onSetLockedAxis',
    'onApplyAnalysisLayout',
    'onRequestClearGraph',
    'onRefreshRecentCases',
    'onQuickAddToCase',
    'onOpenAllCases',
    'onOpenNewCase',
    'onChangeNodeType',
    'onLayoutSelection',
    'onAlignSelection',
    'onDeleteSelection',
    'onDuplicateSelection',
    'onCopySelection',
    'onChangeEdgeColor',
    'onChangeEdgeWidth',
    'onChangeEdgeType',
    'onToggleEdgeLabelVisible',
    'onToggleEdgeDashed',
    'onToggleEdgeHideDirection',
    'onToggleEdgeBidirectional',
    'onInvertEdgeDirection',
    'onMergeSelection',
    'onUnmergeSelection',
    'onChangeWidth',
    'onInvertDirection',
    'onChangeThickness',
    'onToggleDashed',
    'onToggleLabelVisible',
    'onToggleHideDirection',
    'onToggleBidirectional'
  ])
    props[name] = vi.fn();
  props.getSelectedNodes = () => [{ id: 'node' }];
  props.addToCase = {
    recentCases: props.recentCases,
    refreshRecentCases: vi.fn(),
    addNodesToCase: vi.fn(),
    openAllCasesDialog: vi.fn(),
    openNewCaseDialog: vi.fn()
  };
  return props;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.editable = true;
  state.frozen = false;
  state.epoch = 0;
  state.cells = [];
  state.refs = [];
  state.effects = [];
  state.participant = null;
  vi.stubGlobal('document', {
    body: {},
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  });
  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    setTimeout,
    clearTimeout
  });
  vi.stubGlobal('navigator', { clipboard: { writeText: state.copy } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        content: '<p>Saved note</p>',
        writeState: { version: 1, locked: state.frozen }
      })
    }))
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const menuCases: {
  name: string;
  component: (props: any) => ReactNode;
  mode: string;
  reads: string[];
}[] = [
  {
    name: 'pane/free',
    component: PaneContextMenu,
    mode: 'free',
    reads: ['Fit View', 'Zoom In', 'Zoom Out']
  },
  {
    name: 'pane/lanes',
    component: PaneContextMenu,
    mode: 'locked',
    reads: ['Fit View', 'Zoom In', 'Zoom Out']
  },
  {
    name: 'pane/analysis',
    component: PaneContextMenu,
    mode: 'analysis',
    reads: ['Fit View', 'Zoom In', 'Zoom Out']
  },
  {
    name: 'node',
    component: NodeContextMenu,
    mode: 'analysis',
    reads: ['Open Node', 'Copy value']
  },
  {
    name: 'selection',
    component: SelectionContextMenu,
    mode: 'free',
    reads: ['Copy']
  },
  {
    name: 'analysis node',
    component: AnalysisNodeContextMenu,
    mode: 'analysis',
    reads: ['Copy value']
  },
  {
    name: 'analysis edge',
    component: AnalysisEdgeContextMenu,
    mode: 'analysis',
    reads: []
  },
  {
    name: 'analysis selection',
    component: AnalysisSelectionContextMenu,
    mode: 'analysis',
    reads: ['Copy']
  }
];

describe.each(menuCases)(
  '$name readonly menu',
  ({ component, mode, reads }) => {
    it('keeps read actions available and visibly disables every write action', () => {
      state.editable = false;
      const props: Record<string, any> = {
        ...menuProps(),
        graphViewMode: mode
      };
      const tree = render(component, props);
      const controls = elements(tree).filter((el) =>
        ['button', 'Button'].includes(el.type as string)
      );
      for (const control of controls) {
        const name = label(control).trim();
        if (reads.includes(name) || name === 'Cancel') {
          expect(control.props.disabled, name).not.toBe(true);
        } else {
          expect(control.props.disabled, name).toBe(true);
          if (control.type === 'button')
            expect(control.props.className, name).toContain('disabled:opacity');
          control.props.onClick?.();
        }
      }
      expect(
        Object.values(props)
          .filter((value) => vi.isMockFunction(value))
          .every((fn) => fn.mock.calls.length === 0)
      ).toBe(true);
      for (const read of reads) button(tree, read).props.onClick();
      for (const el of elements(tree)) el.props.onMouseEnter?.();
      expect(state.setState).not.toHaveBeenCalled();
      expect(state.executeTransform).not.toHaveBeenCalled();
      expect(state.executeFlow).not.toHaveBeenCalled();
    });

    it('guards callbacks retained from open submenus when a lock arrives', () => {
      const props: Record<string, any> = {
        ...menuProps(),
        graphViewMode: mode
      };
      // Walk every reachable hover submenu while editable, then invoke its stale actions.
      const snapshots: unknown[][] = [[]];
      const seen = new Set<string>();
      for (let i = 0; i < snapshots.length; i++) {
        state.cells = [...snapshots[i]];
        const tree = render(component, props);
        const snapshot = [...state.cells];
        for (const el of elements(tree)) {
          if (!el.props.onMouseEnter) continue;
          state.cells = [...snapshot];
          el.props.onMouseEnter();
          const key = JSON.stringify(state.cells);
          if (!seen.has(key)) {
            seen.add(key);
            snapshots.push([...state.cells]);
          }
        }
        state.cells = snapshot;
        state.editable = false;
        state.epoch++;
        const lockedTree = render(component, props);
        for (const control of elements(lockedTree).filter(
          (el) => el.type === 'button'
        )) {
          if (!reads.includes(label(control).trim()))
            expect(control.props.disabled, label(control)).toBe(true);
        }
        vi.clearAllMocks();
        for (const control of elements(tree)) {
          if (
            reads.includes(label(control).trim()) ||
            label(control).trim() === 'Cancel'
          )
            continue;
          control.props.onClick?.();
        }
        expect(
          Object.values(props)
            .filter((value) => vi.isMockFunction(value))
            .every((fn) => fn.mock.calls.length === 0)
        ).toBe(true);
        expect(state.setState).not.toHaveBeenCalled();
        expect(state.executeTransform).not.toHaveBeenCalled();
        expect(state.executeFlow).not.toHaveBeenCalled();
        for (const fn of Object.values(props.addToCase).filter((value) =>
          vi.isMockFunction(value)
        ))
          expect(fn).not.toHaveBeenCalled();
        state.editable = true;
      }
      expect(snapshots.length).toBeGreaterThan(1);
    });
  }
);

function dialogProps() {
  return {
    nodeId: 'node',
    nodeData: {
      type: 'domain',
      label: 'Saved value',
      metadata: { source: 'Saved source' }
    },
    titleLabel: 'Domain',
    headerBgClassName: '',
    headerTextClassName: '',
    Icon: 'Icon',
    isEditMode: true,
    editedLabel: 'Draft value',
    editedMetadata: { source: 'Draft source' },
    newMetaKey: 'new',
    newMetaValue: 'draft',
    availableTransformNames: ['Transform'],
    setIsEditMode: vi.fn(),
    setEditedLabel: vi.fn(),
    setEditedMetadata: vi.fn(),
    setNewMetaKey: vi.fn(),
    setNewMetaValue: vi.fn(),
    onUpdateMetadataValue: vi.fn(),
    onRemoveMetadataKey: vi.fn(),
    onAddMetadataKeyValue: vi.fn(),
    onSave: vi.fn(),
    onDelete: vi.fn()
  };
}

describe('node details during a lock', () => {
  it('shows saved details instead of an editable draft and discards pending edits', () => {
    state.editable = false;
    const props = dialogProps();
    const tree = render(OpenNodeDialogBody, props);
    expect(
      elements(tree).some((el) =>
        ['Input', 'textarea'].includes(el.type as string)
      )
    ).toBe(false);
    expect(
      elements(tree)
        .filter((el) => el.type === 'LinkableText')
        .map((el) => el.props.text)
    ).toContain('Saved value');
    expect(button(tree, 'Edit').props.disabled).toBe(true);
    expect(button(tree, 'Delete').props.disabled).toBe(true);
    button(tree, 'Edit').props.onClick();
    button(tree, 'Delete').props.onClick();
    expect(props.setIsEditMode).not.toHaveBeenCalled();
    expect(props.onDelete).not.toHaveBeenCalled();
    state.effects.forEach((effect) => effect());
    expect(props.setIsEditMode).toHaveBeenCalledWith(false);
    expect(props.setEditedLabel).toHaveBeenCalledWith('Saved value');
    expect(props.setEditedMetadata).toHaveBeenCalledWith(
      props.nodeData.metadata
    );
    expect(props.setNewMetaKey).toHaveBeenCalledWith('');
    expect(props.setNewMetaValue).toHaveBeenCalledWith('');
  });

  it.each(['domain', 'note'])(
    'guards stale %s editing, save and keyboard handlers even after unlock',
    (type) => {
      const props = dialogProps();
      props.nodeData.type = type;
      const tree = render(OpenNodeDialogBody, props);
      state.editable = false;
      state.epoch++;
      const event = {
        target: { value: 'Blocked' },
        key: 'Enter',
        ctrlKey: true,
        preventDefault: vi.fn()
      };
      for (const editable of [false, true]) {
        state.editable = editable;
        for (const el of elements(tree)) {
          if (label(el).trim() === 'Cancel') continue;
          el.props.onChange?.(event);
          el.props.onKeyDown?.(event);
          el.props.onClick?.();
        }
      }
      for (const fn of Object.values(props).filter((value) =>
        vi.isMockFunction(value)
      ))
        expect(fn).not.toHaveBeenCalled();
    }
  );
});

function hover(component: (props: any) => ReactNode, props: any, name: string) {
  const tree = render(component, props);
  const trigger = elements(tree)
    .filter((el) => el.props.onMouseEnter && label(el).trim() === name)
    .at(-1);
  expect(trigger, name).toBeDefined();
  trigger!.props.onMouseEnter();
  return render(component, props);
}

describe.each([NodeContextMenu, AnalysisNodeContextMenu])(
  'late transform results',
  (component) => {
    it.each([false, true])(
      'does not apply results after ownership changes (async job: %s)',
      async (asyncJob) => {
        const props = menuProps();
        let finish!: (value: any) => void;
        const pending = new Promise((resolve) => {
          finish = resolve;
        });
        if (asyncJob) {
          state.executeTransform.mockResolvedValue({
            success: true,
            async: true,
            jobId: 'job'
          });
          vi.mocked(fetch).mockReturnValue(pending as Promise<Response>);
        } else {
          state.executeTransform.mockReturnValue(pending);
        }
        hover(
          component,
          props,
          component === NodeContextMenu ? 'Transform' : 'Transforms'
        );
        const tree = hover(component, props, 'Plugin');
        button(tree, 'Run lookup').props.onClick();
        await vi.waitFor(() =>
          expect(asyncJob ? fetch : state.executeTransform).toHaveBeenCalled()
        );
        state.editable = false;
        state.epoch++;
        // A completed run may unlock before the old request resolves.
        state.editable = true;
        const result = { entities: [{ id: 'result' }], edges: [] };
        finish(
          asyncJob
            ? { ok: true, json: async () => ({ isCompleted: true, result }) }
            : { success: true, ...result }
        );
        await vi.waitFor(() =>
          expect(state.updateLog).toHaveBeenCalledWith(
            'log',
            expect.objectContaining({ status: 'completed' })
          )
        );
        expect(state.addResults).not.toHaveBeenCalled();
      }
    );
  }
);

it('does not start a flow after its run-record request crosses a lock', async () => {
  const props = { ...menuProps(), graphViewMode: 'analysis' };
  let finish!: (id: string) => void;
  state.startFlow.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const tree = hover(NodeContextMenu, props, 'Flows');
  const flow = elements(tree).find(
    (el) => el.type === 'button' && label(el).startsWith('Flow0 transforms')
  )!;
  flow.props.onClick();
  await vi.waitFor(() => expect(state.startFlow).toHaveBeenCalled());
  state.editable = false;
  state.epoch++;
  finish('run');
  await vi.waitFor(() =>
    expect(state.updateLog).toHaveBeenCalledWith(
      'log',
      expect.objectContaining({ status: 'failed' })
    )
  );
  expect(state.executeFlow).not.toHaveBeenCalled();
});

it('discards a pending merged transform confirmation when locked', () => {
  const props = menuProps();
  props.nodeMetadata = {
    __merge: {},
    merged: [{ value: 'other.example.com' }]
  };
  hover(NodeContextMenu, props, 'Transform');
  button(hover(NodeContextMenu, props, 'Plugin'), 'Run lookup').props.onClick();
  expect(
    elements(render(NodeContextMenu, props)).some(
      (el) => el.type === 'Dialog' && el.props.open
    )
  ).toBe(true);
  state.editable = false;
  const locked = render(NodeContextMenu, props);
  expect(
    elements(locked)
      .filter((el) => el.type === 'Dialog')
      .every((el) => !el.props.open)
  ).toBe(true);
  state.effects.forEach((effect) => effect());
  state.editable = true;
  expect(
    elements(render(NodeContextMenu, props))
      .filter((el) => el.type === 'Dialog')
      .every((el) => !el.props.open)
  ).toBe(true);
  expect(state.executeTransform).not.toHaveBeenCalled();
});

function visibleEdge() {
  const props = {
    id: 'edge',
    source: 'one',
    target: 'two',
    sourceX: 0,
    sourceY: 0,
    targetX: 100,
    targetY: 100,
    sourcePosition: 'right',
    targetPosition: 'left',
    selected: true,
    data: { label: 'Saved label' }
  };
  const detailed = (OSINTEdge as any).type(props) as Element;
  const visible = render(detailed.type as any, detailed.props) as Element;
  return () => render(visible.type as any, visible.props);
}
function edgeMenuElement(tree: ReactNode) {
  return elements(tree).find(
    (el) => typeof el.type === 'function' && el.type.name === 'EdgeContextMenu'
  )!;
}
const contextEvent = () => ({
  preventDefault: vi.fn(),
  stopPropagation: vi.fn(),
  clientX: 10,
  clientY: 20
});

describe('inline edge browsing', () => {
  it('allows hover, label selection, copying and context menus but cannot enter label editing', () => {
    state.editable = false;
    const draw = visibleEdge();
    const tree = draw() as Element;
    tree.props.onMouseEnter();
    const labelEl = elements(tree).find((el) => el.props.onDoubleClick)!;
    expect(labelEl.props.className).toContain('select-text');
    expect(labelEl.props.title).toBe('Read-only');
    state.setState.mockClear();
    labelEl.props.onDoubleClick();
    expect(state.setState).not.toHaveBeenCalled();
    tree.props.onContextMenu(contextEvent());
    const menu = edgeMenuElement(draw());
    expect(menu).toBeDefined();
    menu.props.onCopyLabel();
    expect(state.copy).toHaveBeenCalledWith('Saved label');
    menu.props.onEditLabel();
    expect(elements(draw()).some((el) => el.type === 'Input')).toBe(false);
  });

  it('closes an active label editor and rejects its stale change handler across unlock', () => {
    const draw = visibleEdge();
    elements(draw())
      .find((el) => el.props.onDoubleClick)!
      .props.onDoubleClick();
    const input = elements(draw()).find((el) => el.type === 'Input')!;
    expect(input).toBeDefined();
    state.editable = false;
    state.epoch++;
    state.setState.mockClear();
    input.props.onChange({ target: { value: 'Blocked draft' } });
    expect(state.setState).not.toHaveBeenCalled();
    expect(state.setEdges).not.toHaveBeenCalled();
    expect(elements(draw()).some((el) => el.type === 'Input')).toBe(false);
    state.effects.forEach((effect) => effect());
    state.editable = true;
    input.props.onChange({ target: { value: 'Stale draft' } });
    expect(elements(draw()).some((el) => el.type === 'Input')).toBe(false);
    expect(label(draw())).toContain('Saved label');
    expect(state.setEdges).not.toHaveBeenCalled();
  });

  it.each([null, 'type', 'color', 'thickness', 'direction'])(
    'disables and guards the internal %s menu without blocking copy',
    (submenu) => {
      const draw = visibleEdge();
      (draw() as Element).props.onContextMenu(contextEvent());
      const menu = edgeMenuElement(draw());
      state.cells = [submenu];
      state.refs = [];
      const props: Record<string, any> = {
        ...menuProps(),
        onChangeThickness: vi.fn()
      };
      const stale = render(menu.type as any, props);
      state.editable = false;
      state.epoch++;
      const locked = render(menu.type as any, props);
      for (const el of elements(locked).filter((el) => el.type === 'button')) {
        if (label(el).trim() === 'Copy label')
          expect(el.props.disabled).not.toBe(true);
        else {
          expect(el.props.disabled, label(el)).toBe(true);
          expect(el.props.className).toContain('disabled:opacity');
        }
      }
      vi.clearAllMocks();
      for (const el of elements(stale)) {
        if (label(el).trim() !== 'Copy label') el.props.onClick?.();
      }
      for (const fn of Object.values(props).filter((value) =>
        vi.isMockFunction(value)
      ))
        expect(fn).not.toHaveBeenCalled();
      button(locked, 'Copy label').props.onClick();
      expect(props.onCopyLabel).toHaveBeenCalledOnce();
    }
  );
});

function notesProps() {
  return {
    graphId: 'graph',
    graphName: 'Graph',
    nodes: [{ id: 'node', data: { type: 'domain', label: 'example.com' } }],
    notesPanelRef: { current: null },
    lastOpenNotesSizeRef: { current: 25 },
    notesStateFromResizeRef: { current: false },
    isNotesPanelOpen: true,
    setIsNotesPanelOpen: vi.fn(),
    isDetached: false,
    detachNotesPanel: vi.fn(),
    attachNotesPanel: vi.fn(),
    notesCollapsedSizePct: 0,
    notesMinSizePct: 10,
    notesMaxSizePct: 50,
    closeNotesPanel: vi.fn(),
    onSelectNodeId: vi.fn()
  };
}
async function loadNotes(props: ReturnType<typeof notesProps>) {
  render(GraphNotesPanel, props);
  state.effects.forEach((effect) => effect());
  await vi.waitFor(() => expect(state.cells[2]).toBe(true));
  return render(GraphNotesPanel, props);
}

describe('notes browsing during a lock', () => {
  it('drops a first-read response after the ownership epoch changes', async () => {
    state.editable = false;
    state.frozen = true;
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const props = notesProps();
    render(GraphNotesPanel, props);
    state.effects.forEach((effect) => effect());
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    state.epoch++;
    finish({
      ok: true,
      json: async () => ({
        content: 'Stale note',
        writeState: { version: 1, locked: true }
      })
    } as Response);
    await vi.waitFor(() => expect(state.cells[1]).toBe(false));
    expect(state.cells[2]).toBe(false);
    expect(state.cells[0]).toBe('');
  });

  it('loads the first readonly snapshot without an inert surface and keeps browsing controls live', async () => {
    state.editable = false;
    state.frozen = true;
    const props = notesProps();
    const tree = await loadNotes(props);
    const editor = elements(tree).find((el) => el.type === 'GraphNotesEditor')!;
    expect(editor.props.readOnly).toBe(true);
    expect(editor.props.content).toBe('<p>Saved note</p>');
    expect(elements(tree).some((el) => el.props.inert)).toBe(false);
    editor.props.onOpenReference(editor.props.references[0]);
    expect(props.onSelectNodeId).toHaveBeenCalledWith('node');
    elements(tree)
      .find(
        (el) => el.props['aria-label'] === 'Detach notes into a floating window'
      )!
      .props.onClick();
    elements(tree)
      .find((el) => el.props['aria-label'] === 'Hide graph notes')!
      .props.onClick();
    expect(props.detachNotesPanel).toHaveBeenCalledOnce();
    expect(props.closeNotesPanel).toHaveBeenCalledOnce();
    vi.clearAllMocks();
    editor.props.onChange('<p>Blocked draft</p>');
    editor.props.onSave();
    const create = elements(tree).find(
      (el) => el.props['aria-label'] === 'Create case note and open it in a tab'
    )!;
    expect(create.props.disabled).toBe(true);
    create.props.onClick();
    await Promise.resolve();
    expect(state.setState).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    state.editable = true;
    expect(
      elements(render(GraphNotesPanel, props)).find(
        (el) => el.type === 'GraphNotesEditor'
      )!.props.content
    ).toBe('<p>Saved note</p>');
  });

  it('opens a linked case note without POST or autosave when locked', async () => {
    state.editable = false;
    state.frozen = true;
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        content: '',
        writeState: { version: 1, locked: true },
        caseNote: { id: 'note', caseId: 'case', name: 'Linked note' }
      })
    } as Response);
    const tree = await loadNotes(notesProps());
    const open = elements(tree).find(
      (el) => el.props['aria-label'] === 'Open linked case note in a tab'
    )!;
    expect(open.props.disabled).toBe(false);
    vi.clearAllMocks();
    open.props.onClick();
    await Promise.resolve();
    expect(state.openTab).toHaveBeenCalledWith({
      kind: 'note',
      resourceId: 'case/note',
      title: 'Linked note'
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});

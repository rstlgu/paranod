import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps, ReactElement, ReactNode } from 'react';

// Exercise component handlers and lock transitions without a browser dependency.
const hooks = vi.hoisted(() => {
  let cursor = 0;
  let dirty = false;
  const cells: any[] = [];
  const effects: Array<() => void> = [];
  return {
    react: {
      memo: (component: unknown) => component,
      useMemo: (factory: () => unknown) => factory(),
      useCallback: (callback: unknown) => callback,
      useRef(value: unknown) {
        return (cells[cursor++] ??= { current: value });
      },
      useState(initial: unknown) {
        const index = cursor++;
        cells[index] ??= {
          value: typeof initial === 'function' ? initial() : initial
        };
        return [cells[index].value, (next: any) => {
          const value = typeof next === 'function' ? next(cells[index].value) : next;
          if (!Object.is(value, cells[index].value)) dirty = true;
          cells[index].value = value;
        }];
      },
      useEffect(callback: () => void, deps: unknown[]) {
        const index = cursor++;
        const previous = cells[index];
        if (previous && deps.every((dep, i) => Object.is(dep, previous.deps[i]))) return;
        cells[index] = { deps };
        effects.push(callback);
      }
    },
    render<T>(component: () => T, flushEffects = true): T {
      let result: T;
      let attempts = 0;
      do {
        cursor = 0;
        dirty = false;
        result = component();
        if (flushEffects) effects.splice(0).forEach((effect) => effect());
        if (++attempts > 10) throw new Error('Component did not settle');
      } while (flushEffects && dirty);
      return result;
    },
    reset() {
      cells.length = 0;
      effects.length = 0;
      cursor = 0;
    }
  };
});
const logger = vi.hoisted(() => ({
  logs: [{ id: 'log', transformName: 'Lookup', status: 'running' }],
  clearLogs: vi.fn()
}));
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  ...hooks.react
}));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('reactflow', () => ({
  BackgroundVariant: { Dots: 'dots', Lines: 'lines', Cross: 'cross' }
}));
vi.mock('@/features/agent/components/agent-toggle-button', () => ({ AgentToggleButton: () => null }));
vi.mock('@/features/graph/contexts/transform-logger-context', () => ({ useTransformLogger: () => logger }));
vi.mock('@/features/graph/components/transform-logger', () => ({ TransformActivityDock: () => null }));
vi.mock('@/features/graph/components/graph-console-dock', () => ({ GraphConsoleDock: () => null }));
vi.mock('@/features/osint/node-registry', () => ({
  nodeTypeByType: { domain: { label: 'Domain', ui: {} }, note: { label: 'Note', ui: {} } },
  getGroupedPaletteItems: () => ({ Entities: { _root: [{ value: 'domain', label: 'Domain' }] } }),
  getLogoUrlForDomain: () => undefined,
  getLogoUrlForNodeType: () => undefined
}));
vi.mock('@/features/osint/phosphor-icon-by-key', () => ({ getPhosphorIconByKey: () => () => null }));
vi.mock('../analysis/canvas/analysis-transform', () => ({
  transformRelationalToAnalysisGraphData: () => ({ nodes: [], links: [] })
}));
vi.mock('../analysis/canvas/render-node', () => ({ renderAnalysisNode: vi.fn() }));
vi.mock('../analysis/canvas/render-link', () => ({ renderAnalysisLink: vi.fn() }));
vi.mock('../analysis/canvas/icon-cache', () => ({ loadTablerIcon: vi.fn() }));
vi.mock('../analysis/canvas/logo-cache', () => ({ loadLogoWithRetry: vi.fn() }));
vi.mock('@/features/graph/relational-layout/relational-layout-client', () => ({ computeRelationalPositions: vi.fn() }));

import { GraphTopbar } from './graph-topbar';
import { GraphSidebar } from './graph-sidebar';
import { GraphDetailsPanel } from './graph-details-panel';
import { GraphBottomDock } from './graph-bottom-dock';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction } from '@/components/ui/alert-dialog';
import { DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/components/ui/dropdown-menu';
import { TreeView } from '@/components/ui/tree-view';
import { GraphConsoleDock } from '../../graph-console-dock';
import { TransformActivityDock } from '../../transform-logger';

type Element = ReactElement<Record<string, any>>;
function elements(tree: ReactNode): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!tree || typeof tree !== 'object' || !('props' in tree)) return [];
  const element = tree as Element;
  return [element, ...elements(element.props.children)];
}
function text(tree: ReactNode): string {
  if (Array.isArray(tree)) return tree.map(text).join('');
  if (tree && typeof tree === 'object' && 'props' in tree) return text((tree as Element).props.children);
  return typeof tree === 'string' || typeof tree === 'number' ? String(tree) : '';
}
function find(tree: ReactNode, predicate: (element: Element) => boolean): Element {
  const found = elements(tree).find(predicate);
  expect(found).toBeDefined();
  return found!;
}
function control(tree: ReactNode, label: string): Element {
  return find(tree, ({ props }) => (
    props.title === label || props['aria-label'] === label ||
    (typeof props.onClick === 'function' && text(props.children) === label)
  ));
}
function click(element: Element) {
  expect(element.props.disabled).not.toBe(true);
  element.props.onClick?.({ preventDefault: vi.fn(), stopPropagation: vi.fn() });
}
function expectNoInert(tree: ReactNode) {
  expect(elements(tree).some(({ props }) => props.inert)).toBe(false);
}

function topbarProps(): ComponentProps<typeof GraphTopbar> {
  return {
    isReadOnly: true, graphId: 'graph', isSidebarOpen: true, isDetailsPanelOpen: true,
    isNotesPanelOpen: false, isBottomDockExpanded: true, canUndo: true, canRedo: true,
    undo: vi.fn(), redo: vi.fn(), openTopbarMenuId: null, openTopbarMenu: vi.fn(),
    openTopbarMenuOnHover: vi.fn(), scheduleCloseTopbarMenus: vi.fn(),
    cancelCloseTopbarMenus: vi.fn(), setOpenTopbarMenuId: vi.fn(), activeGraphCase: null,
    onActiveGraphCaseChange: vi.fn(), edges: [{ id: 'edge', source: 'a', target: 'b' }],
    setEdges: vi.fn(), setCurrentEdgeType: vi.fn(), showGrid: true, setShowGrid: vi.fn(),
    showMiniMap: true, setShowMiniMap: vi.fn(), setBackgroundVariant: vi.fn(),
    graphViewMode: 'free', setGraphViewMode: vi.fn(), lockedAxis: 'vertical', setLockedAxis: vi.fn(),
    layoutSettings: { direction: 'LR', spacingPreset: 'normal', quality: 'balanced', considerEdgeLabels: true },
    setLayoutSettings: vi.fn(), applyLayout: vi.fn(),
    analysisLayoutSettings: {
      engine: 'force', hierarchyDirection: 'TB', density: 'normal', quality: 'balanced',
      showLabels: true, gravityStrength: 0.06, maxRadius: null
    },
    applyAnalysisLayout: vi.fn(), handleFitView: vi.fn(), canFitViewToSelected: true,
    handleFitViewToSelected: vi.fn(), handleZoomIn: vi.fn(), handleZoomOut: vi.fn(),
    exportPNG: vi.fn(), exportPNGHighRes: vi.fn(), exportJPEG: vi.fn(), exportHTML: vi.fn(),
    exportGraph: vi.fn(), importGraph: vi.fn(), nodeTypeFilter: null, setNodeTypeFilter: vi.fn(),
    availableNodeTypes: ['domain'], refreshGraph: vi.fn(), saveStatus: { triggerManualSave: vi.fn() },
    toggleSidebar: vi.fn(), toggleNotesPanel: vi.fn(), openSidebarEntities: vi.fn(),
    openSidebarAdd: vi.fn(), handleBottomTabClick: vi.fn()
  };
}
function sidebarProps(): ComponentProps<typeof GraphSidebar> {
  return {
    isReadOnly: true, sidebarPanelRef: { current: null }, lastOpenSidebarSizeRef: { current: 20 },
    sidebarStateFromResizeRef: { current: false }, isSidebarOpen: true, setIsSidebarOpen: vi.fn(),
    sidebarCollapsedSizePct: 0, sidebarMinSizePct: 15, sidebarMaxSizePct: 30,
    sidebarTab: 'entities', setSidebarTab: vi.fn(), toggleSidebar: vi.fn(),
    sidebarSearchQuery: '', setSidebarSearchQuery: vi.fn(), sidebarSearchInputRef: { current: null },
    nodeCount: 2, selectedNodeCount: 2, selectedNodeIds: ['a', 'b'],
    onFitViewToSelection: vi.fn(), onSelectAll: vi.fn(), onDeleteSelection: vi.fn(),
    onClearSelection: vi.fn(), canMergeSelection: true, onMergeSelection: vi.fn(),
    canUnmergeSelection: true, onUnmergeSelection: vi.fn(),
    nodeTypeOptions: [{ value: 'domain', label: 'Domain' }],
    filteredGraphTreeData: [{ id: 'a', name: 'example.org', data: { nodeId: 'a', type: 'domain' } }],
    getGraphNodeCheckState: () => false, toggleCheckedGraphNode: vi.fn(), getMergedChildCount: () => 0,
    handleSelectNodeFromTree: vi.fn(), nodeRowElByIdRef: { current: new Map() },
    setEntitiesScrollRootEl: vi.fn(), openedAddSidebarCategories: ['Entities'],
    filteredGroupedNodeTypesForSidebar: { Entities: { _root: [{ value: 'domain', label: 'Domain' }] } },
    normalizeSidebarSearchQuery: (query) => query.trim(), addNode: vi.fn(), dndNodeTypeMime: 'application/node'
  };
}
function detailsProps(): ComponentProps<typeof GraphDetailsPanel> {
  return {
    isReadOnly: true, detailsPanelRef: { current: null }, lastOpenDetailsSizeRef: { current: 20 },
    detailsStateFromResizeRef: { current: false }, isDetailsPanelOpen: true, setIsDetailsPanelOpen: vi.fn(),
    detailsCollapsedSizePct: 0, detailsMinSizePct: 15, detailsMaxSizePct: 30,
    closeDetailsPanel: vi.fn(), isDark: false, graphViewMode: 'free',
    nodes: [
      { id: 'a', position: { x: 0, y: 0 }, selected: true, data: { type: 'domain', label: 'example.org', metadata: { owner: 'Alice' } } },
      { id: 'b', position: { x: 10, y: 0 }, data: { type: 'domain', label: 'other.org' } }
    ],
    edges: [{ id: 'edge', source: 'a', target: 'b', data: { relationship: 'owns' } }],
    onUpdateNode: vi.fn(), onSelectNodeId: vi.fn(), onSelectEdgeId: vi.fn()
  };
}

beforeEach(() => {
  hooks.reset();
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

describe('read-only graph topbar', () => {
  it('allows all view modes, fit, filters, notes, refresh and every export without graph writes', () => {
    const props = topbarProps();
    const tree = hooks.render(() => GraphTopbar(props));
    expectNoInert(tree);
    const mode = find(tree, (el) => el.type === Select && el.props.value === 'free');
    expect(mode.props.disabled).not.toBe(true);
    for (const value of ['free', 'locked', 'analysis', 'map']) mode.props.onValueChange(value);
    expect(props.setGraphViewMode).toHaveBeenCalledTimes(4);
    expect(props.setLockedAxis).not.toHaveBeenCalled();
    for (const callback of [
      props.handleFitView, props.handleFitViewToSelected, props.openSidebarEntities,
      props.toggleNotesPanel, props.refreshGraph, props.exportPNG, props.exportPNGHighRes,
      props.exportJPEG, props.exportHTML, props.exportGraph
    ]) {
      click(find(tree, ({ props }) => props.onClick === callback));
      expect(callback).toHaveBeenCalledOnce();
    }
    click(control(tree, 'Show all'));
    click(control(tree, 'Hide Grid'));
    click(control(tree, 'Hide MiniMap'));
    expect(props.setNodeTypeFilter).toHaveBeenCalledWith(null);
    expect(props.setShowGrid).toHaveBeenCalledOnce();
    expect(props.setShowMiniMap).toHaveBeenCalledOnce();
    expect(props.setEdges).not.toHaveBeenCalled();
    expect(props.applyLayout).not.toHaveBeenCalled();
    expect(props.applyAnalysisLayout).not.toHaveBeenCalled();
  });

  it('blocks history, imports, saves, edge styles and pending layout actions', () => {
    const props = topbarProps();
    const tree = hooks.render(() => GraphTopbar(props));
    for (const label of ['Undo', 'Redo', 'Left to right', 'Top to bottom', 'Import JSON',
      'Bezier (Curved)', 'Blue', 'Thin', 'Hide Label', 'Dashed Line']) {
      const item = find(tree, (el) => el.props.title === label || el.props['aria-label'] === label ||
        (el.props.disabled === true && text(el.props.children) === label));
      expect(item.props.disabled).toBe(true);
      item.props.onClick?.();
    }
    const save = find(tree, (el) => el.type === Button &&
      String(el.props.onClick).includes('triggerManualSave'));
    expect(save.props.disabled).toBe(true);
    save.props.onClick();
    expect(props.undo).not.toHaveBeenCalled();
    expect(props.redo).not.toHaveBeenCalled();
    expect(props.importGraph).not.toHaveBeenCalled();
    expect(props.setEdges).not.toHaveBeenCalled();
    expect(props.setCurrentEdgeType).not.toHaveBeenCalled();
    expect(props.saveStatus!.triggerManualSave).not.toHaveBeenCalled();
    expect(elements(hooks.render(() => GraphTopbar(props))).filter((el) => el.type === AlertDialog)
      .every((el) => !el.props.open)).toBe(true);
  });

  it.each(['free', 'analysis'] as const)('cancels an open %s layout confirmation on lock', (mode) => {
    const props = { ...topbarProps(), isReadOnly: false, graphViewMode: mode };
    let tree = hooks.render(() => GraphTopbar(props));
    click(control(tree, mode === 'free' ? 'Left to right' : 'Force layout'));
    tree = hooks.render(() => GraphTopbar(props));
    expect(elements(tree).some((el) => el.type === AlertDialog && el.props.open)).toBe(true);
    props.isReadOnly = true;
    tree = hooks.render(() => GraphTopbar(props), false);
    for (const action of elements(tree).filter((el) => el.type === AlertDialogAction)) {
      expect(action.props.disabled).toBe(true);
      action.props.onClick();
    }
    props.isReadOnly = false;
    tree = hooks.render(() => GraphTopbar(props));
    expect(elements(tree).filter((el) => el.type === AlertDialog).every((el) => !el.props.open)).toBe(true);
    expect(props.applyLayout).not.toHaveBeenCalled();
    expect(props.applyAnalysisLayout).not.toHaveBeenCalled();
    expect(props.setLayoutSettings).not.toHaveBeenCalled();
  });

  it('dismisses pending layouts on lock without requiring any further interaction', () => {
    const props = { ...topbarProps(), isReadOnly: false };
    click(control(hooks.render(() => GraphTopbar(props)), 'Left to right'));
    props.isReadOnly = true;
    const tree = hooks.render(() => GraphTopbar(props));
    expect(elements(tree).filter((el) => el.type === AlertDialog).every((el) => !el.props.open)).toBe(true);
    expect(props.applyLayout).not.toHaveBeenCalled();
  });

  it.each(['force', 'hierarchy'] as const)('disables every %s layout option but keeps zoom usable', (engine) => {
    const props = topbarProps();
    props.graphViewMode = 'analysis';
    props.analysisLayoutSettings.engine = engine;
    const tree = hooks.render(() => GraphTopbar(props));
    for (const item of elements(tree).filter((el) => el.type === DropdownMenuRadioItem)) {
      expect(item.props.disabled).toBe(true);
    }
    for (const group of elements(tree).filter((el) => el.type === DropdownMenuRadioGroup)) {
      group.props.onValueChange('force');
    }
    const labels = find(tree, ({ props }) => props.checked === true && text(props.children) === 'Show labels');
    expect(labels.props.disabled).toBe(true);
    labels.props.onCheckedChange(false);
    click(control(tree, 'Zoom In'));
    click(control(tree, 'Zoom Out'));
    expect(props.handleZoomIn).toHaveBeenCalledOnce();
    expect(props.handleZoomOut).toHaveBeenCalledOnce();
    expect(props.applyAnalysisLayout).not.toHaveBeenCalled();
  });

  it('allows presentation axis changes while blocking case reassignment', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ cases: [{ id: 'case', name: 'Case' }] }) });
    vi.stubGlobal('fetch', fetch);
    const props = { ...topbarProps(), graphViewMode: 'locked' as const, openTopbarMenuId: 'case' };
    let tree = hooks.render(() => GraphTopbar(props));
    const axis = find(tree, (el) => el.type === Select && el.props.value === 'vertical');
    expect(axis.props.disabled).not.toBe(true);
    axis.props.onValueChange('horizontal');
    await vi.waitFor(() => {
      tree = hooks.render(() => GraphTopbar(props));
      expect(elements(tree).some((el) => el.props.disabled && text(el.props.children) === 'Case')).toBe(true);
    });
    const item = find(tree, (el) => el.props.disabled && text(el.props.children) === 'Case');
    item.props.onClick();
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][1].method).toBeUndefined();
    expect(props.onActiveGraphCaseChange).not.toHaveBeenCalled();
    expect(props.setLockedAxis).toHaveBeenCalledExactlyOnceWith('horizontal');
    expect(props.setEdges).not.toHaveBeenCalled();
    expect(props.setLayoutSettings).not.toHaveBeenCalled();
    expect(props.applyLayout).not.toHaveBeenCalled();
    expect(props.applyAnalysisLayout).not.toHaveBeenCalled();
  });

  it('restores normal mutation controls when editable', () => {
    const props = { ...topbarProps(), isReadOnly: false };
    let tree = hooks.render(() => GraphTopbar(props));
    click(control(tree, 'Undo'));
    click(control(tree, 'Redo'));
    click(control(tree, 'Import JSON'));
    click(control(tree, 'Blue'));
    click(control(tree, 'Left to right'));
    tree = hooks.render(() => GraphTopbar(props));
    const dialog = find(tree, (el) => el.type === AlertDialog && el.props.open);
    click(find(dialog, (el) => el.type === AlertDialogAction));
    expect(props.undo).toHaveBeenCalledOnce();
    expect(props.redo).toHaveBeenCalledOnce();
    expect(props.importGraph).toHaveBeenCalledOnce();
    expect(props.setEdges).toHaveBeenCalledOnce();
    expect(props.applyLayout).toHaveBeenCalledWith({ direction: 'LR' });
  });
});

describe('read-only graph sidebar', () => {
  it('allows search, selection, navigation and fit while blocking add, drag, merge and delete', () => {
    const props = sidebarProps();
    const tree = hooks.render(() => GraphSidebar(props));
    expectNoInert(tree);
    const search = find(tree, (el) => el.type === Input);
    expect(search.props.readOnly).not.toBe(true);
    search.props.onChange({ target: { value: 'example' } });
    click(control(tree, 'Fit view to selected'));
    click(control(tree, 'Clear selection'));
    click(control(tree, 'Collapse sidebar'));
    expect(props.setSidebarSearchQuery).toHaveBeenCalledWith('example');
    expect(props.onFitViewToSelection).toHaveBeenCalledWith(['a', 'b']);
    const row = find(tree, (el) => el.type === TreeView).props.renderItem({
      item: (props.filteredGraphTreeData as any[])[0], level: 0, isLeaf: true,
      isOpen: true, toggleOpen: vi.fn()
    });
    click(control(row, 'Select node'));
    click(find(row, (el) => el.props['data-node-label'] !== undefined));
    expect(props.toggleCheckedGraphNode).toHaveBeenCalledOnce();
    expect(props.handleSelectNodeFromTree).toHaveBeenCalledWith('a');
    for (const label of ['Merge', 'Delete selected']) {
      expect(control(tree, label).props.disabled).toBe(true);
      expect(control(tree, label).props.onClick).toBeUndefined();
    }
    const add = find(tree, (el) => typeof el.props.onDragStart === 'function');
    expect(add.props.disabled).toBe(true);
    expect(add.props.draggable).toBe(false);
    const event = { preventDefault: vi.fn(), dataTransfer: { setData: vi.fn(), effectAllowed: '' } };
    add.props.onDragStart(event);
    add.props.onClick();
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.dataTransfer.setData).not.toHaveBeenCalled();
    expect(props.addNode).not.toHaveBeenCalled();
  });

  it('permits select-all and disables unmerge, then restores write controls', () => {
    const props = { ...sidebarProps(), selectedNodeCount: 0 };
    click(control(hooks.render(() => GraphSidebar(props)), 'Select all'));
    expect(props.onSelectAll).toHaveBeenCalledOnce();
    props.selectedNodeCount = 1;
    expect(control(hooks.render(() => GraphSidebar(props)), 'Unmerge').props.disabled).toBe(true);
    props.isReadOnly = false;
    const tree = hooks.render(() => GraphSidebar(props));
    click(control(tree, 'Unmerge'));
    click(control(tree, 'Delete selected'));
    const add = find(tree, (el) => typeof el.props.onDragStart === 'function');
    expect(add.props.draggable).toBe(true);
    click(add);
    expect(props.onUnmergeSelection).toHaveBeenCalledOnce();
    expect(props.onDeleteSelection).toHaveBeenCalledOnce();
    expect(props.addNode).toHaveBeenCalledWith('domain');
  });
});

describe('read-only graph details', () => {
  it('keeps values, relationships and preview accessible without allowing edits', () => {
    const props = detailsProps();
    let tree = hooks.render(() => GraphDetailsPanel(props));
    expectNoInert(tree);
    expect(control(tree, 'Edit').props.disabled).toBe(true);
    control(tree, 'Edit').props.onClick();
    expect(elements(hooks.render(() => GraphDetailsPanel(props))).some((el) => el.props.title === 'Save')).toBe(false);
    click(control(tree, 'other.org'));
    click(control(tree, 'OWNS'));
    click(control(tree, 'Hide details'));
    expect(props.onSelectNodeId).toHaveBeenCalledWith('b');
    expect(props.onSelectEdgeId).toHaveBeenCalledWith('edge');
    expect(props.closeDetailsPanel).toHaveBeenCalledOnce();
    expect(elements(tree).some((el) => el.props.canDragNodes === true)).toBe(true);
    click(control(tree, 'Hide minimap'));
    tree = hooks.render(() => GraphDetailsPanel(props));
    expect(control(tree, 'Show minimap')).toBeDefined();
    expect(props.onUpdateNode).not.toHaveBeenCalled();
  });

  it.each(['domain', 'note'])('freezes an in-progress %s edit immediately and discards it on lock', (type) => {
    const props = { ...detailsProps(), isReadOnly: false };
    props.nodes[0].data.type = type;
    let tree = hooks.render(() => GraphDetailsPanel(props));
    click(control(tree, 'Edit'));
    tree = hooks.render(() => GraphDetailsPanel(props));
    find(tree, (el) => el.props.placeholder === 'Enter value...').props.onChange({ target: { value: 'draft' } });
    props.isReadOnly = true;
    tree = hooks.render(() => GraphDetailsPanel(props), false);
    const fields = elements(tree).filter((el) => el.type === Input || el.type === 'textarea');
    expect(fields.length).toBeGreaterThanOrEqual(4);
    fields.forEach((field) => {
      expect(field.props.readOnly).toBe(true);
      field.props.onChange({ target: { value: 'blocked' } });
      field.props.onKeyDown?.({ key: 'Enter' });
    });
    for (const label of ['Save', 'Remove', 'Add']) {
      const item = control(tree, label);
      expect(item.props.disabled).toBe(true);
      item.props.onClick();
    }
    tree = hooks.render(() => GraphDetailsPanel(props));
    expect(control(tree, 'Edit').props.disabled).toBe(true);
    expect(props.onUpdateNode).not.toHaveBeenCalled();
    props.nodes[0].data.label = 'agent-update.org';
    props.isReadOnly = false;
    tree = hooks.render(() => GraphDetailsPanel(props));
    // The final agent snapshot can arrive after editing becomes available.
    props.nodes = props.nodes.map((node) => node.id === 'a'
      ? { ...node, data: { ...node.data, label: 'final-update.org', metadata: { owner: 'Bob' } } }
      : node);
    tree = hooks.render(() => GraphDetailsPanel(props));
    click(control(tree, 'Edit'));
    tree = hooks.render(() => GraphDetailsPanel(props));
    expect(find(tree, (el) => el.props.placeholder === 'Enter value...').props.value).toBe('final-update.org');
    click(control(tree, 'Save'));
    expect(props.onUpdateNode).toHaveBeenCalledWith({ nodeId: 'a', label: 'final-update.org', metadata: { owner: 'Bob' } });
  });
});

describe('read-only bottom dock', () => {
  it('leaves console, activity, search, split and local log clearing usable', () => {
    const props: ComponentProps<typeof GraphBottomDock> = {
      isReadOnly: true, isActive: true, bottomDockTab: 'console', onBottomDockTabClick: vi.fn(),
      isBottomDockExpanded: true, setIsBottomDockExpanded: vi.fn(),
      consoleClearSignal: 0, requestConsoleClear: vi.fn()
    };
    let tree = hooks.render(() => GraphBottomDock(props));
    expectNoInert(tree);
    click(control(tree, 'Console (Cmd+D)'));
    click(control(tree, 'Lookup'));
    expect(props.onBottomDockTabClick).toHaveBeenCalledWith('console');
    expect(props.onBottomDockTabClick).toHaveBeenCalledWith('activity');
    click(control(tree, 'Search logs'));
    tree = hooks.render(() => GraphBottomDock(props));
    expect(find(tree, (el) => el.type === GraphConsoleDock).props.showFilterInput).toBe(true);
    click(control(tree, 'Clear'));
    expect(props.requestConsoleClear).toHaveBeenCalledOnce();
    click(control(tree, 'Split loggers'));
    tree = hooks.render(() => GraphBottomDock(props));
    click(control(tree, 'Clear activity'));
    expect(logger.clearLogs).toHaveBeenCalledOnce();
    expect(find(tree, (el) => el.type === TransformActivityDock)).toBeDefined();
    find(tree, (el) => el.props.role === 'button').props.onKeyDown({ key: 'Enter', preventDefault: vi.fn() });
    expect(props.setIsBottomDockExpanded).toHaveBeenCalledWith(false);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps, ReactElement, ReactNode } from 'react';
import type { TransformLog } from '../contexts/transform-logger-context';

const hooks = vi.hoisted(() => {
  let cursor = 0;
  let dirty = false;
  const cells: any[] = [];
  const effects: Array<() => void> = [];
  const sameDeps = (a: unknown[], b: unknown[]) =>
    a.length === b.length &&
    a.every((value, index) => Object.is(value, b[index]));
  const memo = (factory: () => unknown, deps: unknown[]) => {
    const index = cursor++;
    if (!cells[index] || !sameDeps(cells[index].deps, deps)) {
      cells[index] = { value: factory(), deps };
    }
    return cells[index].value;
  };
  return {
    react: {
      useMemo: memo,
      useCallback: (callback: unknown, deps: unknown[]) =>
        memo(() => callback, deps),
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
            const value =
              typeof next === 'function' ? next(cells[index].value) : next;
            if (!Object.is(value, cells[index].value)) dirty = true;
            cells[index].value = value;
          }
        ];
      },
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
    render<T>(component: () => T): T {
      let result: T;
      let attempts = 0;
      do {
        cursor = 0;
        dirty = false;
        result = component();
        effects.splice(0).forEach((effect) => effect());
        if (++attempts > 20) throw new Error('Component did not settle');
      } while (dirty);
      return result;
    },
    reset() {
      cells.forEach((cell) => cell.cleanup?.());
      cells.length = 0;
      effects.length = 0;
      cursor = 0;
    }
  };
});
const state = vi.hoisted(() => ({
  epoch: 0,
  frozen: false,
  logger: null as any,
  agentRuns: {} as Record<string, any>,
  beginManual: vi.fn(() => ({ finish: vi.fn(), current: () => true }))
}));
const coordinator = vi.hoisted(() => ({
  epoch: () => state.epoch,
  frozen: () => state.frozen,
  beginManual: state.beginManual
}));
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  ...hooks.react,
  useContext: () => state.logger
}));
vi.mock('./graph-editor/hooks/use-graph-participant', () => ({
  useGraphCoordinator: () => coordinator
}));
vi.mock('@/features/agent/store/agent-activity-store', () => ({
  useAgentActivityStore: (selector: (store: unknown) => unknown) =>
    selector({ runs: state.agentRuns })
}));
vi.mock('../lib/agent-transform-logs', () => ({
  projectAgentTransforms: (activity: any) => activity.projection
}));
vi.mock('@/features/osint/node-registry', () => ({
  nodeTypeByType: {
    domain: { label: 'Domain', icon: () => null, ui: { badge: {} } },
    custom: { label: 'Custom', icon: () => null, ui: { badge: {} } }
  }
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() }
}));

import {
  TransformLoggerProvider,
  useTransformLogger
} from '../contexts/transform-logger-context';
import { TransformResultsAutoSheet } from './graph-editor/components/transform-results-auto-sheet';
import { TransformResultsSheet } from './transform-results-sheet';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';

type Element = ReactElement<Record<string, any>>;
function elements(tree: ReactNode): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!tree || typeof tree !== 'object' || !('props' in tree)) return [];
  const element = tree as Element;
  return [element, ...elements(element.props.children)];
}
function text(tree: ReactNode): string {
  if (Array.isArray(tree)) return tree.map(text).join('');
  if (tree && typeof tree === 'object' && 'props' in tree)
    return text((tree as Element).props.children);
  return typeof tree === 'string' || typeof tree === 'number'
    ? String(tree)
    : '';
}
function find(
  tree: ReactNode,
  predicate: (element: Element) => boolean
): Element {
  const found = elements(tree).find(predicate);
  expect(found).toBeDefined();
  return found!;
}
function button(tree: ReactNode, label: string): Element {
  return find(
    tree,
    (element) =>
      element.type === Button && text(element.props.children) === label
  );
}
function resultLog(overrides: Partial<TransformLog> = {}): TransformLog {
  return {
    id: 'log',
    pluginName: 'DNS',
    transformName: 'Lookup',
    entityValue: 'example.org',
    status: 'completed',
    startTime: new Date(0),
    snapshotScope: 0,
    sourceNodeId: 'source',
    sourcePosition: { x: 10, y: 20 },
    results: {
      entities: Array.from({ length: 4 }, (_, index) => ({
        id: `entity-${index}`,
        type: 'domain',
        label: `result-${index}.org`,
        value: `result-${index}.org`,
        metadata: {},
        timestamp: new Date(0).toISOString()
      })),
      edges: [{ id: 'edge', sourceId: 'source', targetId: 'entity-0' }]
    },
    ...overrides
  };
}
function loggerValue(log = resultLog()): ReturnType<typeof useTransformLogger> {
  return {
    logs: [log],
    canApplyLog: vi.fn(
      (id: string) =>
        id === log.id &&
        log.origin !== 'agent' &&
        log.snapshotScope === state.epoch &&
        !state.frozen
    ),
    addLog: vi.fn(),
    updateLog: vi.fn(),
    clearLogs: vi.fn(),
    consoleEntries: [],
    pushConsole: vi.fn(),
    clearConsole: vi.fn(),
    onAddResults: vi.fn(() => ({ addedNodes: 1, addedEdges: 1 })),
    activeResultsLogId: log.id,
    openResultsSheet: vi.fn(),
    suppressAutoOpen: vi.fn(),
    isAutoOpenSuppressed: () => false
  };
}
function providerProps(): ComponentProps<typeof TransformLoggerProvider> {
  return {
    graphId: 'graph',
    children: null,
    onAddResults: vi.fn(() => ({ addedNodes: 1, addedEdges: 1 }))
  };
}
function renderProvider(props: ComponentProps<typeof TransformLoggerProvider>) {
  const tree = hooks.render(() => TransformLoggerProvider(props));
  return find(tree, ({ props }) => props.value?.canApplyLog).props
    .value as ReturnType<typeof useTransformLogger>;
}
function addCompletedLog(logger: ReturnType<typeof useTransformLogger>) {
  return logger.addLog(resultLog());
}
const autoProps = { getEntityAddability: () => 'add_node' as const };
function renderAuto() {
  return hooks.render(() => TransformResultsAutoSheet(autoProps));
}

beforeEach(() => {
  hooks.reset();
  vi.clearAllMocks();
  state.epoch = 0;
  state.frozen = false;
  state.agentRuns = {};
  state.logger = loggerValue();
});
afterEach(() => {
  hooks.reset();
  vi.unstubAllGlobals();
});

describe('manual transform result browsing', () => {
  it('opens and closes existing logs while locked without permitting result application', () => {
    const props = providerProps();
    let logger = renderProvider(props);
    const id = addCompletedLog(logger);
    state.frozen = true;
    logger.openResultsSheet(id);
    logger = renderProvider(props);
    expect(logger.activeResultsLogId).toBe(id);
    expect(logger.logs[0].viewed).toBe(true);
    expect(logger.logs[0].results!.entities).toHaveLength(4);
    expect(logger.canApplyLog(id)).toBe(false);
    expect(
      logger.onAddResults!([], [], { position: { x: 0, y: 0 } }, [])
    ).toMatchObject({ addedNodes: 0 });
    expect(props.onAddResults).not.toHaveBeenCalled();
    logger.openResultsSheet(null);
    expect(renderProvider(props).activeResultsLogId).toBeNull();
  });

  it('allows reading a stale-epoch log but rejects retained apply callbacks', () => {
    const props = providerProps();
    let logger = renderProvider(props);
    const id = addCompletedLog(logger);
    const oldApply = logger.onAddResults!;
    state.epoch++;
    logger.openResultsSheet(id);
    logger = renderProvider(props);
    expect(logger.activeResultsLogId).toBe(id);
    expect(logger.canApplyLog(id)).toBe(false);
    expect(oldApply([], [], { position: { x: 0, y: 0 } }, [])).toMatchObject({
      addedNodes: 0
    });
    expect(props.onAddResults).not.toHaveBeenCalled();
  });

  it('restricts browsing and apply permission to logs owned by the current graph', () => {
    const props = providerProps();
    let logger = renderProvider(props);
    const originalId = addCompletedLog(logger);
    logger.openResultsSheet(originalId);
    expect(renderProvider(props).activeResultsLogId).toBe(originalId);
    props.graphId = 'other-graph';
    logger = renderProvider(props);
    expect(logger.logs).toEqual([]);
    expect(logger.activeResultsLogId).toBeNull();
    expect(logger.canApplyLog(originalId)).toBe(false);
    logger.openResultsSheet(originalId);
    logger.openResultsSheet('unknown');
    expect(renderProvider(props).activeResultsLogId).toBeNull();
    const otherId = addCompletedLog(logger);
    logger.openResultsSheet(otherId);
    logger = renderProvider(props);
    expect(logger.logs.map((log) => log.id)).toEqual([otherId]);
    expect(logger.activeResultsLogId).toBe(otherId);
    expect(logger.canApplyLog(otherId)).toBe(true);
  });

  it('allows current-graph agent results to be read but never reapplied', () => {
    const agentLog = resultLog({ id: 'agent-log', origin: 'agent' });
    state.agentRuns = {
      current: {
        run: { graphId: 'graph' },
        projection: { logs: [agentLog], entries: [] }
      },
      other: {
        run: { graphId: 'other' },
        projection: {
          logs: [resultLog({ id: 'other-log', origin: 'agent' })],
          entries: []
        }
      }
    };
    state.frozen = true;
    const props = providerProps();
    let logger = renderProvider(props);
    expect(logger.logs.map((log) => log.id)).toEqual(['agent-log']);
    logger.openResultsSheet('other-log');
    expect(renderProvider(props).activeResultsLogId).toBeNull();
    logger.openResultsSheet('agent-log');
    logger = renderProvider(props);
    expect(logger.activeResultsLogId).toBe('agent-log');
    expect(logger.canApplyLog('agent-log')).toBe(false);
    state.frozen = false;
    expect(logger.canApplyLog('agent-log')).toBe(false);
  });

  it('does not reopen logs after they have been cleared', () => {
    const props = providerProps();
    const logger = renderProvider(props);
    const id = addCompletedLog(logger);
    logger.clearLogs();
    logger.openResultsSheet(id);
    const cleared = renderProvider(props);
    expect(cleared.logs).toEqual([]);
    expect(cleared.activeResultsLogId).toBeNull();
    expect(cleared.canApplyLog(id)).toBe(false);
  });
});

describe('transform results auto sheet', () => {
  it.each(['locked', 'stale', 'agent'])(
    'keeps manually opened %s results visible, read-only and closable',
    (reason) => {
      const log = resultLog(reason === 'agent' ? { origin: 'agent' } : {});
      if (reason === 'locked') state.frozen = true;
      if (reason === 'stale') state.epoch++;
      state.logger = loggerValue(log);
      const tree = renderAuto()!;
      expect(tree.type).toBe(TransformResultsSheet);
      expect(tree.props.open).toBe(true);
      expect(tree.props.readOnly).toBe(true);
      expect(tree.props.entities).toBe(log.results!.entities);
      tree.props.onConfirm(['entity-0']);
      expect(state.logger.onAddResults).not.toHaveBeenCalled();
      expect(state.logger.openResultsSheet).not.toHaveBeenCalled();
      tree.props.onOpenChange(false);
      expect(state.logger.openResultsSheet).toHaveBeenCalledWith(null);
      expect(state.logger.suppressAutoOpen).toHaveBeenCalledWith(1500);
    }
  );

  it.each(['locked', 'stale'])(
    'rechecks %s eligibility when a retained Confirm callback is invoked',
    (reason) => {
      const tree = renderAuto()!;
      expect(tree.props.readOnly).toBe(false);
      if (reason === 'locked') state.frozen = true;
      else state.epoch++;
      tree.props.onConfirm(['entity-0']);
      expect(state.logger.onAddResults).not.toHaveBeenCalled();
      expect(state.logger.openResultsSheet).not.toHaveBeenCalled();
      const current = renderAuto()!;
      expect(current.props.open).toBe(true);
      expect(current.props.readOnly).toBe(true);
    }
  );

  it.each(['locked', 'stale', 'agent'])(
    'does not auto-open %s logs',
    (reason) => {
      state.logger = loggerValue(
        resultLog(reason === 'agent' ? { origin: 'agent' } : {})
      );
      state.logger.activeResultsLogId = null;
      if (reason === 'locked') state.frozen = true;
      if (reason === 'stale') state.epoch++;
      expect(renderAuto()).toBeNull();
      expect(state.logger.openResultsSheet).not.toHaveBeenCalled();
    }
  );

  it('still auto-opens eligible results', () => {
    state.logger.activeResultsLogId = null;
    renderAuto();
    expect(state.logger.openResultsSheet).toHaveBeenCalledExactlyOnceWith(
      'log'
    );
  });

  it('applies eligible results through the original guarded path', () => {
    const tree = renderAuto()!;
    tree.props.onConfirm(['entity-0']);
    const log = state.logger.logs[0];
    expect(state.logger.onAddResults).toHaveBeenCalledExactlyOnceWith(
      log.results.entities,
      log.results.edges,
      { position: log.sourcePosition, nodeId: 'source' },
      ['entity-0']
    );
    expect(state.logger.openResultsSheet).toHaveBeenCalledWith(null);
    expect(state.logger.suppressAutoOpen).toHaveBeenCalledWith(1500);
  });

  it('keeps only a closed, read-only animation snapshot after the active log disappears', () => {
    renderAuto();
    state.logger.logs = [];
    const tree = renderAuto()!;
    expect(tree.props.open).toBe(false);
    expect(tree.props.readOnly).toBe(true);
    tree.props.onConfirm(['entity-0']);
    expect(state.logger.onAddResults).not.toHaveBeenCalled();
  });
});

describe('read-only transform result sheet', () => {
  function sheetProps(): ComponentProps<typeof TransformResultsSheet> {
    return {
      open: true,
      readOnly: true,
      onOpenChange: vi.fn(),
      entities: resultLog().results!.entities,
      transformName: 'Lookup',
      sourceNodeId: 'source',
      onConfirm: vi.fn(),
      getEntityAddability: () => 'add_node'
    };
  }

  it('keeps results selectable for copying and allows browsing, selection and close without applying', () => {
    const props = sheetProps();
    let tree = hooks.render(() => TransformResultsSheet(props));
    expect(tree.type).toBe(Sheet);
    expect(tree.props.open).toBe(true);
    expect(elements(tree).some(({ props }) => props.inert)).toBe(false);
    const copyArea = find(
      tree,
      ({ props }) => props['data-allow-text-selection'] === 'true'
    );
    expect(text(copyArea)).toContain('result-0.org');
    expect(text(copyArea)).toContain('result-3.org');
    expect(button(tree, 'Add (4)').props.disabled).toBe(true);
    button(tree, 'Add (4)').props.onClick();
    expect(props.onConfirm).not.toHaveBeenCalled();
    expect(props.onOpenChange).not.toHaveBeenCalled();
    expect(button(tree, 'None').props.disabled).toBe(false);
    button(tree, 'None').props.onClick();
    tree = hooks.render(() => TransformResultsSheet(props));
    expect(button(tree, 'Add (0)').props.disabled).toBe(true);
    expect(button(tree, 'All').props.disabled).toBe(false);
    button(tree, 'All').props.onClick();
    tree = hooks.render(() => TransformResultsSheet(props));
    expect(button(tree, 'Add (4)').props.disabled).toBe(true);
    expect(button(tree, 'Close').props.disabled).not.toBe(true);
    button(tree, 'Close').props.onClick();
    expect(props.onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
    expect(props.onConfirm).not.toHaveBeenCalled();
  });

  it('blocks Confirm when a previously editable sheet becomes read-only', () => {
    const props = { ...sheetProps(), readOnly: false };
    expect(
      button(
        hooks.render(() => TransformResultsSheet(props)),
        'Add (4)'
      ).props.disabled
    ).toBe(false);
    props.readOnly = true;
    const tree = hooks.render(() => TransformResultsSheet(props));
    const confirm = button(tree, 'Add (4)');
    expect(confirm.props.disabled).toBe(true);
    confirm.props.onClick();
    expect(props.onConfirm).not.toHaveBeenCalled();
    expect(props.onOpenChange).not.toHaveBeenCalled();
  });

  it('copies a read-only result value without applying results or changing selection', async () => {
    const props = sheetProps();
    props.entities[0].label = 'Display label';
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const tree = hooks.render(() => TransformResultsSheet(props));
    const copy = find(
      tree,
      ({ props }) => props['aria-label'] === 'Copy result value'
    );
    expect(copy.props.disabled).not.toBe(true);
    const event = { stopPropagation: vi.fn() };
    await copy.props.onClick(event);
    expect(writeText).toHaveBeenCalledExactlyOnceWith('result-0.org');
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(props.onConfirm).not.toHaveBeenCalled();
    expect(props.onOpenChange).not.toHaveBeenCalled();
    expect(
      button(
        hooks.render(() => TransformResultsSheet(props)),
        'Add (4)'
      ).props.disabled
    ).toBe(true);
  });

  it('retains normal confirmation when editable and rechecks entity addability', () => {
    let blocked = false;
    const props = {
      ...sheetProps(),
      readOnly: false,
      getEntityAddability: (id: string) =>
        blocked && id !== 'entity-0'
          ? ('blocked' as const)
          : ('add_node' as const)
    };
    const tree = hooks.render(() => TransformResultsSheet(props));
    blocked = true;
    button(tree, 'Add (4)').props.onClick();
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(props.onConfirm).toHaveBeenCalledExactlyOnceWith(['entity-0']);
  });
});

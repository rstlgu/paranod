import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

const testState = vi.hoisted(() => {
  let cursor = 0;
  let dirty = false;
  const cells: any[] = [];
  let effects: Array<() => void> = [];
  const changed = (a: unknown[] | undefined, b: unknown[]) =>
    !a ||
    a.length !== b.length ||
    a.some((value, i) => !Object.is(value, b[i]));
  const memo = (factory: () => unknown, deps: unknown[]) => {
    const index = cursor++;
    if (!cells[index] || changed(cells[index].deps, deps))
      cells[index] = { value: factory(), deps };
    return cells[index].value;
  };
  const guard = {
    valid: true,
    status: 'editable',
    blocked: false,
    blockedRef: { current: false },
    acceptSnapshot: vi.fn(),
    reject: vi.fn(),
    canEditSnapshot: () => guard.valid,
    canSaveSnapshot: () => guard.valid
  };
  return {
    guard,
    setTabTitle: vi.fn(),
    react: {
      useRef(value: unknown) {
        const index = cursor++;
        return (cells[index] ??= { current: value });
      },
      useState(value: unknown) {
        const index = cursor++;
        const cell = (cells[index] ??= { value });
        return [
          cell.value,
          (next: any) => {
            const updated =
              typeof next === 'function' ? next(cell.value) : next;
            if (!Object.is(updated, cell.value)) dirty = true;
            cell.value = updated;
          }
        ];
      },
      useMemo: memo,
      useCallback: (callback: unknown, deps: unknown[]) =>
        memo(() => callback, deps),
      useEffect(callback: () => (() => void) | void, deps: unknown[]) {
        const index = cursor++;
        if (!cells[index] || changed(cells[index].deps, deps)) {
          const previous = cells[index];
          const cell: any = { deps };
          cells[index] = cell;
          effects.push(() => {
            previous?.cleanup?.();
            cell.cleanup = callback();
          });
        }
      }
    },
    render(callback: () => ReactElement) {
      let tree!: ReactElement;
      let renders = 0;
      do {
        dirty = false;
        cursor = 0;
        tree = callback();
        const pending = effects;
        effects = [];
        pending.forEach((effect) => effect());
        if (++renders > 30) throw new Error('render_loop');
      } while (dirty);
      return tree;
    },
    reset() {
      guard.valid = false;
      cells.forEach((cell) => cell.cleanup?.());
      cells.length = 0;
      cursor = 0;
      effects = [];
      dirty = false;
      guard.valid = true;
      guard.status = 'editable';
      guard.reject.mockReset();
      guard.acceptSnapshot.mockReset();
    }
  };
});

vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  ...testState.react
}));
vi.mock('./case-rich-text-editor', () => ({
  CaseRichTextEditor: 'note-editor'
}));
vi.mock('@/components/ui/skeleton', () => ({ Skeleton: 'skeleton' }));
vi.mock(
  '@/features/graph/components/graph-editor/hooks/use-graph-write-guard',
  () => ({ useGraphWriteGuard: () => testState.guard })
);
vi.mock(
  '@/features/graph/components/graph-editor/hooks/use-graph-participant',
  () => ({ useGraphParticipant: () => {} })
);
vi.mock('@/features/workspace/store/workspace-tabs-store', () => ({
  useWorkspaceTabsStore: (selector: (state: unknown) => unknown) =>
    selector({ tabs: [], setTabTitle: testState.setTabTitle })
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() }
}));

import { toast } from 'sonner';
import { CaseNoteWorkspaceEditor } from './case-note-workspace-editor';
import { LINKED_GRAPH_NOTE_UPDATED_EVENT } from '../lib/linked-graph-note-events';

const tick = () => new Promise<void>((done) => setImmediate(done));
const initialNote = {
  id: 'note',
  caseId: 'case',
  graphId: 'graph',
  name: 'Note',
  content: 'initial'
};
let writes: Array<{
  body: any;
  keepalive?: boolean;
  resolve: (response: Response) => void;
}>;
let tree: ReactElement;
let currentResource: string;
const render = () => {
  tree = testState.render(() =>
    CaseNoteWorkspaceEditor({
      resourceId: currentResource,
      onOpenGraph: () => {}
    })
  );
};
function props(type: string, node: any = tree): any {
  if (!node || typeof node !== 'object') return null;
  if (node.type === type) return node.props;
  const children = node.props?.children;
  if (children === undefined) return null;
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = props(type, child);
    if (found) return found;
  }
  return null;
}
function confirm(index: number, status = 200) {
  writes[index].resolve(
    new Response(
      JSON.stringify({
        note: { ...initialNote, content: writes[index].body.content }
      }),
      { status }
    )
  );
}

beforeEach(async () => {
  testState.reset();
  currentResource = 'case/note';
  writes = [];
  vi.stubGlobal(
    'window',
    Object.assign(new EventTarget(), { setTimeout, clearTimeout })
  );
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, options?: RequestInit) => {
      if (options?.method === 'PATCH')
        return new Promise<Response>((resolve) => {
          writes.push({
            body: JSON.parse(options.body as string),
            keepalive: options.keepalive,
            resolve
          });
        });
      return Promise.resolve(
        new Response(
          JSON.stringify(
            url.endsWith('/references')
              ? { references: [] }
              : {
                  note: initialNote,
                  writeState: { version: 0, locked: false }
                }
          )
        )
      );
    })
  );
  render();
  await tick();
  render();
  expect(props('note-editor')).not.toBeNull();
});

afterEach(async () => {
  testState.guard.valid = false;
  writes.forEach((_, index) => confirm(index));
  await tick();
  testState.reset();
  vi.unstubAllGlobals();
});

describe('case note confirmed saves', () => {
  it('does not replace newer typing with an older save response', async () => {
    props('note-editor').onChange('first draft');
    render();
    props('note-editor').onSave();
    await tick();
    props('note-editor').onChange('newer typing');
    render();
    confirm(0);
    await tick();
    render();
    expect(props('note-editor').content).toBe('newer typing');
    expect(props('note-editor').isDirty).toBe(true);
  });

  it('queues the page-hide draft behind a pending manual save', async () => {
    props('note-editor').onChange('first');
    render();
    props('note-editor').onSave();
    await tick();
    props('note-editor').onChange('last');
    render();
    window.dispatchEvent(new Event('pagehide'));
    await tick();
    expect(writes).toHaveLength(1);
    confirm(0);
    await tick();
    expect(writes).toHaveLength(2);
    expect(writes[1]).toMatchObject({
      body: { content: 'last', expectedWriteVersion: 0 },
      keepalive: true
    });
    confirm(1);
    await tick();
    render();
    expect(props('note-editor').content).toBe('last');
    expect(props('note-editor').isDirty).toBe(false);
  });

  it('does not send queued notes after the agent acquires the graph', async () => {
    props('note-editor').onChange('first');
    render();
    props('note-editor').onSave();
    await tick();
    props('note-editor').onChange('queued');
    render();
    window.dispatchEvent(new Event('pagehide'));
    testState.guard.valid = false;
    confirm(0);
    await tick();
    render();
    expect(writes).toHaveLength(1);
    expect(props('note-editor').content).toBe('queued');
    expect(props('note-editor').isDirty).toBe(true);
  });

  it('ignores linked-note events from a previous ownership epoch', () => {
    window.dispatchEvent(
      new CustomEvent(LINKED_GRAPH_NOTE_UPDATED_EVENT, {
        detail: {
          graphId: 'graph',
          note: initialNote,
          content: 'old',
          writeVersion: 9
        }
      })
    );
    render();
    expect(props('note-editor').content).toBe('initial');
    window.dispatchEvent(
      new CustomEvent(LINKED_GRAPH_NOTE_UPDATED_EVENT, {
        detail: {
          graphId: 'graph',
          note: initialNote,
          content: 'current',
          writeVersion: 0
        }
      })
    );
    render();
    expect(props('note-editor').content).toBe('current');
  });

  it('keeps failed saves dirty and reports a rejected graph write', async () => {
    props('note-editor').onChange('unsaved');
    render();
    props('note-editor').onSave();
    await tick();
    confirm(0, 423);
    await tick();
    render();
    expect(testState.guard.reject).toHaveBeenCalledOnce();
    expect(props('note-editor').isDirty).toBe(true);
  });

  it('a stale note reloads by itself, after pending saves, never adopting their late response', async () => {
    props('note-editor').onChange('old draft');
    render();
    props('note-editor').onSave();
    await tick();
    const readsBefore = vi.mocked(fetch).mock.calls.length;
    testState.guard.status = 'stale';
    render();
    await tick();
    expect(vi.mocked(fetch).mock.calls).toHaveLength(readsBefore);
    expect(toast.warning).toHaveBeenCalledOnce();
    confirm(0);
    await tick();
    render();
    expect(props('note-editor').content).toBe('initial');
  });

  it('a callback from a previous note cannot save into the newly opened note', async () => {
    const oldSave = props('note-editor').onSave;
    currentResource = 'case/other';
    render();
    await tick();
    render();
    props('note-editor').onChange('other note draft');
    render();
    oldSave();
    await tick();
    expect(writes).toHaveLength(0);
    props('note-editor').onSave();
    await tick();
    expect(writes).toHaveLength(1);
    expect(writes[0].body.content).toBe('other note draft');
  });
});

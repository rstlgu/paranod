import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const effect = vi.hoisted(() => {
  let previousDeps: unknown[] | undefined;
  let cleanup: (() => void) | void;
  return {
    useEffect(callback: () => (() => void) | void, deps: unknown[]) {
      if (
        previousDeps &&
        deps.every((dep, i) => Object.is(dep, previousDeps![i]))
      )
        return;
      cleanup?.();
      previousDeps = deps;
      cleanup = callback();
    },
    reset() {
      cleanup?.();
      previousDeps = undefined;
      cleanup = undefined;
    }
  };
});
vi.mock('react', () => ({ useEffect: effect.useEffect }));

import { useGraphKeyboardShortcuts } from './use-graph-keyboard-shortcuts';

type KeyHandler = (event: KeyboardEvent) => void | Promise<void>;
const listeners = new Set<KeyHandler>();
const addEventListener = vi.fn((type: string, listener: KeyHandler) => {
  if (type === 'keydown') listeners.add(listener);
});
const removeEventListener = vi.fn((type: string, listener: KeyHandler) => {
  if (type === 'keydown') listeners.delete(listener);
});

function argsFor(canEditSnapshot: (() => boolean) | undefined = () => false) {
  return {
    isActive: true,
    canEditSnapshot,
    nodes: [
      {
        id: 'a',
        selected: true,
        data: { metadata: { __merge: { nodeIds: ['a', 'b'] } } }
      },
      { id: 'b', selected: true, data: { metadata: {} } }
    ],
    undo: vi.fn(),
    redo: vi.fn(),
    handleCopySelection: vi.fn(),
    handleDeleteSelection: vi.fn(),
    handleMergeSelection: vi.fn(),
    handleUnmergeSelection: vi.fn(),
    toggleSidebar: vi.fn(),
    toggleRightPanel: vi.fn(),
    toggleConsole: vi.fn(),
    openCommandPalette: vi.fn()
  };
}

async function press(key: string, options: Record<string, unknown> = {}) {
  const event = {
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    target: { tagName: 'DIV', isContentEditable: false },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    stopImmediatePropagation: vi.fn(),
    ...options
  };
  for (const listener of Array.from(listeners)) {
    await listener(event as unknown as KeyboardEvent);
  }
  return event;
}

const mutations = [
  {
    name: 'Cmd+Z undo',
    key: 'z',
    options: { metaKey: true },
    callback: 'undo'
  },
  {
    name: 'Ctrl+Z undo',
    key: 'z',
    options: { ctrlKey: true },
    callback: 'undo'
  },
  {
    name: 'Cmd+Shift+Z redo',
    key: 'z',
    options: { metaKey: true, shiftKey: true },
    callback: 'redo'
  },
  {
    name: 'Ctrl+Shift+Z redo',
    key: 'z',
    options: { ctrlKey: true, shiftKey: true },
    callback: 'redo'
  },
  {
    name: 'Cmd+Y redo',
    key: 'y',
    options: { metaKey: true },
    callback: 'redo'
  },
  {
    name: 'Ctrl+Y redo',
    key: 'y',
    options: { ctrlKey: true },
    callback: 'redo'
  },
  {
    name: 'Delete',
    key: 'Delete',
    options: {},
    callback: 'handleDeleteSelection'
  },
  {
    name: 'Backspace',
    key: 'Backspace',
    options: {},
    callback: 'handleDeleteSelection'
  },
  { name: 'm merge', key: 'm', options: {}, callback: 'handleMergeSelection' },
  { name: 'M merge', key: 'M', options: {}, callback: 'handleMergeSelection' },
  {
    name: 'u unmerge',
    key: 'u',
    options: {},
    callback: 'handleUnmergeSelection'
  },
  {
    name: 'U unmerge',
    key: 'U',
    options: {},
    callback: 'handleUnmergeSelection'
  }
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  listeners.clear();
  vi.stubGlobal('window', { addEventListener, removeEventListener });
});
afterEach(() => {
  effect.reset();
  vi.unstubAllGlobals();
});

describe('graph keyboard shortcuts during an agent lock', () => {
  it.each(['metaKey', 'ctrlKey'])(
    'keeps read shortcuts enabled with %s while edits are blocked',
    async (modifier) => {
      const args = argsFor(() => false);
      useGraphKeyboardShortcuts(args);
      const navigation = [
        ['b', args.toggleSidebar],
        ['B', args.toggleSidebar],
        ['l', args.toggleRightPanel],
        ['L', args.toggleRightPanel],
        ['d', args.toggleConsole],
        ['D', args.toggleConsole],
        ['j', args.openCommandPalette],
        ['J', args.openCommandPalette]
      ] as const;
      for (const [key, callback] of navigation) {
        callback.mockClear();
        const event = await press(key, { [modifier]: true });
        expect(callback).toHaveBeenCalledOnce();
        expect(event.preventDefault).toHaveBeenCalledOnce();
        expect(event.stopPropagation).toHaveBeenCalledOnce();
        expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
      }
      const copy = await press('c', { [modifier]: true });
      expect(args.handleCopySelection).toHaveBeenCalledOnce();
      expect(copy.preventDefault).toHaveBeenCalledOnce();
      for (const callback of [
        'undo',
        'redo',
        'handleDeleteSelection',
        'handleMergeSelection',
        'handleUnmergeSelection'
      ] as const) {
        expect(args[callback]).not.toHaveBeenCalled();
      }
    }
  );

  it('blocks all mutation shortcuts when registered during a lock', async () => {
    const canEditSnapshot = vi.fn(() => false);
    const args = argsFor(canEditSnapshot);
    useGraphKeyboardShortcuts(args);
    for (const mutation of mutations) {
      const event = await press(mutation.key, mutation.options);
      expect(args[mutation.callback]).not.toHaveBeenCalled();
      if (
        ['undo', 'redo', 'handleDeleteSelection'].includes(mutation.callback)
      ) {
        expect(event.preventDefault).toHaveBeenCalledOnce();
      }
    }
    expect(canEditSnapshot).toHaveBeenCalledTimes(mutations.length);
  });

  it.each(mutations)(
    'rechecks the lock for $name without re-registering the handler',
    async ({ key, options, callback }) => {
      let editable = true;
      const canEditSnapshot = vi.fn(() => editable);
      const args = argsFor(canEditSnapshot);
      useGraphKeyboardShortcuts(args);
      const registered = Array.from(listeners)[0];

      editable = false;
      await press(key, options);
      expect(args[callback]).not.toHaveBeenCalled();
      editable = true;
      await press(key, options);
      expect(args[callback]).toHaveBeenCalledOnce();
      editable = false;
      await press(key, options);
      expect(args[callback]).toHaveBeenCalledOnce();
      expect(canEditSnapshot).toHaveBeenCalledTimes(3);
      expect(addEventListener).toHaveBeenCalledOnce();
      expect(Array.from(listeners)).toEqual([registered]);
    }
  );

  it('still allows navigation and copying after the lock starts without a rerender', async () => {
    let editable = true;
    const args = argsFor(() => editable);
    useGraphKeyboardShortcuts(args);
    editable = false;
    for (const key of ['b', 'l', 'd', 'j', 'c'])
      await press(key, { metaKey: true });
    for (const callback of [
      'toggleSidebar',
      'toggleRightPanel',
      'toggleConsole',
      'openCommandPalette',
      'handleCopySelection'
    ] as const) {
      expect(args[callback]).toHaveBeenCalledOnce();
    }
    expect(addEventListener).toHaveBeenCalledOnce();
  });

  it.each([
    { tagName: 'INPUT', isContentEditable: false },
    { tagName: 'TEXTAREA', isContentEditable: false },
    { tagName: 'DIV', isContentEditable: true }
  ])('leaves editing inside $tagName untouched', async (target) => {
    const args = argsFor(() => true);
    useGraphKeyboardShortcuts(args);
    for (const key of ['b', 'l', 'd', 'j', 'c', 'z', 'y']) {
      const event = await press(key, { ctrlKey: true, target });
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    for (const key of ['m', 'u', 'Delete', 'Backspace']) {
      const event = await press(key, { target });
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    for (const callback of Object.values(args).filter((value) =>
      vi.isMockFunction(value)
    )) {
      expect(callback).not.toHaveBeenCalled();
    }
  });

  it('preserves native copy without selected nodes and does not intercept paste', async () => {
    const args = argsFor(() => false);
    args.nodes = args.nodes.map((node) => ({ ...node, selected: false }));
    useGraphKeyboardShortcuts(args);
    const copy = await press('c', { metaKey: true });
    const paste = await press('v', { metaKey: true });
    expect(copy.preventDefault).not.toHaveBeenCalled();
    expect(paste.preventDefault).not.toHaveBeenCalled();
    expect(args.handleCopySelection).not.toHaveBeenCalled();
  });

  it('does not install shortcuts for inactive tabs and removes the capture listener on deactivation', async () => {
    const args = { ...argsFor(() => true), isActive: false };
    useGraphKeyboardShortcuts(args);
    expect(addEventListener).not.toHaveBeenCalled();
    args.isActive = true;
    useGraphKeyboardShortcuts(args);
    const registered = Array.from(listeners)[0];
    expect(addEventListener).toHaveBeenCalledWith('keydown', registered, {
      capture: true
    });
    args.isActive = false;
    useGraphKeyboardShortcuts(args);
    expect(removeEventListener).toHaveBeenCalledWith('keydown', registered, {
      capture: true
    });
    expect(listeners.size).toBe(0);
    await press('z', { metaKey: true });
    await press('b', { metaKey: true });
    expect(args.undo).not.toHaveBeenCalled();
    expect(args.toggleSidebar).not.toHaveBeenCalled();
  });

  it('cleans up on unmount', () => {
    useGraphKeyboardShortcuts(argsFor());
    expect(listeners.size).toBe(1);
    effect.reset();
    expect(listeners.size).toBe(0);
    expect(removeEventListener).toHaveBeenCalledOnce();
  });
});

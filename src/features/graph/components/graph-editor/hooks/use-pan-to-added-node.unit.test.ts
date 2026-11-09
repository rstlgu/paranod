import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => {
  let cursor = 0;
  const cells: any[] = [];
  return {
    react: {
      useRef(value: unknown) {
        return (cells[cursor++] ??= { current: value });
      },
      useEffect(callback: () => (() => void) | void, deps: unknown[]) {
        const index = cursor++;
        const previous = cells[index];
        if (
          previous &&
          deps.every((dep, i) => Object.is(dep, previous.deps[i]))
        )
          return;
        previous?.cleanup?.();
        cells[index] = { deps, cleanup: callback() };
      }
    },
    render(callback: () => void) {
      cursor = 0;
      callback();
    },
    reset() {
      cells.forEach((cell) => cell.cleanup?.());
      cells.length = 0;
      cursor = 0;
    }
  };
});
vi.mock('react', () => hooks.react);
import { usePanToAddedNode } from './use-pan-to-added-node';

const pan = vi.fn();
function render(
  ids: string[],
  ready = true,
  scope = 'graph:free',
  callback = pan
) {
  hooks.render(() =>
    usePanToAddedNode({
      nodes: ids.map((id) => ({ id })),
      ready,
      scope,
      panToNode: callback
    })
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  pan.mockClear();
});
afterEach(() => {
  hooks.reset();
  vi.useRealTimers();
});

it('does not pan on initial load, edits or removals', () => {
  render([], false);
  render(['a', 'b']);
  render(['a', 'b']);
  render(['b']);
  vi.runAllTimers();
  expect(pan).not.toHaveBeenCalled();
});

it('follows the latest addition once, using the latest callback', () => {
  render(['a']);
  render(['a', 'b']);
  vi.advanceTimersByTime(200);
  render(['a', 'b', 'c']);
  const latest = vi.fn();
  render(['a', 'b', 'c'], true, 'graph:free', latest);
  vi.runAllTimers();
  expect(pan).not.toHaveBeenCalled();
  expect(latest).toHaveBeenCalledExactlyOnceWith('c');
});

it('follows the first node added to an empty loaded graph', () => {
  render([]);
  render(['a']);
  vi.runAllTimers();
  expect(pan).toHaveBeenCalledExactlyOnceWith('a');
});

it('ignores a target removed before the animation starts', () => {
  render(['a']);
  render(['a', 'b']);
  render(['a']);
  vi.runAllTimers();
  expect(pan).not.toHaveBeenCalled();
});

it.each(['other:free', 'graph:analysis'])(
  'cancels pending movement when scope changes to %s',
  (scope) => {
    render(['a']);
    render(['a', 'b']);
    render(['a', 'b'], true, scope);
    vi.runAllTimers();
    expect(pan).not.toHaveBeenCalled();
  }
);

it('cancels movement when the tab becomes inactive or unmounts', () => {
  render(['a']);
  render(['a', 'b']);
  render(['a', 'b'], false);
  vi.runAllTimers();
  render(['a', 'b']);
  render(['a', 'b', 'c']);
  hooks.reset();
  vi.runAllTimers();
  expect(pan).not.toHaveBeenCalled();
});

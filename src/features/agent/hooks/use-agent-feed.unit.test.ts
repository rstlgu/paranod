import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => {
  let cursor = 0;
  const cells: any[] = [];
  return {
    react: {
      useState(value: unknown) {
        const index = cursor++;
        const cell = (cells[index] ??= { value });
        return [
          cell.value,
          (next: any) => {
            cell.value = typeof next === 'function' ? next(cell.value) : next;
          }
        ];
      },
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
    render<T>(callback: () => T): T {
      cursor = 0;
      return callback();
    },
    reset() {
      cells.forEach((cell) => cell.cleanup?.());
      cells.length = 0;
      cursor = 0;
    }
  };
});
vi.mock('react', () => hooks.react);
import { useAgentFeed } from './use-agent-feed';

const history = [
  { runId: 'parent', goal: 'Previous question', messages: ['Public response'] }
];
const data = (id: string, extra: object = {}) => ({
  run: { id, graphId: 'graph', status: 'running' },
  events: [
    {
      sequence: 1,
      createdAt: new Date(0).toISOString(),
      data: { type: 'phase', phase: 'thinking', summary: 'Current' }
    }
  ],
  hasMore: false,
  ...extra
});
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
let requests: Array<{ url: string; resolve: (response: Response) => void }>;
const render = (id: string | null, retryMissing = false) =>
  hooks.render(() => useAgentFeed(id, retryMissing));

beforeEach(() => {
  requests = [];
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (url: string) =>
        new Promise<Response>((resolve) => requests.push({ url, resolve }))
    )
  );
});
afterEach(() => {
  hooks.reset();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('conversation feed history', () => {
  it('distinguishes a missing conversation from a temporary transport error', async () => {
    render('never-created');
    requests[0].resolve(Response.json({}, { status: 404 }));
    await tick();
    expect(render('never-created')).toMatchObject({
      error: true,
      unavailable: 'missing',
      run: null
    });
    await vi.advanceTimersByTimeAsync(30000);
    expect(requests).toHaveLength(1);
    expect(render(null)).toMatchObject({ error: false, run: null });
  });
  it('local monitors retry a pre-commit 404 and observe a fast terminal run', async () => {
    render('fast', true);
    requests[0].resolve(Response.json({}, { status: 404 }));
    await tick();
    await vi.advanceTimersByTimeAsync(3000);
    expect(requests).toHaveLength(2);
    requests[1].resolve(
      Response.json(
        data('fast', {
          run: { id: 'fast', graphId: 'graph', status: 'completed' }
        })
      )
    );
    await tick();
    expect(render('fast', true)).toMatchObject({
      run: { id: 'fast', status: 'completed' },
      error: false
    });
  });
  it.each([401, 403])(
    'local monitors stop retrying revoked access (%s)',
    async (status) => {
      render('revoked', true);
      requests[0].resolve(Response.json({}, { status }));
      await tick();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(requests).toHaveLength(1);
      expect(render('revoked', true).error).toBe(true);
    }
  );
  it('retains first-page history when later pages omit it', async () => {
    render('child');
    requests[0].resolve(
      Response.json(data('child', { history, hasMore: true }))
    );
    await tick();
    expect(render('child').history).toEqual(history);
    await vi.advanceTimersByTimeAsync(0);
    expect(requests[1].url).toContain('after=1');
    requests[1].resolve(Response.json(data('child', { events: [] })));
    await tick();
    expect(render('child').history).toEqual(history);
  });
  it('does not carry history into a different selected run or a new conversation', async () => {
    render('child');
    requests[0].resolve(Response.json(data('child', { history })));
    await tick();
    expect(render('child').history).toEqual(history);
    expect(render('other').history).toEqual([]);
    requests[1].resolve(Response.json(data('other')));
    await tick();
    expect(render('other').history).toEqual([]);
    expect(render(null).history).toEqual([]);
  });
  it.each([200, 404])(
    'ignores an old async response after selection changes (%s)',
    async (status) => {
      render('old');
      render('new');
      requests[1].resolve(Response.json(data('new', { history })));
      await tick();
      requests[0].resolve(Response.json(data('old'), { status }));
      await tick();
      expect(render('new')).toMatchObject({
        run: { id: 'new' },
        history,
        error: false
      });
    }
  );
  it('drops history after access is revoked but preserves it on transient errors', async () => {
    render('child');
    requests[0].resolve(Response.json(data('child', { history })));
    await tick();
    render('child').refresh();
    requests[1].resolve(Response.json({}, { status: 503 }));
    await tick();
    expect(render('child')).toMatchObject({ history, error: true });
    render('child').refresh();
    requests[2].resolve(Response.json({}, { status: 403 }));
    await tick();
    expect(render('child')).toMatchObject({
      run: null,
      history: [],
      error: true
    });
  });
  it('rejects a response for the wrong run', async () => {
    render('child');
    requests[0].resolve(Response.json(data('other', { history })));
    await tick();
    expect(render('child')).toMatchObject({
      run: null,
      history: [],
      error: true
    });
  });
});

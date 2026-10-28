import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  begin: vi.fn(),
  current: vi.fn(),
  finish: vi.fn()
}));
vi.mock('@/features/graph/lib/graph-client-coordinator', () => ({
  graphClientCoordinator: { beginManual: state.begin }
}));
vi.mock('./registry', () => ({
  findTransform: () => ({ plugin: { type: 'builtin' } })
}));
vi.mock('@/lib/url', () => ({ buildAppUrl: (path: string) => path }));
import { executeTransform } from './executor';
const input = {
  entity: { id: 'seed', type: 'email' as const, value: 'person@example.org' }
};
const tick = () =>
  Promise.resolve()
    .then(() => Promise.resolve())
    .then(() => Promise.resolve());

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', {});
  state.current.mockReset().mockReturnValue(true);
  state.finish.mockReset();
  state.begin
    .mockReset()
    .mockReturnValue({ current: state.current, finish: state.finish });
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('manual client executor barrier', () => {
  it('does not dispatch when the graph is frozen', async () => {
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    state.begin.mockImplementation(() => {
      throw new Error('frozen');
    });
    expect(
      await executeTransform('email-parser', 'parse', input, 'graph')
    ).toMatchObject({ success: false, denied: true });
    expect(request).not.toHaveBeenCalled();
  });
  it('holds the manual operation until the request completes', async () => {
    let resolve!: (value: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          })
      )
    );
    const result = executeTransform('email-parser', 'parse', input, 'graph');
    expect(state.begin).toHaveBeenCalledWith('graph');
    expect(state.finish).not.toHaveBeenCalled();
    resolve(
      Response.json({
        success: true,
        data: { success: true, entities: [], edges: [] }
      })
    );
    expect(await result).toMatchObject({ success: true });
    expect(state.finish).toHaveBeenCalledOnce();
  });
  it('discards a response belonging to an invalidated snapshot', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          success: true,
          data: { success: true, entities: [{ id: 'late' }], edges: [] }
        })
      )
    );
    state.current.mockReturnValue(false);
    expect(
      await executeTransform('email-parser', 'parse', input, 'graph')
    ).toMatchObject({ success: false, entities: [], denied: true });
  });
  it('keeps asynchronous addon jobs registered beyond the original response and transient polling failures', async () => {
    let polls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, options?: RequestInit) => {
        if (options?.method === 'POST')
          return Response.json({
            success: true,
            data: {
              success: true,
              async: true,
              jobId: 'job',
              entities: [],
              edges: []
            }
          });
        polls++;
        return polls < 2
          ? Response.json({}, { status: 503 })
          : Response.json({ isCompleted: true });
      })
    );
    expect(
      await executeTransform('email-parser', 'parse', input, 'graph')
    ).toMatchObject({ async: true });
    await tick();
    expect(state.finish).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(state.finish).toHaveBeenCalledOnce();
  });
  it('releases the tracked operation on a synchronous network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('offline');
      })
    );
    expect(
      await executeTransform('email-parser', 'parse', input, 'graph')
    ).toMatchObject({ success: false });
    expect(state.finish).toHaveBeenCalledOnce();
  });
});

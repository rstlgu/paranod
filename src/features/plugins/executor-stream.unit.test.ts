import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/graph/lib/graph-client-coordinator', () => ({
  graphClientCoordinator: {
    beginManual: () => ({ current: () => true, finish: () => {} })
  }
}));
vi.mock('@/lib/url', () => ({ buildAppUrl: (path: string) => path }));
import { executeTransform, readTransformStream } from './executor';

const input = {
  entity: { id: 'seed', type: 'email' as const, value: 'jack@gmail.com' }
};

function ndjson(chunks: string[]) {
  const encoder = new TextEncoder();
  const pending = [...chunks];
  return new Response(
    new ReadableStream({
      pull(controller) {
        const chunk = pending.shift();
        if (chunk === undefined) controller.close();
        else controller.enqueue(encoder.encode(chunk));
      }
    }),
    { headers: { 'content-type': 'application/x-ndjson; charset=utf-8' } }
  );
}

const result = {
  type: 'result',
  response: {
    success: true,
    status: 'completed',
    data: { success: true, entities: [{ id: 'card' }], edges: [], message: 'Found 1' }
  }
};

beforeEach(() => vi.stubGlobal('window', {}));
afterEach(() => vi.unstubAllGlobals());

describe('transform progress stream', () => {
  it('reports progress lines split across chunks and returns the final result', async () => {
    const progress = vi.fn();
    const lines = [
      JSON.stringify({ type: 'progress', message: '1 found so far', progress: 10 }),
      JSON.stringify({ type: 'progress', message: '2 found so far' }),
      JSON.stringify(result)
    ].join('\n');
    const response = await readTransformStream(
      ndjson([lines.slice(0, 25), lines.slice(25, 80), lines.slice(80)]),
      progress
    );
    expect(progress.mock.calls).toEqual([
      [{ message: '1 found so far', progress: 10 }],
      [{ message: '2 found so far', progress: undefined }]
    ]);
    expect(response).toEqual(result.response);
  });

  it('fails when the stream ends without a result', async () => {
    expect(
      await readTransformStream(
        ndjson([JSON.stringify({ type: 'progress', message: 'x' }) + '\n'])
      )
    ).toMatchObject({ success: false, error: expect.stringMatching(/without a result/) });
  });

  it('asks for NDJSON only when the caller wants progress', async () => {
    const fetchMock = vi.fn(async () => ndjson([JSON.stringify(result) + '\n']));
    vi.stubGlobal('fetch', fetchMock);
    const onProgress = vi.fn();
    const output = await executeTransform(
      'osint-industries',
      'osintind-email',
      input,
      'graph',
      { onProgress }
    );
    expect(output).toMatchObject({ success: true, entities: [{ id: 'card' }] });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toMatchObject({
      Accept: 'application/x-ndjson, application/json'
    });

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(result.response), {
        headers: { 'content-type': 'application/json' }
      })
    );
    await executeTransform('osint-industries', 'osintind-email', input, 'graph');
    const [, plain] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(plain.headers).not.toHaveProperty('Accept');
  });
});

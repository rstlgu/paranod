import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  find: vi.fn(),
  list: vi.fn(),
  fetch: vi.fn()
}));
vi.mock('@/lib/db', () => ({
  db: {
    transformJob: {
      updateMany: mocks.update,
      findUnique: mocks.find,
      findMany: mocks.list
    }
  }
}));
vi.mock('@/lib/security/safe-fetch', () => ({ safeFetch: mocks.fetch }));
vi.mock('@/lib/security/secrets', () => ({
  decryptSecret: (value: string) => value
}));
import { pollAddonJob, pollAddonJobs } from './poll-addons';

let job: any;
const result = {
  success: true,
  entities: [{ id: 'out', type: 'ip', value: '192.0.2.1' }],
  edges: [
    { id: 'edge', sourceId: 'input', targetId: 'out', label: 'Resolves to' }
  ]
};
const completed = () =>
  new Response(
    JSON.stringify({
      jobId: 'external',
      transformId: 'scan',
      status: 'completed',
      result
    })
  );

beforeEach(() => {
  vi.resetAllMocks();
  job = {
    id: 'job',
    workspaceId: 'workspace',
    transformId: 'scan',
    externalJobId: 'external',
    resultDelivery: 'polling',
    pollingEndpoint: 'https://addon.example/jobs/status?token=private',
    status: 'SUBMITTED',
    nextPollAt: new Date(0),
    pollLeaseToken: null,
    pollLeaseExpiresAt: null,
    pollFailureCount: 0,
    startedAt: new Date(),
    inputEntity: JSON.stringify({ id: 'input' }),
    addon: { webhookSecret: 'secret'.repeat(8), uninstalledAt: null }
  };
  // Emulate atomic conditional writes, including fencing and terminal transitions.
  mocks.update.mockImplementation(async ({ where, data }) => {
    if (where.id !== job.id || !where.status.in.includes(job.status))
      return { count: 0 };
    if (
      'pollLeaseToken' in where &&
      where.pollLeaseToken !== job.pollLeaseToken
    )
      return { count: 0 };
    if (
      where.resultDelivery &&
      (job.resultDelivery !== where.resultDelivery ||
        !job.externalJobId ||
        !job.nextPollAt ||
        job.nextPollAt > where.nextPollAt.lte ||
        (job.pollLeaseExpiresAt &&
          job.pollLeaseExpiresAt > where.OR[1].pollLeaseExpiresAt.lte))
    )
      return { count: 0 };
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === 'object' && 'increment' in value)
        job[key] += (value as any).increment;
      else if (value !== undefined) job[key] = value;
    }
    return { count: 1 };
  });
  mocks.find.mockImplementation(async () => structuredClone(job));
  mocks.list.mockResolvedValue([{ id: 'job' }]);
  mocks.fetch.mockImplementation(async () => completed());
});

describe('durable outbound addon polling', () => {
  it('signs status requests, validates relationships and persists terminal results once', async () => {
    await pollAddonJob('job');
    expect(job).toMatchObject({
      status: 'COMPLETED',
      progress: 100,
      nextPollAt: null,
      pollLeaseToken: null
    });
    expect(JSON.parse(job.result)).toEqual(result);
    expect(mocks.fetch).toHaveBeenCalledWith(
      job.pollingEndpoint,
      expect.objectContaining({
        method: 'POST',
        maxRedirects: 0,
        timeoutMs: 10000,
        maxResponseBytes: 5 * 1024 * 1024,
        headers: expect.objectContaining({
          'X-Relazio-Workspace-Id': 'workspace',
          'X-Relazio-Signature': expect.any(String)
        })
      })
    );
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toEqual({
      action: 'status',
      jobId: 'external',
      transformId: 'scan'
    });
    await pollAddonJob('job');
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });

  it.each(['callback', 'sync'])('does not poll %s jobs', async (mode) => {
    job.resultDelivery = mode;
    await pollAddonJob('job');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('coordinates simultaneous readers with a database lease', async () => {
    let resolve!: (response: Response) => void;
    mocks.fetch.mockImplementation(
      () =>
        new Promise<Response>((r) => {
          resolve = r;
        })
    );
    const first = pollAddonJob('job');
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
    await pollAddonJob('job');
    expect(mocks.fetch).toHaveBeenCalledOnce();
    resolve(completed());
    await first;
    expect(job.status).toBe('COMPLETED');
  });

  it('does not overwrite cancellation with an in-flight result', async () => {
    let resolve!: (response: Response) => void;
    mocks.fetch.mockImplementation(
      () =>
        new Promise<Response>((r) => {
          resolve = r;
        })
    );
    const work = pollAddonJob('job');
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
    job.status = 'CANCELLED';
    job.pollLeaseToken = null;
    resolve(completed());
    await work;
    expect(job.status).toBe('CANCELLED');
    expect(job.result).toBeUndefined();
  });

  it('recovers an expired claim and fences the old response', async () => {
    let old!: (response: Response) => void;
    mocks.fetch.mockImplementationOnce(
      () =>
        new Promise<Response>((r) => {
          old = r;
        })
    );
    const first = pollAddonJob('job');
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
    job.pollLeaseExpiresAt = new Date(0);
    await pollAddonJob('job');
    expect(job.status).toBe('COMPLETED');
    old(
      new Response(
        JSON.stringify({
          jobId: 'external',
          transformId: 'scan',
          status: 'processing',
          progress: 10
        })
      )
    );
    await first;
    expect(job.status).toBe('COMPLETED');
    expect(job.progress).toBe(100);
  });

  it('persists progress and schedules the next read without executing the transform again', async () => {
    mocks.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          jobId: 'external',
          transformId: 'scan',
          status: 'processing',
          progress: 35,
          progressMessage: 'Working'
        })
      )
    );
    await pollAddonJob('job');
    expect(job).toMatchObject({
      status: 'PROCESSING',
      progress: 35,
      progressMessage: 'Working',
      pollLeaseToken: null
    });
    expect(job.nextPollAt.getTime()).toBeGreaterThan(Date.now());
    await pollAddonJob('job');
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });

  it.each([429, 503])(
    'backs off on HTTP %s and can resume with the same external job',
    async (status) => {
      mocks.fetch.mockResolvedValueOnce(new Response('{}', { status }));
      await pollAddonJob('job');
      expect(job.status).toBe('SUBMITTED');
      expect(job.pollFailureCount).toBe(1);
      job.nextPollAt = new Date(0);
      await pollAddonJob('job');
      expect(job.status).toBe('COMPLETED');
      expect(
        mocks.fetch.mock.calls.every(
          ([, options]) => JSON.parse(options.body).jobId === 'external'
        )
      ).toBe(true);
    }
  );

  it('keeps credential-bearing network errors out of persisted diagnostics', async () => {
    mocks.fetch.mockRejectedValue(
      new Error('https://addon.example/?installToken=secret')
    );
    await pollAddonJob('job');
    expect(job.error).toBeUndefined();
    expect(job.pollFailureCount).toBe(1);
    expect(job.pollLeaseToken).toBeNull();
  });

  it.each([401, 403, 404])(
    'settles a rejected or lost remote job (HTTP %s) without resubmitting it',
    async (status) => {
      mocks.fetch.mockResolvedValue(new Response('{}', { status }));
      await pollAddonJob('job');
      expect(job.status).toBe('FAILED');
      expect(job.nextPollAt).toBeNull();
      expect(mocks.fetch).toHaveBeenCalledOnce();
    }
  );

  it.each([
    'wrong-job',
    'wrong-transform',
    'bad-edge',
    'missing-result',
    'unknown-field'
  ])('rejects %s responses before durable completion', async (kind) => {
    const body: any = {
      jobId: 'external',
      transformId: 'scan',
      status: 'completed',
      result: structuredClone(result)
    };
    if (kind === 'wrong-job') body.jobId = 'someone-else';
    if (kind === 'wrong-transform') body.transformId = 'other';
    if (kind === 'bad-edge') body.result.edges[0].sourceId = 'other-graph';
    if (kind === 'missing-result') delete body.result;
    if (kind === 'unknown-field')
      body.pollingEndpoint = 'https://attacker.example';
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify(body)));
    await pollAddonJob('job');
    expect(job.status).toBe('FAILED');
    expect(job.result).toBeUndefined();
  });

  it('times out overdue jobs without another provider request', async () => {
    job.startedAt = new Date(Date.now() - 31 * 60000);
    await pollAddonJob('job');
    expect(job.status).toBe('TIMEOUT');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('bounds background batches and only selects due polling jobs', async () => {
    expect(await pollAddonJobs()).toEqual({ checked: 1, failed: 0 });
    expect(mocks.list).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 5,
        where: expect.objectContaining({
          resultDelivery: 'polling',
          status: { in: ['SUBMITTED', 'PROCESSING'] }
        })
      })
    );
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  client: vi.fn(),
  disconnect: vi.fn(),
  initialize: vi.fn(),
  work: vi.fn(),
  stop: vi.fn(),
  on: vi.fn(),
  heartbeat: vi.fn(),
  remove: vi.fn(),
  job: vi.fn(),
  delay: vi.fn()
}));
vi.mock('@prisma/client', () => ({ PrismaClient: mock.client }));
vi.mock('./queue', () => ({
  AGENT_QUEUE: 'paranod-investigation-v1',
  createAgentQueue: () => ({ on: mock.on, work: mock.work, stop: mock.stop }),
  initializeAgentQueue: mock.initialize
}));
vi.mock('./readiness', () => ({
  AGENT_WORKER_QUEUE: 'paranod-investigation-v1',
  AGENT_WORKER_HEARTBEAT_MS: 10_000,
  heartbeatAgentWorker: mock.heartbeat,
  removeAgentWorker: mock.remove
}));
vi.mock('./worker', () => ({ processAgentJob: mock.job }));
vi.mock('./provider', () => ({ getWorkspaceAgentProvider: vi.fn() }));
vi.mock('node:timers/promises', () => ({ setTimeout: mock.delay }));

const signals = new Map<string, () => void>();
let priorExitCode: typeof process.exitCode;
let priorPrisma: typeof global.prisma;
let resolveDelay: () => void;
const flush = async () => {
  for (let i = 0; i < 5; i++)
    await new Promise<void>((resolve) => setImmediate(resolve));
};

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  signals.clear();
  priorExitCode = process.exitCode;
  priorPrisma = global.prisma;
  process.exitCode = 0;
  vi.stubEnv('PARANOD_AGENT_WORKER_ENABLED', 'true');
  vi.stubEnv('DATABASE_URL', 'postgresql://synthetic.invalid/test');
  vi.stubEnv('SECRETS_ENCRYPTION_KEY', 'synthetic-test-key');
  vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  vi.spyOn(process, 'once').mockImplementation(((
    event: string,
    callback: () => void
  ) => {
    signals.set(event, callback);
    return process;
  }) as typeof process.once);
  mock.client.mockImplementation(function () {
    return { $disconnect: mock.disconnect };
  });
  for (const fn of [
    mock.disconnect,
    mock.initialize,
    mock.work,
    mock.stop,
    mock.heartbeat,
    mock.remove,
    mock.job
  ])
    fn.mockResolvedValue(undefined);
  mock.delay.mockImplementation(
    (_ms, _value, { signal }) =>
      new Promise<void>((resolve, reject) => {
        resolveDelay = resolve;
        signal.addEventListener('abort', () => reject(new Error('aborted')), {
          once: true
        });
      })
  );
});

afterEach(async () => {
  signals.get('SIGTERM')?.();
  await flush();
  process.exitCode = priorExitCode;
  global.prisma = priorPrisma;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('agent worker readiness lifecycle', () => {
  it('does not connect when disabled', async () => {
    vi.stubEnv('PARANOD_AGENT_WORKER_ENABLED', 'false');
    await import('./worker-entry');
    await flush();
    expect(mock.client).not.toHaveBeenCalled();
    expect(mock.heartbeat).not.toHaveBeenCalled();
  });

  it('uses a quiet shared client and only advertises after work registration', async () => {
    let registered!: () => void;
    mock.work.mockReturnValue(
      new Promise<void>((resolve) => {
        registered = resolve;
      })
    );
    await import('./worker-entry');
    await vi.waitFor(() => expect(mock.work).toHaveBeenCalledOnce());
    expect(mock.heartbeat).not.toHaveBeenCalled();
    registered();
    await flush();
    expect(mock.client).toHaveBeenCalledWith({ log: [] });
    expect(mock.work.mock.calls[0][1]).toMatchObject({
      batchSize: 1,
      localConcurrency: 1
    });
    expect(mock.heartbeat).toHaveBeenCalledOnce();
    expect(mock.delay).toHaveBeenCalledWith(
      10_000,
      undefined,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    signals.get('SIGTERM')!();
    await flush();
    expect(mock.remove.mock.invocationCallOrder[0]).toBeLessThan(
      mock.stop.mock.invocationCallOrder[0]
    );
    expect(mock.stop.mock.invocationCallOrder[0]).toBeLessThan(
      mock.disconnect.mock.invocationCallOrder[0]
    );
    expect(mock.remove.mock.calls[0][1]).toBe(mock.heartbeat.mock.calls[0][1]);
  });

  it('fails startup without advertising when work registration fails', async () => {
    mock.work.mockRejectedValue(new Error('private-queue-credentials'));
    await import('./worker-entry');
    await vi.waitFor(() => expect(mock.disconnect).toHaveBeenCalledOnce());
    await flush();
    expect(mock.heartbeat).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(
      JSON.stringify(vi.mocked(process.stderr.write).mock.calls)
    ).not.toContain('private-queue-credentials');
  });

  it('does not register after a stop during startup', async () => {
    let initialized!: () => void;
    mock.initialize.mockReturnValue(
      new Promise<void>((resolve) => {
        initialized = resolve;
      })
    );
    await import('./worker-entry');
    await vi.waitFor(() => expect(mock.initialize).toHaveBeenCalledOnce());
    signals.get('SIGTERM')!();
    initialized();
    await flush();
    expect(mock.work).not.toHaveBeenCalled();
    expect(mock.heartbeat).not.toHaveBeenCalled();
    expect(mock.disconnect).toHaveBeenCalledOnce();
    expect(process.exitCode).toBe(0);
  });

  it('waits for an in-flight heartbeat before removing readiness', async () => {
    await import('./worker-entry');
    await vi.waitFor(() => expect(mock.heartbeat).toHaveBeenCalledOnce());
    let refreshed!: () => void;
    mock.heartbeat.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        refreshed = resolve;
      })
    );
    resolveDelay();
    await flush();
    signals.get('SIGTERM')!();
    await flush();
    expect(mock.remove).not.toHaveBeenCalled();
    refreshed();
    await flush();
    expect(mock.remove).toHaveBeenCalledOnce();
    expect(mock.stop).toHaveBeenCalledOnce();
  });

  it.each(['heartbeat', 'queue'])(
    'fails closed on a %s failure without logging error payloads',
    async (source) => {
      await import('./worker-entry');
      await vi.waitFor(() => expect(mock.heartbeat).toHaveBeenCalledOnce());
      if (source === 'heartbeat') {
        mock.heartbeat.mockRejectedValueOnce(
          new Error('private-database-credentials')
        );
        resolveDelay();
      } else {
        mock.on.mock.calls[0][1](new Error('private-queue-credentials'));
      }
      await flush();
      expect(mock.remove).toHaveBeenCalledOnce();
      expect(mock.stop).toHaveBeenCalledOnce();
      expect(process.exitCode).toBe(1);
      expect(
        JSON.stringify(vi.mocked(process.stderr.write).mock.calls)
      ).not.toContain('private-');
    }
  );

  it('redacts job failures before pg-boss can persist them', async () => {
    await import('./worker-entry');
    await vi.waitFor(() => expect(mock.heartbeat).toHaveBeenCalledOnce());
    mock.job.mockRejectedValueOnce(new Error('private-provider-credentials'));
    const callback = mock.work.mock.calls[0][2];
    await expect(
      callback([{ data: { runId: '12345678-1234-4234-8234-123456789abc' } }])
    ).rejects.toThrow('agent_job_failed');
  });
});

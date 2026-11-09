import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LocalDockerRunner } from './local-runner';
const network = vi.fn();
const job = {
  image: 'sherlock/sherlock:latest',
  cmd: ['sample_user', '--print-found'],
  timeoutMs: 1000
};
beforeEach(() => {
  vi.stubEnv('WORKSPACES_RUNNER_URL', 'http://runner:4050');
  vi.stubEnv('WORKSPACES_RUNNER_TOKEN', 'synthetic-runner-token');
  vi.stubGlobal('fetch', network);
  network.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it('checks cancellation capabilities before submitting an agent job', async () => {
  network
    .mockResolvedValueOnce(
      Response.json({
        protocolVersion: 2,
        capabilities: { cancellableJobs: true, immutableJobImages: true }
      })
    )
    .mockResolvedValueOnce(Response.json({ exitCode: 0, output: 'result' }));
  expect(
    await new LocalDockerRunner().run(job, { requireCancellation: true })
  ).toEqual({ exitCode: 0, output: 'result' });
  expect(network.mock.calls.map((call) => call[0])).toEqual([
    'http://runner:4050/healthz',
    'http://runner:4050/jobs/run'
  ]);
  expect(JSON.parse(network.mock.calls[1][1].body)).toEqual(job);
});
it('does not dispatch to a runner that cannot cancel jobs', async () => {
  network.mockResolvedValueOnce(Response.json({ ok: true }));
  await expect(
    new LocalDockerRunner().run(job, { requireCancellation: true })
  ).rejects.toThrow('container_runner_upgrade_required');
  expect(network).toHaveBeenCalledOnce();
});
it('honours cancellation before any request and while waiting for a job', async () => {
  const stopped = new AbortController();
  stopped.abort();
  await expect(
    new LocalDockerRunner().run(job, { signal: stopped.signal })
  ).rejects.toThrow();
  expect(network).not.toHaveBeenCalled();
  const active = new AbortController();
  network.mockImplementationOnce(async (_url, options) => {
    active.abort();
    expect(options.signal.aborted).toBe(true);
    options.signal.throwIfAborted();
  });
  await expect(
    new LocalDockerRunner().run(job, { signal: active.signal })
  ).rejects.toThrow();
});

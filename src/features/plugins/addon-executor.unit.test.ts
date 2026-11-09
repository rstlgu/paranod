import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OSINTEntity } from './types';

const mocks = vi.hoisted(() => ({
  addon: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  fetch: vi.fn(),
  settle: vi.fn()
}));
vi.mock('@/lib/db', () => ({
  db: {
    workspaceMember: { findUnique: async () => ({ role: 'admin' }) },
    graph: { findFirst: async () => ({ id: 'graph' }) },
    workspaceAddonInstall: { findUnique: mocks.addon },
    transformJob: {
      create: mocks.create,
      update: mocks.update,
      updateMany: mocks.updateMany
    }
  }
}));
vi.mock('@/lib/security/safe-fetch', () => ({ safeFetch: mocks.fetch }));
vi.mock('@/lib/security/secrets', () => ({
  encryptSecret: (s: string) => `encrypted:${s}`,
  decryptSecret: (s: string) => s
}));
vi.mock('./addon-storage', () => ({ parseStoredAddonManifest: JSON.parse }));
vi.mock('./registry', () => ({ matchesInputType: () => true }));
vi.mock('@/lib/middleware/rate-limit', () => ({
  checkPluginRateLimit: async () => ({ allowed: true })
}));
vi.mock('@/lib/jobs/settle-job', () => ({ settleAddonJob: mocks.settle }));
vi.mock('@/lib/url', () => ({
  buildAppUrl: (p: string) => new URL(p, process.env.APP_URL).toString()
}));
import { AddonExecutor } from './addon-executor';
import { sanitizeAddonManifestForClient } from './addon-public';

let manifest: any;
const input = {
  id: 'input',
  type: 'domain',
  value: 'example.test',
  label: 'example.test',
  metadata: {},
  source: 'manual',
  timestamp: new Date().toISOString()
} as OSINTEntity;
const run = () =>
  AddonExecutor.executeTransform(
    'workspace',
    'addon',
    'scan',
    input,
    'graph',
    {},
    'user'
  );
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('APP_URL', 'http://localhost:3002');
  for (const method of ['log', 'error', 'warn'] as const)
    vi.spyOn(console, method).mockImplementation(() => {});
  manifest = {
    manifestVersion: '1.0',
    plugin: {
      transforms: [
        {
          id: 'scan',
          inputType: 'domain',
          outputTypes: ['ip'],
          async: true,
          endpoint: 'https://addon.example/scan',
          pollingEndpoint: 'https://addon.example/jobs/status?token=private'
        }
      ]
    }
  };
  mocks.addon.mockImplementation(async () => ({
    enabled: true,
    uninstalledAt: null,
    webhookSecret: 'test-signing-key',
    manifestData: JSON.stringify(manifest)
  }));
  mocks.create.mockResolvedValue({ id: 'platform-job' });
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.settle.mockResolvedValue(true);
  mocks.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({ async: true, jobId: 'external-job' })
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('addon result delivery selection', () => {
  it('selects polling from the manifest for a local HTTP installation and encrypts the endpoint snapshot', async () => {
    expect(await run()).toMatchObject({
      success: true,
      async: true,
      jobId: 'platform-job'
    });
    const body = JSON.parse(mocks.fetch.mock.calls[0][1].body);
    expect(body.resultDelivery).toBe('polling');
    expect(body).not.toHaveProperty('callbackUrl');
    expect(mocks.create.mock.calls[0][0].data).toMatchObject({
      resultDelivery: 'polling',
      pollingEndpoint:
        'encrypted:https://addon.example/jobs/status?token=private',
      webhookUrl: ''
    });
    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          externalJobId: 'external-job',
          status: 'SUBMITTED',
          nextPollAt: expect.any(Date)
        })
      })
    );
  });

  it('returns synchronous results without advertising a callback URL', async () => {
    manifest.plugin.transforms[0].async = false;
    delete manifest.plugin.transforms[0].pollingEndpoint;
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        async: false,
        result: { success: true, entities: [], edges: [] }
      })
    });
    expect(await run()).toMatchObject({ success: true, async: false });
    const body = JSON.parse(mocks.fetch.mock.calls[0][1].body);
    expect(body).not.toHaveProperty('callbackUrl');
    expect(body).not.toHaveProperty('resultDelivery');
    expect(mocks.create.mock.calls[0][0].data.resultDelivery).toBe('sync');
  });

  it('rejects a callback-only operation on HTTP before creating or submitting a job', async () => {
    delete manifest.plugin.transforms[0].pollingEndpoint;
    expect(await run()).toMatchObject({
      success: false,
      error: expect.stringContaining('local installations')
    });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('preserves the legacy callback payload for an HTTPS platform', async () => {
    delete manifest.plugin.transforms[0].pollingEndpoint;
    vi.stubEnv('APP_URL', 'https://platform.example');
    expect(await run()).toMatchObject({ success: true, async: true });
    const body = JSON.parse(mocks.fetch.mock.calls[0][1].body);
    expect(body.callbackUrl).toBe(
      'https://platform.example/api/webhooks/transforms/platform-job'
    );
    expect(body).not.toHaveProperty('resultDelivery');
  });

  it('does not turn an unexpected async response into a callback or polling job', async () => {
    manifest.plugin.transforms[0].async = false;
    delete manifest.plugin.transforms[0].pollingEndpoint;
    expect(await run()).toMatchObject({
      success: false,
      error: 'Unexpected async addon response'
    });
  });

  it('exposes polling capability without disclosing the personalized endpoint', () => {
    const publicManifest = sanitizeAddonManifestForClient(manifest);
    expect(JSON.stringify(publicManifest)).not.toContain('addon.example');
    expect(JSON.stringify(publicManifest)).not.toContain('private');
    expect(publicManifest.plugin.transforms[0]).toMatchObject({
      supportsPolling: true
    });
  });
});

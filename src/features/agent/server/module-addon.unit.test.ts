import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient, Prisma } from '@prisma/client';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  settle: vi.fn(),
  rate: vi.fn()
}));
vi.mock('@/lib/security/safe-fetch', () => ({ safePublicFetch: mocks.fetch }));
vi.mock('@/features/plugins/addon-storage', () => ({
  parseStoredAddonManifest: JSON.parse
}));
vi.mock('@/lib/jobs/settle-job', () => ({ settleAddonJob: mocks.settle }));
vi.mock('@/lib/middleware/rate-limit', () => ({
  checkPluginRateLimit: mocks.rate
}));
vi.mock('./runs', () => ({ publishAgentActivity: vi.fn() }));
vi.mock('@/features/graph/server/graph-agent-lease', () => ({
  assertAgentGraphLease: vi.fn()
}));
import {
  prepareAgentAddon,
  executeAgentAddon,
  addonAvailability
} from './module-addon';
import { createAgentGateway } from './gateway';
import { argumentsHash } from './policy';
import { listAgentModules } from './modules';
import { encryptSecret } from '@/lib/security/secrets';

const MANIFEST_URL =
  'https://provider.example.org/manifest?token=synthetic-install-token';

const scope = {
  runId: 'run',
  graphId: 'graph',
  userId: 'owner',
  generation: 1
};
const request = {
  moduleId: 'addon:future-addon',
  transformId: 'lookup',
  nodeId: 'input'
};
const input = {
  id: 'input',
  type: 'email' as const,
  value: 'someone@example.org'
};
function fixture() {
  const transform = {
    id: 'lookup',
    name: 'Private provider',
    description: 'Sensitive publisher text',
    inputType: 'email',
    outputTypes: ['domain'],
    endpoint:
      'https://provider.example.org/lookup?token=synthetic-private-token',
    method: 'POST' as const,
    async: false
  };
  const manifest = {
    manifestVersion: '1.0',
    plugin: {
      id: 'future-addon',
      name: 'Publisher',
      description: 'Example addon',
      version: '1.0.0',
      author: 'Test',
      category: 'osint',
      capabilities: {
        inputTypes: ['email'],
        outputTypes: ['domain'],
        estimatedTime: 'seconds',
        supportsAsync: false
      },
      metadata: { minimumPlatformVersion: '2.0.0' },
      transforms: [transform]
    }
  };
  const install = {
    id: 'install',
    addonId: 'future-addon',
    enabled: true,
    uninstalledAt: null as Date | null,
    updatedAt: new Date(0),
    manifestData: '',
    manifestUrl: encryptSecret(MANIFEST_URL),
    manifestVersion: '1.0',
    config: 'private config',
    webhookSecret: encryptSecret('synthetic-signing-secret')
  };
  const events: Array<{ data: unknown }> = [];
  const graph = {
    workspaceId: 'workspace',
    nodes: [
      {
        id: 'input',
        position: { x: 0, y: 0 },
        data: { type: 'email', label: input.value }
      }
    ],
    edges: []
  };
  const tx = {
    workspaceAddonInstall: {
      findUnique: vi.fn(async () => ({
        ...install,
        manifestData: JSON.stringify(manifest)
      })),
      findMany: vi.fn(async () =>
        install.enabled && !install.uninstalledAt
          ? [
              {
                addonId: install.addonId,
                manifestData: JSON.stringify(manifest)
              }
            ]
          : []
      )
    },
    workspacePluginSetting: { findMany: vi.fn(async () => []) },
    agentRun: {
      findUnique: vi.fn(async () => ({
        status: 'running',
        userId: 'owner',
        graphId: 'graph'
      }))
    },
    graph: {
      findUniqueOrThrow: vi.fn(async () => graph),
      update: vi.fn(async () => ({ id: 'graph' }))
    },
    agentEvent: { findMany: vi.fn(async () => events) },
    transformJob: {
      create: vi.fn(async () => ({ id: 'job' })),
      findUnique: vi.fn(async () => ({ status: 'PENDING' }))
    }
  };
  const db = {
    ...tx,
    $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)
  } as unknown as PrismaClient;
  const prepare = () =>
    prepareAgentAddon(
      tx as unknown as Prisma.TransactionClient,
      'workspace',
      request.moduleId,
      request.transformId,
      input,
      scope
    );
  const port = createAgentGateway(
    db,
    { ...scope, token: 'lease-secret' },
    'workspace'
  );
  const approve = async () => {
    const permit = await port.prepareTransform(request);
    const hash = argumentsHash({
      runId: 'run',
      name: 'run_transform',
      arguments: request,
      fingerprint: permit.fingerprint
    });
    events.splice(
      0,
      events.length,
      {
        data: {
          type: 'approval',
          approvalId: 'a',
          tool: 'run_transform',
          summary: 'Lookup',
          destination: permit.destination,
          argumentsHash: hash
        }
      },
      { data: { type: 'decision', approvalId: 'a', approved: true } }
    );
    await port.waitForDecision('a', hash, new AbortController().signal);
    return permit;
  };
  return { transform, manifest, install, tx, db, prepare, port, approve };
}
function response(
  value: unknown = {
    success: true,
    entities: [
      {
        id: 'new',
        type: 'domain',
        value: 'example.org',
        metadata: { kept: 'plugin field', apiToken: 'discard-me' }
      }
    ],
    edges: [{ id: 'edge', sourceId: 'input', targetId: 'new', label: 'Found' }]
  }
) {
  return new Response(JSON.stringify({ async: false, result: value }));
}

beforeEach(() => {
  vi.stubEnv('SECRETS_ENCRYPTION_KEY', 'f'.repeat(64));
  vi.clearAllMocks();
  mocks.fetch.mockReset();
  mocks.settle.mockReset();
  mocks.fetch.mockImplementation(async () => response());
  mocks.settle.mockResolvedValue(true);
  mocks.rate.mockResolvedValue({ allowed: true });
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Unexpected live request');
    })
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('future installed synchronous addon adapter', () => {
  it('decrypts a stored installation URL only for server-side validation and result filtering', async () => {
    const setup = fixture();
    expect(setup.install.manifestUrl).toMatch(/^enc:v1:/);
    expect(setup.install.manifestUrl).not.toContain('synthetic-install-token');
    const prepared = await setup.prepare();
    expect(prepared.execution.addon.manifestUrl).toBe(MANIFEST_URL);
    expect(JSON.stringify(prepared.permit)).not.toContain('provider.example');
    expect(JSON.stringify(prepared.permit)).not.toContain(
      'synthetic-install-token'
    );
  });

  it.each([
    'https://127.0.0.1/manifest',
    'http://provider.example.org/manifest'
  ])(
    'still rejects unsafe manifest destinations after decrypting %s',
    async (url) => {
      const setup = fixture();
      setup.install.manifestUrl = encryptSecret(url);
      await expect(setup.prepare()).rejects.toThrow(
        'agent_addon_requires_public_https_manifest'
      );
      expect(mocks.fetch).not.toHaveBeenCalled();
    }
  );
  it('discovers and executes a new sync addon through exact approval and existing signed protocol', async () => {
    const setup = fixture();
    const catalog = await listAgentModules(
      setup.tx as unknown as Prisma.TransactionClient,
      'workspace',
      'email'
    );
    expect(
      catalog.modules.find((m) => m.moduleId === request.moduleId)
    ).toMatchObject({ executable: true, requiresApproval: true });
    expect(JSON.stringify(catalog)).not.toMatch(
      /provider\.example|synthetic-private|Sensitive publisher/
    );
    const permit = await setup.approve();
    expect(JSON.stringify(permit)).not.toMatch(
      /provider\.example|private config|opaque-ciphertext|synthetic-/
    );
    expect(
      await setup.port.executeTransform(
        request,
        permit.fingerprint,
        new AbortController().signal
      )
    ).toMatchObject({ nodesAdded: 1, edgesAdded: 1 });
    expect(mocks.fetch).toHaveBeenCalledWith(
      setup.transform.endpoint,
      expect.objectContaining({
        method: 'POST',
        redirect: 'error',
        maxRedirects: 0,
        allowLocalAddon: false,
        timeoutMs: 120000,
        maxBytes: 512000,
        signal: expect.any(AbortSignal),
        headers: expect.objectContaining({
          'X-Relazio-Workspace-Id': 'workspace',
          'X-Relazio-Signature': expect.any(String)
        })
      })
    );
    const sent = JSON.parse(mocks.fetch.mock.calls[0][1].body);
    expect(sent).toEqual({
      transformId: 'lookup',
      input: { entity: input, config: {} }
    });
    expect(sent).not.toHaveProperty('callbackUrl');
    expect(mocks.settle).toHaveBeenCalledWith(
      'job',
      'COMPLETED',
      expect.any(Object)
    );
    // Plugin fields persist as returned; credential text never does.
    expect(mocks.settle.mock.calls[0][2].result).toContain('plugin field');
    expect(mocks.settle.mock.calls[0][2].result).not.toContain('discard-me');
    expect(setup.tx.graph.update).toHaveBeenCalledOnce();
  });

  it('cannot execute even a free addon using only a prepared fingerprint', async () => {
    const setup = fixture();
    const permit = await setup.port.prepareTransform(request);
    await expect(
      setup.port.executeTransform(
        request,
        permit.fingerprint,
        new AbortController().signal
      )
    ).rejects.toThrow('agent_approval_required');
    expect(setup.tx.transformJob.create).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each([
    'endpoint',
    'manifestUrl',
    'config',
    'secret',
    'version',
    'disabled',
    'uninstalled'
  ])(
    'invalidates the exact approval when installed %s changes',
    async (field) => {
      const setup = fixture();
      const permit = await setup.approve();
      if (field === 'endpoint')
        setup.transform.endpoint = 'https://other.example.org/lookup';
      if (field === 'manifestUrl')
        setup.install.manifestUrl = encryptSecret(`${MANIFEST_URL}-changed`);
      if (field === 'config') setup.install.config = 'changed';
      if (field === 'secret') setup.install.webhookSecret = 'rotated';
      if (field === 'version') setup.manifest.plugin.version = '2.0.0';
      if (field === 'disabled') setup.install.enabled = false;
      if (field === 'uninstalled') setup.install.uninstalledAt = new Date();
      await expect(
        setup.port.executeTransform(
          request,
          permit.fingerprint,
          new AbortController().signal
        )
      ).rejects.toThrow();
      expect(mocks.fetch).not.toHaveBeenCalled();
      expect(setup.tx.transformJob.create).not.toHaveBeenCalled();
    }
  );

  it.each(['async', 'private-output', 'http', 'loopback', 'credentials'])(
    'keeps unsupported %s addons unavailable',
    async (kind) => {
      const setup = fixture();
      if (kind === 'async') {
        setup.transform.async = true;
        setup.manifest.plugin.capabilities.supportsAsync = true;
      }
      if (kind === 'private-output')
        setup.transform.outputTypes = ['credential'];
      if (kind === 'http')
        setup.transform.endpoint = 'http://provider.example.org/lookup';
      if (kind === 'loopback')
        setup.transform.endpoint = 'https://127.0.0.1/lookup';
      if (kind === 'credentials')
        setup.transform.endpoint =
          'https://user:secret@provider.example.org/lookup';
      expect(addonAvailability(setup.transform)).not.toBeNull();
      await expect(setup.prepare()).rejects.toThrow();
      expect(mocks.fetch).not.toHaveBeenCalled();
    }
  );

  it('rejects an unexpected async response and settles failure without adopting its job', async () => {
    const setup = fixture();
    const permit = await setup.approve();
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ async: true, jobId: 'external-job' }))
    );
    await expect(
      setup.port.executeTransform(
        request,
        permit.fingerprint,
        new AbortController().signal
      )
    ).rejects.toThrow('agent_addon_unexpected_async_response');
    expect(mocks.settle).toHaveBeenCalledWith(
      'job',
      'FAILED',
      expect.any(Object)
    );
    expect(setup.tx.graph.update).not.toHaveBeenCalled();
  });

  it('uses local cancellation settlement and never merges a late addon response', async () => {
    const setup = fixture();
    const permit = await setup.approve();
    const controller = new AbortController();
    mocks.fetch.mockImplementation(async () => {
      controller.abort();
      return response();
    });
    await expect(
      setup.port.executeTransform(
        request,
        permit.fingerprint,
        controller.signal
      )
    ).rejects.toThrow('agent_module_cancelled');
    expect(mocks.settle).toHaveBeenCalledWith('job', 'CANCELLED', {
      error: 'agent_module_cancelled'
    });
    expect(setup.tx.graph.update).not.toHaveBeenCalled();
  });

  it('rejects malformed or cross-graph result references before durable completion', async () => {
    const setup = fixture();
    const permit = await setup.approve();
    mocks.fetch.mockResolvedValue(
      response({
        success: true,
        entities: [],
        edges: [
          {
            id: 'bad',
            sourceId: 'other-graph',
            targetId: 'input',
            label: 'bad'
          }
        ]
      })
    );
    await expect(
      setup.port.executeTransform(
        request,
        permit.fingerprint,
        new AbortController().signal
      )
    ).rejects.toThrow('agent_invalid_module_result');
    expect(mocks.settle).toHaveBeenCalledWith(
      'job',
      'FAILED',
      expect.any(Object)
    );
    expect(setup.tx.graph.update).not.toHaveBeenCalled();
  });

  it('does not leak reflected endpoints, auth tokens or signing secrets in addon results', async () => {
    const setup = fixture();
    const prepared = await setup.prepare();
    for (const secret of [
      setup.transform.endpoint,
      'synthetic-private-token',
      MANIFEST_URL,
      'synthetic-install-token',
      'synthetic-signing-secret'
    ]) {
      mocks.fetch.mockResolvedValue(
        response({
          success: true,
          entities: [{ id: 'e', type: 'domain', value: secret }],
          edges: []
        })
      );
      await expect(
        executeAgentAddon({
          db: setup.db,
          workspaceId: 'workspace',
          graphId: 'graph',
          execution: prepared.execution,
          signal: new AbortController().signal,
          beforeRequest: async () => {}
        })
      ).rejects.toThrow('agent_addon_result_contains_private_configuration');
    }
  });

  it('revalidates after job creation and does not dispatch if the snapshot changed', async () => {
    const setup = fixture();
    const permit = await setup.approve();
    setup.tx.transformJob.create.mockImplementation(async () => {
      setup.transform.endpoint = 'https://other.example.org/lookup';
      return { id: 'job' };
    });
    await expect(
      setup.port.executeTransform(
        request,
        permit.fingerprint,
        new AbortController().signal
      )
    ).rejects.toThrow('agent_module_changed');
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.settle).toHaveBeenCalledWith(
      'job',
      'FAILED',
      expect.any(Object)
    );
  });

  it('does not dispatch an already cancelled job or accept duplicate completion', async () => {
    const setup = fixture();
    const permit = await setup.approve();
    setup.tx.transformJob.findUnique.mockResolvedValue({ status: 'CANCELLED' });
    await expect(
      setup.port.executeTransform(
        request,
        permit.fingerprint,
        new AbortController().signal
      )
    ).rejects.toThrow('agent_addon_job_already_settled');
    expect(mocks.fetch).not.toHaveBeenCalled();
    const other = fixture();
    const otherPermit = await other.approve();
    mocks.settle.mockResolvedValue(false);
    await expect(
      other.port.executeTransform(
        request,
        otherPermit.fingerprint,
        new AbortController().signal
      )
    ).rejects.toThrow('agent_addon_job_already_settled');
    expect(other.tx.graph.update).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
vi.mock('@/features/plugins/addon-storage', () => ({
  parseStoredAddonManifest: JSON.parse
}));
import {
  describeOfflineTransform,
  executeOfflineTransform,
  listAgentModules,
  searchAgentModules,
  describeAgentModule,
  prepareAgentTransform
} from './modules';
import { getPlugin } from '@/features/plugins/registry';
import { moduleAvailability, checkedModuleInput } from './module-policy';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Unexpected live request');
    })
  );
});

function manifest(async = false) {
  return {
    manifestVersion: '1.0',
    plugin: {
      id: 'new-addon',
      name: 'Secret https://example.org/path?token=private',
      description: 'Never expose publisher prose',
      version: '1.0.0',
      author: 'Test',
      category: 'osint',
      capabilities: {
        inputTypes: ['email'],
        outputTypes: ['domain'],
        estimatedTime: 'seconds',
        supportsAsync: async
      },
      metadata: { minimumPlatformVersion: '2.0.0' },
      transforms: [
        {
          id: 'lookup',
          name: 'https://secret@example.org/?token=private',
          description: 'never-expose',
          inputType: 'email',
          outputTypes: ['domain'],
          endpoint: 'https://example.org/secret-endpoint?token=private',
          method: 'POST',
          async
        }
      ]
    }
  };
}

function database(disabled = false) {
  return {
    workspacePluginSetting: {
      findMany: vi.fn(async () => [
        { pluginId: 'email-parser', enabled: !disabled }
      ]),
      findUnique: vi.fn(async () => ({
        enabled: !disabled,
        updatedAt: new Date(0)
      }))
    },
    workspaceAddonInstall: {
      findMany: vi.fn(async () => [
        {
          addonId: 'new-addon',
          manifestData: JSON.stringify(manifest())
        }
      ])
    }
  } as unknown as Prisma.TransactionClient;
}
describe('agent module discovery and execution policy', () => {
  it('searches a small index and loads only a selected description on demand', async () => {
    const tx = database();
    const result = await searchAgentModules(
      tx,
      'workspace',
      'domain',
      'dns',
      0
    );
    expect(result.modules.length).toBeGreaterThan(0);
    expect(result.modules.length).toBeLessThanOrEqual(20);
    for (const entry of result.modules) {
      expect(entry).not.toHaveProperty('description');
      expect(entry).not.toHaveProperty('limitations');
      expect(entry).not.toHaveProperty('requiresApproval');
    }
    const details = await describeAgentModule(
      tx,
      'workspace',
      'domain',
      'dns-lookup',
      'dns-resolve-a'
    );
    expect(details).toMatchObject({ executable: true, requiresApproval: true });
    expect(details.description.length).toBeGreaterThan(0);
    const addon = await describeAgentModule(
      tx,
      'workspace',
      'email',
      'addon:new-addon',
      'lookup'
    );
    expect(JSON.stringify(addon)).not.toMatch(
      /secret-endpoint|token=private|never-expose|https:\/\//
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('paginates without repeats and rechecks disabled tools when loading details', async () => {
    const tx = database();
    const first = await searchAgentModules(tx, 'workspace', 'domain');
    if (first.nextOffset !== null) {
      const second = await searchAgentModules(
        tx,
        'workspace',
        'domain',
        '',
        first.nextOffset
      );
      const ids = (items: typeof first.modules) =>
        items.map((m) => `${m.moduleId}/${m.transformId}`);
      expect(
        ids(second.modules).some((id) => ids(first.modules).includes(id))
      ).toBe(false);
    }
    expect(
      (await searchAgentModules(tx, 'workspace', 'email', 'no-such-capability'))
        .modules
    ).toEqual([]);
    await expect(
      describeAgentModule(
        database(true),
        'workspace',
        'email',
        'email-parser',
        'email-extract-domain'
      )
    ).rejects.toThrow('agent_transform_unavailable');
    await expect(
      describeAgentModule(
        tx,
        'workspace',
        'ip',
        'email-parser',
        'email-extract-domain'
      )
    ).rejects.toThrow('agent_transform_unavailable');
  });
  it('discovers new free synchronous addons without exposing endpoints', async () => {
    const tx = database();
    const catalog = await listAgentModules(tx, 'pinned-workspace', 'email');
    expect(
      catalog.modules.find(
        (entry) =>
          entry.moduleId === 'new-addon' || entry.moduleId === 'addon:new-addon'
      )
    ).toMatchObject({
      executable: true,
      requiresApproval: true,
      reason: null
    });
    expect(JSON.stringify(catalog)).not.toMatch(
      /secret-endpoint|token=private|never-expose|https:\/\//
    );
    expect(tx.workspaceAddonInstall.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId: 'pinned-workspace',
          enabled: true,
          uninstalledAt: null
        }
      })
    );
  });
  it('hides disabled modules and independently blocks their execution', async () => {
    const tx = database(true);
    expect(
      (await listAgentModules(tx, 'workspace', 'email')).modules.some(
        (entry) => entry.moduleId === 'email-parser'
      )
    ).toBe(false);
    await expect(
      describeOfflineTransform(
        tx,
        'workspace',
        'email-parser',
        'email-extract-domain',
        { id: 'n', type: 'email', value: 'user@example.test' }
      )
    ).rejects.toThrow('agent_module_disabled');
  });
  it('blocks network/container operations despite a matching plugin ID', async () => {
    await expect(
      executeOfflineTransform('email-parser', 'email-gravatar', {
        id: 'n',
        type: 'email',
        value: 'user@example.test'
      })
    ).rejects.toThrow('agent_transform_unavailable');
    await expect(
      executeOfflineTransform('sherlock', 'sherlock-search', {
        id: 'n',
        type: 'username',
        value: 'sample'
      })
    ).rejects.toThrow('agent_transform_unavailable');
  });
  it('pins the target and module settings into the approval descriptor', async () => {
    const tx = database();
    const first = await describeOfflineTransform(
      tx,
      'workspace',
      'email-parser',
      'email-extract-domain',
      { id: 'n', type: 'email', value: 'user@example.test' }
    );
    const changed = await describeOfflineTransform(
      tx,
      'workspace',
      'email-parser',
      'email-extract-domain',
      { id: 'n', type: 'email', value: 'other@example.test' }
    );
    expect(first.requiresApproval).toBe(false);
    expect(first.fingerprint).not.toBe(changed.fingerprint);
  });

  it('marks each useful target class executable but requires approval for network lookup', async () => {
    const tx = database();
    for (const [type, transformId] of [
      ['username', 'whatsmyname-search'],
      ['email', 'email-validate'],
      ['domain', 'dns-resolve-a'],
      ['ip', 'ip-reverse-dns'],
      ['organization', 'org-to-asn']
    ]) {
      const found = (
        await listAgentModules(tx, 'workspace', type)
      ).modules.find((m) => m.transformId === transformId);
      expect(found).toMatchObject({
        executable: true,
        requiresApproval: true,
        reason: null
      });
    }
  });

  it('allows enabled builtins, including key-backed transforms', () => {
    const plugin = getPlugin('dns-lookup')!;
    const transform = plugin.transforms[0];
    expect(moduleAvailability(plugin, transform).kind).toBe('dns');
    expect(
      moduleAvailability(plugin, { ...transform, requiresApiKey: true }).kind
    ).toBe('dns');
    expect(
      moduleAvailability(
        getPlugin('whois-lookup')!,
        getPlugin('whois-lookup')!.transforms[0]
      ).kind
    ).toBe('http');
    expect(
      moduleAvailability(plugin, { ...transform, id: 'newly-registered' }).kind
    ).toBe('http');
  });

  it('binds all scope/config/version details without putting destinations or settings in the permit', async () => {
    const tx = database();
    const input = {
      id: 'n',
      type: 'organization' as const,
      value: 'Example Org'
    };
    const scope = {
      runId: 'run',
      graphId: 'graph',
      userId: 'owner',
      generation: 1
    };
    const prepare = (workspace = 'workspace', context = scope) =>
      prepareAgentTransform(
        tx,
        workspace,
        'ip-geolocation',
        'org-to-asn',
        input,
        context
      );
    const first = await prepare();
    expect(first.permit.requiresApproval).toBe(true);
    expect(JSON.stringify(first.permit)).not.toMatch(
      /https|api\.|config|endpoint/
    );
    expect(first.execution.plan.requests).toHaveLength(1);
    expect((await prepare('other')).permit.fingerprint).not.toBe(
      first.permit.fingerprint
    );
    for (const change of [
      { runId: 'other' },
      { graphId: 'other' },
      { userId: 'other' },
      { generation: 2 }
    ])
      expect(
        (await prepare('workspace', { ...scope, ...change })).permit.fingerprint
      ).not.toBe(first.permit.fingerprint);
    vi.mocked(tx.workspacePluginSetting.findUnique).mockResolvedValue({
      enabled: true,
      updatedAt: new Date(0),
      config: 'opaque-config-version'
    } as never);
    const changed = await prepare();
    expect(changed.permit.fingerprint).not.toBe(first.permit.fingerprint);
    expect(JSON.stringify(changed.permit)).not.toContain(
      'opaque-config-version'
    );
  });

  it('discovers async addons and rejects malformed, mismatched or unsupported manifests without fetching them', async () => {
    const tx = database();
    const invalid = manifest();
    invalid.plugin.id = 'different-id';
    vi.mocked(tx.workspaceAddonInstall.findMany).mockResolvedValue([
      { addonId: 'new-addon', manifestData: JSON.stringify(manifest(true)) },
      { addonId: 'mismatch', manifestData: JSON.stringify(invalid) },
      { addonId: 'broken', manifestData: '{bad' }
    ] as never);
    const addons = (
      await listAgentModules(tx, 'workspace', 'email')
    ).modules.filter((m) => m.moduleId.startsWith('addon:'));
    expect(addons).toHaveLength(1);
    expect(addons[0].reason).toContain('cancellable_async_job_handoff');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['domain', 'localhost'],
    ['domain', 'service.internal'],
    ['ip', '127.0.0.1'],
    ['ip', '169.254.169.254'],
    ['url', 'https://user:password@example.org/'],
    ['url', 'https://example.org/?token=private'],
    ['username', '../admin'],
    ['cidr', '8.8.8.0/24']
  ])('rejects unsafe/broad target %s %s', (type, value) => {
    expect(() =>
      checkedModuleInput({ id: 'n', type: type as never, value }, true)
    ).toThrow();
  });
});

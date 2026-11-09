import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  cancel: vi.fn(),
  resolve4: vi.fn(),
  resolveMx: vi.fn(),
  resolveNs: vi.fn(),
  resolveTxt: vi.fn(),
  reverse: vi.fn(),
  resolve6: vi.fn(),
  resolveCname: vi.fn(),
  resolveSoa: vi.fn(),
  resolveCaa: vi.fn()
}));
vi.mock('@/lib/security/safe-fetch', () => ({ safePublicFetch: mocks.fetch }));
vi.mock('node:dns/promises', () => ({
  Resolver: class {
    setServers = vi.fn();
    cancel = mocks.cancel;
    resolve4 = mocks.resolve4;
    resolveMx = mocks.resolveMx;
    resolveNs = mocks.resolveNs;
    resolveTxt = mocks.resolveTxt;
    reverse = mocks.reverse;
    resolve6 = mocks.resolve6;
    resolveCname = mocks.resolveCname;
    resolveSoa = mocks.resolveSoa;
    resolveCaa = mocks.resolveCaa;
  }
}));
import {
  executeAgentModule,
  validateModuleResult,
  type ModuleExecution
} from './module-execution';
import { prepareAgentTransform } from './modules';
import { MODULE_LIMITS } from './module-policy';

const signal = () => new AbortController().signal;
const tx = {
  workspacePluginSetting: { findUnique: async () => null }
} as unknown as Prisma.TransactionClient;
async function execution(
  moduleId: string,
  transformId: string,
  type: string,
  value: string
) {
  return (
    await prepareAgentTransform(tx, 'workspace', moduleId, transformId, {
      id: 'input',
      type: type as never,
      value
    })
  ).execution;
}
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetch.mockReset();
  mocks.fetch.mockRejectedValue(new Error('Unexpected provider call'));
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Unexpected unbounded fetch');
    })
  );
});

describe('bounded agent module execution', () => {
  it.each([
    [
      'email-parser',
      'email-extract-domain',
      'email',
      'someone@example.org',
      'domain'
    ],
    [
      'url-parser',
      'url-extract-domain',
      'url',
      'https://example.org/path',
      'domain'
    ],
    ['url-parser', 'domain-to-root', 'domain', 'api.example.org', 'domain'],
    ['url-parser', 'domain-to-website', 'domain', 'example.org', 'url'],
    ['ip-geolocation', 'cidr-to-ips', 'cidr', '8.8.8.0/30', 'ip'],
    ['social-media', 'social-generate-url', 'instagram_user', 'sample', 'url']
  ])(
    'reuses reviewed local executor %s/%s without any network',
    async (moduleId, transformId, type, value, output) => {
      const result = await executeAgentModule(
        await execution(moduleId, transformId, type, value),
        signal(),
        async () => {}
      );
      expect(result.result.entities[0].type).toBe(output);
      expect(result.result.edges[0].sourceId).toBe('input');
      expect(result.result.entities[0]).toHaveProperty('metadata');
      expect(mocks.fetch).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    }
  );

  it('returns local notes as bounded observations without opening private graph notes', async () => {
    const result = await executeAgentModule(
      await execution(
        'disposable-email',
        'disposable-check-email',
        'email',
        'sample@mailinator.com'
      ),
      signal(),
      async () => {}
    );
    expect(result.result.entities).toEqual([]);
    expect(result.result.edges).toEqual([]);
    expect(result.observations[0].text).toContain('Disposable: mailinator.com');
  });

  it('queries DNS with a per-call resolver and validates public results', async () => {
    mocks.resolve4.mockResolvedValue(['8.8.8.8']);
    const check = vi.fn(async () => {});
    const result = await executeAgentModule(
      await execution('dns-lookup', 'dns-resolve-a', 'domain', 'example.org'),
      signal(),
      check
    );
    expect(result.result.entities[0].value).toBe('8.8.8.8');
    expect(check).toHaveBeenCalledTimes(1);
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
    mocks.resolve4.mockResolvedValue(['127.0.0.1']);
    await expect(
      executeAgentModule(
        await execution('dns-lookup', 'dns-resolve-a', 'domain', 'example.org'),
        signal(),
        check
      )
    ).rejects.toThrow('agent_private_target');
  });

  it('cancels the individual resolver, never the global resolver', async () => {
    const controller = new AbortController();
    mocks.resolve4.mockImplementation(async () => {
      controller.abort();
      throw new Error('cancelled');
    });
    await expect(
      executeAgentModule(
        await execution('dns-lookup', 'dns-resolve-a', 'domain', 'example.org'),
        controller.signal,
        async () => {}
      )
    ).rejects.toThrow('agent_module_cancelled');
    expect(mocks.cancel).toHaveBeenCalled();
  });

  it('uses only the approved HTTPS request with pinned DNS, body limits, no redirects and cancellation', async () => {
    mocks.fetch.mockResolvedValue(
      json({ data: { asns: [{ asn: 15169, name: 'Example' }] } })
    );
    const prepared = await execution(
      'ip-geolocation',
      'org-to-asn',
      'organization',
      'Example Org'
    );
    const result = await executeAgentModule(prepared, signal(), async () => {});
    expect(result.result.entities[0].value).toBe('AS15169');
    expect(mocks.fetch).toHaveBeenCalledWith(
      prepared.plan.requests[0],
      expect.objectContaining({
        method: 'GET',
        redirect: 'error',
        maxRedirects: 0,
        allowLocalAddon: false,
        maxBytes: 1_000_000,
        timeoutMs: 30_000,
        signal: expect.any(AbortSignal)
      })
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('checks three named username services, matches exact account names and never follows provider URLs', async () => {
    mocks.fetch
      .mockResolvedValueOnce(
        json([{ id: 1, username: 'sample', web_url: 'http://127.0.0.1/' }])
      )
      .mockResolvedValueOnce(json({ id: 'different' }))
      .mockResolvedValueOnce(
        json({ kind: 't2', data: { name: 'sample', id: 'abc' } })
      );
    const check = vi.fn(async () => {});
    const result = await executeAgentModule(
      await execution(
        'whatsmyname',
        'whatsmyname-search',
        'username',
        'sample'
      ),
      signal(),
      check
    );
    expect(result.result.entities.map((e) => e.value)).toEqual([
      'https://gitlab.com/sample',
      'https://www.reddit.com/user/sample'
    ]);
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
    expect(check).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(result)).not.toContain('127.0.0.1');
  });

  it('does not interpret provider failure or malformed schema as no findings', async () => {
    mocks.fetch.mockResolvedValue(json({ error: 'rate limit' }, 429));
    await expect(
      executeAgentModule(
        await execution(
          'whatsmyname',
          'whatsmyname-search',
          'username',
          'sample'
        ),
        signal(),
        async () => {}
      )
    ).rejects.toThrow('agent_provider_failed');
    mocks.fetch.mockResolvedValue(
      json({ data: { asns: [{ asn: 'not-a-number' }] } })
    );
    await expect(
      executeAgentModule(
        await execution(
          'ip-geolocation',
          'org-to-asn',
          'organization',
          'Example'
        ),
        signal(),
        async () => {}
      )
    ).rejects.toThrow('agent_module_failed');
  });

  it('rechecks permission before every request and stops fan-out immediately on scope revocation', async () => {
    mocks.fetch.mockResolvedValueOnce(json([]));
    const check = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(new Error('agent_scope_changed'));
    await expect(
      executeAgentModule(
        await execution(
          'whatsmyname',
          'whatsmyname-search',
          'username',
          'sample'
        ),
        signal(),
        check
      )
    ).rejects.toThrow('agent_scope_changed');
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not return provider diagnostics or endpoints on transport failure', async () => {
    mocks.fetch.mockRejectedValue(
      new Error('secret at https://private.example/path?token=do-not-expose')
    );
    await expect(
      executeAgentModule(
        await execution(
          'ip-geolocation',
          'org-to-asn',
          'organization',
          'Example'
        ),
        signal(),
        async () => {}
      )
    ).rejects.toThrow(/^agent_module_failed$/);
  });

  it('rejects a Wayback result outside the approved domain', async () => {
    mocks.fetch.mockResolvedValue(
      json([
        ['original', 'timestamp'],
        ['https://other.org/path', '20250101000000']
      ])
    );
    await expect(
      executeAgentModule(
        await execution(
          'url-parser',
          'domain-wayback',
          'domain',
          'example.org'
        ),
        signal(),
        async () => {}
      )
    ).rejects.toThrow('agent_result_outside_target');
  });
});

describe('agent result validation', () => {
  const prepared: ModuleExecution = {
    moduleId: 'dns-lookup',
    transformId: 'dns-resolve-a',
    input: { id: 'input', type: 'domain', value: 'example.org' },
    outputTypes: ['ip'],
    plan: { kind: 'dns', destination: 'DNS', requests: [], dnsServers: [] }
  };
  const valid = () => ({
    success: true,
    entities: [{ id: 'e', type: 'ip', value: '8.8.8.8' }],
    edges: [
      { id: 'link', sourceId: 'input', targetId: 'e', label: 'Resolves to' }
    ]
  });
  it.each([
    () => ({ ...valid(), success: false, error: 'secret' }),
    () => ({ ...valid(), async: true, jobId: 'job' }),
    () => ({
      ...valid(),
      entities: [{ id: 'input', type: 'ip', value: '8.8.8.8' }]
    }),
    () => ({
      ...valid(),
      entities: [{ id: 'e', type: 'credential', value: 'secret' }]
    }),
    () => ({
      ...valid(),
      entities: [{ id: 'e', type: 'ip', value: 'x'.repeat(2001) }]
    }),
    () => ({
      ...valid(),
      edges: [
        { id: 'edge', sourceId: 'other-graph', targetId: 'e', label: 'bad' }
      ]
    })
  ])(
    'rejects malformed/broad/private results without leaking their contents',
    (make) => {
      expect(() => validateModuleResult(make(), prepared)).toThrow(
        /^agent_invalid_module_result$/
      );
    }
  );

  it('keeps a bounded subset when a transform returns more entities than the cap', () => {
    const output = validateModuleResult(
      {
        success: true,
        entities: Array.from(
          { length: MODULE_LIMITS.maxEntities + 1 },
          (_, index) => ({
            id: `e${index}`,
            type: 'ip',
            value: '8.8.8.8'
          })
        ),
        edges: []
      },
      prepared
    );
    expect(output.result.entities).toHaveLength(MODULE_LIMITS.maxEntities);
    expect(output.omittedEntities).toBe(1);
  });

  it('counts links to omitted entities instead of silently dropping their count', () => {
    const output = validateModuleResult(
      {
        success: true,
        entities: Array.from(
          { length: MODULE_LIMITS.maxEntities + 1 },
          (_, i) => ({ id: `e${i}`, type: 'ip', value: '8.8.8.8' })
        ),
        edges: Array.from(
          { length: MODULE_LIMITS.maxEntities + 1 },
          (_, i) => ({
            id: `link${i}`,
            sourceId: 'input',
            targetId: `e${i}`,
            label: 'Result'
          })
        )
      },
      prepared
    );
    expect(output.omittedEntities).toBe(1);
    expect(output.omittedEdges).toBe(1);
    expect(output.result.edges).toHaveLength(MODULE_LIMITS.maxEntities);
  });

  it('keeps plugin values and fields as returned, without credential text', () => {
    const output = validateModuleResult(
      {
        success: true,
        entities: [
          {
            id: 'e',
            type: 'ip',
            value: '8.8.8.8',
            label: 'Google DNS · 8.8.8.8',
            metadata: {
              nodeView: 'card',
              'Profile Url': 'https://example.org/p?id=1',
              'Has Password': true,
              sessionToken: 'abc123'
            }
          }
        ],
        edges: [
          {
            id: 'link',
            sourceId: 'input',
            targetId: 'e',
            label: 'Resolves to',
            relationship: 'resolves_to'
          }
        ]
      },
      prepared
    );
    expect(output.result.entities[0]).toEqual({
      id: 'e',
      type: 'ip',
      value: '8.8.8.8',
      label: 'Google DNS · 8.8.8.8',
      metadata: {
        nodeView: 'card',
        'Profile Url': 'https://example.org/p?id=1',
        'Has Password': true
      }
    });
    expect(output.result.edges[0]).toMatchObject({ relationship: 'resolves_to' });
  });

  it('omits whole entities past the byte budget instead of failing', () => {
    const big = 'x'.repeat(200_000);
    const output = validateModuleResult(
      {
        success: true,
        entities: [0, 1, 2, 3].map((index) => ({
          id: `e${index}`,
          type: 'ip',
          value: '8.8.8.8',
          metadata: { Notes: big }
        })),
        edges: [0, 1, 2, 3].map((index) => ({
          id: `link${index}`,
          sourceId: 'input',
          targetId: `e${index}`,
          label: 'Resolves to'
        }))
      },
      prepared
    );
    expect(output.result.entities.map((entity) => entity.id)).toEqual([
      'e0',
      'e1'
    ]);
    expect(output.omittedEntities).toBe(2);
    expect(output.omittedEdges).toBe(2);
    expect(output.result.edges.map((edge) => edge.targetId)).toEqual(['e0', 'e1']);
  });

  it('drops provider metadata instead of failing the transform', () => {
    const output = validateModuleResult(
      { ...valid(), metadata: { trace: 'x'.repeat(256001) } },
      prepared
    );
    expect(output.result.entities).toHaveLength(1);
    expect(JSON.stringify(output.result)).not.toContain('trace');
  });
});

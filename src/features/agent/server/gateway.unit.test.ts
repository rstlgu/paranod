import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { AgentGraphLease } from '@/features/graph/server/graph-agent-lease';
import type { AgentApprovalMode } from '../lib/contracts';
import sharp from 'sharp';
import * as imageBytes from '@/lib/security/image-bytes';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  osintFetch: vi.fn(),
  publish: vi.fn()
}));
vi.mock('@/lib/security/safe-fetch', () => ({ safePublicFetch: mocks.fetch }));
vi.mock('@/features/plugins/builtin/osint-utils', async (original) => ({
  ...(await original<
    typeof import('@/features/plugins/builtin/osint-utils')
  >()),
  osintFetch: mocks.osintFetch
}));
// Execution uses the real plugin, but workspace configuration must never reach
// the developer's configured database from this isolated gateway fixture.
vi.mock('@/features/plugins/server-config', () => ({
  loadWorkspacePluginConfig: vi.fn(async () => ({}))
}));
vi.mock('./runs', () => ({ publishAgentActivity: mocks.publish }));
import { createAgentGateway } from './gateway';
import { AGENT_LIMITS, argumentsHash } from './policy';

const handle: AgentGraphLease = {
  runId: 'run',
  graphId: 'graph',
  userId: 'owner',
  generation: 1,
  token: 'server-only'
};
const args = {
  moduleId: 'ip-geolocation',
  transformId: 'org-to-asn',
  nodeId: 'input'
};
const signal = () => new AbortController().signal;

function database(
  type = 'organization',
  value = 'Example Org',
  approvalMode?: AgentApprovalMode
) {
  const state = {
    owner: 'owner',
    workspaceId: 'workspace',
    member: true,
    status: 'running',
    goal: 'ora fai lo stesso per adidas',
    generation: 1,
    setting: {
      enabled: true,
      updatedAt: new Date(0),
      config: null as string | null
    },
    graph: {
      nodes: [
        {
          id: 'input',
          position: { x: 0, y: 0 },
          data: { type, label: value, metadata: { value } }
        }
      ],
      edges: []
    },
    events: [] as Array<{ data: unknown }>
  };
  const tx = {
    $queryRaw: vi.fn(async () => [{ id: 'graph', now: new Date() }]),
    graphAgentLease: {
      findUnique: vi.fn(async () => ({
        ...handle,
        expiresAt: new Date(Date.now() + 60000),
        generation: state.generation
      }))
    },
    workspaceMember: {
      findUnique: vi.fn(async () =>
        state.member ? { id: 'membership' } : null
      )
    },
    agentRun: {
      findUniqueOrThrow: vi.fn(async () => ({
        goal: state.goal,
        parentRunId: null,
        graphId: 'graph',
        userId: 'owner'
      })),
      findUnique: vi.fn(async () => ({
        userId: 'owner',
        graphId: 'graph',
        status: state.status
      }))
    },
    graph: {
      findUnique: vi.fn(async () => ({
        userId: state.owner,
        workspaceId: state.workspaceId
      })),
      findUniqueOrThrow: vi.fn(async () => ({
        ...state.graph,
        workspaceId: state.workspaceId
      })),
      update: vi.fn(async () => ({ id: 'graph' }))
    },
    workspacePluginSetting: {
      findUnique: vi.fn(async () => state.setting),
      findMany: vi.fn(async () => [
        { pluginId: args.moduleId, enabled: state.setting.enabled }
      ])
    },
    workspaceAddonInstall: { findMany: vi.fn(async () => []) },
    agentEvent: { findMany: vi.fn(async () => state.events) }
  };
  const db = {
    $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)
  } as unknown as PrismaClient;
  return {
    state,
    tx,
    port: createAgentGateway(db, handle, 'workspace', approvalMode)
  };
}

async function approve(
  setup: ReturnType<typeof database>,
  request = args,
  approved = true
) {
  const permit = await setup.port.prepareTransform(request);
  const hash = argumentsHash({
    runId: 'run',
    name: 'run_transform',
    arguments: request,
    fingerprint: permit.fingerprint
  });
  setup.state.events = [
    {
      data: {
        type: 'approval',
        approvalId: 'a',
        tool: 'run_transform',
        summary: 'Exact lookup',
        destination: permit.destination,
        argumentsHash: hash
      }
    },
    { data: { type: 'decision', approvalId: 'a', approved } }
  ];
  expect(await setup.port.waitForDecision('a', hash, signal())).toBe(approved);
  return permit;
}

describe('agent node deletion gateway', () => {
  const deletion = { nodeIds: ['input'], reason: 'Requested cleanup' };

  it('persists deletions and publishes removal counts in Full access', async () => {
    const f = database('domain', 'example.org', 'auto');
    expect(await f.port.deleteNodes(deletion)).toEqual({
      nodesRemoved: 1,
      edgesRemoved: 0
    });
    expect(f.tx.graph.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { nodes: [], edges: [], nodeCount: 0, edgeCount: 0 }
      })
    );
    expect(mocks.publish).toHaveBeenCalledWith(
      f.tx,
      handle,
      expect.objectContaining({
        type: 'graph_changes',
        nodesRemoved: 1,
        edgesRemoved: 0
      })
    );
  });

  it.each(['guarded', 'ask'] as const)(
    'requires exact, single-use approval in %s mode',
    async (mode) => {
      const f = database('domain', 'example.org', mode);
      await expect(f.port.deleteNodes(deletion)).rejects.toThrow(
        'agent_approval_required'
      );
      expect(f.tx.graph.update).not.toHaveBeenCalled();
      const hash = argumentsHash({
        runId: 'run',
        name: 'delete_nodes',
        arguments: deletion
      });
      f.state.events = [
        {
          data: {
            type: 'approval',
            approvalId: 'delete-1',
            tool: 'delete_nodes',
            summary: 'Delete one node',
            destination: 'Current graph',
            argumentsHash: hash
          }
        },
        { data: { type: 'decision', approvalId: 'delete-1', approved: true } }
      ];
      await f.port.waitForDecision('delete-1', hash, signal());
      await expect(
        f.port.deleteNodes({ ...deletion, reason: 'Changed arguments' })
      ).rejects.toThrow('agent_approval_required');
      await f.port.deleteNodes(deletion);
      await expect(f.port.deleteNodes(deletion)).rejects.toThrow(
        'agent_approval_required'
      );
      expect(f.tx.graph.update).toHaveBeenCalledOnce();
    }
  );

  it('does not write after lease ownership or workspace changes', async () => {
    for (const change of [
      { generation: 2 },
      { status: 'cancelled' },
      { workspaceId: 'other' },
      { member: false }
    ]) {
      const f = database('domain', 'example.org', 'auto');
      Object.assign(f.state, change);
      await expect(f.port.deleteNodes(deletion)).rejects.toThrow();
      expect(f.tx.graph.update).not.toHaveBeenCalled();
    }
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetch.mockReset();
  mocks.osintFetch.mockReset();
  mocks.fetch.mockResolvedValue(
    new Response(
      JSON.stringify({ data: { asns: [{ asn: 15169, name: 'Example' }] } })
    )
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Unexpected live call');
    })
  );
});

describe('agent gateway scoped module execution', () => {
  it('adds a domain inferred from a brand as an unverified candidate', async () => {
    const setup = database('domain', 'nike.com', 'auto');
    const result = await setup.port.addSeed({
      type: 'domain',
      value: 'adidas.com'
    });
    expect(result).toMatchObject({ nodesAdded: 1, inferred: true });
    const update = setup.tx.graph.update.mock.calls[0] as unknown as [
      {
        data: {
          nodes: Array<{
            data: { label: string; metadata: Record<string, unknown> };
          }>;
        };
      }
    ];
    expect(update[0].data.nodes.at(-1)?.data).toMatchObject({
      label: 'adidas.com',
      metadata: { verified: false, provenance: 'agent_inference' }
    });
  });
  it('does not infer an unrelated seed or bypass URL credential validation', async () => {
    const setup = database('domain', 'nike.com', 'auto');
    await expect(
      setup.port.addSeed({ type: 'domain', value: 'unrelated.com' })
    ).rejects.toThrow('agent_seed_outside_request');
    setup.state.goal = 'aggiungi https://user:pass@adidas.com';
    await expect(
      setup.port.addSeed({ type: 'url', value: 'https://user:pass@adidas.com' })
    ).rejects.toThrow('agent_sensitive_seed');
    expect(setup.tx.graph.update).not.toHaveBeenCalled();
  });
  it.each(['auto', 'guarded', 'ask'] as const)(
    'imports 100 subdomains plus their IPs through the real plugin in %s mode',
    async (mode) => {
      const setup = database('domain', 'nike.com', mode);
      mocks.osintFetch.mockImplementation(async (url: string) => {
        if (url.includes('hackertarget'))
          return new Response(
            Array.from(
              { length: 100 },
              (_, i) => `sub${i}.nike.com,8.8.8.${i + 1}`
            ).join('\n')
          );
        return new Response('[]');
      });
      const request = {
        moduleId: 'subdomain-finder',
        transformId: 'subdomain-find',
        nodeId: 'input'
      };
      const permit =
        mode === 'auto'
          ? await setup.port.prepareTransform(request)
          : await approve(setup, request);
      const result = await setup.port.executeTransform(
        request,
        permit.fingerprint,
        signal()
      );
      expect(result).toMatchObject({
        nodesAdded: 200,
        edgesAdded: 200,
        omittedEntities: 0,
        omittedEdges: 0
      });
      expect(setup.tx.graph.update).toHaveBeenCalledTimes(1);
      expect(mocks.osintFetch).toHaveBeenCalledTimes(3);
    }
  );
  it('returns and publishes exact omissions when the graph has room for only part of the results', async () => {
    const setup = database('organization', 'Example Org', 'auto');
    const input = setup.state.graph.nodes[0];
    setup.state.graph.nodes.push(
      ...Array.from({ length: AGENT_LIMITS.maxGraphNodes - 2 }, (_, i) => ({
        ...input,
        id: `existing-${i}`
      }))
    );
    mocks.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({ data: { asns: [{ asn: 15169 }, { asn: 13335 }] } })
      )
    );
    const permit = await setup.port.prepareTransform(args);
    expect(
      await setup.port.executeTransform(args, permit.fingerprint, signal())
    ).toMatchObject({
      nodesAdded: 1,
      edgesAdded: 1,
      omittedEntities: 1,
      omittedEdges: 1
    });
    expect(mocks.publish).toHaveBeenCalledWith(
      expect.anything(),
      handle,
      expect.objectContaining({
        type: 'message',
        text: expect.stringContaining('1 entities and 1 links were not added')
      })
    );
  });
  it('requires a persisted exact-action approval; prepare alone is not authority', async () => {
    const setup = database();
    const permit = await setup.port.prepareTransform(args);
    await expect(
      setup.port.executeTransform(args, permit.fingerprint, signal())
    ).rejects.toThrow('agent_approval_required');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('executes an approved lookup and merges remapped unverified provenance', async () => {
    const setup = database();
    const permit = await approve(setup);
    const result = await setup.port.executeTransform(
      args,
      permit.fingerprint,
      signal()
    );
    expect(result).toMatchObject({ nodesAdded: 1, edgesAdded: 1 });
    await expect(
      setup.port.executeTransform(args, permit.fingerprint, signal())
    ).rejects.toThrow('agent_approval_required');
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not execute a denied action or reuse a prior decision to replay an external request', async () => {
    const denied = database();
    const permit = await approve(denied, args, false);
    await expect(
      denied.port.executeTransform(args, permit.fingerprint, signal())
    ).rejects.toThrow('agent_approval_required');
    const setup = database();
    const approved = await approve(setup);
    await setup.port.executeTransform(args, approved.fingerprint, signal());
    await approve(setup);
    await expect(
      setup.port.executeTransform(args, approved.fingerprint, signal())
    ).rejects.toThrow('agent_duplicate_external_action');
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it('scopes lazy discovery and detail loading to the active graph membership', async () => {
    const setup = database('domain', 'example.org');
    const found = (await setup.port.listModules('domain', 'dns', 0)) as {
      modules: unknown[];
    };
    expect(found.modules.length).toBeGreaterThan(0);
    expect(found.modules.length).toBeLessThanOrEqual(20);
    await expect(
      setup.port.describeModule('domain', 'dns-lookup', 'dns-resolve-a')
    ).resolves.toMatchObject({ executable: true });
    setup.state.member = false;
    await expect(setup.port.listModules('domain')).rejects.toThrow();
    await expect(
      setup.port.describeModule('domain', 'dns-lookup', 'dns-resolve-a')
    ).rejects.toThrow();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each([
    'disabled',
    'config',
    'target',
    'workspace',
    'membership',
    'owner',
    'lease',
    'cancel'
  ])(
    'rejects %s changes after approval without external execution',
    async (change) => {
      const setup = database();
      const permit = await approve(setup);
      switch (change) {
        case 'disabled':
          setup.state.setting.enabled = false;
          break;
        case 'config':
          setup.state.setting.config = 'changed';
          break;
        case 'target':
          setup.state.graph.nodes[0].data.metadata.value = 'Different Org';
          break;
        case 'workspace':
          setup.state.workspaceId = 'other';
          break;
        case 'membership':
          setup.state.member = false;
          break;
        case 'owner':
          setup.state.owner = 'other';
          break;
        case 'lease':
          setup.state.generation++;
          break;
        case 'cancel':
          setup.state.status = 'cancelled';
          break;
      }
      await expect(
        setup.port.executeTransform(args, permit.fingerprint, signal())
      ).rejects.toThrow();
      expect(mocks.fetch).not.toHaveBeenCalled();
      expect(setup.tx.graph.update).not.toHaveBeenCalled();
    }
  );

  it('revalidates configuration immediately before dispatch', async () => {
    const setup = database();
    const permit = await approve(setup);
    let reads = 0;
    setup.tx.workspacePluginSetting.findUnique.mockImplementation(async () => {
      reads++;
      if (reads === 2) setup.state.setting.config = 'changed';
      return setup.state.setting;
    });
    await expect(
      setup.port.executeTransform(args, permit.fingerprint, signal())
    ).rejects.toThrow('agent_module_changed');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each(['config', 'membership', 'cancel'])(
    'discards late results after %s changes',
    async (change) => {
      const setup = database();
      const permit = await approve(setup);
      mocks.fetch.mockImplementation(async () => {
        if (change === 'config') setup.state.setting.config = 'changed';
        if (change === 'membership') setup.state.member = false;
        if (change === 'cancel') setup.state.status = 'cancelled';
        return new Response(
          JSON.stringify({ data: { asns: [{ asn: 15169 }] } })
        );
      });
      await expect(
        setup.port.executeTransform(args, permit.fingerprint, signal())
      ).rejects.toThrow();
      expect(setup.tx.graph.update).not.toHaveBeenCalled();
    }
  );

  it('allows key-backed transforms at prepare time without executing them', async () => {
    const setup = database('email', 'sample@example.org');
    const permit = await setup.port.prepareTransform({
      moduleId: 'hibp',
      transformId: 'hibp-email-breaches',
      nodeId: 'input'
    });
    expect(permit.requiresApproval).toBe(true);
    expect(permit.destination.length).toBeGreaterThan(0);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('passes only the persisted owner and workspace to image file execution', async () => {
    const source = '/api/upload/temp/image-file';
    const setup = database('media_url', source);
    const request = {
      moduleId: 'image-analysis',
      transformId: 'image-hash',
      nodeId: 'input'
    };
    const image = await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#336699' }
    })
      .png()
      .toBuffer();
    const read = vi
      .spyOn(imageBytes, 'loadImageBytes')
      .mockResolvedValue(image);
    try {
      const permit = await approve(setup, request);
      await setup.port.executeTransform(request, permit.fingerprint, signal());
      expect(read).toHaveBeenCalledWith(source, {
        userId: 'owner',
        workspaceId: 'workspace'
      });
      expect(setup.tx.graph.update).toHaveBeenCalled();
    } finally {
      read.mockRestore();
    }
  });

  it('rejects malformed provider results without graph mutation', async () => {
    const setup = database();
    const permit = await approve(setup);
    mocks.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({ data: { asns: [{ asn: 'secret-value' }] } })
      )
    );
    await expect(
      setup.port.executeTransform(args, permit.fingerprint, signal())
    ).rejects.toThrow(/^agent_module_failed$/);
    expect(setup.tx.graph.update).not.toHaveBeenCalled();
  });

  it('does not silently remove credentials or a query from a graph target before approval', async () => {
    const setup = database(
      'url',
      'https://user:secret@example.org/?token=secret'
    );
    await expect(
      setup.port.prepareTransform({
        moduleId: 'url-parser',
        transformId: 'url-resolve-ip',
        nodeId: 'input'
      })
    ).rejects.toThrow('agent_sensitive_target');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('still executes the existing local email parser without external approval', async () => {
    const setup = database('email', 'sample@example.org');
    const request = {
      moduleId: 'email-parser',
      transformId: 'email-extract-domain',
      nodeId: 'input'
    };
    const permit = await setup.port.prepareTransform(request);
    expect(permit.requiresApproval).toBe(false);
    expect(
      await setup.port.executeTransform(request, permit.fingerprint, signal())
    ).toMatchObject({ nodesAdded: 1 });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('applies the run approval mode chosen by the user', async () => {
    const local = {
      moduleId: 'email-parser',
      transformId: 'email-extract-domain',
      nodeId: 'input'
    };
    const ask = database('email', 'sample@example.org', 'ask');
    const askPermit = await ask.port.prepareTransform(local);
    expect(askPermit.requiresApproval).toBe(true);
    await expect(
      ask.port.executeTransform(local, askPermit.fingerprint, signal())
    ).rejects.toThrow('agent_approval_required');
    const full = database('organization', 'Example Org', 'auto');
    const fullPermit = await full.port.prepareTransform(args);
    expect(fullPermit.requiresApproval).toBe(false);
    expect(
      await full.port.executeTransform(args, fullPermit.fingerprint, signal())
    ).toMatchObject({ nodesAdded: expect.any(Number) });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
});

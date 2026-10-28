import { describe, expect, it } from 'vitest';
import { AGENT_LIMITS } from './policy';
import { MODULE_LIMITS } from './module-policy';
import {
  CARD_WIDTH,
  cardSize
} from '@/features/graph/components/graph-editor/utils/card-node';
import {
  addSeed,
  deleteGraphNodes,
  graphNodeInput,
  mergeGraphNodes,
  mergeTransformResult,
  projectGraph,
  type AgentGraphData
} from './graph-data';

const base = (): AgentGraphData => ({
  nodes: [
    {
      id: 'source',
      position: { x: 0, y: 0 },
      data: {
        label: 'example.test',
        type: 'domain',
        metadata: { apiKey: 'do-not-send', cookie: 'private' }
      }
    }
  ],
  edges: []
});
describe('agent graph data boundary', () => {
  it('removes only the requested nodes and incident edges without mutating the input', () => {
    const graph = base();
    graph.nodes.push(
      { ...graph.nodes[0], id: 'keep' },
      { ...graph.nodes[0], id: 'other' }
    );
    graph.edges = [
      { id: 'incident', source: 'source', target: 'keep' },
      { id: 'keep-edge', source: 'keep', target: 'other' }
    ];
    const result = deleteGraphNodes(graph, {
      nodeIds: ['source', 'source'],
      reason: 'Duplicate'
    });
    expect(result).toMatchObject({
      nodesRemoved: 1,
      edgesRemoved: 1,
      nodesAdded: 0,
      edgesAdded: 0
    });
    expect(result.graph.nodes.map((node) => node.id)).toEqual([
      'keep',
      'other'
    ]);
    expect(result.graph.edges.map((edge) => edge.id)).toEqual(['keep-edge']);
    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges).toHaveLength(2);
  });

  it('rejects unknown targets atomically and bounds deletion batches', () => {
    const graph = base();
    expect(() =>
      deleteGraphNodes(graph, {
        nodeIds: ['source', 'another-graph'],
        reason: 'Cleanup'
      })
    ).toThrow('agent_node_unavailable');
    expect(graph.nodes).toHaveLength(1);
    for (const nodeIds of [[], Array(101).fill('source')]) {
      expect(() =>
        deleteGraphNodes(graph, { nodeIds, reason: 'Cleanup' })
      ).toThrow();
    }
  });

  it('can delete a supplied private node ID without exposing its content', () => {
    const graph = base();
    graph.nodes[0].data.type = 'note';
    const result = deleteGraphNodes(graph, {
      nodeIds: ['source'],
      reason: 'Requested deletion'
    });
    expect(result.graph).toEqual({ nodes: [], edges: [] });
    expect(graph.nodes[0].data.metadata).toHaveProperty('cookie', 'private');
  });

  it('merges only nodes of the same type and keeps the primary metadata', () => {
    const graph = base();
    graph.nodes.push(
      {
        id: 'alias',
        position: { x: 200, y: 0 },
        data: {
          label: 'example.test alias',
          type: 'domain',
          metadata: { value: 'alias.example.test' }
        }
      },
      {
        id: 'address',
        position: { x: 0, y: 200 },
        data: { label: '203.0.113.10', type: 'ip', metadata: { value: '203.0.113.10' } }
      }
    );
    graph.edges = [
      { id: 'between', source: 'source', target: 'alias' },
      { id: 'external', source: 'address', target: 'source' }
    ];
    const result = mergeGraphNodes(graph, {
      nodeIds: ['source', 'alias'],
      primaryNodeId: 'source',
      reason: 'Same domain'
    });
    expect(result.nodesMerged).toBe(2);
    expect(result.nodeType).toBe('domain');
    expect(result.mergedNodeId).toMatch(/^merged_\d+$/);
    expect(result.graph.nodes.map((node) => node.id).sort()).toEqual(
      ['address', result.mergedNodeId].sort()
    );
    const merged = result.graph.nodes.find(
      (node) => node.id === result.mergedNodeId
    );
    expect(merged?.data.metadata).toMatchObject({
      apiKey: 'do-not-send',
      mergedChildCount: 2
    });
    expect(result.graph.edges).toEqual([
      expect.objectContaining({
        source: 'address',
        target: result.mergedNodeId
      })
    ]);
    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges.map((edge) => edge.id)).toEqual(['between', 'external']);
    expect(() =>
      mergeGraphNodes(graph, {
        nodeIds: ['source', 'address'],
        primaryNodeId: 'source',
        reason: 'Different types'
      })
    ).toThrow('agent_merge_not_allowed');
    expect(() =>
      mergeGraphNodes(graph, {
        nodeIds: ['source', 'missing'],
        primaryNodeId: 'source',
        reason: 'Missing'
      })
    ).toThrow('agent_node_unavailable');
  });
  const provenance = { runId: 'run', moduleId: 'plugin', transformId: 'test' };
  const manyResults = (count: number) => ({
    success: true,
    entities: Array.from({ length: count }, (_, i) => ({
      id: `remote-${i}`,
      type: 'domain',
      value: `sub${i}.example.org`
    })),
    edges: Array.from({ length: count * 2 }, (_, i) => ({
      id: `link-${i}`,
      sourceId: 'source',
      targetId: `remote-${Math.floor(i / 2)}`,
      label: `Relation ${i % 2}`
    }))
  });
  it('accepts the complete module limit, including more than 300 edges', () => {
    const result = mergeTransformResult(
      base(),
      'source',
      manyResults(MODULE_LIMITS.maxEntities),
      provenance
    );
    expect(result).toMatchObject({
      nodesAdded: MODULE_LIMITS.maxEntities,
      edgesAdded: MODULE_LIMITS.maxEdges,
      omittedEntities: 0,
      omittedEdges: 0
    });
  });
  it('keeps the import bounded and rejects oversize results atomically', () => {
    const graph = base();
    expect(() =>
      mergeTransformResult(
        graph,
        'source',
        manyResults(MODULE_LIMITS.maxEntities + 1),
        provenance
      )
    ).toThrow('agent_result_limit');
    expect(graph.nodes).toHaveLength(1);
    expect(graph.edges).toHaveLength(0);
  });
  it.each([0, 2])(
    'keeps valid endpoint references with %s node slots left',
    (slots) => {
      const graph = base();
      graph.nodes.push(
        ...Array.from(
          { length: AGENT_LIMITS.maxGraphNodes - 1 - slots },
          (_, i) => ({ ...graph.nodes[0], id: `existing-${i}` })
        )
      );
      const result = mergeTransformResult(
        graph,
        'source',
        manyResults(4),
        provenance
      );
      expect(result).toMatchObject({
        nodesAdded: slots,
        edgesAdded: slots * 2,
        omittedEntities: 4 - slots,
        omittedEdges: (4 - slots) * 2
      });
      const ids = new Set(result.graph.nodes.map((node) => node.id));
      expect(
        result.graph.edges.every(
          (edge) => ids.has(edge.source) && ids.has(edge.target)
        )
      ).toBe(true);
    }
  );
  it('respects the global edge capacity and reports every skipped link', () => {
    const graph = base();
    graph.edges = Array.from(
      { length: AGENT_LIMITS.maxGraphEdges - 1 },
      (_, i) => ({ id: `existing-${i}`, source: 'source', target: 'source' })
    );
    const result = mergeTransformResult(
      graph,
      'source',
      manyResults(2),
      provenance
    );
    expect(result).toMatchObject({
      nodesAdded: 2,
      edgesAdded: 1,
      omittedEntities: 0,
      omittedEdges: 3
    });
    expect(result.graph.edges).toHaveLength(AGENT_LIMITS.maxGraphEdges);
  });
  it('does not hide invalid provider references in a truncated result', () => {
    const graph = base();
    graph.nodes = Array.from(
      { length: AGENT_LIMITS.maxGraphNodes },
      (_, i) => ({ ...graph.nodes[0], id: i ? `existing-${i}` : 'source' })
    );
    const result = manyResults(4);
    result.edges[7].targetId = 'other-graph';
    expect(() =>
      mergeTransformResult(graph, 'source', result, provenance)
    ).toThrow('Invalid addon edge reference');
  });
  it('projects only public values; never arbitrary metadata or private node contents', () => {
    const graph = base();
    graph.nodes.push({
      id: 'secret',
      position: { x: 0, y: 0 },
      data: { type: 'credential', label: 'secret-password' }
    });
    expect(JSON.stringify(projectGraph(graph))).not.toMatch(
      /do-not-send|private|password/
    );
    expect(() => graphNodeInput(graph, 'secret')).toThrow();
  });
  it('deduplicates seeds and rejects credentialed URLs', () => {
    expect(
      addSeed(base(), { type: 'domain', value: 'example.test' }, 'run')
        .nodesAdded
    ).toBe(0);
    expect(() =>
      addSeed(
        base(),
        { type: 'url', value: 'https://example.test/?key=secret' },
        'run'
      )
    ).toThrow();
  });
  it('stores usernames without the @ sigil', () => {
    const change = addSeed(
      base(),
      { type: 'username', value: '@rstlgu' },
      'run'
    );
    const node = change.graph.nodes.find((item) => item.id === change.id);
    expect(node?.data.label).toBe('rstlgu');
    expect(() =>
      addSeed(base(), { type: 'username', value: '@' }, 'run')
    ).toThrow('agent_invalid_seed');
  });
  it('remaps provider IDs and keeps plugin fields except credential text', () => {
    const graph = base();
    const result = mergeTransformResult(
      graph,
      'source',
      {
        success: true,
        entities: [
          {
            id: 'remote-1',
            type: 'ip',
            value: '203.0.113.1',
            metadata: { apiKey: 'secret', verified: true, country: 'IT' }
          }
        ],
        edges: [
          {
            id: 'edge',
            sourceId: 'source',
            targetId: 'remote-1',
            label: 'Resolves to'
          }
        ]
      },
      { runId: 'run', moduleId: 'dns', transformId: 'lookup' }
    );
    expect(result.graph.nodes[1].id).not.toBe('remote-1');
    expect(result.graph.edges[0].target).toBe(result.graph.nodes[1].id);
    // The plugin's own `verified` wins; agent provenance fills the rest.
    expect(result.graph.nodes[1].data.metadata).toEqual({
      verified: true,
      country: 'IT',
      source: 'dns/lookup',
      retrievedAt: expect.any(String),
      agentRunId: 'run'
    });
    expect(JSON.stringify(result.graph.nodes[1])).not.toContain('secret');
    expect(graph.nodes).toHaveLength(1);
  });
  it('adds plugin cards as cards, exactly as a manual run does', () => {
    const metadata = {
      nodeView: 'card',
      customTitle: 'GitHub',
      Name: 'Ada Lovelace',
      'Profile Url': 'https://github.com/ada?tab=repositories',
      'Has Password': true
    };
    const result = mergeTransformResult(
      base(),
      'source',
      {
        success: true,
        entities: [
          {
            id: 'card',
            type: 'github_user',
            value: 'ada',
            label: 'GitHub · Ada Lovelace',
            metadata
          },
          { id: 'name', type: 'username', value: 'ada' }
        ],
        edges: [
          { id: 'e1', sourceId: 'source', targetId: 'card', label: 'Account' },
          {
            id: 'e2',
            sourceId: 'card',
            targetId: 'name',
            label: 'Username',
            relationship: 'associated_with'
          }
        ]
      },
      provenance
    );
    const [card, username] = result.graph.nodes.slice(1);
    expect(card.data).toEqual({
      type: 'github_user',
      label: 'GitHub · Ada Lovelace',
      metadata: {
        ...metadata,
        value: 'ada',
        verified: false,
        source: 'plugin/test',
        retrievedAt: expect.any(String),
        agentRunId: 'run'
      }
    });
    expect(card.style).toEqual(cardSize(metadata));
    expect(username.style).toEqual({ width: 200, height: 85 });
    expect(username.position.x - card.position.x).toBe(CARD_WIDTH + 60);
    expect(result.graph.edges[1].data).toMatchObject({
      label: 'Username',
      relationship: 'associated_with'
    });
  });
  it('rejects output ID collisions and cross-graph edge references atomically', () => {
    const provenance = {
      runId: 'run',
      moduleId: 'plugin',
      transformId: 'test'
    };
    expect(() =>
      mergeTransformResult(
        base(),
        'source',
        { entities: [{ id: 'source', type: 'ip', value: 'value' }], edges: [] },
        provenance
      )
    ).toThrow();
    expect(() =>
      mergeTransformResult(
        base(),
        'source',
        {
          entities: [],
          edges: [
            {
              id: 'e',
              sourceId: 'source',
              targetId: 'other-graph',
              label: 'link'
            }
          ]
        },
        provenance
      )
    ).toThrow();
  });
});

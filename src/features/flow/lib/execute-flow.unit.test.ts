import { beforeEach, describe, expect, it, vi } from 'vitest';

const { executeTransform } = vi.hoisted(() => ({ executeTransform: vi.fn() }));

vi.mock('@/features/plugins', () => ({
  executeTransform,
  matchesInputType: (actual: string, expected: string) =>
    expected === 'all' || actual === expected,
  createTransformInput: (
    entityId: string,
    entityType: string,
    entityValue: string,
    metadata: unknown,
    config: unknown
  ) => ({ entityId, entityType, entityValue, metadata, config })
}));

import { executeFlow, type StoredFlowNode } from './execute-flow';
import { sanitizeSteps } from './flow-run-recorder';

const nodes: StoredFlowNode[] = [
  { id: 'trigger', type: 'trigger', data: { nodeType: 'domain' } },
  {
    id: 'resolve',
    type: 'transform',
    data: {
      pluginId: 'dns',
      transformId: 'resolve',
      name: 'Resolve domain',
      inputType: 'domain',
      outputTypes: ['ip']
    }
  },
  {
    id: 'lookup',
    type: 'transform',
    data: {
      pluginId: 'network',
      transformId: 'lookup',
      name: 'Lookup IP',
      inputType: 'ip',
      outputTypes: ['organization']
    }
  }
];
const edges = [
  { source: 'trigger', target: 'resolve' },
  { source: 'resolve', target: 'lookup' }
];
const input = {
  entityId: 'domain-1',
  entityType: 'domain',
  entityValue: 'example.org'
};

beforeEach(() => executeTransform.mockReset());

describe('flow execution and local history', () => {
  it('propagates unique outputs to the next step with workspace configuration and graph context', async () => {
    executeTransform
      .mockResolvedValueOnce({
        success: true,
        entities: [
          { id: 'ip-1', type: 'ip', value: '192.0.2.1' },
          { id: 'ip-duplicate', type: 'ip', value: '192.0.2.1' }
        ],
        edges: []
      })
      .mockResolvedValueOnce({
        success: true,
        entities: [{ id: 'org-1', type: 'organization', value: 'Example' }],
        edges: []
      });

    const result = await executeFlow({
      nodes,
      edges,
      input,
      graphId: 'graph-1',
      pluginConfigs: { network: { apiKey: 'test-key' } }
    });

    expect(result.success).toBe(true);
    expect(executeTransform).toHaveBeenCalledTimes(2);
    expect(executeTransform).toHaveBeenLastCalledWith(
      'network',
      'lookup',
      expect.objectContaining({
        entityId: 'ip-1',
        entityValue: '192.0.2.1',
        config: { apiKey: 'test-key' }
      }),
      'graph-1'
    );
    expect(result.entities).toHaveLength(2);
    expect(sanitizeSteps(result.steps)).toEqual([
      expect.objectContaining({
        nodeId: 'resolve',
        inputCount: 1,
        entityCount: 1
      }),
      expect.objectContaining({
        nodeId: 'lookup',
        inputCount: 1,
        entityCount: 1
      })
    ]);
  });

  it('records a rejected transform as failed and skips dependent steps', async () => {
    executeTransform.mockResolvedValue({
      success: false,
      error: 'Graph is read-only',
      entities: [],
      edges: []
    });

    const result = await executeFlow({
      nodes,
      edges,
      input,
      graphId: 'graph-1'
    });

    expect(executeTransform).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
    expect(result.steps[0]).toMatchObject({
      status: 'failed',
      error: 'Graph is read-only'
    });
    expect(result.steps[1]).toMatchObject({ status: 'skipped' });
    expect(result.entities).toEqual([]);
  });

  it('stops before executing a flow whose trigger does not match its input', async () => {
    const result = await executeFlow({
      nodes,
      edges,
      input: { ...input, entityType: 'email', entityValue: 'user@example.org' }
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('expects "domain"');
    expect(executeTransform).not.toHaveBeenCalled();
  });
});

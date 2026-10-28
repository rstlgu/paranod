import { describe, expect, it } from 'vitest';
import { agentStartRequestHash, agentStartSchema } from './start-contract';
import { agentGraphRevision } from './snapshot';

const start = {
  runId: 'ee423bc3-7c44-4b4c-8a87-f3e106f65b8d',
  graphId: 'graph',
  workspaceId: 'workspace',
  userId: 'user',
  goal: 'Inspect example.org',
  model: 'gpt-6-astra',
  reasoning: 'low',
  expectedWriteVersion: 0,
  expectedRevision: 'a'.repeat(64)
};
describe('start binding', () => {
  it('binds retries to content, version, user, workspace and exact intent', () => {
    const hash = agentStartRequestHash(start);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(agentStartRequestHash({ ...start, goal: ` ${start.goal} ` })).toBe(
      hash
    );
    for (const change of [
      { userId: 'other' },
      { workspaceId: 'other' },
      { graphId: 'other' },
      { goal: 'Another task' },
      { model: 'gpt-5.5' },
      { reasoning: 'high' },
      { expectedWriteVersion: 1 },
      { expectedRevision: 'b'.repeat(64) },
      { parentRunId: '09466329-c5fa-4164-916c-240d9e37e8cf' }
    ])
      expect(agentStartRequestHash({ ...start, ...change })).not.toBe(hash);
  });
  it('rejects unsafe numbers and client-supplied scope', () => {
    const { workspaceId: _workspace, userId: _user, ...body } = start;
    expect(agentStartSchema.safeParse(body).success).toBe(true);
    expect(agentStartSchema.safeParse(start).success).toBe(false);
    expect(
      agentStartSchema.safeParse({
        ...body,
        expectedWriteVersion: Number.MAX_SAFE_INTEGER + 1
      }).success
    ).toBe(false);
  });
});
describe('canonical graph revision', () => {
  const graph = {
    id: 'graph',
    userId: 'user',
    workspaceId: 'workspace',
    caseId: 'case',
    name: 'Graph',
    description: null,
    nodes: [{ id: 'node', type: 'domain' }],
    edges: [],
    notes: 'Notes',
    caseNote: { id: 'note', content: 'Linked note' }
  };
  it('is stable for JSON object key order and changes with every content surface', () => {
    const revision = agentGraphRevision(graph);
    expect(
      agentGraphRevision({ ...graph, nodes: [{ type: 'domain', id: 'node' }] })
    ).toBe(revision);
    for (const change of [
      { nodes: [] },
      { edges: [{ id: 'edge' }] },
      { name: 'Renamed' },
      { notes: 'Changed' },
      { caseNote: { id: 'note', content: 'Changed' } },
      { workspaceId: 'other' },
      { caseId: 'other' }
    ])
      expect(agentGraphRevision({ ...graph, ...change })).not.toBe(revision);
  });
});

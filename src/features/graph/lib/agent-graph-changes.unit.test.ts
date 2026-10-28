import { describe, expect, it } from 'vitest';
import { agentGraphChanges, withPresentation } from './agent-graph-changes';

describe('agent graph changes', () => {
  it('highlights added and edited items but not presentation-only changes', () => {
    const previous = {
      nodes: [
        { id: 'a', data: { label: 'a' }, selected: true, width: 90 },
        { id: 'b', data: { label: 'b' } },
        { id: 'gone', data: { label: 'x' } }
      ],
      edges: [{ id: 'e1', source: 'a', target: 'b' }]
    };
    const next = {
      nodes: [
        { id: 'a', data: { label: 'a' } },
        { id: 'b', data: { label: 'b', metadata: { verified: false } } },
        { id: 'c', data: { label: 'c' } }
      ],
      edges: [
        { id: 'e1', source: 'a', target: 'b' },
        { id: 'e2', source: 'a', target: 'c' }
      ]
    };
    expect(agentGraphChanges(previous, next)).toEqual({
      nodeIds: ['b', 'c'],
      edgeIds: ['e2']
    });
    expect(withPresentation(previous.nodes, next.nodes)[0]).toEqual({
      id: 'a',
      data: { label: 'a' },
      selected: true,
      width: 90
    });
  });
});

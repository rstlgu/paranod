import { expect, it } from 'vitest';
import { updateGraphSelection } from './graph-selection';
import { graphDraftFingerprint } from './graph-client-coordinator';

it('changes only selection without changing the captured investigation', () => {
  const nodes = [
    {
      id: 'a',
      selected: false,
      position: { x: 12, y: 24 },
      data: { label: 'example.org' }
    },
    {
      id: 'b',
      selected: false,
      position: { x: 56, y: 78 },
      data: { label: 'other.org' }
    }
  ];
  const edges = [{ id: 'edge', source: 'a', target: 'b', selected: true }];
  const selected = updateGraphSelection(nodes, (node) => node.id === 'a');
  const deselected = updateGraphSelection(edges, () => false);
  expect(selected[0].selected).toBe(true);
  expect(selected[0].data).toBe(nodes[0].data);
  expect(selected[0].position).toBe(nodes[0].position);
  expect(selected[1]).toBe(nodes[1]);
  expect(nodes[0].selected).toBe(false);
  expect(graphDraftFingerprint({ nodes: selected, edges: deselected })).toBe(
    graphDraftFingerprint({ nodes, edges })
  );
});

it('reuses the current snapshot when selection does not change', () => {
  const nodes = [{ id: 'a', selected: true }];
  expect(updateGraphSelection(nodes, () => true)).toBe(nodes);
});

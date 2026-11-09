import { describe, expect, it } from 'vitest';
import { createGraphHistory, type GraphSnapshot } from './graph-history';

const snapshot = (...ids: string[]): GraphSnapshot => ({
  nodes: ids.map((id) => ({
    id,
    position: { x: 0, y: 0 },
    data: { type: 'domain', label: id }
  })),
  edges: []
});
describe('agent graph history', () => {
  it('restores agent deletions with incident edges and supports redo to an empty graph', () => {
    const history = createGraphHistory();
    const before = snapshot('seed', 'result');
    before.edges = [{ id: 'link', source: 'seed', target: 'result' }];
    history.reset(before);
    history.commit(snapshot());
    expect(history.undo()).toEqual(before);
    expect(history.redo()).toEqual(snapshot());
  });
  it('keeps consecutive preview/adopt commits atomic without duplicate steps', () => {
    const history = createGraphHistory();
    history.reset(snapshot('seed'));
    history.commit(snapshot('seed'));
    history.commit(snapshot('seed', 'agent-a'));
    history.commit(snapshot('seed', 'agent-a'));
    history.commit(snapshot('seed', 'agent-a', 'agent-b'));
    history.commit(snapshot('seed', 'agent-a', 'agent-b'));
    expect(history.index).toBe(2);
    expect(history.undo()).toEqual(snapshot('seed', 'agent-a'));
    expect(history.undo()).toEqual(snapshot('seed'));
    expect(history.redo()).toEqual(snapshot('seed', 'agent-a'));
    expect(history.redo()).toEqual(snapshot('seed', 'agent-a', 'agent-b'));
  });
  it('ignores ReactFlow measurements, selections, key and array order', () => {
    const history = createGraphHistory();
    history.reset(snapshot('seed'));
    history.commit(snapshot('seed', 'agent'));
    history.undo();
    const measured = snapshot('seed');
    Object.assign(measured.nodes[0], {
      width: 200,
      height: 80,
      selected: true,
      dragging: false,
      positionAbsolute: { x: 0, y: 0 }
    });
    expect(history.commit(measured)).toBe(false);
    expect(history.canRedo).toBe(true);
    history.redo();
    expect(history.commit({ ...snapshot('agent', 'seed') })).toBe(false);
  });
  it('retains real size/position edits and drops redo only for a new edit', () => {
    const history = createGraphHistory();
    history.reset(snapshot('seed'));
    history.commit(snapshot('seed', 'agent'));
    history.undo();
    const edited = snapshot('seed');
    edited.nodes[0].style = { width: 450, height: 300 };
    edited.nodes[0].position.x = 123;
    expect(history.commit(edited)).toBe(true);
    expect(history.canRedo).toBe(false);
    expect(history.undo()).toEqual(snapshot('seed'));
    expect(history.redo()).toEqual(edited);
  });
  it('does not retain mutable references and enforces the history limit', () => {
    const history = createGraphHistory(3);
    const initial = snapshot('seed');
    history.reset(initial);
    initial.nodes[0].data.label = 'mutated';
    history.commit(snapshot('one'));
    expect(history.undo()).toEqual(snapshot('seed'));
    for (const id of ['one', 'two', 'three']) history.commit(snapshot(id));
    expect(history.index).toBe(2);
    history.undo();
    history.undo();
    expect(history.undo()).toBeNull();
  });
});

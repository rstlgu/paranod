import { describe, expect, it } from 'vitest';
import type { Node } from 'reactflow';
import { projectNodeDimensionsForCanvas } from './canvas-node-dimensions';
import { cardSize } from './card-node';

const node = (data: Record<string, unknown>, style?: Node['style']): Node => ({
  id: 'n',
  type: 'osint',
  position: { x: 0, y: 0 },
  data,
  ...(style ? { style } : {})
});

const cardData = {
  type: 'social',
  label: 'GitHub · Ada',
  metadata: { nodeView: 'card', Name: 'Ada', Username: 'ada' }
};

describe('canvas node dimensions', () => {
  it('keeps the size of a card, including after a resize', () => {
    const created = node(cardData, cardSize(cardData.metadata));
    expect(projectNodeDimensionsForCanvas(created)).toBe(created);
    const resized = node(cardData, { width: 420, height: 520 });
    expect(projectNodeDimensionsForCanvas(resized)).toBe(resized);
  });

  it('opens cards saved at the classic size or without one', () => {
    for (const style of [{ width: 200, height: 85 }, undefined]) {
      expect(projectNodeDimensionsForCanvas(node(cardData, style)).style).toEqual(
        cardSize(cardData.metadata)
      );
    }
  });

  it('still draws other entity nodes at the classic size', () => {
    const projected = projectNodeDimensionsForCanvas(
      node({ type: 'social', label: 'jack', metadata: {} }, { width: 300, height: 300 })
    );
    expect(projected.style).toMatchObject({ width: 200, height: 85 });
  });

  it('leaves resizable types alone', () => {
    const note = node({ type: 'note', label: 'text' }, { width: 350, height: 250 });
    expect(projectNodeDimensionsForCanvas(note)).toBe(note);
  });
});

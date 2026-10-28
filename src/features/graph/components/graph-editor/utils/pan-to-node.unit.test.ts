import { expect, it, vi } from 'vitest';
import type { ReactFlowInstance } from 'reactflow';
import { panToFlowNode } from './pan-to-node';

it.each([0.25, 1, 2.4])(
  'centers the rendered node without changing zoom %s',
  (zoom) => {
    const setCenter = vi.fn();
    const flow = {
      getNode: () => ({
        position: { x: 10, y: 20 },
        positionAbsolute: { x: 400, y: 600 },
        width: 300,
        height: 80
      }),
      getZoom: () => zoom,
      setCenter
    } as unknown as ReactFlowInstance;
    panToFlowNode(flow, 'new');
    expect(setCenter).toHaveBeenCalledExactlyOnceWith(550, 640, {
      zoom,
      duration: 380
    });
  }
);

it('ignores missing and hidden nodes', () => {
  const setCenter = vi.fn();
  for (const node of [undefined, { hidden: true }]) {
    panToFlowNode(
      { getNode: () => node, setCenter } as unknown as ReactFlowInstance,
      'gone'
    );
  }
  expect(setCenter).not.toHaveBeenCalled();
});

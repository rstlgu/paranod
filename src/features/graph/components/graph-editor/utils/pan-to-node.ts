import type { ReactFlowInstance } from 'reactflow';

/** Read rendered geometry and zoom at animation time, after layout has settled. */
export function panToFlowNode(flow: ReactFlowInstance, id: string) {
  const node = flow.getNode(id);
  if (!node || node.hidden) return;
  const position = node.positionAbsolute ?? node.position;
  void flow.setCenter(
    position.x + (node.width ?? 200) / 2,
    position.y + (node.height ?? 100) / 2,
    { zoom: flow.getZoom(), duration: 380 }
  );
}

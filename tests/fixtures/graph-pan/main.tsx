import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import ReactFlow, {
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  Background
} from 'reactflow';
import 'reactflow/dist/style.css';
import { usePanToAddedNode } from '../../../src/features/graph/components/graph-editor/hooks/use-pan-to-added-node';
import { panToFlowNode } from '../../../src/features/graph/components/graph-editor/utils/pan-to-node';

function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState([
    { id: 'initial', position: { x: 100, y: 100 }, data: { label: 'Initial' } }
  ]);
  const [ready, setReady] = useState(false);
  const flow = useReactFlow();
  usePanToAddedNode({
    nodes,
    scope: 'test',
    ready,
    panToNode: (id) => panToFlowNode(flow, id)
  });
  (window as any).graphPanFixture = {
    viewport: () => flow.getViewport(),
    node: (id: string) => flow.getNode(id)
  };
  function add(count: number) {
    setNodes((current) => [
      ...current,
      ...Array.from({ length: count }, (_, i) => {
        const n = current.length + i;
        return {
          id: `node-${n}`,
          position: { x: 1000 + n * 300, y: 600 + n * 200 },
          data: { label: `Added ${n}` }
        };
      })
    ]);
  }
  return (
    <>
      <button onClick={() => add(1)}>Add node</button>
      <button onClick={() => add(3)}>Add batch</button>
      <button onClick={() => flow.zoomTo(0.4)}>Zoom 40%</button>
      <button onClick={() => flow.zoomTo(1.7)}>Zoom 170%</button>
      <div style={{ width: 900, height: 600 }}>
        <ReactFlow
          nodes={nodes}
          onNodesChange={onNodesChange}
          onInit={() => setReady(true)}
          defaultViewport={{ x: 0, y: 0, zoom: 0.7 }}
        >
          <Background />
        </ReactFlow>
      </div>
    </>
  );
}
createRoot(document.getElementById('root')!).render(
  <ReactFlowProvider>
    <App />
  </ReactFlowProvider>
);

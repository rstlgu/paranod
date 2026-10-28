'use client';

import { ReactFlowProvider } from 'reactflow';
import 'reactflow/dist/style.css';

import { GraphEditor } from './graph-editor/graph-editor';

interface GraphViewPageProps {
  graphId?: string;
  isActive?: boolean;
}

export default function GraphViewPage({ graphId, isActive = true }: GraphViewPageProps) {
  return (
    <ReactFlowProvider>
      <GraphEditor graphId={graphId} isActive={isActive} />
    </ReactFlowProvider>
  );
}

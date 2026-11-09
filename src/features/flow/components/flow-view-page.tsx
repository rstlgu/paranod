'use client';

import { ReactFlowProvider } from 'reactflow';
import 'reactflow/dist/style.css';

import { FlowEditor } from './flow-editor/flow-editor';

interface FlowViewPageProps {
  flowId?: string;
  isActive?: boolean;
}

export default function FlowViewPage({ flowId, isActive = true }: FlowViewPageProps) {
  return (
    <ReactFlowProvider>
      <FlowEditor flowId={flowId} isActive={isActive} />
    </ReactFlowProvider>
  );
}

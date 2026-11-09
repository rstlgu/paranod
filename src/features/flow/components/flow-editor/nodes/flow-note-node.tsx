'use client';

import { memo } from 'react';
import type { NodeProps } from 'reactflow';
import type { OSINTNodeData } from '@/features/graph/types';
import { OSINTNode } from '@/features/graph/components/osint-node';
import { GraphLayoutSettingsProvider } from '@/features/graph/contexts/graph-layout-settings-context';

export const FlowNoteNode = memo(function FlowNoteNode(
  props: NodeProps<OSINTNodeData>
) {
  return (
    <GraphLayoutSettingsProvider
      value={{
        graphViewMode: 'free',
        lockedAxis: 'vertical',
        spacingPreset: 'normal'
      }}
    >
      <OSINTNode {...props} />
    </GraphLayoutSettingsProvider>
  );
});

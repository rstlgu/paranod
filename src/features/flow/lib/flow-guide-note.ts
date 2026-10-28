import type { Node } from 'reactflow';
import type { OSINTNodeData } from '@/features/graph/types';

export const FLOW_GUIDE_NOTE_ID = 'flow-guide-note';

export function createFlowGuideNoteNode(): Node<OSINTNodeData> {
  return {
    id: FLOW_GUIDE_NOTE_ID,
    type: 'osint',
    position: { x: 0, y: 0 },
    data: {
      type: 'note',
      label: 'Add a single trigger node, then connect the transforms.',
      metadata: {
        flowDecoration: true
      }
    },
    style: {
      width: 350,
      height: 250
    },
    connectable: false,
    deletable: true
  };
}

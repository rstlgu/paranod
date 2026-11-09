import type { OSINTNodeData } from '@/features/graph/types';
import { isImageNode } from './image-node';

export const NOTE_MIN_HEIGHT = { plain: 40, withHeader: 80 } as const;

export function nodeHeaderKey(data: OSINTNodeData) {
  if (data.type === 'note') return 'hideNoteHeader';
  if (isImageNode(data)) return 'hideImageHeader';
  return null;
}

export function isNodeHeaderHidden(data: OSINTNodeData, mode: string) {
  const key = nodeHeaderKey(data);
  return mode !== 'analysis' && key !== null && data.metadata?.[key] === true;
}

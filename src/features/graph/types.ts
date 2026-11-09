import { NodeType } from '@/features/osint/node-registry';

export interface OSINTNodeData {
  label: string;
  type: NodeType;
  metadata?: Record<string, unknown>;
}

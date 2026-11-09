import type { OSINTNodeData } from '@/features/graph/types';

export type FlowNodeKind = 'transform' | 'trigger' | 'osint';

export interface FlowTransformNodeData {
  pluginId: string;
  transformId: string;
  name: string;
  description?: string | null;
  inputType?: string | null;
  outputTypes?: string[] | null;
  pluginName?: string | null;
  pluginIcon?: string | null;
  pluginLogoUrl?: string | null;

  // Popolato se il transform non è più disponibile o il plugin è disabilitato
  missingReason?: string | null;
}

export interface FlowTriggerNodeData {
  nodeType: string;
}

export type FlowNodeData =
  | FlowTransformNodeData
  | FlowTriggerNodeData
  | OSINTNodeData;

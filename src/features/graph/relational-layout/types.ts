export interface RelationalLayoutNodeInput {
  id: string;
  width: number;
  height: number;
  degree: number;
  /**
   * Seed iniziale (top-left, coordinate ReactFlow) per accelerare la convergenza del force layout.
   * Se assente, il motore inizializza con una disposizione radiale.
   */
  x?: number;
  y?: number;
  /** Keep a seeded node stationary while incrementally placing new neighbors. */
  fixed?: boolean;
}

export interface RelationalLayoutEdgeInput {
  source: string;
  target: string;
}

export interface RelationalLayoutPosition {
  id: string;
  x: number;
  y: number;
}

export type RelationalLayoutEngine = 'force' | 'hierarchy';

export interface RelationalForceOptions {
  iterations: number;
  linkDistance: number;
  repulsionBase: number;
  repulsionDegreeFactor: number;
  collisionPadding: number;
  gravityStrength: number;
  maxRadius: number | null;
}

export interface RelationalHierarchyOptions {
  direction: 'TB' | 'LR';
  nodesep: number;
  ranksep: number;
}

export interface RelationalLayoutRequestPayload {
  requestId: string;
  engine: RelationalLayoutEngine;
  nodes: RelationalLayoutNodeInput[];
  edges: RelationalLayoutEdgeInput[];
  options: RelationalForceOptions | RelationalHierarchyOptions;
}

export type RelationalLayoutWorkerStartMessage = {
  type: 'start';
} & RelationalLayoutRequestPayload;

export type RelationalLayoutWorkerCancelMessage = {
  type: 'cancel';
  requestId: string;
};

export type RelationalLayoutWorkerInMessage =
  | RelationalLayoutWorkerStartMessage
  | RelationalLayoutWorkerCancelMessage;

export type RelationalLayoutWorkerProgressMessage = {
  type: 'progress';
  requestId: string;
  pct: number; // 0..1
  stage: string;
};

export type RelationalLayoutWorkerTickMessage = {
  type: 'tick';
  requestId: string;
  pct: number; // 0..1
  positions: RelationalLayoutPosition[];
};

export type RelationalLayoutWorkerDoneMessage = {
  type: 'done';
  requestId: string;
  positions: RelationalLayoutPosition[];
};

export type RelationalLayoutWorkerErrorMessage = {
  type: 'error';
  requestId: string;
  message: string;
};

export type RelationalLayoutWorkerOutMessage =
  | RelationalLayoutWorkerProgressMessage
  | RelationalLayoutWorkerTickMessage
  | RelationalLayoutWorkerDoneMessage
  | RelationalLayoutWorkerErrorMessage;

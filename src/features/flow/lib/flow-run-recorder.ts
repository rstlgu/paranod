/**
 * Registrazione best-effort dei run di un flow su FlowRun (history).
 * Non deve mai bloccare o far fallire l'esecuzione: ogni errore è ignorato.
 */

import type { FlowRunStep } from './execute-flow';

export interface RecordedStep {
  nodeId: string;
  pluginId: string;
  transformId: string;
  name: string;
  status: string;
  error?: string;
  inputCount: number;
  entityCount: number;
  edgeCount: number;
  durationMs: number;
}

/** Steps senza entities/edges completi (solo conteggi): compatti per il jsonb. */
export function sanitizeSteps(steps: FlowRunStep[]): RecordedStep[] {
  return steps.map((s) => ({
    nodeId: s.nodeId,
    pluginId: s.pluginId,
    transformId: s.transformId,
    name: s.name,
    status: s.status,
    error: s.error,
    inputCount: s.inputCount,
    entityCount: s.entities.length,
    edgeCount: s.edges.length,
    durationMs: s.durationMs
  }));
}

export async function startFlowRunRecord(args: {
  flowId: string;
  kind: 'run' | 'test';
  inputType: string;
  inputValue: string;
  graphId?: string;
}): Promise<string | null> {
  try {
    const res = await fetch(`/api/flows/${args.flowId}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: args.kind,
        inputType: args.inputType,
        inputValue: args.inputValue,
        graphId: args.graphId
      })
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return data?.run?.id ?? null;
  } catch {
    return null;
  }
}

export async function finishFlowRunRecord(args: {
  flowId: string;
  runId: string;
  status: 'COMPLETED' | 'FAILED';
  steps: FlowRunStep[];
  entityCount: number;
  error?: string;
}): Promise<void> {
  try {
    await fetch(`/api/flows/${args.flowId}/runs/${args.runId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: args.status,
        steps: sanitizeSteps(args.steps),
        entityCount: args.entityCount,
        error: args.error ?? null
      })
    });
  } catch {
    // best-effort
  }
}

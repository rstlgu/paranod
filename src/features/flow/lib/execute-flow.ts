/**
 * Flow execution engine (client-side).
 *
 * Un flow è: trigger (entity type) → catena/albero di transform node.
 * L'engine cammina il grafo in ordine topologico partendo dal trigger,
 * esegue ogni transform via `executeTransform` (stesso percorso dei transform
 * singoli: API routes gated, addon inclusi) e propaga le entità prodotte ai
 * nodi successivi filtrando per input type.
 *
 * Usato da: test run nell'editor flow, esecuzione flow su un nodo del grafo.
 */

import type { FlowTransformNodeData } from '@/features/flow/types';
import {
  createTransformInput,
  executeTransform,
  matchesInputType
} from '@/features/plugins';
import type {
  EntityType,
  OSINTEdge,
  OSINTEntity
} from '@/features/plugins/types';

// Shape dei nodi/edge come persistiti nel jsonb del Flow (reactflow).
export interface StoredFlowNode {
  id: string;
  type?: string;
  position?: { x: number; y: number };
  data?: Record<string, unknown>;
}

export interface StoredFlowEdge {
  id?: string;
  source?: string;
  target?: string;
}

export interface FlowRunInput {
  entityId: string;
  entityType: string;
  entityValue: string;
  metadata?: Record<string, unknown>;
}

export type FlowStepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped';

export interface FlowRunStep {
  nodeId: string;
  pluginId: string;
  transformId: string;
  name: string;
  status: FlowStepStatus;
  error?: string;
  /** Entità in input al nodo (dopo il filtro per input type). */
  inputCount: number;
  entities: OSINTEntity[];
  edges: OSINTEdge[];
  durationMs: number;
}

export interface FlowRunResult {
  success: boolean;
  /** Errore globale (es. trigger non compatibile). */
  error?: string;
  steps: FlowRunStep[];
  /** Aggregato deduplicato di tutte le entità/edge prodotti. */
  entities: OSINTEntity[];
  edges: OSINTEdge[];
}

export interface FlowValidationIssue {
  level: 'error' | 'warning';
  nodeId?: string;
  message: string;
}

function isTrigger(n: StoredFlowNode) {
  return String(n.type ?? '') === 'trigger';
}

function isTransform(n: StoredFlowNode) {
  return String(n.type ?? '') === 'transform';
}

function getExecutableGraph(nodes: StoredFlowNode[], edges: StoredFlowEdge[]) {
  const executableNodes = nodes.filter(
    (node) => isTrigger(node) || isTransform(node)
  );
  const executableIds = new Set(executableNodes.map((node) => node.id));
  const executableEdges = edges.filter(
    (edge) =>
      executableIds.has(String(edge.source ?? '')) &&
      executableIds.has(String(edge.target ?? ''))
  );
  return { nodes: executableNodes, edges: executableEdges };
}

function transformData(n: StoredFlowNode): FlowTransformNodeData {
  return (n.data ?? {}) as unknown as FlowTransformNodeData;
}

/** Adiacenza source → targets (solo id presenti tra i nodi). */
function buildAdjacency(nodes: StoredFlowNode[], edges: StoredFlowEdge[]) {
  const ids = new Set(nodes.map((n) => n.id));
  const out = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const n of nodes) {
    out.set(n.id, []);
    indegree.set(n.id, 0);
  }
  for (const e of edges) {
    const s = String(e.source ?? '');
    const t = String(e.target ?? '');
    if (!ids.has(s) || !ids.has(t) || s === t) continue;
    out.get(s)!.push(t);
    indegree.set(t, (indegree.get(t) ?? 0) + 1);
  }
  return { out, indegree };
}

/** Nodi raggiungibili da un insieme di partenza. */
function reachableFrom(startIds: string[], out: Map<string, string[]>) {
  const seen = new Set<string>(startIds);
  const queue = [...startIds];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const next of out.get(cur) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

/**
 * Valida un flow: trigger presente, transform integri, raggiungibilità,
 * compatibilità di tipo tra step consecutivi, cicli.
 */
export function validateFlow(
  nodes: StoredFlowNode[],
  edges: StoredFlowEdge[]
): FlowValidationIssue[] {
  const issues: FlowValidationIssue[] = [];
  const executableGraph = getExecutableGraph(nodes, edges);
  const executableNodes = executableGraph.nodes;
  const executableEdges = executableGraph.edges;
  const triggers = executableNodes.filter(isTrigger);
  const transforms = executableNodes.filter(isTransform);

  if (triggers.length === 0) {
    issues.push({ level: 'error', message: 'Flow has no trigger node.' });
  }
  if (triggers.length > 1) {
    issues.push({
      level: 'error',
      message: `Flow has ${triggers.length} trigger nodes: at most one is allowed.`
    });
  }
  if (transforms.length === 0) {
    issues.push({ level: 'error', message: 'Flow has no transform nodes.' });
  }

  for (const n of transforms) {
    const d = transformData(n);
    if (d.missingReason) {
      issues.push({
        level: 'error',
        nodeId: n.id,
        message: `"${d.name || d.transformId}": ${d.missingReason}`
      });
    }
    if (!d.pluginId || !d.transformId) {
      issues.push({
        level: 'error',
        nodeId: n.id,
        message: 'Transform node without pluginId/transformId.'
      });
    }
  }

  const { out, indegree } = buildAdjacency(executableNodes, executableEdges);

  // Raggiungibilità dai trigger
  if (triggers.length > 0) {
    const reach = reachableFrom(
      triggers.map((t) => t.id),
      out
    );
    for (const n of transforms) {
      if (!reach.has(n.id)) {
        issues.push({
          level: 'warning',
          nodeId: n.id,
          message: `"${transformData(n).name || n.id}" is not connected to a trigger and will not run.`
        });
      }
    }
  }

  // Compatibilità di tipo lungo gli edge
  const byId = new Map(executableNodes.map((n) => [n.id, n]));
  for (const e of executableEdges) {
    const src = byId.get(String(e.source ?? ''));
    const dst = byId.get(String(e.target ?? ''));
    if (!src || !dst || !isTransform(dst)) continue;
    const dstInput = String(transformData(dst).inputType ?? 'all');
    const srcOutputs = isTrigger(src)
      ? [String((src.data as Record<string, unknown>)?.nodeType ?? '')]
      : (transformData(src).outputTypes ?? []).map(String);
    if (srcOutputs.length === 0) continue;
    const compatible = srcOutputs.some((t) =>
      matchesInputType(t as EntityType, dstInput)
    );
    if (!compatible) {
      issues.push({
        level: 'warning',
        nodeId: dst.id,
        message: `"${transformData(dst).name || dst.id}" expects "${dstInput}" but upstream produces [${srcOutputs.join(', ')}].`
      });
    }
  }

  // Cicli: Kahn — se restano nodi con indegree > 0 c'è un ciclo
  const deg = new Map(indegree);
  const queue = executableNodes
    .filter((n) => (deg.get(n.id) ?? 0) === 0)
    .map((n) => n.id);
  let processed = 0;
  const q = [...queue];
  while (q.length) {
    const cur = q.shift()!;
    processed++;
    for (const next of out.get(cur) ?? []) {
      const nd = (deg.get(next) ?? 0) - 1;
      deg.set(next, nd);
      if (nd === 0) q.push(next);
    }
  }
  if (processed < executableNodes.length) {
    issues.push({
      level: 'error',
      message: 'Flow contains a cycle: execution order cannot be determined.'
    });
  }

  return issues;
}

/** Trigger types di un flow (per matchare i flow disponibili su un nodo). */
export function getFlowTriggerTypes(nodes: StoredFlowNode[]): string[] {
  return Array.from(
    new Set(
      nodes
        .filter(isTrigger)
        .map((n) => String((n.data as Record<string, unknown>)?.nodeType ?? ''))
        .filter(Boolean)
    )
  );
}

// Ogni step gira su TUTTE le entità prodotte a monte (dedup per type:value):
// nessun cap di default sugli input, resta solo il budget globale di entità.
const DEFAULT_MAX_INPUTS_PER_STEP = Number.POSITIVE_INFINITY;
const DEFAULT_MAX_TOTAL_ENTITIES = 200;
const DEFAULT_STEP_CONCURRENCY = 4;
const DEFAULT_INPUT_CONCURRENCY = 3;
const DEFAULT_ASYNC_JOB_TIMEOUT_MS = 300_000;
const DEFAULT_ASYNC_POLL_INTERVAL_MS = 3_000;

/** Esegue `fn` sugli item con al massimo `limit` promise in volo. */
async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

/**
 * Attende il completamento di un job async (addon) via polling di
 * /api/jobs/[jobId]. Ritorna entities/edges (già convertiti dal server) o
 * lancia con un messaggio di errore.
 */
async function waitForAsyncJob(args: {
  jobId: string;
  timeoutMs: number;
  pollIntervalMs: number;
  onProgress?: (progress: number, message?: string) => void;
}): Promise<{ entities: OSINTEntity[]; edges: OSINTEdge[] }> {
  const deadline = Date.now() + args.timeoutMs;

  while (Date.now() < deadline) {
    const res = await fetch(`/api/jobs/${args.jobId}`);
    if (!res.ok) throw new Error(`Job status error: ${res.status}`);
    const job = await res.json();

    if (typeof job.progress === 'number') {
      args.onProgress?.(job.progress, job.progressMessage ?? undefined);
    }

    if (job.isCompleted) {
      if (job.result?.error) throw new Error(String(job.result.error));
      return {
        entities: (job.result?.entities ?? []) as OSINTEntity[],
        edges: (job.result?.edges ?? []) as OSINTEdge[]
      };
    }
    if (job.isFailed) {
      throw new Error(String(job.error || `Job ${job.status || 'failed'}`));
    }

    await new Promise((r) => setTimeout(r, args.pollIntervalMs));
  }

  throw new Error(
    `Async job timed out after ${Math.round(args.timeoutMs / 1000)}s.`
  );
}

/**
 * Esegue un flow su un'entità di partenza.
 *
 * - I livelli topologici girano in sequenza; i nodi dello stesso livello in
 *   parallelo (cap `stepConcurrency`), gli input di uno step in parallelo
 *   (cap `inputConcurrency`).
 * - I transform async (addon con job) sono supportati: l'engine fa polling di
 *   /api/jobs/[jobId] fino a completamento (timeout `asyncJobTimeoutMs`).
 * - Non lancia mai: errori globali in `result.error`, per-step in `step.error`.
 */
export async function executeFlow(args: {
  nodes: StoredFlowNode[];
  edges: StoredFlowEdge[];
  input: FlowRunInput;
  graphId?: string;
  pluginConfigs?: Record<string, Record<string, unknown>>;
  maxInputsPerStep?: number;
  maxTotalEntities?: number;
  /** Nodi eseguiti in parallelo nello stesso livello topologico. */
  stepConcurrency?: number;
  /** Input eseguiti in parallelo dentro un singolo step. */
  inputConcurrency?: number;
  asyncJobTimeoutMs?: number;
  asyncPollIntervalMs?: number;
  /** Callback per aggiornare la UI a ogni cambio stato step. */
  onStep?: (step: FlowRunStep) => void;
}): Promise<FlowRunResult> {
  const {
    nodes,
    edges,
    input,
    graphId,
    pluginConfigs = {},
    maxInputsPerStep = DEFAULT_MAX_INPUTS_PER_STEP,
    maxTotalEntities = DEFAULT_MAX_TOTAL_ENTITIES,
    stepConcurrency = DEFAULT_STEP_CONCURRENCY,
    inputConcurrency = DEFAULT_INPUT_CONCURRENCY,
    asyncJobTimeoutMs = DEFAULT_ASYNC_JOB_TIMEOUT_MS,
    asyncPollIntervalMs = DEFAULT_ASYNC_POLL_INTERVAL_MS,
    onStep
  } = args;

  const steps: FlowRunStep[] = [];
  const empty = (error?: string): FlowRunResult => ({
    success: false,
    error,
    steps,
    entities: [],
    edges: []
  });

  const executableGraph = getExecutableGraph(nodes, edges);
  const executableNodes = executableGraph.nodes;
  const executableEdges = executableGraph.edges;
  const triggers = executableNodes.filter(isTrigger);
  if (triggers.length === 0) return empty('Flow has no trigger node.');

  const trigger = triggers.find((t) =>
    matchesInputType(
      input.entityType as EntityType,
      String((t.data as Record<string, unknown>)?.nodeType ?? '')
    )
  );
  if (!trigger) {
    const expected =
      getFlowTriggerTypes(executableNodes).join(', ') || 'unknown';
    return empty(
      `Flow trigger expects "${expected}" but got "${input.entityType}".`
    );
  }

  const hardErrors = validateFlow(executableNodes, executableEdges).filter(
    (i) => i.level === 'error'
  );
  if (hardErrors.length > 0) {
    return empty(hardErrors.map((i) => i.message).join(' '));
  }

  const { out } = buildAdjacency(executableNodes, executableEdges);
  const byId = new Map(executableNodes.map((n) => [n.id, n]));
  const reach = reachableFrom([trigger.id], out);

  // Ordine topologico del sottografo raggiungibile dal trigger (Kahn).
  const subIndegree = new Map<string, number>();
  for (const id of Array.from(reach)) subIndegree.set(id, 0);
  for (const id of Array.from(reach)) {
    for (const next of out.get(id) ?? []) {
      if (reach.has(next))
        subIndegree.set(next, (subIndegree.get(next) ?? 0) + 1);
    }
  }
  const order: string[] = [];
  const q = [trigger.id];
  while (q.length) {
    const cur = q.shift()!;
    order.push(cur);
    for (const next of out.get(cur) ?? []) {
      if (!reach.has(next)) continue;
      const nd = (subIndegree.get(next) ?? 0) - 1;
      subIndegree.set(next, nd);
      if (nd === 0) q.push(next);
    }
  }

  const rootEntity: OSINTEntity = {
    id: input.entityId,
    type: input.entityType as OSINTEntity['type'],
    value: input.entityValue,
    label: input.entityValue,
    metadata: input.metadata ?? {},
    timestamp: new Date().toISOString()
  };

  // nodeId → entità prodotte (trigger produce l'entità di partenza)
  const produced = new Map<string, OSINTEntity[]>();
  produced.set(trigger.id, [rootEntity]);

  // Predecessori nel sottografo
  const preds = new Map<string, string[]>();
  for (const id of Array.from(reach)) preds.set(id, []);
  for (const id of Array.from(reach)) {
    for (const next of out.get(id) ?? []) {
      if (reach.has(next)) preds.get(next)!.push(id);
    }
  }

  const aggEntities = new Map<string, OSINTEntity>();
  const aggEdges = new Map<string, OSINTEdge>();
  // Entità duplicate (stesso type:value) collassano sull'istanza canonica: gli
  // edge che puntavano all'id scartato vanno rimappati sull'id canonico.
  const entityIdRemap = new Map<string, string>();
  let totalEntities = 0;

  const edgeKey = (ed: OSINTEdge) =>
    `${ed.sourceId}|${ed.targetId}|${String(ed.relationship)}|${ed.label}`;

  // Livelli topologici: level(nodo) = max(level(predecessori)) + 1.
  // `order` è già topologico, quindi i predecessori sono sempre calcolati prima.
  const level = new Map<string, number>();
  for (const nodeId of order) {
    const ps = preds.get(nodeId) ?? [];
    level.set(
      nodeId,
      ps.length === 0 ? 0 : Math.max(...ps.map((p) => level.get(p) ?? 0)) + 1
    );
  }
  const maxLevel = Math.max(0, ...Array.from(level.values()));
  const levels: string[][] = [];
  for (let l = 1; l <= maxLevel; l++) {
    const ids = order.filter(
      (nodeId) =>
        level.get(nodeId) === l && isTransform(byId.get(nodeId) ?? { id: '' })
    );
    if (ids.length > 0) levels.push(ids);
  }

  const runNode = async (nodeId: string) => {
    const node = byId.get(nodeId);
    if (!node) return;

    const d = transformData(node);

    const step: FlowRunStep = {
      nodeId,
      pluginId: String(d.pluginId ?? ''),
      transformId: String(d.transformId ?? ''),
      name: String(d.name ?? d.transformId ?? nodeId),
      status: 'running',
      inputCount: 0,
      entities: [],
      edges: [],
      durationMs: 0
    };
    steps.push(step);
    onStep?.(step);

    const startedAt = Date.now();

    // Input: entità prodotte dai predecessori, filtrate per input type
    const incoming: OSINTEntity[] = [];
    for (const p of preds.get(nodeId) ?? []) {
      for (const e of produced.get(p) ?? []) incoming.push(e);
    }
    const inputType = String(d.inputType ?? 'all');
    // Filtro per input type + dedup: la stessa entità (type:value) prodotta
    // da più predecessori entra una volta sola.
    const seenInputs = new Set<string>();
    const matching = incoming.filter((e) => {
      if (!matchesInputType(String(e.type) as EntityType, inputType))
        return false;
      const key = `${e.type}:${e.value}`;
      if (seenInputs.has(key)) return false;
      seenInputs.add(key);
      return true;
    });
    const inputs = Number.isFinite(maxInputsPerStep)
      ? matching.slice(0, maxInputsPerStep)
      : matching;
    step.inputCount = inputs.length;

    if (inputs.length === 0) {
      step.status = 'skipped';
      step.error = 'No matching input entities from previous steps.';
      step.durationMs = Date.now() - startedAt;
      produced.set(nodeId, []);
      onStep?.(step);
      return;
    }

    if (totalEntities >= maxTotalEntities) {
      step.status = 'skipped';
      step.error = `Entity budget exhausted (max ${maxTotalEntities}).`;
      step.durationMs = Date.now() - startedAt;
      produced.set(nodeId, []);
      onStep?.(step);
      return;
    }

    const stepEntities: OSINTEntity[] = [];
    const errors: string[] = [];
    const stepSeenEntities = new Set<string>();
    const stepSeenEdges = new Set<string>();

    const collect = (
      entities: OSINTEntity[] | undefined,
      resultEdges: OSINTEdge[] | undefined
    ) => {
      for (const e of entities ?? []) {
        const key = `${e.type}:${e.value}`;
        if (!aggEntities.has(key)) {
          aggEntities.set(key, e);
          totalEntities++;
        }
        const canonical = aggEntities.get(key)!;
        if (canonical.id !== e.id) entityIdRemap.set(e.id, canonical.id);
        // Istanza canonica (dedup globale) + dedup dentro lo step: la stessa
        // entità prodotta da più input dello stesso step entra una volta sola.
        if (!stepSeenEntities.has(key)) {
          stepSeenEntities.add(key);
          stepEntities.push(canonical);
          step.entities.push(canonical);
        }
      }
      for (const ed of resultEdges ?? []) {
        const sourceId = entityIdRemap.get(ed.sourceId) ?? ed.sourceId;
        const targetId = entityIdRemap.get(ed.targetId) ?? ed.targetId;
        const remapped =
          sourceId === ed.sourceId && targetId === ed.targetId
            ? ed
            : { ...ed, sourceId, targetId };
        // Dedup per relazione (source|target|tipo|label), non per id: plugin
        // diversi/run diverse generano id random per lo stesso edge logico.
        const key = edgeKey(remapped);
        if (!aggEdges.has(key)) aggEdges.set(key, remapped);
        if (!stepSeenEdges.has(key)) {
          stepSeenEdges.add(key);
          step.edges.push(aggEdges.get(key)!);
        }
      }
    };

    await mapPool(inputs, inputConcurrency, async (entity) => {
      try {
        const result = await executeTransform(
          step.pluginId,
          step.transformId,
          createTransformInput(
            entity.id,
            String(entity.type),
            entity.value,
            entity.metadata,
            pluginConfigs[step.pluginId]
          ),
          graphId
        );

        if (!result.success) {
          errors.push(result.error || 'Transform failed');
          return;
        }

        // Job async (addon): attendi il completamento via polling
        const asyncResult = result as { async?: boolean; jobId?: string };
        if (asyncResult.async) {
          if (!asyncResult.jobId) {
            errors.push('Async transform returned no jobId.');
            return;
          }
          const jobOutput = await waitForAsyncJob({
            jobId: asyncResult.jobId,
            timeoutMs: asyncJobTimeoutMs,
            pollIntervalMs: asyncPollIntervalMs,
            onProgress: (progress, message) => {
              step.error = undefined;
              onStep?.({
                ...step,
                status: 'running',
                error: message ? `${progress}% — ${message}` : `${progress}%`
              });
            }
          });
          collect(jobOutput.entities, jobOutput.edges);
          return;
        }

        collect(result.entities, result.edges);
      } catch (error) {
        errors.push(
          error instanceof Error ? error.message : 'Transform execution failed'
        );
      }
    });

    produced.set(nodeId, stepEntities);
    step.durationMs = Date.now() - startedAt;

    if (stepEntities.length === 0 && errors.length > 0) {
      step.status = 'failed';
      step.error = Array.from(new Set(errors)).join('; ');
    } else {
      step.status = 'completed';
      if (errors.length > 0)
        step.error = `Partial: ${Array.from(new Set(errors)).join('; ')}`;
    }
    onStep?.(step);
  };

  // Livelli in sequenza, nodi dello stesso livello in parallelo.
  for (const levelIds of levels) {
    await mapPool(levelIds, stepConcurrency, runNode);
  }

  const ranSteps = steps.filter((s) => s.status !== 'skipped');
  const success =
    ranSteps.length > 0 && ranSteps.some((s) => s.status === 'completed');

  return {
    success,
    error: success
      ? undefined
      : steps.find((s) => s.error)?.error || 'Flow produced no results.',
    steps,
    entities: Array.from(aggEntities.values()),
    edges: Array.from(aggEdges.values())
  };
}

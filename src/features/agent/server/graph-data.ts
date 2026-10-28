import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { mergeNodes } from '@/features/graph/utils/node-merge';
import { coerceEntityType } from '@/features/osint/entity-types';
import { parseAddonResult } from '@/lib/validators/addon-result';
import {
  CLASSIC_NODE_SIZE,
  resultNodeSize,
  withEntityValue
} from '@/features/graph/utils/result-node';
import { AGENT_LIMITS, publicText, withoutCredentials } from './policy';
import { MODULE_LIMITS } from './module-policy';

const nodeSchema = z
  .object({
    id: z.string().min(1),
    position: z.object({ x: z.number().finite(), y: z.number().finite() }),
    data: z
      .object({
        type: z.string(),
        label: z.string(),
        metadata: z.record(z.string(), z.unknown()).optional()
      })
      .passthrough()
  })
  .passthrough();
const edgeSchema = z
  .object({
    id: z.string().min(1),
    source: z.string(),
    target: z.string()
  })
  .passthrough();
export const graphDataSchema = z.object({
  nodes: z.array(nodeSchema).max(AGENT_LIMITS.maxGraphNodes),
  edges: z.array(edgeSchema).max(AGENT_LIMITS.maxGraphEdges)
});
export type AgentGraphData = z.infer<typeof graphDataSchema>;
export const deleteNodesSchema = z
  .object({
    nodeIds: z.array(z.string().min(1).max(200)).min(1).max(100),
    reason: z.string().trim().min(1).max(500)
  })
  .strict();
export const mergeNodesSchema = z
  .object({
    nodeIds: z.array(z.string().min(1).max(200)).min(2).max(100),
    primaryNodeId: z.string().min(1).max(200),
    reason: z.string().trim().min(1).max(500)
  })
  .strict();

export function deleteGraphNodes(graph: AgentGraphData, raw: unknown) {
  const input = deleteNodesSchema.parse(raw);
  const ids = new Set(input.nodeIds);
  const available = new Set(graph.nodes.map((node) => node.id));
  // Validate the complete batch before changing anything. No attachment contents
  // are exposed or deleted; graph history must be able to restore these nodes.
  for (const id of Array.from(ids)) {
    if (!available.has(id)) throw new Error('agent_node_unavailable');
  }
  const nodes = graph.nodes.filter((node) => !ids.has(node.id));
  const edges = graph.edges.filter(
    (edge) => !ids.has(edge.source) && !ids.has(edge.target)
  );
  return {
    graph: { nodes, edges },
    nodesAdded: 0,
    edgesAdded: 0,
    nodesRemoved: graph.nodes.length - nodes.length,
    edgesRemoved: graph.edges.length - edges.length
  };
}

const MERGE_REJECTIONS = new Set([
  'Select at least 2 nodes',
  'Some nodes are missing',
  'Invalid node type',
  'Nodes must have the same type',
  'primary_node_not_in_selection',
  'primary_leaf_node_not_in_payload',
  'merge_not_allowed'
]);

export function mergeGraphNodes(graph: AgentGraphData, raw: unknown) {
  const input = mergeNodesSchema.parse(raw);
  const ids = Array.from(new Set(input.nodeIds));
  if (ids.length < 2 || !ids.includes(input.primaryNodeId))
    throw new Error('agent_merge_not_allowed');
  const available = new Set(graph.nodes.map((node) => node.id));
  for (const id of ids) {
    if (!available.has(id)) throw new Error('agent_node_unavailable');
  }
  let merged: ReturnType<typeof mergeNodes>;
  try {
    merged = mergeNodes({
      selectedNodeIds: ids,
      nodes: graph.nodes,
      edges: graph.edges,
      primaryNodeId: input.primaryNodeId
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (MERGE_REJECTIONS.has(message)) throw new Error('agent_merge_not_allowed');
    throw error;
  }
  const next = graphDataSchema.parse({
    nodes: merged.nextNodes,
    edges: merged.nextEdges
  });
  const nodeType =
    graph.nodes.find((node) => node.id === input.primaryNodeId)?.data.type ??
    '';
  return {
    graph: next,
    nodesAdded: 1,
    edgesAdded: Math.max(0, next.edges.length - graph.edges.length),
    nodesRemoved: ids.length,
    edgesRemoved: Math.max(0, graph.edges.length - next.edges.length),
    mergedNodeId: merged.mergedNodeId,
    nodeType,
    nodesMerged: ids.length,
    summary: `Merged ${ids.length} ${nodeType} nodes into one.`
  };
}
export const seedSchema = z
  .object({
    type: z.enum([
      'email',
      'domain',
      'ip',
      'username',
      'organization',
      'person',
      'phone',
      'url'
    ]),
    value: z.string().trim().min(1).max(500)
  })
  .strict();
export const linkSchema = z
  .object({
    sourceId: z.string().min(1).max(200),
    targetId: z.string().min(1).max(200),
    hypothesis: z.string().trim().min(1).max(500)
  })
  .strict();

const PRIVATE_TYPES = new Set([
  'credential',
  'credit_card',
  'bank_account',
  'note',
  'document',
  'pdf',
  'docx',
  'xlsx',
  'txt',
  'csv',
  'json',
  'http_request',
  'http_response'
]);

export function graphNodeInput(graph: AgentGraphData, id: string) {
  const node = graph.nodes.find((entry) => entry.id === id);
  if (!node || PRIVATE_TYPES.has(node.data.type))
    throw new Error('agent_node_unavailable');
  // Never send arbitrary metadata, notes, cookies, request headers or file contents.
  const value =
    typeof node.data.metadata?.value === 'string'
      ? node.data.metadata.value
      : node.data.label;
  return {
    id: node.id,
    type: coerceEntityType(node.data.type).type,
    value: publicText(value, 2000)
  };
}

export function projectGraph(graph: AgentGraphData, offset = 0) {
  const accessible = graph.nodes.filter(
    (node) => !PRIVATE_TYPES.has(node.data.type)
  );
  const page = accessible.slice(offset, offset + 100);
  const ids = new Set(page.map((node) => node.id));
  return {
    nodes: page.map((node) => graphNodeInput(graph, node.id)),
    edges: graph.edges
      .filter((edge) => ids.has(edge.source) && ids.has(edge.target))
      .slice(0, 200)
      .map((edge) => ({ sourceId: edge.source, targetId: edge.target })),
    nextOffset:
      offset + page.length < accessible.length ? offset + page.length : null
  };
}

export function addSeed(
  graph: AgentGraphData,
  raw: unknown,
  runId: string,
  provenance: 'user_request' | 'agent_inference' = 'user_request'
) {
  const parsed = seedSchema.parse(raw);
  const seed =
    parsed.type === 'username'
      ? { ...parsed, value: parsed.value.replace(/^@/, '') }
      : parsed;
  if (!seed.value) throw new Error('agent_invalid_seed');
  if (publicText(seed.value, 500) !== seed.value && seed.type !== 'url')
    throw new Error('agent_sensitive_seed');
  if (seed.type === 'url') {
    const url = new URL(seed.value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error('agent_sensitive_seed');
  }
  const existing = graph.nodes.find(
    (node) =>
      node.data.type === seed.type &&
      (node.data.metadata?.value ?? node.data.label) === seed.value
  );
  if (existing) return { graph, id: existing.id, nodesAdded: 0, edgesAdded: 0 };
  const id = randomUUID();
  const node = {
    id,
    type: 'osint',
    position: {
      x: (graph.nodes.length % 6) * 260,
      y: Math.floor(graph.nodes.length / 6) * 150
    },
    data: {
      type: seed.type,
      label: seed.value,
      metadata: {
        value: seed.value,
        verified: false,
        agentRunId: runId,
        provenance
      }
    },
    style: { width: 200, height: 85 }
  };
  const next = graphDataSchema.parse({
    nodes: [...graph.nodes, node],
    edges: graph.edges
  });
  return { graph: next, id, nodesAdded: 1, edgesAdded: 0 };
}

export function addHypothesis(
  graph: AgentGraphData,
  raw: unknown,
  runId: string
) {
  const link = linkSchema.parse(raw);
  graphNodeInput(graph, link.sourceId);
  graphNodeInput(graph, link.targetId);
  if (link.sourceId === link.targetId) throw new Error('agent_invalid_link');
  const edge = {
    id: randomUUID(),
    source: link.sourceId,
    target: link.targetId,
    type: 'osint',
    label: publicText(link.hypothesis, 500),
    data: {
      label: publicText(link.hypothesis, 500),
      metadata: {
        verified: false,
        provenance: 'agent_hypothesis',
        agentRunId: runId
      }
    }
  };
  return {
    graph: graphDataSchema.parse({
      nodes: graph.nodes,
      edges: [...graph.edges, edge]
    }),
    nodesAdded: 0,
    edgesAdded: 1
  };
}

export function mergeTransformResult(
  graph: AgentGraphData,
  inputId: string,
  raw: unknown,
  provenance: { runId: string; moduleId: string; transformId: string },
  makeId = randomUUID
) {
  const input = graph.nodes.find((node) => node.id === inputId);
  if (!input) throw new Error('agent_node_unavailable');
  const result = parseAddonResult(raw, inputId);
  if (
    result.entities.length > MODULE_LIMITS.maxEntities ||
    result.edges.length > MODULE_LIMITS.maxEdges
  )
    throw new Error('agent_result_limit');
  // Validate the whole result before choosing a bounded subset. A discarded
  // tail must never hide a private entity or an invalid edge reference.
  for (const entity of result.entities) {
    if (PRIVATE_TYPES.has(coerceEntityType(entity.type).type))
      throw new Error('agent_result_type_not_allowed');
  }
  const entities = result.entities.slice(
    0,
    Math.max(0, AGENT_LIMITS.maxGraphNodes - graph.nodes.length)
  );
  const ids = new Map([[inputId, inputId]]);
  const retrievedAt = new Date().toISOString();
  const prepared = entities.map((entity) => {
    const { type, originalType } = coerceEntityType(entity.type);
    if (PRIVATE_TYPES.has(type))
      throw new Error('agent_result_type_not_allowed');
    const label = entity.label || entity.value;
    // The node keeps what the plugin returned, exactly as a manual run does;
    // agent provenance only fills the keys the plugin left empty.
    const metadata = {
      verified: false,
      source: `${provenance.moduleId}/${provenance.transformId}`,
      retrievedAt,
      ...(originalType ? { originalType } : {}),
      ...withEntityValue(
        entity.metadata && withoutCredentials(entity.metadata),
        entity.value,
        label
      ),
      agentRunId: provenance.runId
    };
    const size = resultNodeSize(type, metadata) ?? CLASSIC_NODE_SIZE;
    return { entity, type, label, metadata, size };
  });
  // Grid cells fit the largest result, so cards never overlap.
  const cellWidth =
    Math.max(CLASSIC_NODE_SIZE.width, ...prepared.map((item) => item.size.width)) + 60;
  const cellHeight =
    Math.max(CLASSIC_NODE_SIZE.height, ...prepared.map((item) => item.size.height)) + 65;
  const added = prepared.map((item, index) => {
    const id = makeId();
    ids.set(item.entity.id, id);
    return {
      id,
      type: 'osint',
      position: {
        x: input.position.x + (index % 5) * cellWidth,
        y: input.position.y + 150 + Math.floor(index / 5) * cellHeight
      },
      data: { type: item.type, label: item.label, metadata: item.metadata },
      style: { width: item.size.width, height: item.size.height }
    };
  });
  const applicableEdges = result.edges
    .filter((edge) => ids.has(edge.sourceId) && ids.has(edge.targetId))
    .slice(0, Math.max(0, AGENT_LIMITS.maxGraphEdges - graph.edges.length));
  const edges = applicableEdges.map((edge) => ({
    id: makeId(),
    source: ids.get(edge.sourceId)!,
    target: ids.get(edge.targetId)!,
    type: 'osint',
    label: edge.label,
    data: {
      label: edge.label,
      ...(edge.relationship ? { relationship: edge.relationship } : {}),
      metadata: {
        verified: false,
        agentRunId: provenance.runId,
        source: `${provenance.moduleId}/${provenance.transformId}`
      }
    }
  }));
  return {
    graph: graphDataSchema.parse({
      nodes: [...graph.nodes, ...added],
      edges: [...graph.edges, ...edges]
    }),
    nodesAdded: added.length,
    edgesAdded: edges.length,
    omittedEntities: result.entities.length - added.length,
    omittedEdges: result.edges.length - edges.length,
    nodeIds: added.map((node) => node.id)
  };
}

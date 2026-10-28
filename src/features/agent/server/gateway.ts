import type { Prisma, PrismaClient } from '@prisma/client';
import { setTimeout as delay } from 'node:timers/promises';
import {
  assertAgentGraphLease,
  type AgentGraphLease
} from '@/features/graph/server/graph-agent-lease';
import { publishAgentActivity } from './runs';
import {
  agentEventSchema,
  DEFAULT_AGENT_APPROVAL_MODE,
  type AgentApprovalMode
} from '../lib/contracts';
import {
  addHypothesis,
  addSeed,
  deleteGraphNodes,
  mergeGraphNodes,
  graphDataSchema,
  graphNodeInput,
  mergeTransformResult,
  projectGraph,
  type AgentGraphData
} from './graph-data';
import {
  prepareAgentTransform,
  searchAgentModules,
  describeAgentModule
} from './modules';
import { executeAgentModule } from './module-execution';
import { executeAgentAddon, isAddonExecution } from './module-addon';
import { loadWorkspacePluginConfig } from '@/features/plugins/server-config';
import type { AgentRuntimePort, TransformRequest } from './runtime';
import {
  actionNeedsApproval,
  argumentsHash,
  seedAuthorization
} from './policy';
import { checkpointSchema, readAgentContext } from './context';

export function createAgentGateway(
  db: PrismaClient,
  handle: AgentGraphLease,
  workspaceId: string,
  approvalMode: AgentApprovalMode = DEFAULT_AGENT_APPROVAL_MODE
): AgentRuntimePort {
  const approvedActions = new Set<string>();
  const consumedActions = new Set<string>();
  async function active(tx: Prisma.TransactionClient) {
    await assertAgentGraphLease(tx, handle);
    const run = await tx.agentRun.findUnique({
      where: { id: handle.runId },
      select: { status: true, userId: true, graphId: true }
    });
    const graph = await tx.graph.findUniqueOrThrow({
      where: { id: handle.graphId },
      select: { workspaceId: true, nodes: true, edges: true }
    });
    if (
      run?.status !== 'running' ||
      run.userId !== handle.userId ||
      run.graphId !== handle.graphId ||
      graph.workspaceId !== workspaceId
    )
      throw new Error('agent_scope_changed');
    return graphDataSchema.parse(graph);
  }
  async function write(
    tx: Prisma.TransactionClient,
    change: {
      graph: AgentGraphData;
      nodesAdded: number;
      edgesAdded: number;
      nodesRemoved?: number;
      edgesRemoved?: number;
      summary?: string;
    }
  ) {
    if (
      !change.nodesAdded &&
      !change.edgesAdded &&
      !change.nodesRemoved &&
      !change.edgesRemoved
    )
      return;
    await tx.graph.update({
      where: { id: handle.graphId },
      select: { id: true },
      data: {
        nodes: change.graph.nodes as Prisma.InputJsonValue,
        edges: change.graph.edges as Prisma.InputJsonValue,
        nodeCount: change.graph.nodes.length,
        edgeCount: change.graph.edges.length
      }
    });
    await publishAgentActivity(tx, handle, {
      type: 'graph_changes',
      nodesAdded: change.nodesAdded,
      edgesAdded: change.edgesAdded,
      ...(change.nodesRemoved !== undefined
        ? {
            nodesRemoved: change.nodesRemoved,
            edgesRemoved: change.edgesRemoved ?? 0
          }
        : {}),
      summary:
        change.summary ??
        (change.nodesRemoved
          ? `Removed ${change.nodesRemoved} nodes and ${change.edgesRemoved ?? 0} incident links.`
          : 'Graph updated with provenance, marked as unverified.')
    });
  }
  async function prepare(tx: Prisma.TransactionClient, args: TransformRequest) {
    const graph = await active(tx);
    const input = graphNodeInput(graph, args.nodeId);
    const source = graph.nodes.find((node) => node.id === args.nodeId)!;
    // Validate the actual target, not the redacted model projection. Otherwise
    // credentials/query changes could be hidden from the approval fingerprint.
    input.value =
      typeof source.data.metadata?.value === 'string'
        ? source.data.metadata.value
        : source.data.label;
    const { permit, execution } = await prepareAgentTransform(
      tx,
      workspaceId,
      args.moduleId,
      args.transformId,
      input,
      {
        runId: handle.runId,
        graphId: handle.graphId,
        userId: handle.userId,
        generation: handle.generation
      }
    );
    return {
      input,
      permit: {
        ...permit,
        requiresApproval: actionNeedsApproval(
          approvalMode,
          'transform',
          permit.requiresApproval
        )
      },
      execution
    };
  }
  return {
    async saveContextCheckpoint(checkpoint) {
      await db.$transaction(async (tx) => {
        await active(tx);
        await tx.agentRun.update({
          where: { id: handle.runId },
          data: { contextCheckpoint: checkpointSchema.parse(checkpoint) }
        });
      });
    },
    async assertActive() {
      await db.$transaction(active);
    },
    async publish(event) {
      await db.$transaction(async (tx) => {
        await active(tx);
        if (event.type === 'usage') {
          await tx.agentRun.update({
            where: { id: handle.runId },
            data: {
              inputTokens: event.inputTokens,
              outputTokens: event.outputTokens,
              contextUsage: event.context
            }
          });
        }
        await publishAgentActivity(tx, handle, event);
      });
    },
    readGraph: (offset) =>
      db.$transaction(async (tx) => projectGraph(await active(tx), offset)),
    listModules: (inputType, query, offset) =>
      db.$transaction(async (tx) => {
        await active(tx);
        return searchAgentModules(tx, workspaceId, inputType, query, offset);
      }),
    describeModule: (inputType, moduleId, transformId) =>
      db.$transaction(async (tx) => {
        await active(tx);
        return describeAgentModule(
          tx,
          workspaceId,
          inputType,
          moduleId,
          transformId
        );
      }),
    addSeed: (input) =>
      db.$transaction(async (tx) => {
        const graph = await active(tx);
        const run = await tx.agentRun.findUniqueOrThrow({
          where: { id: handle.runId },
          select: {
            goal: true,
            parentRunId: true,
            graphId: true,
            userId: true
          }
        });
        const memory = await readAgentContext(tx, {
          parentRunId: run.parentRunId,
          graphId: run.graphId,
          userId: run.userId
        });
        const provenance = seedAuthorization(
          {
            currentGoal: run.goal,
            history: memory.goals.map((goal) => ({
              runId: '',
              goal,
              messages: []
            }))
          },
          input.value,
          input.type
        );
        if (!provenance) throw new Error('agent_seed_outside_request');
        const change = addSeed(graph, input, handle.runId, provenance);
        await write(tx, change);
        return {
          nodeId: change.id,
          nodesAdded: change.nodesAdded,
          inferred: provenance === 'agent_inference'
        };
      }),
    addHypothesis: (input) =>
      db.$transaction(async (tx) => {
        const change = addHypothesis(await active(tx), input, handle.runId);
        await write(tx, change);
        return { edgesAdded: change.edgesAdded, verified: false };
      }),
    deleteNodes: (input) =>
      db.$transaction(async (tx) => {
        const graph = await active(tx);
        const change = deleteGraphNodes(graph, input);
        if (actionNeedsApproval(approvalMode, 'deletion')) {
          const hash = argumentsHash({
            runId: handle.runId,
            name: 'delete_nodes',
            arguments: input
          });
          if (!approvedActions.delete(hash))
            throw new Error('agent_approval_required');
        }
        await write(tx, change);
        return {
          nodesRemoved: change.nodesRemoved,
          edgesRemoved: change.edgesRemoved
        };
      }),
    mergeNodes: (input) =>
      db.$transaction(async (tx) => {
        const graph = await active(tx);
        const change = mergeGraphNodes(graph, input);
        if (actionNeedsApproval(approvalMode, 'merge')) {
          const hash = argumentsHash({
            runId: handle.runId,
            name: 'merge_nodes',
            arguments: input
          });
          if (!approvedActions.delete(hash))
            throw new Error('agent_approval_required');
        }
        await write(tx, change);
        return {
          mergedNodeId: change.mergedNodeId,
          nodeType: change.nodeType,
          nodesMerged: change.nodesMerged
        };
      }),
    prepareTransform: (args) =>
      db.$transaction(async (tx) => (await prepare(tx, args)).permit),
    async executeTransform(args, fingerprint, signal) {
      signal.throwIfAborted();
      const { permit } = await db.$transaction((tx) => prepare(tx, args));
      if (permit.fingerprint !== fingerprint)
        throw new Error('agent_module_changed');
      const actionHash = argumentsHash({
        runId: handle.runId,
        name: 'run_transform',
        arguments: args,
        fingerprint
      });
      if (permit.requiresApproval) {
        if (!approvedActions.delete(actionHash))
          throw new Error('agent_approval_required');
        if (consumedActions.has(actionHash))
          throw new Error('agent_duplicate_external_action');
        consumedActions.add(actionHash);
      }
      const revalidate = async () => {
        signal.throwIfAborted();
        const current = await db.$transaction((tx) => prepare(tx, args));
        if (current.permit.fingerprint !== fingerprint)
          throw new Error('agent_module_changed');
        signal.throwIfAborted();
        return current;
      };
      const current = await revalidate();
      const beforeRequest = async () => {
        await revalidate();
      };
      const { result, observations, omittedEntities, omittedEdges } =
        isAddonExecution(current.execution)
          ? await executeAgentAddon({
              db,
              workspaceId,
              graphId: handle.graphId,
              execution: current.execution,
              signal,
              beforeRequest
            })
          : await executeAgentModule(
              {
                ...current.execution,
                config: await loadWorkspacePluginConfig(
                  workspaceId,
                  args.moduleId
                ).catch(() => ({}))
              },
              signal,
              beforeRequest,
              { userId: handle.userId, workspaceId }
            );
      signal.throwIfAborted();
      const output = await db.$transaction(async (tx) => {
        const current = await prepare(tx, args);
        signal.throwIfAborted();
        if (current.permit.fingerprint !== fingerprint)
          throw new Error('agent_module_changed');
        const graph = await active(tx);
        const change = mergeTransformResult(graph, args.nodeId, result, {
          runId: handle.runId,
          moduleId: args.moduleId,
          transformId: args.transformId
        });
        await write(tx, change);
        const totalOmittedEntities = omittedEntities + change.omittedEntities;
        const totalOmittedEdges = omittedEdges + change.omittedEdges;
        if (totalOmittedEntities || totalOmittedEdges)
          await publishAgentActivity(tx, handle, {
            type: 'message',
            text: `Transform results partially applied: ${change.nodesAdded} nodes and ${change.edgesAdded} links added. ${totalOmittedEntities} entities and ${totalOmittedEdges} links were not added because of validation or capacity limits.`,
            sources: []
          });
        return {
          nodeIds: change.nodeIds,
          nodesAdded: change.nodesAdded,
          edgesAdded: change.edgesAdded,
          observations: observations.map((observation) => ({
            ...observation,
            source: `${args.moduleId}/${args.transformId}`,
            agentRunId: handle.runId,
            inputNodeId: args.nodeId,
            verified: false
          })),
          omittedEntities: totalOmittedEntities,
          omittedEdges: totalOmittedEdges
        };
      });
      return output;
    },
    async waitForDecision(approvalId, hash, signal) {
      while (true) {
        signal.throwIfAborted();
        const decision = await db.$transaction(async (tx) => {
          await active(tx);
          const rows = await tx.agentEvent.findMany({
            where: {
              runId: handle.runId,
              data: { path: ['approvalId'], equals: approvalId }
            },
            orderBy: { sequence: 'asc' },
            take: 3
          });
          const events = rows.map((row) => agentEventSchema.parse(row.data));
          const request = events.find((event) => event.type === 'approval');
          if (request?.type !== 'approval' || request.argumentsHash !== hash)
            throw new Error('agent_approval_mismatch');
          const answer = events.find((event) => event.type === 'decision');
          return answer?.type === 'decision' ? answer.approved : null;
        });
        if (decision !== null) {
          if (decision) approvedActions.add(hash);
          return decision;
        }
        await delay(500, undefined, { signal });
      }
    }
  };
}

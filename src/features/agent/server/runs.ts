import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  acquireAgentGraphLease,
  assertAgentGraphLease,
  getGraphWriteState,
  releaseAgentGraphLease,
  GraphWriteError,
  type AgentGraphLease
} from '@/features/graph/server/graph-agent-lease';
import { agentThreadRunIds, agentRunRootId } from '../lib/conversation-threads';
import { runFailureSummary } from '../lib/run-outcome';
import type { AgentFailureCode } from './failure';
import {
  agentApprovalModeSchema,
  agentEventSchema,
  DEFAULT_AGENT_APPROVAL_MODE,
  type AgentApprovalMode,
  type AgentEventData,
  type AgentRunSummary,
  type AgentRunStatus
} from '../lib/contracts';

type Transaction = Prisma.TransactionClient;
import { contextUsageSchema } from '../lib/context';
export const PUBLIC_RUN_SELECT = {
  inputTokens: true,
  outputTokens: true,
  contextUsage: true,
  id: true,
  graphId: true,
  goal: true,
  model: true,
  reasoning: true,
  approvalMode: true,
  parentRunId: true,
  status: true,
  createdAt: true,
  endedAt: true,
  graph: { select: { name: true } }
} satisfies Prisma.AgentRunSelect;
type PublicRun = Prisma.AgentRunGetPayload<{
  select: typeof PUBLIC_RUN_SELECT;
}>;
export function toRunSummary(run: PublicRun): AgentRunSummary {
  return {
    inputTokens: run.inputTokens ?? 0,
    outputTokens: run.outputTokens ?? 0,
    contextUsage: contextUsageSchema.safeParse(run.contextUsage).success
      ? contextUsageSchema.parse(run.contextUsage)
      : null,
    id: run.id,
    graphId: run.graphId,
    graphName: run.graph.name,
    goal: run.goal,
    model: run.model,
    reasoning: run.reasoning,
    approvalMode: agentApprovalModeSchema.parse(run.approvalMode),
    parentRunId: run.parentRunId ?? null,
    status: run.status as AgentRunStatus,
    createdAt: run.createdAt.toISOString(),
    endedAt: run.endedAt?.toISOString() ?? null
  };
}

async function assertAccess(tx: Transaction, graphId: string, userId: string) {
  const graph = await tx.graph.findFirst({
    where: { id: graphId, userId },
    select: { workspaceId: true }
  });
  if (!graph) throw new GraphWriteError('graph_not_found', 404);
  if (
    graph.workspaceId &&
    !(await tx.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId: graph.workspaceId } },
      select: { id: true }
    }))
  )
    throw new GraphWriteError('workspace_access_revoked', 403);
}

async function append(
  tx: Transaction,
  runId: string,
  data: AgentEventData,
  terminal = false
) {
  const parsed = agentEventSchema.parse(data);
  const run = await tx.agentRun.update({
    where: { id: runId },
    data: { eventCount: { increment: 1 } },
    select: { eventCount: true }
  });
  if (run.eventCount > 500 && parsed.type !== 'finished' && !terminal)
    throw new GraphWriteError('agent_event_limit', 409);
  return tx.agentEvent.create({
    data: {
      runId,
      sequence: run.eventCount,
      data: parsed as Prisma.InputJsonValue
    }
  });
}

// Internal lifecycle, shared by future provider workers. All callers must pass
// an interactive transaction; never hold it open during a provider/tool call.
export async function beginAgentRun(
  tx: Transaction,
  input: {
    runId?: string;
    startRequestHash?: string;
    parentRunId?: string;
    graphId: string;
    userId: string;
    goal: string;
    model: string;
    reasoning: string;
    approvalMode?: AgentApprovalMode;
    expectedWriteVersion: number;
  }
) {
  const { approvalMode } = z
    .object({
      goal: z.string().trim().min(1).max(8000),
      model: z.string().min(1).max(120),
      reasoning: z.string().min(1).max(40),
      approvalMode: agentApprovalModeSchema.default(DEFAULT_AGENT_APPROVAL_MODE)
    })
    .parse(input);
  const runId = input.runId ? z.uuid().parse(input.runId) : randomUUID();
  const handle = await acquireAgentGraphLease(tx, { ...input, runId });
  await tx.agentRun.create({
    data: {
      id: runId,
      graphId: input.graphId,
      userId: input.userId,
      goal: input.goal.trim(),
      model: input.model,
      reasoning: input.reasoning,
      approvalMode,
      startRequestHash: input.startRequestHash ?? null,
      parentRunId: input.parentRunId ?? null
    }
  });
  return handle;
}

export async function publishAgentActivity(
  tx: Transaction,
  handle: AgentGraphLease,
  data: AgentEventData
) {
  await assertAgentGraphLease(tx, handle);
  const run = await tx.agentRun.findUnique({
    where: { id: handle.runId },
    select: { status: true, graphId: true }
  });
  if (run?.status !== 'running' || run.graphId !== handle.graphId)
    throw new GraphWriteError('agent_run_finished', 409);
  if (data.type === 'finished' || data.type === 'decision')
    throw new GraphWriteError('invalid_agent_event', 400);
  if (data.type === 'approval') {
    const previous = await tx.agentEvent.findFirst({
      where: {
        runId: handle.runId,
        data: { path: ['approvalId'], equals: data.approvalId }
      },
      select: { sequence: true }
    });
    if (previous) throw new GraphWriteError('duplicate_approval', 409);
  }
  return append(tx, handle.runId, data);
}

export async function finishAgentRun(
  tx: Transaction,
  handle: AgentGraphLease,
  status: 'completed' | 'failed',
  summary: string,
  reasonCode?: AgentFailureCode
) {
  await assertAgentGraphLease(tx, handle);
  const run = await tx.agentRun.findUnique({ where: { id: handle.runId } });
  if (run?.status !== 'running' || run.graphId !== handle.graphId)
    throw new GraphWriteError('agent_run_finished', 409);
  if (status === 'failed') {
    const rows = await tx.agentEvent.findMany({
      where: { runId: handle.runId },
      orderBy: { sequence: 'asc' },
      take: 500,
      select: { data: true }
    });
    const events = rows.flatMap((row) => {
      const parsed = agentEventSchema.safeParse(row.data);
      return parsed.success ? [parsed.data] : [];
    });
    await append(
      tx,
      handle.runId,
      {
        type: 'message',
        text: runFailureSummary(events, summary),
        sources: []
      },
      true
    );
  }
  await append(tx, handle.runId, {
    type: 'finished',
    status,
    summary,
    ...(reasonCode ? { reasonCode } : {})
  });
  await tx.agentRun.update({
    where: { id: handle.runId },
    data: { status, endedAt: new Date() }
  });
  await releaseAgentGraphLease(tx, handle);
}

// Internal cleanup may run after workspace access was revoked. It cannot write
// graph data or release another worker's lease, and never overwrites Stop.
export async function interruptAgentRun(
  tx: Transaction,
  handle: AgentGraphLease
) {
  await getGraphWriteState(tx, handle.graphId);
  const run = await tx.agentRun.findUnique({ where: { id: handle.runId } });
  if (!run || run.status !== 'running') return;
  if (run.graphId !== handle.graphId || run.userId !== handle.userId)
    throw new GraphWriteError('agent_scope_changed', 409);
  const released = await releaseAgentGraphLease(tx, handle);
  const current = await tx.graphAgentLease.findUnique({
    where: { graphId: handle.graphId }
  });
  if (!released && current?.runId === handle.runId)
    throw new GraphWriteError('graph_lease_lost', 409);
  await append(tx, handle.runId, {
    type: 'finished',
    status: 'interrupted',
    summary: 'Run interrupted: authorization or graph lock is no longer valid.'
  });
  await tx.agentRun.update({
    where: { id: handle.runId },
    data: { status: 'interrupted', endedAt: new Date() }
  });
}

export async function readOwnedAgentRun(
  tx: Transaction,
  runId: string,
  userId: string
) {
  const found = await tx.agentRun.findFirst({
    where: { id: runId, userId },
    select: PUBLIC_RUN_SELECT
  });
  if (!found) throw new GraphWriteError('agent_run_not_found', 404);
  await assertAccess(tx, found.graphId, userId);
  await getGraphWriteState(tx, found.graphId);
  const run = await tx.agentRun.findUniqueOrThrow({
    where: { id: runId },
    select: PUBLIC_RUN_SELECT
  });
  const lease = await tx.graphAgentLease.findUnique({
    where: { graphId: run.graphId }
  });
  if (run.status === 'running' && lease?.runId !== runId) {
    await append(tx, runId, {
      type: 'finished',
      status: 'interrupted',
      summary: 'Run interrupted: the graph lock is no longer valid.'
    });
    return tx.agentRun.update({
      where: { id: runId },
      data: { status: 'interrupted', endedAt: new Date() },
      select: PUBLIC_RUN_SELECT
    });
  }
  return run;
}

export async function archiveAgentThread(
  tx: Transaction,
  graphId: string,
  userId: string,
  rootRunId: string
) {
  await assertAccess(tx, graphId, userId);
  const runs = await tx.agentRun.findMany({
    where: { graphId, userId, archivedAt: null },
    select: { id: true, parentRunId: true, status: true }
  });
  if (!runs.some((run) => agentRunRootId(runs, run.id) === rootRunId))
    throw new GraphWriteError('agent_thread_not_found', 404);
  if (
    runs.some(
      (run) =>
        agentRunRootId(runs, run.id) === rootRunId && run.status === 'running'
    )
  )
    throw new GraphWriteError('agent_thread_running', 409);
  const ids = agentThreadRunIds(runs, rootRunId);
  await tx.agentRun.updateMany({
    where: { id: { in: ids }, graphId, userId },
    data: { archivedAt: new Date() }
  });
  return ids.length;
}

export async function cancelAgentRun(
  tx: Transaction,
  runId: string,
  userId: string
) {
  const run = await readOwnedAgentRun(tx, runId, userId);
  if (run.status !== 'running') return run;
  const lease = await tx.graphAgentLease.findUniqueOrThrow({
    where: { graphId: run.graphId }
  });
  await append(tx, runId, {
    type: 'finished',
    status: 'cancelled',
    summary: 'Run stopped by the user.'
  });
  await releaseAgentGraphLease(tx, {
    graphId: run.graphId,
    runId,
    userId,
    generation: lease.generation,
    token: lease.token!
  });
  return tx.agentRun.update({
    where: { id: runId },
    data: { status: 'cancelled', endedAt: new Date() },
    select: PUBLIC_RUN_SELECT
  });
}

export async function decideAgentApproval(
  tx: Transaction,
  runId: string,
  userId: string,
  approvalId: string,
  approved: boolean
) {
  const run = await readOwnedAgentRun(tx, runId, userId);
  if (run.status !== 'running')
    throw new GraphWriteError('agent_run_finished', 409);
  const events = await tx.agentEvent.findMany({
    where: { runId },
    orderBy: { sequence: 'asc' },
    take: 501
  });
  const data = events.map((event) => agentEventSchema.parse(event.data));
  if (
    !data.some(
      (event) => event.type === 'approval' && event.approvalId === approvalId
    )
  )
    throw new GraphWriteError('approval_not_found', 404);
  const previous = data.find(
    (event) => event.type === 'decision' && event.approvalId === approvalId
  );
  if (previous?.type === 'decision') {
    if (previous.approved !== approved)
      throw new GraphWriteError('approval_already_decided', 409);
    return;
  }
  await append(tx, runId, { type: 'decision', approvalId, approved });
}

import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { GraphWriteState } from '../lib/graph-write-state';

type Transaction = Prisma.TransactionClient;

export class GraphWriteError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly writeState?: GraphWriteState
  ) {
    super(code);
  }
}

export interface AgentGraphLease {
  graphId: string;
  runId: string;
  userId: string;
  generation: number;
  token: string;
}

const EMPTY_OWNER = { runId: null, userId: null, token: null, expiresAt: null };

// Call only inside the transaction that reads/mutates the graph. Every writer
// locks the parent row, including the first acquisition before a lease exists.
async function lockGraph(tx: Transaction, graphId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Graph" WHERE "id" = ${graphId} FOR UPDATE
  `;
  if (!rows.length) throw new GraphWriteError('graph_not_found', 404);
  const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`
    SELECT clock_timestamp() AS "now"
  `;
  return clock.now;
}

async function lockedLease(tx: Transaction, graphId: string) {
  const now = await lockGraph(tx, graphId);
  let lease = await tx.graphAgentLease.findUnique({ where: { graphId } });
  if (lease?.expiresAt && lease.expiresAt <= now) {
    lease = await tx.graphAgentLease.update({
      where: { graphId },
      data: { ...EMPTY_OWNER, generation: { increment: 1 } }
    });
  }
  return { now, lease };
}

export async function getGraphWriteState(
  tx: Transaction,
  graphId: string
): Promise<GraphWriteState> {
  const { lease } = await lockedLease(tx, graphId);
  return {
    version: lease?.generation ?? 0,
    locked: Boolean(lease?.runId),
    expiresAt: lease?.expiresAt?.toISOString() ?? null
  };
}

function validateVersion(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new GraphWriteError('invalid_graph_write_version', 400);
  }
}

export async function assertGraphEditable(
  tx: Transaction,
  graphId: string,
  options: { snapshot?: boolean; expectedWriteVersion?: unknown } = {}
) {
  const state = await getGraphWriteState(tx, graphId);
  if (state.locked)
    throw new GraphWriteError('graph_agent_running', 423, state);
  if (options.snapshot) {
    const version = options.expectedWriteVersion;
    // Older clients remain compatible only until the first agent run.
    if (version === undefined && state.version !== 0) {
      throw new GraphWriteError('graph_reload_required', 428, state);
    }
    if (version !== undefined) {
      validateVersion(version);
      if (version !== state.version) {
        throw new GraphWriteError('graph_changed', 409, state);
      }
    }
  }
  return state;
}

async function requireAgentOwner(
  tx: Transaction,
  graphId: string,
  userId: string
) {
  const graph = await tx.graph.findUnique({
    where: { id: graphId },
    select: { userId: true, workspaceId: true }
  });
  if (!graph || graph.userId !== userId) {
    throw new GraphWriteError('graph_not_found', 404);
  }
  if (graph.workspaceId) {
    const member = await tx.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId: graph.workspaceId } },
      select: { id: true }
    });
    if (!member) throw new GraphWriteError('workspace_access_revoked', 403);
  }
}

function expiresAt(now: Date, ttlMs: number) {
  if (!Number.isInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 300_000) {
    throw new GraphWriteError('invalid_graph_lease_duration', 400);
  }
  return new Date(now.getTime() + ttlMs);
}

// Internal worker API: never expose acquisition or the returned token to a model.
export async function acquireAgentGraphLease(
  tx: Transaction,
  input: {
    graphId: string;
    userId: string;
    runId: string;
    expectedWriteVersion: number;
  },
  ttlMs = 60_000
): Promise<AgentGraphLease> {
  const { graphId, userId, runId } = input;
  if (!runId.trim()) throw new GraphWriteError('invalid_agent_run', 400);
  const { now, lease } = await lockedLease(tx, graphId);
  await requireAgentOwner(tx, graphId, userId);
  validateVersion(input.expectedWriteVersion);
  if (lease?.runId) throw new GraphWriteError('graph_agent_running', 423);
  if (input.expectedWriteVersion !== (lease?.generation ?? 0)) {
    throw new GraphWriteError('graph_changed', 409);
  }
  const owner = {
    runId,
    userId,
    token: randomUUID(),
    expiresAt: expiresAt(now, ttlMs)
  };
  const acquired = await tx.graphAgentLease.upsert({
    where: { graphId },
    create: { graphId, generation: 1, ...owner },
    update: { generation: { increment: 1 }, ...owner }
  });
  return {
    graphId,
    runId,
    userId,
    token: owner.token,
    generation: acquired.generation
  };
}

export async function assertAgentGraphLease(
  tx: Transaction,
  handle: AgentGraphLease
) {
  const { now, lease } = await lockedLease(tx, handle.graphId);
  if (
    !lease?.runId ||
    lease.runId !== handle.runId ||
    lease.userId !== handle.userId ||
    lease.generation !== handle.generation ||
    lease.token !== handle.token
  ) {
    throw new GraphWriteError('graph_lease_lost', 409);
  }
  await requireAgentOwner(tx, handle.graphId, handle.userId);
  return now;
}

export async function renewAgentGraphLease(
  tx: Transaction,
  handle: AgentGraphLease,
  ttlMs = 60_000
) {
  const now = await assertAgentGraphLease(tx, handle);
  await tx.graphAgentLease.update({
    where: { graphId: handle.graphId },
    data: { expiresAt: expiresAt(now, ttlMs) }
  });
}

export async function releaseAgentGraphLease(
  tx: Transaction,
  handle: AgentGraphLease
) {
  const { lease } = await lockedLease(tx, handle.graphId);
  if (
    lease?.generation !== handle.generation ||
    lease.token !== handle.token ||
    lease.runId !== handle.runId ||
    lease.userId !== handle.userId
  )
    return false;
  await tx.graphAgentLease.update({
    where: { graphId: handle.graphId },
    data: { ...EMPTY_OWNER, generation: { increment: 1 } }
  });
  return true;
}

export async function assertGraphScopeEditable(
  tx: Transaction,
  scope: { caseId: string } | { workspaceId: string }
) {
  // Lock the parent first so new graphs cannot enter a scope being deleted.
  if ('caseId' in scope) {
    await tx.$queryRaw`SELECT "id" FROM "Case" WHERE "id" = ${scope.caseId} FOR UPDATE`;
  } else {
    await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${scope.workspaceId} FOR UPDATE`;
  }
  const graphs = await tx.graph.findMany({
    where: scope,
    select: { id: true },
    orderBy: { id: 'asc' }
  });
  for (const graph of graphs) await assertGraphEditable(tx, graph.id);
}

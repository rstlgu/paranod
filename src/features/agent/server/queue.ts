import { PgBoss, type SendOptions } from 'pg-boss';
import type { Prisma, PrismaClient } from '@prisma/client';
import { beginAgentRun } from './runs';
import { validateModelSelection } from './policy';
import { readAgentStartSnapshot } from './snapshot';
import { agentStartRequestHash, type AgentStartInput } from './start-contract';
import { assertAgentWorkerCapacity } from './readiness';
import { GraphWriteError } from '@/features/graph/server/graph-agent-lease';

export const AGENT_QUEUE = 'paranod-investigation-v1';
export function createAgentQueue(connectionString: string) {
  return new PgBoss({
    connectionString,
    schema: 'agent_queue',
    max: 3,
    application_name: 'paranod-agent'
  });
}
export async function initializeAgentQueue(queue: PgBoss) {
  await queue.start();
  await queue.createQueue(AGENT_QUEUE, {
    retryLimit: 0,
    expireInSeconds: 660,
    retentionSeconds: 86400
  });
}

export function transactionDatabase(tx: Prisma.TransactionClient) {
  return {
    executeSql: async (sql: string, values?: unknown[]) => ({
      rows: await tx.$queryRawUnsafe<never[]>(sql, ...(values ?? []))
    })
  };
}

// The web process only produces jobs through Prisma. Queue initialization,
// scheduling and maintenance belong to the dedicated worker process.
type AgentQueueSender = {
  send(
    name: string,
    data: object,
    options: SendOptions
  ): Promise<string | null>;
};

export function createAgentProducer(): AgentQueueSender {
  return {
    async send(name, data, options) {
      if (!options.db) throw new Error('agent_queue_transaction_required');
      // pg-boss reads queue metadata through its constructor DB, not send's
      // override. Keep both queries on the already-owned transaction connection.
      const producer = new PgBoss({ schema: 'agent_queue', db: options.db });
      return producer.send(name, data, options);
    }
  };
}

export async function findStartedAgentRun(
  db: PrismaClient | Prisma.TransactionClient,
  input: AgentStartInput
) {
  const existing = await db.agentRun.findUnique({
    where: { id: input.runId },
    select: {
      id: true,
      userId: true,
      graphId: true,
      startRequestHash: true,
      graph: { select: { userId: true, workspaceId: true } }
    }
  });
  if (!existing) return null;
  if (
    existing.userId !== input.userId ||
    existing.graphId !== input.graphId ||
    existing.graph.userId !== input.userId ||
    existing.graph.workspaceId !== input.workspaceId ||
    existing.startRequestHash !== agentStartRequestHash(input)
  )
    throw new GraphWriteError('agent_start_conflict', 409);
  return { runId: existing.id };
}

export async function enqueueAgentRun(
  db: PrismaClient,
  queue: AgentQueueSender,
  input: AgentStartInput
) {
  validateModelSelection(input.model, input.reasoning);
  return db.$transaction(
    async (tx) => {
      const snapshot = await readAgentStartSnapshot(tx, input);
      const existing = await findStartedAgentRun(tx, input);
      if (existing) return existing;
      if (input.parentRunId) {
        const parent = await tx.agentRun.findFirst({
          where: {
            id: input.parentRunId,
            graphId: input.graphId,
            userId: input.userId
          },
          select: { status: true }
        });
        if (
          input.parentRunId === input.runId ||
          !parent ||
          parent.status === 'running'
        )
          throw new GraphWriteError('agent_conversation_unavailable', 409);
      }
      if (snapshot.revision !== input.expectedRevision)
        throw new GraphWriteError(
          'agent_snapshot_changed',
          409,
          snapshot.writeState
        );
      await assertAgentWorkerCapacity(tx);
      const inFlight = await tx.transformJob.count({
        where: {
          graphId: input.graphId,
          status: { in: ['PENDING', 'SUBMITTED', 'PROCESSING'] }
        }
      });
      if (inFlight) throw new GraphWriteError('agent_manual_jobs_active', 409);
      const handle = await beginAgentRun(tx, {
        ...input,
        startRequestHash: agentStartRequestHash(input)
      });
      const jobId = await queue.send(
        AGENT_QUEUE,
        { runId: handle.runId },
        {
          id: handle.runId,
          retryLimit: 0,
          expireInSeconds: 660,
          db: transactionDatabase(tx)
        }
      );
      if (!jobId) throw new Error('agent_queue_rejected');
      return { runId: handle.runId };
    },
    { isolationLevel: 'ReadCommitted' }
  );
}

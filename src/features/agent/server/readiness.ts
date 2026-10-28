import type { Prisma, PrismaClient } from '@prisma/client';
import { GraphWriteError } from '@/features/graph/server/graph-agent-lease';

type Database = PrismaClient | Prisma.TransactionClient;

// Bump the protocol when the job or graph-write contract becomes incompatible.
export const AGENT_WORKER_PROTOCOL_VERSION = 1;
export const AGENT_WORKER_QUEUE = 'paranod-investigation-v1';
export const AGENT_WORKER_HEARTBEAT_MS = 10_000;
export const AGENT_WORKER_TTL_MS = 30_000;

export interface AgentWorkerCapacity {
  readyWorkers: number;
  activeRuns: number;
  availableSlots: number;
}

export async function getAgentWorkerCapacity(
  db: Database
): Promise<AgentWorkerCapacity> {
  const [counts] = await db.$queryRaw<
    Array<{ readyWorkers: number; activeRuns: number }>
  >`
    WITH clock AS MATERIALIZED (
      SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now
    )
    SELECT (
      SELECT count(*)::integer FROM "AgentWorker", clock
      WHERE "protocolVersion" = ${AGENT_WORKER_PROTOCOL_VERSION}
        AND "queueName" = ${AGENT_WORKER_QUEUE}
        AND "heartbeatAt" <= clock.now
        AND "heartbeatAt" > clock.now - ${AGENT_WORKER_TTL_MS} * interval '1 millisecond'
        AND "expiresAt" > clock.now
    ) AS "readyWorkers", (
      SELECT count(*)::integer FROM "GraphAgentLease" lease
      JOIN "AgentRun" run ON run."id" = lease."runId"
        AND run."graphId" = lease."graphId"
        AND run."userId" = lease."userId"
      CROSS JOIN clock
      WHERE run."status" = 'running'
        AND lease."token" IS NOT NULL
        AND lease."expiresAt" > clock.now
    ) AS "activeRuns"
  `;
  return {
    ...counts,
    availableSlots: Math.max(0, counts.readyWorkers - counts.activeRuns)
  };
}

// Call BEFORE acquiring a graph lease, in the SAME enqueue transaction. The
// transaction lock serializes starts across every web process and graph.
export async function assertAgentWorkerCapacity(tx: Prisma.TransactionClient) {
  // Separate statements ensure a fresh READ COMMITTED snapshot after waiting.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(1346458177, 1095189838)::text`;
  let capacity: AgentWorkerCapacity;
  try {
    capacity = await getAgentWorkerCapacity(tx);
  } catch {
    throw new GraphWriteError('agent_worker_unavailable', 503);
  }
  if (!capacity.readyWorkers)
    throw new GraphWriteError('agent_worker_unavailable', 503);
  if (!capacity.availableSlots)
    throw new GraphWriteError('agent_worker_busy', 409);
  return capacity;
}

// A row means queue.work has registered successfully. One process handles one
// job at a time; callers must not publish this before registration completes.
export async function heartbeatAgentWorker(db: Database, workerId: string) {
  await db.$executeRaw`
    WITH clock AS MATERIALIZED (
      SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now
    )
    INSERT INTO "AgentWorker"
      ("id", "protocolVersion", "queueName", "heartbeatAt", "expiresAt")
    SELECT ${workerId}, ${AGENT_WORKER_PROTOCOL_VERSION}, ${AGENT_WORKER_QUEUE},
      clock.now,
      clock.now + ${AGENT_WORKER_TTL_MS} * interval '1 millisecond'
    FROM clock
    ON CONFLICT ("id") DO UPDATE SET
      "protocolVersion" = EXCLUDED."protocolVersion",
      "queueName" = EXCLUDED."queueName",
      "heartbeatAt" = EXCLUDED."heartbeatAt",
      "expiresAt" = EXCLUDED."expiresAt"
  `;
}

export async function removeAgentWorker(db: Database, workerId: string) {
  await db.agentWorker.deleteMany({ where: { id: workerId } });
}

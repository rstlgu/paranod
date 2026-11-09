import type { PrismaClient } from '@prisma/client';
import type { ModelProvider } from '@openai/agents';
import { setTimeout as delay } from 'node:timers/promises';
import {
  assertAgentGraphLease,
  renewAgentGraphLease,
  type AgentGraphLease
} from '@/features/graph/server/graph-agent-lease';
import { finishAgentRun, interruptAgentRun, readOwnedAgentRun } from './runs';
import { createAgentGateway } from './gateway';
import { runInvestigation } from './runtime';
import { AGENT_LIMITS } from './policy';
import { readAgentContext } from './context';
import { agentApprovalModeSchema } from '../lib/contracts';
import { agentFailure } from './failure';

export async function claimAgentJob(db: PrismaClient, runId: string) {
  return db.$transaction(async (tx) => {
    const initial = await tx.agentRun.findUnique({ where: { id: runId } });
    if (!initial || initial.status !== 'running' || initial.workerStartedAt)
      return null;
    const run = await readOwnedAgentRun(tx, runId, initial.userId);
    if (run.status !== 'running') return null;
    const graph = await tx.graph.findUniqueOrThrow({
      where: { id: run.graphId },
      select: { workspaceId: true }
    });
    if (!graph.workspaceId) throw new Error('agent_workspace_required');
    const lease = await tx.graphAgentLease.findUniqueOrThrow({
      where: { graphId: run.graphId }
    });
    const handle: AgentGraphLease = {
      graphId: run.graphId,
      runId,
      userId: initial.userId,
      generation: lease.generation,
      token: lease.token!
    };
    await assertAgentGraphLease(tx, handle);
    // A recovered/retried queue job must never replay uncertain external work.
    const claimed = await tx.agentRun.updateMany({
      where: { id: runId, status: 'running', workerStartedAt: null },
      data: { workerStartedAt: new Date() }
    });
    return claimed.count
      ? { handle, workspaceId: graph.workspaceId, run }
      : null;
  });
}

export async function processAgentJob(input: {
  db: PrismaClient;
  runId: string;
  signal: AbortSignal;
  getProvider(
    workspaceId: string,
    run: { model: string; reasoning: string }
  ): Promise<{ provider: ModelProvider; close(): Promise<void> }>;
  heartbeatMs?: number;
}) {
  const claimed = await claimAgentJob(input.db, input.runId);
  if (!claimed) return;
  const { handle, workspaceId, run } = claimed;
  const abort = new AbortController();
  const heartbeatStop = new AbortController();
  const signal = AbortSignal.any([
    input.signal,
    abort.signal,
    AbortSignal.timeout(AGENT_LIMITS.runTimeoutMs)
  ]);
  const heartbeat = (async () => {
    try {
      while (true) {
        await delay(input.heartbeatMs ?? AGENT_LIMITS.heartbeatMs, undefined, {
          signal: heartbeatStop.signal
        });
        await input.db.$transaction(async (tx) => {
          await assertAgentGraphLease(tx, handle);
          const current = await tx.agentRun.findUnique({
            where: { id: handle.runId },
            select: { status: true }
          });
          if (current?.status !== 'running')
            throw new Error('agent_run_finished');
          await renewAgentGraphLease(tx, handle, AGENT_LIMITS.leaseTtlMs);
        });
      }
    } catch {
      if (!heartbeatStop.signal.aborted)
        abort.abort(new Error('agent_lease_lost'));
    }
  })();
  let provider: Awaited<ReturnType<typeof input.getProvider>> | undefined;
  try {
    signal.throwIfAborted();
    provider = await input.getProvider(workspaceId, {
      model: run.model,
      reasoning: run.reasoning
    });
    const memory = await readAgentContext(input.db, {
      parentRunId: run.parentRunId,
      graphId: run.graphId,
      userId: handle.userId
    });
    const approvalMode = agentApprovalModeSchema.parse(run.approvalMode);
    const usage = await runInvestigation({
      runId: run.id,
      goal: run.goal,
      model: run.model,
      reasoning: run.reasoning,
      approvalMode,
      provider: provider.provider,
      port: createAgentGateway(input.db, handle, workspaceId, approvalMode),
      signal,
      history: memory.history,
      contextSummary: memory.summary,
      contextGoals: memory.goals
    });
    signal.throwIfAborted();
    await input.db.$transaction(async (tx) => {
      await finishAgentRun(tx, handle, 'completed', 'Investigation completed.');
      await tx.agentRun.update({ where: { id: run.id }, data: usage });
    });
  } catch (error) {
    // Do not persist SDK errors: they may contain request bodies or credentials.
    const failure = agentFailure(error, signal);
    process.stderr.write(
      `[agent] Run failed ${JSON.stringify({ runId: run.id, code: failure.code })}\n`
    );
    await input.db
      .$transaction((tx) =>
        finishAgentRun(tx, handle, 'failed', failure.summary, failure.code)
      )
      .catch(() =>
        input.db
          .$transaction((tx) => interruptAgentRun(tx, handle))
          .catch(() => undefined)
      );
  } finally {
    heartbeatStop.abort();
    await heartbeat;
    await provider?.close().catch(() => undefined);
  }
}

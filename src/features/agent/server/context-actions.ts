import type { PrismaClient } from '@prisma/client';
import type { ModelProvider } from '@openai/agents';
import {
  GraphWriteError,
  getGraphWriteState
} from '@/features/graph/server/graph-agent-lease';
import { PUBLIC_RUN_SELECT, readOwnedAgentRun, toRunSummary } from './runs';
import {
  checkpointSchema,
  compactContext,
  contextInput,
  readAgentContext
} from './context';
import { argumentsHash, AGENT_LIMITS } from './policy';
import { emptyContextUsage, estimateContextTokens } from '../lib/context';

export async function changeAgentContext(input: {
  db: PrismaClient;
  runId: string;
  userId: string;
  action: 'clear' | 'compact';
  signal: AbortSignal;
  getProvider(
    workspaceId: string,
    run: { model: string; reasoning: string }
  ): Promise<{ provider: ModelProvider; close(): Promise<void> }>;
}) {
  const snapshot = await input.db.$transaction(async (tx) => {
    const run = await readOwnedAgentRun(tx, input.runId, input.userId);
    const write = await getGraphWriteState(tx, run.graphId);
    if (run.status === 'running' || write.locked)
      throw new GraphWriteError('graph_agent_running', 423);
    const stored = await tx.agentRun.findUniqueOrThrow({
      where: { id: run.id },
      select: { contextCheckpoint: true }
    });
    const graph = await tx.graph.findUniqueOrThrow({
      where: { id: run.graphId },
      select: { workspaceId: true }
    });
    const memory =
      input.action === 'compact'
        ? await readAgentContext(tx, {
            parentRunId: run.id,
            graphId: run.graphId,
            userId: input.userId
          })
        : { history: [], summary: '', goals: [] };
    return {
      run,
      write,
      checkpointHash: argumentsHash(stored.contextCheckpoint ?? null),
      workspaceId: graph.workspaceId,
      memory
    };
  });
  let summary = '';
  if (input.action === 'compact') {
    if (!snapshot.workspaceId)
      throw new GraphWriteError('agent_workspace_required', 409);
    const text = contextInput('', snapshot.memory);
    if (!text.trim()) throw new GraphWriteError('agent_context_empty', 409);
    const provider = await input.getProvider(
      snapshot.workspaceId,
      snapshot.run
    );
    let used = 0;
    try {
      summary = await compactContext({
        text,
        model: snapshot.run.model,
        reasoning: snapshot.run.reasoning,
        provider: provider.provider,
        signal: input.signal,
        onUsage: async (inputTokens, outputTokens) => {
          used += inputTokens + outputTokens;
          await input.db.$transaction(async (tx) => {
            await readOwnedAgentRun(tx, input.runId, input.userId);
            await tx.agentRun.update({
              where: { id: input.runId },
              data: {
                inputTokens: { increment: inputTokens },
                outputTokens: { increment: outputTokens }
              }
            });
          });
          if (used > AGENT_LIMITS.maxTotalTokens)
            throw new Error('agent_token_limit');
        }
      });
    } finally {
      await provider.close();
    }
  }
  input.signal.throwIfAborted();
  return input.db.$transaction(async (tx) => {
    const current = await readOwnedAgentRun(tx, input.runId, input.userId);
    const write = await getGraphWriteState(tx, current.graphId);
    const stored = await tx.agentRun.findUniqueOrThrow({
      where: { id: current.id },
      select: { contextCheckpoint: true }
    });
    if (
      write.locked ||
      current.status === 'running' ||
      write.version !== snapshot.write.version ||
      argumentsHash(stored.contextCheckpoint ?? null) !==
        snapshot.checkpointHash
    )
      throw new GraphWriteError('agent_context_changed', 409);
    const checkpoint = checkpointSchema.parse({
      mode: input.action === 'clear' ? 'cleared' : 'compacted',
      summary,
      includesRun: true,
      goals: input.action === 'clear' ? [] : snapshot.memory.goals
    });
    const run = await tx.agentRun.update({
      where: { id: input.runId },
      select: PUBLIC_RUN_SELECT,
      data: {
        contextCheckpoint: checkpoint,
        contextUsage: {
          ...emptyContextUsage(current.model),
          tokens: estimateContextTokens(summary),
          state: input.action === 'clear' ? 'cleared' : 'ready',
          compactions:
            input.action === 'clear'
              ? 0
              : (toRunSummary(current).contextUsage?.compactions ?? 0) + 1
        }
      }
    });
    return toRunSummary(run);
  });
}

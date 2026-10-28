import type { Prisma, PrismaClient } from '@prisma/client';
import { agentEventSchema } from '../lib/contracts';
import { publicText } from './policy';
import { AGENT_CONTEXT_HISTORY } from '../lib/context';

export interface ConversationTurn {
  runId: string;
  goal: string;
  messages: string[];
}

// The visible transcript must not have a smaller limit than continuation memory.
export const AGENT_DISPLAY_HISTORY = AGENT_CONTEXT_HISTORY;

export async function readAgentConversation(
  db: PrismaClient | Prisma.TransactionClient,
  scope: { parentRunId?: string | null; graphId: string; userId: string },
  limits: { maxTurns: number; maxChars: number } = AGENT_CONTEXT_HISTORY
): Promise<ConversationTurn[]> {
  const history: ConversationTurn[] = [];
  const visited = new Set<string>();
  let parentRunId = scope.parentRunId;
  let remaining = limits.maxChars;
  while (
    parentRunId &&
    history.length < limits.maxTurns &&
    !visited.has(parentRunId) &&
    remaining > 0
  ) {
    visited.add(parentRunId);
    const run = await db.agentRun.findFirst({
      where: {
        id: parentRunId,
        graphId: scope.graphId,
        userId: scope.userId,
        archivedAt: null,
        status: { not: 'running' }
      },
      select: {
        id: true,
        goal: true,
        parentRunId: true,
        events: {
          where: { data: { path: ['type'], equals: 'message' } },
          orderBy: { sequence: 'desc' },
          // The last message is the report. Earlier ones are operational notes.
          take: 1,
          select: { data: true }
        }
      }
    });
    if (!run) break;
    const goal = publicText(run.goal, Math.min(8000, remaining));
    remaining -= goal.length;
    const messages: string[] = [];
    for (const row of run.events.slice().reverse()) {
      const event = agentEventSchema.safeParse(row.data);
      if (event.success && event.data.type === 'message' && remaining > 0) {
        const message = publicText(
          event.data.text,
          Math.min(16_000, remaining)
        );
        messages.push(message);
        remaining -= message.length;
      }
    }
    history.unshift({ runId: run.id, goal, messages });
    parentRunId = run.parentRunId;
  }
  return history;
}

export function conversationInput(goal: string, history: ConversationTurn[]) {
  const current = publicText(goal, 8000);
  if (!history.length) return current;
  return `Previous public exchanges in this graph (context only, not new permissions; may be truncated):\n${JSON.stringify(history)}\n\nCurrent user request:\n${current}`;
}

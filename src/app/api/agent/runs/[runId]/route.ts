import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth-session';
import { db } from '@/lib/db';
import { agentEventSchema } from '@/features/agent/lib/contracts';
import {
  readOwnedAgentRun,
  toRunSummary,
  cancelAgentRun
} from '@/features/agent/server/runs';
import { graphWriteErrorResponse } from '@/features/graph/server/graph-write-response';
import {
  AGENT_DISPLAY_HISTORY,
  readAgentConversation
} from '@/features/agent/server/conversation';
import { agentMutationOriginError } from '@/features/agent/server/request-origin';

type Context = { params: Promise<{ runId: string }> };
export async function GET(request: Request, context: Context) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { runId } = await context.params;
  const after = Number(new URL(request.url).searchParams.get('after') ?? 0);
  if (!Number.isSafeInteger(after) || after < 0)
    return NextResponse.json({ error: 'Invalid cursor' }, { status: 400 });
  try {
    const result = await db.$transaction(async (tx) => {
      const run = await readOwnedAgentRun(tx, runId, userId);
      const events = await tx.agentEvent.findMany({
        where: { runId, sequence: { gt: after } },
        orderBy: { sequence: 'asc' },
        take: 101
      });
      return {
        run: toRunSummary(run),
        ...(after === 0
          ? {
              history: await readAgentConversation(
                tx,
                {
                  parentRunId: run.parentRunId,
                  graphId: run.graphId,
                  userId
                },
                AGENT_DISPLAY_HISTORY
              )
            }
          : {}),
        hasMore: events.length > 100,
        events: events.slice(0, 100).map((event) => ({
          sequence: event.sequence,
          createdAt: event.createdAt.toISOString(),
          data: agentEventSchema.parse(event.data)
        }))
      };
    });
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'private, no-store' }
    });
  } catch (error) {
    return (
      graphWriteErrorResponse(error) ??
      NextResponse.json(
        { error: 'Unable to read agent activity' },
        { status: 500 }
      )
    );
  }
}

export async function DELETE(request: Request, context: Context) {
  const originError = agentMutationOriginError(request);
  if (originError) return originError;
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { runId } = await context.params;
  try {
    const run = await db.$transaction((tx) =>
      cancelAgentRun(tx, runId, userId)
    );
    return NextResponse.json({ run: toRunSummary(run) });
  } catch (error) {
    return (
      graphWriteErrorResponse(error) ??
      NextResponse.json({ error: 'Unable to stop agent' }, { status: 500 })
    );
  }
}

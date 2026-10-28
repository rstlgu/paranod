import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth-session';
import { db } from '@/lib/db';
import { archiveAgentThread } from '@/features/agent/server/runs';
import { graphWriteErrorResponse } from '@/features/graph/server/graph-write-response';
import { agentMutationOriginError } from '@/features/agent/server/request-origin';

type Context = { params: Promise<{ graphId: string; rootId: string }> };

export async function POST(request: Request, context: Context) {
  const originError = agentMutationOriginError(request);
  if (originError) return originError;
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { graphId, rootId } = await context.params;
  try {
    const archived = await db.$transaction((tx) =>
      archiveAgentThread(tx, graphId, userId, rootId)
    );
    return NextResponse.json({ archived });
  } catch (error) {
    return (
      graphWriteErrorResponse(error) ??
      NextResponse.json(
        { error: 'Unable to archive conversation' },
        { status: 500 }
      )
    );
  }
}

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth-session';
import { db } from '@/lib/db';
import { decideAgentApproval } from '@/features/agent/server/runs';
import { graphWriteErrorResponse } from '@/features/graph/server/graph-write-response';
import { readBoundedBody } from '@/lib/security/bounded-body';
import { agentMutationOriginError } from '@/features/agent/server/request-origin';

export async function POST(
  request: Request,
  context: { params: Promise<{ runId: string }> }
) {
  const originError = agentMutationOriginError(request);
  if (originError) return originError;
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body;
  try {
    body = JSON.parse(await readBoundedBody(request, 2048));
  } catch (error) {
    return NextResponse.json(
      { error: 'Invalid decision' },
      { status: error instanceof RangeError ? 413 : 400 }
    );
  }
  if (
    !body ||
    typeof body.approvalId !== 'string' ||
    !body.approvalId.trim() ||
    body.approvalId.length > 240 ||
    typeof body.approved !== 'boolean'
  )
    return NextResponse.json({ error: 'Invalid decision' }, { status: 400 });
  const { runId } = await context.params;
  try {
    await db.$transaction((tx) =>
      decideAgentApproval(tx, runId, userId, body.approvalId, body.approved)
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    return (
      graphWriteErrorResponse(error) ??
      NextResponse.json({ error: 'Unable to save decision' }, { status: 500 })
    );
  }
}

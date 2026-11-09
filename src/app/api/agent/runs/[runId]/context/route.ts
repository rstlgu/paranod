import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth-session';
import { db } from '@/lib/db';
import { readBoundedBody } from '@/lib/security/bounded-body';
import { agentMutationOriginError } from '@/features/agent/server/request-origin';
import { changeAgentContext } from '@/features/agent/server/context-actions';
import { getWorkspaceAgentProvider } from '@/features/agent/server/provider';
import { graphWriteErrorResponse } from '@/features/graph/server/graph-write-response';

export const runtime = 'nodejs';
export const maxDuration = 120;
const schema = z.object({ action: z.enum(['clear', 'compact']) }).strict();
export async function POST(
  request: Request,
  context: { params: Promise<{ runId: string }> }
) {
  const originError = agentMutationOriginError(request);
  if (originError) return originError;
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await readBoundedBody(request, 1024)
    .then(JSON.parse)
    .catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json(
      { error: 'Invalid context action' },
      { status: 400 }
    );
  try {
    const { runId } = await context.params;
    const run = await changeAgentContext({
      db,
      runId,
      userId,
      action: parsed.data.action,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(110_000)]),
      getProvider: getWorkspaceAgentProvider
    });
    return NextResponse.json(
      { run },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    return (
      graphWriteErrorResponse(error) ??
      NextResponse.json(
        { error: 'Context update failed; previous memory was preserved.' },
        { status: 500 }
      )
    );
  }
}

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth-session';
import { db } from '@/lib/db';
import { getGraphWriteState } from '@/features/graph/server/graph-agent-lease';
import { graphWriteErrorResponse } from '@/features/graph/server/graph-write-response';

export async function GET(
  _request: Request,
  context: { params: Promise<{ graphId: string }> }
) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { graphId } = await context.params;
  const graph = await db.graph.findFirst({
    where: { id: graphId, userId },
    select: { id: true }
  });
  if (!graph)
    return NextResponse.json({ error: 'Graph not found' }, { status: 404 });
  try {
    const writeState = await db.$transaction((tx) =>
      getGraphWriteState(tx, graphId)
    );
    return NextResponse.json(
      { writeState },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    return (
      graphWriteErrorResponse(error) ??
      NextResponse.json(
        { error: 'Failed to read graph state' },
        { status: 500 }
      )
    );
  }
}

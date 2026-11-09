import { NextResponse } from 'next/server';
import { getActiveWorkspaceAccess } from '@/lib/auth-utils';
import { db } from '@/lib/db';
import { readAgentStartSnapshot } from '@/features/agent/server/snapshot';
import { graphWriteErrorResponse } from '@/features/graph/server/graph-write-response';

export async function GET(
  _request: Request,
  context: { params: Promise<{ graphId: string }> }
) {
  const access = await getActiveWorkspaceAccess();
  if (!access)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { graphId } = await context.params;
  try {
    const snapshot = await db.$transaction((tx) =>
      readAgentStartSnapshot(tx, { ...access, graphId })
    );
    return NextResponse.json(snapshot, {
      headers: { 'Cache-Control': 'private, no-store' }
    });
  } catch (error) {
    return (
      graphWriteErrorResponse(error) ??
      NextResponse.json(
        { error: 'agent_snapshot_unavailable' },
        { status: 503 }
      )
    );
  }
}

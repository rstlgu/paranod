import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getGraphWriteState } from './graph-agent-lease';

/** Agent tools use their leased gateway, never these manual HTTP routes. */
export async function manualTransformGraphError(
  graphId: unknown,
  access: { userId: string; workspaceId: string }
) {
  if (graphId === undefined) return null; // Standalone plugin/flow editor.
  if (typeof graphId !== 'string' || !graphId || graphId.length > 160)
    return NextResponse.json({ error: 'Invalid graph' }, { status: 400 });
  return db.$transaction(async (tx) => {
    const graph = await tx.graph.findFirst({
      where: {
        id: graphId,
        workspaceId: access.workspaceId,
        OR: [{ userId: access.userId }, { visibility: 'workspace' }]
      },
      select: { id: true }
    });
    if (!graph)
      return NextResponse.json({ error: 'Graph not found' }, { status: 404 });
    const state = await getGraphWriteState(tx, graphId);
    return state.locked
      ? NextResponse.json(
          { success: false, error: 'graph_agent_running' },
          { status: 423 }
        )
      : null;
  });
}

import type { Prisma } from '@prisma/client';
import { argumentsHash } from './policy';
import {
  getGraphWriteState,
  GraphWriteError
} from '@/features/graph/server/graph-agent-lease';

export const AGENT_SNAPSHOT_SELECT = {
  id: true,
  userId: true,
  workspaceId: true,
  caseId: true,
  name: true,
  description: true,
  nodes: true,
  edges: true,
  notes: true,
  caseNote: { select: { id: true, content: true } }
} satisfies Prisma.GraphSelect;

type Snapshot = Prisma.GraphGetPayload<{
  select: typeof AGENT_SNAPSHOT_SELECT;
}>;

export function agentGraphRevision(graph: Snapshot) {
  // Opening a graph updates its timestamps, so hash content rather than updatedAt.
  return argumentsHash(graph);
}

export async function readAgentStartSnapshot(
  tx: Prisma.TransactionClient,
  scope: { graphId: string; workspaceId: string; userId: string }
) {
  const writeState = await getGraphWriteState(tx, scope.graphId);
  const graph = await tx.graph.findFirst({
    where: {
      id: scope.graphId,
      userId: scope.userId,
      workspaceId: scope.workspaceId
    },
    select: AGENT_SNAPSHOT_SELECT
  });
  if (!graph) throw new GraphWriteError('graph_not_found', 404);
  const member = await tx.workspaceMember.findUnique({
    where: {
      userId_workspaceId: {
        userId: scope.userId,
        workspaceId: scope.workspaceId
      }
    },
    select: { id: true }
  });
  if (!member) throw new GraphWriteError('workspace_access_revoked', 403);
  return {
    graphId: graph.id,
    revision: agentGraphRevision(graph),
    writeState,
    nodes: graph.nodes,
    edges: graph.edges,
    notes: graph.caseNote?.content ?? graph.notes ?? ''
  };
}

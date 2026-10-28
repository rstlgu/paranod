import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  assertGraphEditable,
  getGraphWriteState
} from '@/features/graph/server/graph-agent-lease';
import { graphWriteErrorResponse } from '@/features/graph/server/graph-write-response';
import {
  requireActiveWorkspaceMember,
  requireCaseInWorkspace
} from '@/app/api/cases/_utils';

type RouteContext = { params: Promise<{ caseId: string; noteId: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await requireActiveWorkspaceMember();
  if (!auth.ok)
    return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { caseId, noteId } = await context.params;
  const foundCase = await requireCaseInWorkspace({
    caseId,
    workspaceId: auth.ctx.workspaceId
  });
  if (!foundCase)
    return NextResponse.json({ error: 'Case not found' }, { status: 404 });

  const note = await db.caseArtifact.findFirst({
    where: { id: noteId, caseId, type: 'note' }
  });
  if (!note)
    return NextResponse.json({ error: 'Note not found' }, { status: 404 });

  await db.caseArtifact.update({
    where: { id: noteId },
    data: { lastOpenedAt: new Date() }
  });

  if (note.graphId) {
    const snapshot = await db.$transaction(async (tx) => {
      const writeState = await getGraphWriteState(tx, note.graphId!);
      const current = await tx.caseArtifact.findUniqueOrThrow({
        where: { id: noteId }
      });
      return { note: current, writeState };
    });
    return NextResponse.json(snapshot, {
      headers: { 'Cache-Control': 'private, no-store' }
    });
  }
  return NextResponse.json({ note });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireActiveWorkspaceMember();
  if (!auth.ok)
    return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { caseId, noteId } = await context.params;
  const foundCase = await requireCaseInWorkspace({
    caseId,
    workspaceId: auth.ctx.workspaceId
  });
  if (!foundCase)
    return NextResponse.json({ error: 'Case not found' }, { status: 404 });

  const existing = await db.caseArtifact.findFirst({
    where: { id: noteId, caseId, type: 'note' },
    select: { id: true, graphId: true }
  });
  if (!existing)
    return NextResponse.json({ error: 'Note not found' }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const data: { name?: string; content?: string } = {};
  if (typeof body?.name === 'string' && body.name.trim())
    data.name = body.name.trim();
  // Preserve the exact editor payload, including an intentionally empty note.
  // Trimming only here disagrees with graph-note saves and the start barrier.
  if (typeof body?.content === 'string') data.content = body.content;

  try {
    const note = await db.$transaction(async (tx) => {
      if (existing.graphId)
        await assertGraphEditable(tx, existing.graphId, {
          snapshot: typeof data.content === 'string',
          expectedWriteVersion: body.expectedWriteVersion
        });
      const updated = await tx.caseArtifact.update({
        where: { id: noteId },
        data
      });
      if (existing.graphId && typeof data.content === 'string')
        await tx.graph.update({
          where: { id: existing.graphId },
          data: { notes: data.content }
        });
      return updated;
    });
    return NextResponse.json({ note });
  } catch (error) {
    const blocked = graphWriteErrorResponse(error);
    if (blocked) return blocked;
    throw error;
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const auth = await requireActiveWorkspaceMember();
  if (!auth.ok)
    return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { caseId, noteId } = await context.params;
  const foundCase = await requireCaseInWorkspace({
    caseId,
    workspaceId: auth.ctx.workspaceId
  });
  if (!foundCase)
    return NextResponse.json({ error: 'Case not found' }, { status: 404 });

  try {
    const result = await db.$transaction(async (tx) => {
      const existing = await tx.caseArtifact.findFirst({
        where: { id: noteId, caseId, type: 'note' },
        select: { graphId: true }
      });
      if (existing?.graphId) await assertGraphEditable(tx, existing.graphId);
      return tx.caseArtifact.deleteMany({
        where: { id: noteId, caseId, type: 'note' }
      });
    });
    if (!result.count)
      return NextResponse.json({ error: 'Note not found' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    const blocked = graphWriteErrorResponse(error);
    if (blocked) return blocked;
    throw error;
  }
}

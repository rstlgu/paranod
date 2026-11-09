import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth-session';
import { db } from '@/lib/db';
import {
  assertGraphEditable,
  getGraphWriteState
} from '@/features/graph/server/graph-agent-lease';
import { graphWriteErrorResponse } from '@/features/graph/server/graph-write-response';

type RouteContext = {
  params: Promise<{ graphId: string }>;
};

const MAX_NOTE_LENGTH = 2_000_000;

async function requireOwnedGraph(graphId: string, userId: string) {
  return db.graph.findFirst({
    where: { id: graphId, userId },
    select: {
      id: true,
      name: true,
      caseId: true,
      notes: true,
      caseNote: {
        select: {
          id: true,
          caseId: true,
          name: true,
          content: true,
          graphId: true
        }
      }
    }
  });
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { graphId } = await context.params;
  const graph = await requireOwnedGraph(graphId, userId);
  if (!graph) {
    return NextResponse.json({ error: 'Graph not found' }, { status: 404 });
  }

  const snapshot = await db.$transaction(async (tx) => {
    const writeState = await getGraphWriteState(tx, graphId);
    const current = await tx.graph.findUniqueOrThrow({
      where: { id: graphId },
      select: {
        notes: true,
        caseNote: {
          select: {
            id: true,
            caseId: true,
            name: true,
            content: true,
            graphId: true
          }
        }
      }
    });
    return { ...current, writeState };
  });
  return NextResponse.json(
    {
      content: snapshot.caseNote?.content ?? snapshot.notes ?? '',
      caseNote: snapshot.caseNote,
      writeState: snapshot.writeState
    },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { graphId } = await context.params;
  const graph = await requireOwnedGraph(graphId, userId);
  if (!graph) {
    return NextResponse.json({ error: 'Graph not found' }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const content = body?.content;
  if (typeof content !== 'string') {
    return NextResponse.json(
      { error: 'Invalid note content' },
      { status: 400 }
    );
  }
  if (content.length > MAX_NOTE_LENGTH) {
    return NextResponse.json({ error: 'Note is too large' }, { status: 413 });
  }

  try {
    const updated = await db.$transaction(async (tx) => {
      await assertGraphEditable(tx, graphId, {
        snapshot: true,
        expectedWriteVersion: body.expectedWriteVersion
      });
      const current = await tx.graph.findUniqueOrThrow({
        where: { id: graphId },
        select: { caseNote: { select: { id: true } } }
      });
      const updated = await tx.graph.update({
        where: { id: graph.id },
        data: { notes: content || null },
        select: { notes: true, updatedAt: true }
      });
      if (current.caseNote)
        await tx.caseArtifact.update({
          where: { id: current.caseNote.id },
          data: { content }
        });
      return updated;
    });

    return NextResponse.json({
      content: updated.notes ?? '',
      updatedAt: updated.updatedAt,
      caseNote: graph.caseNote
    });
  } catch (error) {
    const blocked = graphWriteErrorResponse(error);
    if (blocked) return blocked;
    throw error;
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { graphId } = await context.params;
  const graph = await requireOwnedGraph(graphId, userId);
  if (!graph) {
    return NextResponse.json({ error: 'Graph not found' }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const content = body?.content;
  if (typeof content !== 'string') {
    return NextResponse.json(
      { error: 'Invalid note content' },
      { status: 400 }
    );
  }
  if (content.length > MAX_NOTE_LENGTH) {
    return NextResponse.json({ error: 'Note is too large' }, { status: 413 });
  }

  const plainText = content
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .trim();
  if (!plainText) {
    return NextResponse.json(
      { error: 'Write something before creating a case note' },
      { status: 400 }
    );
  }

  try {
    const note = await db.$transaction(async (tx) => {
      await assertGraphEditable(tx, graphId, {
        snapshot: true,
        expectedWriteVersion: body.expectedWriteVersion
      });
      const current = await tx.graph.findUniqueOrThrow({
        where: { id: graphId },
        select: { caseId: true, caseNote: { select: { id: true } } }
      });
      await tx.graph.update({
        where: { id: graph.id },
        data: { notes: content }
      });

      if (current.caseNote) {
        return tx.caseArtifact.update({
          where: { id: current.caseNote.id },
          data: { content },
          select: {
            id: true,
            caseId: true,
            name: true,
            content: true,
            graphId: true
          }
        });
      }

      return tx.caseArtifact.create({
        data: {
          caseId: current.caseId,
          graphId: graph.id,
          type: 'note',
          name: graph.name,
          content,
          metadata: JSON.stringify({ source: 'graph_notes' }),
          createdByUserId: userId
        },
        select: {
          id: true,
          caseId: true,
          name: true,
          content: true,
          graphId: true
        }
      });
    });

    return NextResponse.json({ note }, { status: graph.caseNote ? 200 : 201 });
  } catch (error) {
    const blocked = graphWriteErrorResponse(error);
    if (blocked) return blocked;
    throw error;
  }
}

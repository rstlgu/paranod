import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { assertGraphScopeEditable } from '@/features/graph/server/graph-agent-lease';
import { graphWriteErrorResponse } from '@/features/graph/server/graph-write-response';
import {
  requireActiveWorkspaceMember,
  safeJsonParseArray
} from '@/app/api/cases/_utils';

type RouteContext = {
  params: Promise<{ caseId: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const ctx = await requireActiveWorkspaceMember();
    if (!ctx.ok)
      return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    const { caseId } = await context.params;
    const found = await db.case.findFirst({
      where: { id: caseId, workspaceId: ctx.ctx.workspaceId },
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        tags: true,
        createdAt: true,
        updatedAt: true,
        lastOpenedAt: true,
        createdByUserId: true,
        _count: {
          select: {
            entities: true,
            targets: true,
            graphs: true,
            artifacts: true
          }
        }
      }
    });

    if (!found)
      return NextResponse.json({ error: 'Case not found' }, { status: 404 });

    const lastOpenedAt = new Date();
    await db.case.update({
      where: { id: caseId },
      data: { lastOpenedAt }
    });

    return NextResponse.json({
      case: {
        ...found,
        lastOpenedAt,
        tags: safeJsonParseArray(found.tags)
      }
    });
  } catch (error) {
    console.error('GET /api/cases/[caseId] error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch case' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const ctx = await requireActiveWorkspaceMember();
    if (!ctx.ok)
      return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    const { caseId } = await context.params;
    const existing = await db.case.findFirst({
      where: { id: caseId, workspaceId: ctx.ctx.workspaceId },
      select: {
        id: true,
        graphs: { select: { id: true } },
        artifacts: {
          where: { type: 'note' },
          select: { id: true }
        }
      }
    });
    if (!existing)
      return NextResponse.json({ error: 'Case not found' }, { status: 404 });

    const body = await request.json().catch(() => ({}));
    const updateData: Record<string, unknown> = {};

    if (typeof body?.name === 'string') updateData.name = body.name.trim();
    if (typeof body?.description === 'string')
      updateData.description = body.description.trim() || null;

    if (body?.status !== undefined) {
      updateData.status =
        body.status === 'closed' || body.status === 'archived'
          ? body.status
          : 'open';
    }

    if (body?.tags !== undefined) {
      const tags = Array.isArray(body.tags)
        ? body.tags
            .filter((t: unknown) => typeof t === 'string')
            .map((t: string) => t.trim())
            .filter(Boolean)
        : [];
      updateData.tags = JSON.stringify(tags);
    }

    const updated = await db.case.update({
      where: { id: caseId },
      data: { ...updateData, updatedAt: new Date() },
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        tags: true,
        createdAt: true,
        updatedAt: true
      }
    });

    return NextResponse.json({
      case: { ...updated, tags: safeJsonParseArray(updated.tags) }
    });
  } catch (error) {
    console.error('PATCH /api/cases/[caseId] error:', error);
    return NextResponse.json(
      { error: 'Failed to update case' },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const ctx = await requireActiveWorkspaceMember();
    if (!ctx.ok)
      return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    const { caseId } = await context.params;
    const existing = await db.case.findFirst({
      where: { id: caseId, workspaceId: ctx.ctx.workspaceId },
      select: {
        id: true,
        graphs: { select: { id: true } },
        artifacts: {
          where: { type: 'note' },
          select: { id: true }
        }
      }
    });
    if (!existing)
      return NextResponse.json({ error: 'Case not found' }, { status: 404 });

    await db.$transaction(async (tx) => {
      await assertGraphScopeEditable(tx, { caseId });
      await tx.case.delete({ where: { id: caseId } });
    });

    return NextResponse.json({
      success: true,
      deleted: {
        caseId,
        graphIds: existing.graphs.map((graph) => graph.id),
        noteIds: existing.artifacts.map((note) => note.id)
      }
    });
  } catch (error) {
    const blocked = graphWriteErrorResponse(error);
    if (blocked) return blocked;
    console.error('DELETE /api/cases/[caseId] error:', error);
    return NextResponse.json(
      { error: 'Failed to delete case' },
      { status: 500 }
    );
  }
}

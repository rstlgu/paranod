import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  requireActiveWorkspaceMember,
  requireCaseInWorkspace
} from '@/app/api/cases/_utils';

type RouteContext = {
  params: Promise<{ caseId: string }>;
};

function parseConfidence(value: unknown): 'low' | 'medium' | 'confirmed' {
  return value === 'low' || value === 'medium' || value === 'confirmed'
    ? value
    : 'confirmed';
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const auth = await requireActiveWorkspaceMember();
    if (!auth.ok)
      return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { caseId } = await context.params;
    const foundCase = await requireCaseInWorkspace({ caseId, workspaceId: auth.ctx.workspaceId });
    if (!foundCase) return NextResponse.json({ error: 'Case not found' }, { status: 404 });

    const targets = await db.caseTarget.findMany({
      where: { caseId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        color: true,
        confidence: true,
        createdAt: true,
        updatedAt: true,
        entity: { select: { id: true, type: true, value: true, label: true } }
      }
    });

    return NextResponse.json({ targets });
  } catch (error) {
    console.error('GET /api/cases/[caseId]/targets error:', error);
    return NextResponse.json({ error: 'Failed to fetch targets' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const auth = await requireActiveWorkspaceMember();
    if (!auth.ok)
      return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { caseId } = await context.params;
    const foundCase = await requireCaseInWorkspace({ caseId, workspaceId: auth.ctx.workspaceId });
    if (!foundCase) return NextResponse.json({ error: 'Case not found' }, { status: 404 });

    const body = await request.json().catch(() => ({}));

    const caseEntityId =
      typeof body?.caseEntityId === 'string' ? body.caseEntityId : null;

    if (!caseEntityId) {
      return NextResponse.json({ error: 'Missing caseEntityId' }, { status: 400 });
    }

    const entity = await db.caseEntity.findFirst({
      where: { id: caseEntityId, caseId },
      select: { id: true }
    });
    if (!entity)
      return NextResponse.json({ error: 'CaseEntity not found' }, { status: 404 });

    const created = await db.caseTarget.create({
      data: {
        caseId,
        caseEntityId,
        name: typeof body?.name === 'string' ? body.name.trim() || null : null,
        color: typeof body?.color === 'string' ? body.color.trim() || null : null,
        confidence: parseConfidence(body?.confidence),
        createdByUserId: auth.ctx.userId
      },
      select: {
        id: true,
        name: true,
        color: true,
        confidence: true,
        createdAt: true,
        updatedAt: true,
        entity: { select: { id: true, type: true, value: true, label: true } }
      }
    });

    // auto-link the entity to its own target
    await db.caseTargetEntityLink.createMany({
      data: [
        {
          targetId: created.id,
          caseEntityId,
          createdByUserId: auth.ctx.userId
        }
      ],
      skipDuplicates: true
    });

    return NextResponse.json({ target: created }, { status: 201 });
  } catch (error) {
    console.error('POST /api/cases/[caseId]/targets error:', error);
    return NextResponse.json({ error: 'Failed to create target' }, { status: 500 });
  }
}

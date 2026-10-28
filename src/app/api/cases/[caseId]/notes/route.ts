import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  requireActiveWorkspaceMember,
  requireCaseInWorkspace
} from '@/app/api/cases/_utils';

type RouteContext = { params: Promise<{ caseId: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await requireActiveWorkspaceMember();
  if (!auth.ok)
    return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { caseId } = await context.params;
  const foundCase = await requireCaseInWorkspace({
    caseId,
    workspaceId: auth.ctx.workspaceId
  });
  if (!foundCase)
    return NextResponse.json({ error: 'Case not found' }, { status: 404 });

  const notes = await db.caseArtifact.findMany({
    where: { caseId, type: 'note' },
    orderBy: [
      { lastOpenedAt: { sort: 'desc', nulls: 'last' } },
      { updatedAt: 'desc' }
    ],
    select: {
      id: true,
      graphId: true,
      name: true,
      content: true,
      createdAt: true,
      updatedAt: true,
      lastOpenedAt: true,
      createdByUserId: true
    }
  });
  return NextResponse.json(
    { notes },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
}

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireActiveWorkspaceMember();
  if (!auth.ok)
    return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { caseId } = await context.params;
  const foundCase = await requireCaseInWorkspace({
    caseId,
    workspaceId: auth.ctx.workspaceId
  });
  if (!foundCase)
    return NextResponse.json({ error: 'Case not found' }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const content = typeof body?.content === 'string' ? body.content.trim() : '';
  if (!name || !content) {
    return NextResponse.json(
      { error: 'Title and content are required' },
      { status: 400 }
    );
  }

  const note = await db.caseArtifact.create({
    data: {
      caseId,
      type: 'note',
      name,
      content,
      createdByUserId: auth.ctx.userId
    }
  });
  return NextResponse.json({ note }, { status: 201 });
}

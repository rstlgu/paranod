import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  requireActiveWorkspaceMember,
  requireCaseInWorkspace
} from '@/app/api/cases/_utils';

type RouteContext = {
  params: Promise<{ caseId: string; targetId: string }>;
};

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const auth = await requireActiveWorkspaceMember();
    if (!auth.ok)
      return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { caseId, targetId } = await context.params;
    const foundCase = await requireCaseInWorkspace({ caseId, workspaceId: auth.ctx.workspaceId });
    if (!foundCase) return NextResponse.json({ error: 'Case not found' }, { status: 404 });

    const target = await db.caseTarget.findFirst({
      where: { id: targetId, caseId },
      select: { id: true }
    });
    if (!target) return NextResponse.json({ error: 'Target not found' }, { status: 404 });

    // deleting target removes links but keeps the underlying entity
    await db.caseTarget.delete({ where: { id: targetId } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/cases/[caseId]/targets/[targetId] error:', error);
    return NextResponse.json({ error: 'Failed to delete target' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  requireActiveWorkspaceMember,
  requireCaseInWorkspace
} from '@/app/api/cases/_utils';

type RouteContext = {
  params: Promise<{ caseId: string }>;
};

function parseTargetIdFromUrl(request: NextRequest): string | null {
  try {
    const url = new URL(request.url);
    const targetId = url.searchParams.get('targetId');
    return targetId && targetId.trim() ? targetId.trim() : null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const auth = await requireActiveWorkspaceMember();
    if (!auth.ok)
      return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { caseId } = await context.params;
    const foundCase = await requireCaseInWorkspace({ caseId, workspaceId: auth.ctx.workspaceId });
    if (!foundCase) return NextResponse.json({ error: 'Case not found' }, { status: 404 });

    const targetId = parseTargetIdFromUrl(request);
    if (targetId) {
      const target = await db.caseTarget.findFirst({
        where: { id: targetId, caseId },
        select: { id: true }
      });
      if (!target)
        return NextResponse.json({ error: 'Target not found' }, { status: 404 });

      const links = await db.caseTargetEntityLink.findMany({
        where: { targetId },
        orderBy: { createdAt: 'desc' },
        select: {
          entity: {
            select: {
              id: true,
              type: true,
              value: true,
              normalizedValue: true,
              label: true,
              confidence: true,
              firstSeenAt: true,
              lastSeenAt: true,
              seenCount: true
            }
          }
        }
      });

      return NextResponse.json({
        entities: links.map((l) => l.entity)
      });
    }

    const entities = await db.caseEntity.findMany({
      where: { caseId },
      orderBy: { lastSeenAt: 'desc' },
      select: {
        id: true,
        type: true,
        value: true,
        normalizedValue: true,
        label: true,
        confidence: true,
        firstSeenAt: true,
        lastSeenAt: true,
        seenCount: true
      }
    });

    return NextResponse.json({ entities });
  } catch (error) {
    console.error('GET /api/cases/[caseId]/entities error:', error);
    return NextResponse.json({ error: 'Failed to fetch entities' }, { status: 500 });
  }
}

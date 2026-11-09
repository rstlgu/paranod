import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  requireActiveWorkspaceMember,
  safeJsonParseArray
} from '@/app/api/cases/_utils';

function parsePositiveInt(value: string | null, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(100, Math.floor(n)));
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireActiveWorkspaceMember();
    if (!ctx.ok)
      return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    const searchParams = request.nextUrl.searchParams;
    const qRaw = searchParams.get('q');
    const q = typeof qRaw === 'string' ? qRaw.trim() : '';
    const cursor = searchParams.get('cursor');
    const hasCursorParam = typeof cursor === 'string' && cursor.length > 0;
    const hasLimitParam = searchParams.has('limit');

    // Back-compat: se non vengono passati parametri, restituiamo la lista completa come prima.
    if (!hasLimitParam && !hasCursorParam && !q) {
      const cases = await db.case.findMany({
        where: { workspaceId: ctx.ctx.workspaceId },
        orderBy: { updatedAt: 'desc' },
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
              graphs: true,
              targets: true,
              artifacts: { where: { type: 'note' } }
            }
          }
        }
      });

      return NextResponse.json({
        cases: cases.map((c) => ({
          ...c,
          tags: safeJsonParseArray(c.tags),
          _count: {
            graphs: c._count.graphs,
            targets: c._count.targets,
            notes: c._count.artifacts
          }
        }))
      });
    }

    const limit = parsePositiveInt(searchParams.get('limit'), 4);

    const page = await db.case.findMany({
      where: {
        workspaceId: ctx.ctx.workspaceId,
        status: { not: 'archived' },
        ...(q ? { name: { contains: q, mode: 'insensitive' } } : {})
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: limit,
      ...(hasCursorParam ? { cursor: { id: cursor as string }, skip: 1 } : {}),
      select: {
        id: true,
        name: true,
        updatedAt: true,
        lastOpenedAt: true
      }
    });

    const nextCursor = page.length === limit ? page[page.length - 1].id : null;

    return NextResponse.json({
      cases: page,
      nextCursor
    });
  } catch (error) {
    console.error('GET /api/cases error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch cases' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireActiveWorkspaceMember();
    if (!ctx.ok)
      return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    const body = await request.json().catch(() => ({}));
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const description =
      typeof body?.description === 'string' ? body.description.trim() : '';

    if (!name || name.length < 2) {
      return NextResponse.json(
        { error: 'Name must be at least 2 characters' },
        { status: 400 }
      );
    }

    const status =
      body?.status === 'closed' || body?.status === 'archived'
        ? body.status
        : 'open';

    const tags = Array.isArray(body?.tags)
      ? body.tags
          .filter((t: unknown) => typeof t === 'string')
          .map((t: string) => t.trim())
          .filter(Boolean)
      : [];

    const created = await db.case.create({
      data: {
        workspaceId: ctx.ctx.workspaceId,
        createdByUserId: ctx.ctx.userId,
        name,
        description: description || null,
        status,
        tags: JSON.stringify(tags)
      },
      select: {
        id: true,
        name: true,
        status: true,
        tags: true,
        createdAt: true,
        updatedAt: true
      }
    });

    return NextResponse.json(
      { case: { ...created, tags: safeJsonParseArray(created.tags) } },
      { status: 201 }
    );
  } catch (error) {
    console.error('POST /api/cases error:', error);
    return NextResponse.json(
      { error: 'Failed to create case' },
      { status: 500 }
    );
  }
}

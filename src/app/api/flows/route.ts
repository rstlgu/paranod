/**
 * API Routes per la gestione dei flows (workspace-scoped)
 * GET /api/flows - Lista flows dell'workspace attiva
 * POST /api/flows - Crea nuovo flow
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireActiveWorkspaceMember } from '@/app/api/cases/_utils';
import { createFlowGuideNoteNode } from '@/features/flow/lib/flow-guide-note';

export const runtime = 'nodejs';

// NOTE:
// In some environments Prisma Client types may not include all delegates during Next build,
// even though runtime works. Access delegate via a narrow cast to avoid build failures.
const flow = (db as any).flow as {
  findMany: (args: unknown) => Promise<any[]>;
  create: (args: unknown) => Promise<any>;
};

// GET - Lista flows dell'workspace
export async function GET() {
  try {
    const ctx = await requireActiveWorkspaceMember();
    if (!ctx.ok)
      return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    const flows = await flow.findMany({
      where: { workspaceId: ctx.ctx.workspaceId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        description: true,
        nodes: true,
        nodeCount: true,
        edgeCount: true,
        thumbnail: true,
        createdAt: true,
        updatedAt: true,
        lastOpenedAt: true,
        createdByUserId: true,
        workspaceId: true
      }
    });

    // Match flows to graph entity types without returning full node data.
    const list = flows.map(({ nodes, ...rest }) => {
      const nodeList = Array.isArray(nodes)
        ? (nodes as Array<Record<string, any>>)
        : [];
      return {
        ...rest,
        triggerTypes: Array.isArray(nodes)
          ? Array.from(
              new Set(
                nodeList
                  .filter((n) => String(n?.type ?? '') === 'trigger')
                  .map((n) => String(n?.data?.nodeType ?? ''))
                  .filter(Boolean)
              )
            )
          : []
      };
    });

    return NextResponse.json({ flows: list });
  } catch {
    return NextResponse.json(
      { error: 'Failed to fetch flows' },
      { status: 500 }
    );
  }
}

// POST - Crea nuovo flow
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireActiveWorkspaceMember();
    if (!ctx.ok)
      return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    const body = await request.json().catch(() => ({}));
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const description =
      typeof body?.description === 'string' ? body.description.trim() : '';

    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    const guideNote = createFlowGuideNoteNode();
    const created = await flow.create({
      data: {
        workspaceId: ctx.ctx.workspaceId,
        createdByUserId: ctx.ctx.userId,
        name,
        description: description || null,
        nodes: [guideNote],
        edges: [],
        nodeCount: 0,
        edgeCount: 0
      }
    });

    return NextResponse.json({ flow: created }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: 'Failed to create flow' },
      { status: 500 }
    );
  }
}

/**
 * API Routes per singolo flow (workspace-scoped)
 * GET /api/flows/[flowId] - Dettagli flow
 * PUT /api/flows/[flowId] - Aggiorna flow
 * DELETE /api/flows/[flowId] - Elimina flow
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireActiveWorkspaceMember } from '@/app/api/cases/_utils';

type RouteContext = {
  params: Promise<{ flowId: string }>;
};

export const runtime = 'nodejs';

// NOTE:
// In some environments Prisma Client types may not include all delegates during Next build,
// even though runtime works. Access delegate via a narrow cast to avoid build failures.
const flow = (db as any).flow as {
  findFirst: (args: unknown) => Promise<any | null>;
  update: (args: unknown) => Promise<any>;
  delete: (args: unknown) => Promise<any>;
};

// GET - Dettagli flow con nodi e edges
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const ctx = await requireActiveWorkspaceMember();
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    const { flowId } = await context.params;
    const record = await flow.findFirst({
      where: { id: flowId, workspaceId: ctx.ctx.workspaceId }
    });

    if (!record) return NextResponse.json({ error: 'Flow not found' }, { status: 404 });

    await flow.update({
      where: { id: flowId },
      data: { lastOpenedAt: new Date() }
    });

    return NextResponse.json({
      flow: {
        ...record,
        nodes: record.nodes,
        edges: record.edges
      }
    });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch flow' }, { status: 500 });
  }
}

// PUT - Aggiorna flow (nome, descrizione, nodi, edges)
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const ctx = await requireActiveWorkspaceMember();
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    const { flowId } = await context.params;
    const existing = await flow.findFirst({
      where: { id: flowId, workspaceId: ctx.ctx.workspaceId },
      select: { id: true }
    });
    if (!existing) return NextResponse.json({ error: 'Flow not found' }, { status: 404 });

    const body = await request.json().catch(() => ({}));
    const { name, description, nodes, edges, thumbnail } = body as Record<string, unknown>;

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = String(name).trim();
    if (description !== undefined)
      updateData.description = String(description ?? '').trim() || null;
    if (nodes !== undefined) {
      if (Array.isArray(nodes)) {
        const triggerCount = nodes.filter(
          (n) => String((n as Record<string, unknown> | null)?.type ?? '') === 'trigger'
        ).length;
        if (triggerCount > 1) {
          return NextResponse.json(
            { error: 'Flow can have at most one trigger node.' },
            { status: 400 }
          );
        }
      }
      updateData.nodes = nodes;
      updateData.nodeCount = Array.isArray(nodes)
        ? nodes.filter((node) =>
            ['trigger', 'transform'].includes(
              String((node as Record<string, unknown> | null)?.type ?? '')
            )
          ).length
        : 0;
    }
    if (edges !== undefined) {
      updateData.edges = edges;
      updateData.edgeCount = Array.isArray(edges) ? edges.length : 0;
    }
    if (thumbnail !== undefined) updateData.thumbnail = thumbnail;
    updateData.updatedAt = new Date();

    const updated = await flow.update({
      where: { id: flowId },
      data: updateData
    });

    return NextResponse.json({
      flow: {
        ...updated,
        nodes: updated.nodes,
        edges: updated.edges
      }
    });
  } catch {
    return NextResponse.json({ error: 'Failed to update flow' }, { status: 500 });
  }
}

// DELETE - Elimina flow
export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const ctx = await requireActiveWorkspaceMember();
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    const { flowId } = await context.params;
    const existing = await flow.findFirst({
      where: { id: flowId, workspaceId: ctx.ctx.workspaceId },
      select: { id: true }
    });
    if (!existing) return NextResponse.json({ error: 'Flow not found' }, { status: 404 });

    await flow.delete({ where: { id: flowId } });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Failed to delete flow' }, { status: 500 });
  }
}

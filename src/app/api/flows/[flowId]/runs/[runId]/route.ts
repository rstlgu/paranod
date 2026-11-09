/**
 * FlowRun update
 * PATCH /api/flows/[flowId]/runs/[runId] - Aggiorna stato/risultato di un run
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireActiveWorkspaceMember } from '@/app/api/cases/_utils';

export const runtime = 'nodejs';

const flowRun = (db as any).flowRun as {
  findFirst: (args: unknown) => Promise<any | null>;
  update: (args: unknown) => Promise<any>;
};

type RouteContext = { params: Promise<{ flowId: string; runId: string }> };

const VALID_STATUSES = ['RUNNING', 'COMPLETED', 'FAILED'];

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const ctx = await requireActiveWorkspaceMember();
    if (!ctx.ok)
      return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    const { flowId, runId } = await context.params;
    const existing = await flowRun.findFirst({
      where: { id: runId, flowId, workspaceId: ctx.ctx.workspaceId },
      select: { id: true }
    });
    if (!existing)
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });

    const body = await request.json().catch(() => ({}));
    const updateData: Record<string, unknown> = {};

    if (typeof body?.status === 'string') {
      const status = body.status.toUpperCase();
      if (!VALID_STATUSES.includes(status)) {
        return NextResponse.json(
          { error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` },
          { status: 400 }
        );
      }
      updateData.status = status;
      if (status !== 'RUNNING') updateData.completedAt = new Date();
    }
    if (Array.isArray(body?.steps)) updateData.steps = body.steps;
    if (typeof body?.entityCount === 'number')
      updateData.entityCount = Math.max(0, Math.floor(body.entityCount));
    if (body?.error !== undefined)
      updateData.error = body.error ? String(body.error) : null;

    const updated = await flowRun.update({
      where: { id: runId },
      data: updateData,
      select: { id: true, status: true }
    });

    return NextResponse.json({ run: updated });
  } catch {
    return NextResponse.json(
      { error: 'Failed to update flow run' },
      { status: 500 }
    );
  }
}

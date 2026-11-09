/**
 * FlowRun API (workspace-scoped)
 * GET  /api/flows/[flowId]/runs - History esecuzioni (ultime 30)
 * POST /api/flows/[flowId]/runs - Registra inizio esecuzione
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireActiveWorkspaceMember } from '@/app/api/cases/_utils';
import {
  getHistoryCutoff,
  purgeExpiredFlowRuns
} from '@/lib/history-retention';

export const runtime = 'nodejs';

// Delegate via narrow cast (parity con le altre route: i tipi Prisma possono
// non essere idratati in build, il runtime funziona).
const flowRun = (db as any).flowRun as {
  findMany: (args: unknown) => Promise<any[]>;
  create: (args: unknown) => Promise<any>;
};
const flow = (db as any).flow as {
  findFirst: (args: unknown) => Promise<any | null>;
};

type RouteContext = { params: Promise<{ flowId: string }> };

async function assertFlowInWorkspace(flowId: string, workspaceId: string) {
  return flow.findFirst({
    where: { id: flowId, workspaceId: workspaceId },
    select: { id: true }
  });
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const ctx = await requireActiveWorkspaceMember();
    if (!ctx.ok)
      return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    const { flowId } = await context.params;
    if (!(await assertFlowInWorkspace(flowId, ctx.ctx.workspaceId)))
      return NextResponse.json({ error: 'Flow not found' }, { status: 404 });

    // Apply the optional retention configured by the instance administrator.
    const cutoff = getHistoryCutoff();
    await purgeExpiredFlowRuns(ctx.ctx.workspaceId);

    const runs = await flowRun.findMany({
      where: {
        flowId,
        workspaceId: ctx.ctx.workspaceId,
        ...(cutoff
          ? { OR: [{ startedAt: { gte: cutoff } }, { status: 'RUNNING' }] }
          : {})
      },
      orderBy: { startedAt: 'desc' },
      take: 30,
      select: {
        id: true,
        kind: true,
        status: true,
        inputType: true,
        inputValue: true,
        graphId: true,
        steps: true,
        entityCount: true,
        error: true,
        startedAt: true,
        completedAt: true
      }
    });

    return NextResponse.json({ runs });
  } catch {
    return NextResponse.json(
      { error: 'Failed to fetch flow runs' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const ctx = await requireActiveWorkspaceMember();
    if (!ctx.ok)
      return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    const { flowId } = await context.params;
    if (!(await assertFlowInWorkspace(flowId, ctx.ctx.workspaceId)))
      return NextResponse.json({ error: 'Flow not found' }, { status: 404 });

    const body = await request.json().catch(() => ({}));
    const kind = body?.kind === 'test' ? 'test' : 'run';
    const inputType = typeof body?.inputType === 'string' ? body.inputType : '';
    const inputValue =
      typeof body?.inputValue === 'string' ? body.inputValue : '';
    const graphId = typeof body?.graphId === 'string' ? body.graphId : null;

    if (!inputType || !inputValue) {
      return NextResponse.json(
        { error: 'inputType and inputValue are required' },
        { status: 400 }
      );
    }

    const created = await flowRun.create({
      data: {
        workspaceId: ctx.ctx.workspaceId,
        flowId,
        createdByUserId: ctx.ctx.userId,
        kind,
        status: 'RUNNING',
        inputType,
        inputValue,
        graphId
      },
      select: { id: true }
    });

    return NextResponse.json({ run: created }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: 'Failed to create flow run' },
      { status: 500 }
    );
  }
}

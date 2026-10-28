import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { auth } from '@/lib/auth-session';
import { getActiveWorkspaceId } from '@/lib/auth-utils';
import { executeContainerTool } from '@/lib/container-tools/execute-container-tool';
import { manualTransformGraphError } from '@/features/graph/server/manual-transform-guard';

export const runtime = 'nodejs';

const bodySchema = z.object({
  graphId: z.string().min(1).max(160).optional(),
  input: z.object({
    entity: z.object({
      id: z.string().min(1),
      type: z.string().min(1),
      value: z
        .string()
        .min(1)
        .max(254)
        .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.+@-]*$/),
      metadata: z.record(z.string(), z.unknown()).optional()
    }),
    config: z.record(z.string(), z.unknown()).optional()
  })
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ toolId: string }> }
) {
  try {
    const { userId } = await auth();
    const workspaceId = await getActiveWorkspaceId();
    if (!userId || !workspaceId)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { toolId } = await params;
    const setting = await db.workspacePluginSetting.findUnique({
      where: { workspaceId_pluginId: { workspaceId, pluginId: toolId } },
      select: { enabled: true }
    });
    if (setting?.enabled === false)
      return NextResponse.json(
        { error: 'Plugin is disabled' },
        { status: 403 }
      );
    const json = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success)
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    const graphError = await manualTransformGraphError(parsed.data.graphId, {
      userId,
      workspaceId
    });
    if (graphError) return graphError;

    const result = await executeContainerTool({
      toolId,
      input: parsed.data.input as any
    });

    if (!result.success)
      return NextResponse.json(
        { success: false, data: result, error: result.error },
        { status: 400 }
      );

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

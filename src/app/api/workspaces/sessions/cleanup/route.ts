import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth-session';
import { getActiveWorkspaceId } from '@/lib/auth-utils';
import { cleanupWorkspaceSessionsForUser } from '@/lib/workspaces/workspace-session-service';

export const runtime = 'nodejs';

const bodySchema = z.object({
  keepSessionIds: z.array(z.string().min(1)).max(50).optional(),
  confirmNoTabs: z.boolean().optional()
});

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    const workspaceId = await getActiveWorkspaceId();
    if (!userId || !workspaceId)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const json = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success)
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });

    const keepSessionIds = parsed.data.keepSessionIds ?? [];
    const confirmNoTabs = parsed.data.confirmNoTabs ?? false;
    const result = await cleanupWorkspaceSessionsForUser({
      workspaceId,
      userId,
      keepSessionIds,
      confirmNoTabs
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

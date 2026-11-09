import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth-session';
import { getActiveWorkspaceId } from '@/lib/auth-utils';
import {
  createWorkspaceSession,
  listActiveWorkspaceSessions
} from '@/lib/workspaces/workspace-session-service';

export const runtime = 'nodejs';

function getPublicOrigin(request: NextRequest) {
  const proto =
    request.headers.get('x-forwarded-proto') ??
    new URL(request.url).protocol.replace(':', '') ??
    'http';
  const host =
    request.headers.get('x-forwarded-host') ??
    request.headers.get('host') ??
    new URL(request.url).host;
  return `${proto}://${host}`;
}

const createSchema = z.object({
  url: z.string().min(1),
  browser: z.enum(['chrome', 'tor']).optional()
});

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    const workspaceId = await getActiveWorkspaceId();
    if (!userId || !workspaceId)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const json = await request.json().catch(() => null);
    const parsed = createSchema.safeParse(json);
    if (!parsed.success)
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });

    const session = await createWorkspaceSession({
      workspaceId,
      createdByUserId: userId,
      browser: parsed.data.browser ?? 'chrome',
      targetUrl: parsed.data.url,
      requestOrigin: getPublicOrigin(request)
    });

    return NextResponse.json({ success: true, data: session });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth();
    const workspaceId = await getActiveWorkspaceId();
    if (!userId || !workspaceId)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const sessions = await listActiveWorkspaceSessions({
      workspaceId,
      requestOrigin: getPublicOrigin(request)
    });

    return NextResponse.json({ success: true, data: sessions });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

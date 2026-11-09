import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth-session';
import { getActiveWorkspaceId } from '@/lib/auth-utils';
import {
  getWorkspaceSessionById,
  stopWorkspaceSessionForUser
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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { userId } = await auth();
    const workspaceId = await getActiveWorkspaceId();
    if (!userId || !workspaceId)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { sessionId } = await params;
    const session = await getWorkspaceSessionById({
      workspaceId,
      sessionId,
      requestOrigin: getPublicOrigin(request)
    });

    if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true, data: session });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { userId } = await auth();
    const workspaceId = await getActiveWorkspaceId();
    if (!userId || !workspaceId)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { sessionId } = await params;
    const ok = await stopWorkspaceSessionForUser({ workspaceId, userId, sessionId });
    if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

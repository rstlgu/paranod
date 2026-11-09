import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { auth } from '@/lib/auth-session';
import { getActiveWorkspaceId } from '@/lib/auth-utils';
import { getWorkspaceSessionById } from '@/lib/workspaces/workspace-session-service';

export const runtime = 'nodejs';

async function getPublicOrigin() {
  const h = await headers();
  const proto = h.get('x-forwarded-proto') ?? 'http';
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost';
  return `${proto}://${host}`;
}

function buildClientUrl(args: { baseUrl: string; sessionId: string }) {
  const u = new URL(args.baseUrl);
  u.pathname = u.pathname.endsWith('/') ? u.pathname : `${u.pathname}/`;
  u.searchParams.set('resize', 'remote');
  u.searchParams.set('path', `w/${args.sessionId}/websockify`);
  u.searchParams.set('t', String(Date.now()));
  return u.toString();
}

export default async function Page({
  params
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { userId } = await auth();
  const workspaceId = await getActiveWorkspaceId();
  if (!userId || !workspaceId) return notFound();

  const { sessionId } = await params;
  const session = await getWorkspaceSessionById({
    workspaceId,
    sessionId,
    requestOrigin: await getPublicOrigin()
  });

  if (!session?.streamUrl) return notFound();

  const iframeSrc = buildClientUrl({ baseUrl: session.streamUrl, sessionId: session.id });

  return (
    <iframe
      title={`workspace-popout-${session.id}`}
      src={iframeSrc}
      className='h-full w-full bg-black'
      scrolling='no'
      allow='clipboard-read; clipboard-write'
      style={{ border: 0 }}
    />
  );
}

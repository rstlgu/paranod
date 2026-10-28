import { NextResponse } from 'next/server';

export function agentMutationOriginError(request: Request) {
  const origin = request.headers.get('origin');
  const allowed = [
    request.url,
    process.env.BETTER_AUTH_URL,
    process.env.APP_URL
  ].flatMap((value) => {
    try {
      return value ? [new URL(value).origin] : [];
    } catch {
      return [];
    }
  });
  if (
    request.headers.get('sec-fetch-site') === 'cross-site' ||
    (origin && !allowed.includes(origin))
  )
    return NextResponse.json(
      { error: 'agent_origin_not_allowed' },
      {
        status: 403,
        headers: { 'Cache-Control': 'private, no-store' }
      }
    );
  return null;
}

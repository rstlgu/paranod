import { toNextJsHandler } from 'better-auth/next-js';
import { authService } from '@/lib/auth';
import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';

const handlers = toNextJsHandler(authService);

function isInternalAdministration(request: NextRequest) {
  return request.nextUrl.pathname.startsWith('/api/auth/admin/');
}

export async function GET(request: NextRequest) {
  if (isInternalAdministration(request)) {
    return NextResponse.json(
      { error: 'Use workspace administration' },
      { status: 403 }
    );
  }
  return handlers.GET(request);
}

export async function POST(request: NextRequest) {
  // The application invokes administrative methods server-side after enforcing
  // workspace membership, last-administrator and session-revocation rules.
  if (isInternalAdministration(request)) {
    return NextResponse.json(
      { error: 'Use workspace administration' },
      { status: 403 }
    );
  }
  const isPublicSignup = request.nextUrl.pathname.endsWith('/sign-up/email');

  if (isPublicSignup && (await db.user.count()) > 0) {
    return NextResponse.json(
      { error: 'Users must be created by an administrator' },
      { status: 403 }
    );
  }

  return handlers.POST(request);
}

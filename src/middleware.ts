import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_PAGE_PREFIXES = [
  '/setup',
  '/sign-in',
  '/sign-up',
  '/auth/sign-in',
  '/auth/sign-up',
  '/terms',
  '/privacy'
];

function isPublicPage(pathname: string): boolean {
  return PUBLIC_PAGE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

function hasSessionCookie(request: NextRequest): boolean {
  return Boolean(
    request.cookies.get('better-auth.session_token') ||
      request.cookies.get('__Secure-better-auth.session_token')
  );
}

export default function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (pathname.startsWith('/api') || pathname.startsWith('/_')) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/temp/')) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (pathname.startsWith('/auth/sign-in')) {
    const target = request.nextUrl.clone();
    target.pathname = target.pathname.replace(/^\/auth\/sign-in/, '/sign-in');
    return NextResponse.redirect(target);
  }

  if (pathname.startsWith('/auth/sign-up')) {
    const target = request.nextUrl.clone();
    target.pathname = target.pathname.replace(/^\/auth\/sign-up/, '/sign-up');
    return NextResponse.redirect(target);
  }

  if (!isPublicPage(pathname) && !hasSessionCookie(request)) {
    const target = request.nextUrl.clone();
    target.pathname = '/sign-in';
    target.search = '';
    target.searchParams.set('redirect_url', pathname + search);
    return NextResponse.redirect(target);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next|.*\\..*).*)', '/', '/(api|trpc)(.*)', '/temp(.*)']
};

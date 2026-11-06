import { NextResponse, type NextRequest } from 'next/server';
import { AUTH_COOKIE, authToken, safeEqual } from './src/shared/auth';

/** Password gate: every page and API route except the unlock screen needs the cookie. */
export async function proxy(request: NextRequest) {
  const cookie = request.cookies.get(AUTH_COOKIE)?.value;
  if (cookie && safeEqual(cookie, await authToken())) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'locked' }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = '/unlock';
  url.search = '';
  if (pathname !== '/' || search) url.searchParams.set('next', pathname + search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!unlock|api/unlock|_next/static|_next/image|favicon.ico|icon.svg|robots.txt|healthz).*)'],
};

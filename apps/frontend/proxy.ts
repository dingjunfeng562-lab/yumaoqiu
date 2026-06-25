import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { auth } from '@/auth';

function isAdminRole(role?: string | null) {
  return role === 'ADMIN' || role === 'SUPER_ADMIN' || role === 'ROOT';
}

function destinationForRole(role?: string | null) {
  if (role === 'REFEREE') return '/referee/my-matches';
  if (isAdminRole(role)) return '/admin';
  if (role === 'PLAYER') return '/my-registrations';
  return '/';
}

function loginRedirect(req: NextRequest) {
  const url = new URL('/login', req.url);
  url.searchParams.set('redirect', `${req.nextUrl.pathname}${req.nextUrl.search}`);
  const res = NextResponse.redirect(url);
  res.cookies.delete('authjs.session-token');
  res.cookies.delete('__Secure-authjs.session-token');
  return res;
}

export default async function proxy(req: NextRequest) {
  const session = await auth();
  const hasInvalidSession = session?.authError === 'RefreshAccessTokenError';
  const isLoggedIn = !!session && !hasInvalidSession;
  const isAdminRoute = req.nextUrl.pathname.startsWith('/admin');
  const isRefereeRoute = req.nextUrl.pathname.startsWith('/referee');
  const isMyRegistrationsRoute = req.nextUrl.pathname.startsWith('/my-registrations');
  const isRegisterRoute = /\/competitions\/[^/]+\/register$/.test(req.nextUrl.pathname);
  const isLoginPage = req.nextUrl.pathname === '/login';

  if (
    (isAdminRoute || isRefereeRoute || isRegisterRoute || isMyRegistrationsRoute) &&
    (!isLoggedIn || hasInvalidSession)
  ) {
    return loginRedirect(req);
  }
  if (isAdminRoute && !isAdminRole(session?.user?.role)) {
    return NextResponse.redirect(new URL('/forbidden', req.url));
  }
  if (isRefereeRoute && session?.user?.role !== 'REFEREE') {
    return NextResponse.redirect(new URL('/forbidden', req.url));
  }
  if (isRegisterRoute && session?.user?.role !== 'PLAYER') {
    return NextResponse.redirect(new URL('/forbidden', req.url));
  }
  if (isMyRegistrationsRoute && session?.user?.role !== 'PLAYER') {
    return NextResponse.redirect(new URL('/forbidden', req.url));
  }
  if (isLoginPage && isLoggedIn && !hasInvalidSession) {
    return NextResponse.redirect(new URL(destinationForRole(session?.user?.role), req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/admin/:path*',
    '/referee/:path*',
    '/my-registrations/:path*',
    '/competitions/:path*/register',
    '/login',
  ],
};

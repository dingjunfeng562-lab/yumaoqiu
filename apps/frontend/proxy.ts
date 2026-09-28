import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { firstAdminPage } from '@/lib/admin-permissions';

function canSubmitRegistration(role?: string | null) {
  return role === 'PLAYER' || role === 'ROOT';
}

function destinationForRole(role?: string | null, permissions?: string[]) {
  const adminPage = firstAdminPage(role ?? undefined, permissions);
  if (adminPage) return adminPage;
  if (role === 'REFEREE') return '/referee/my-matches';
  if (role === 'PLAYER') return '/my-registrations';
  return '/';
}

const authSessionCookieNames = [
  'authjs.session-token',
  '__Secure-authjs.session-token',
  '__Host-authjs.session-token',
  'next-auth.session-token',
  '__Secure-next-auth.session-token',
];

function isAuthSessionCookieName(name: string) {
  return authSessionCookieNames.some((cookieName) => name === cookieName || name.startsWith(`${cookieName}.`));
}

function clearAuthSessionCookies(req: NextRequest, res: NextResponse) {
  const names = new Set(authSessionCookieNames);
  for (const cookie of req.cookies.getAll()) {
    if (isAuthSessionCookieName(cookie.name)) names.add(cookie.name);
  }
  for (const name of names) {
    res.cookies.delete(name);
  }
}

function loginRedirect(req: NextRequest) {
  const url = new URL('/login', req.url);
  url.searchParams.set('redirect', `${req.nextUrl.pathname}${req.nextUrl.search}`);
  const res = NextResponse.redirect(url);
  clearAuthSessionCookies(req, res);
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
  if (isLoginPage && isLoggedIn && !hasInvalidSession) {
    return NextResponse.redirect(new URL(destinationForRole(session?.user?.role, session?.user?.permissions), req.url));
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

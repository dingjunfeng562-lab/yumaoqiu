import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { auth } from '@/auth';

export default async function proxy(req: NextRequest) {
  const session = await auth();
  const isLoggedIn = !!session;
  const isAdminRoute = req.nextUrl.pathname.startsWith('/admin');
  const isRefereeRoute = req.nextUrl.pathname.startsWith('/referee');
  const isLoginPage = req.nextUrl.pathname === '/login';

  if ((isAdminRoute || isRefereeRoute) && !isLoggedIn) {
    return NextResponse.redirect(new URL('/login', req.url));
  }
  if (isAdminRoute && session?.user?.role === 'REFEREE') {
    return NextResponse.redirect(new URL('/referee', req.url));
  }
  if (isRefereeRoute && session?.user?.role !== 'REFEREE') {
    return NextResponse.redirect(new URL('/admin', req.url));
  }
  if (isLoginPage && isLoggedIn) {
    return NextResponse.redirect(new URL('/admin', req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/referee/:path*', '/login'],
};

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import type { Session } from 'next-auth';
import { auth } from '@/auth';
import { firstAdminPage } from '@/lib/admin-permissions';
import {
  MAINTENANCE_VIEW_HEADER,
  canEnterDuringMaintenance,
  fetchMaintenanceStatus,
  serverApiBase,
} from '@/lib/maintenance';

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

// 全服维护状态只缓存很短时间：维护开关切换后，最多几秒全站生效。
const MAINTENANCE_CACHE_MS = 3_000;
let maintenanceCache: { enabled: boolean; at: number } | null = null;
let maintenanceLoading: Promise<boolean> | null = null;

async function maintenanceEnabled() {
  if (maintenanceCache && Date.now() - maintenanceCache.at < MAINTENANCE_CACHE_MS) return maintenanceCache.enabled;
  maintenanceLoading ??= fetchMaintenanceStatus(serverApiBase(), 1500)
    .then((status) => {
      // 后端暂时连不上时沿用上次结果；从没取到过按未维护处理（写操作仍由后端拦住）。
      const enabled = status ? status.enabled : (maintenanceCache?.enabled ?? false);
      maintenanceCache = { enabled, at: Date.now() };
      return enabled;
    })
    .finally(() => {
      maintenanceLoading = null;
    });
  return maintenanceLoading;
}

// 维护期间所有人都能打开的页面：维护页本身，以及给管理员用的登录页。
const MAINTENANCE_OPEN_PATHS = new Set(['/maintenance', '/login']);

function isProtectedPath(pathname: string) {
  return pathname.startsWith('/nicaiyixiahh')
    || pathname.startsWith('/referee')
    || pathname.startsWith('/my-registrations')
    || pathname === '/login';
}

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  let sessionLoaded = false;
  let cachedSession: Session | null = null;
  const getSession = async () => {
    if (!sessionLoaded) {
      cachedSession = await auth();
      sessionLoaded = true;
    }
    return cachedSession;
  };

  // 全服维护：除管理员、超级管理员外，任何页面都显示维护页（地址不变，维护结束刷新即回原页）。
  if (!MAINTENANCE_OPEN_PATHS.has(pathname) && await maintenanceEnabled()) {
    const session = await getSession();
    const role = session && session.authError !== 'RefreshAccessTokenError' ? session.user?.role : undefined;
    if (!canEnterDuringMaintenance(role)) {
      const headers = new Headers(req.headers);
      headers.set(MAINTENANCE_VIEW_HEADER, '1');
      const res = NextResponse.rewrite(new URL('/maintenance', req.url), { request: { headers } });
      res.headers.set('Cache-Control', 'no-store');
      return res;
    }
  }

  if (!isProtectedPath(pathname)) return NextResponse.next();

  const session = await getSession();
  const hasInvalidSession = session?.authError === 'RefreshAccessTokenError';
  const isLoggedIn = !!session && !hasInvalidSession;
  const isAdminRoute = pathname.startsWith('/nicaiyixiahh');
  const isRefereeRoute = pathname.startsWith('/referee');
  const isMyRegistrationsRoute = pathname.startsWith('/my-registrations');
  const isLoginPage = pathname === '/login';

  // 报名页不再要求登录：学生组与社会组都凭报名码进入。
  // 未登录用户提交时由页面走 public-register 游客通道。
  if (
    (isAdminRoute || isRefereeRoute || isMyRegistrationsRoute) &&
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
  // 全服维护要覆盖所有页面，所以匹配全部路径；排除 NextAuth 接口、构建产物和静态文件。
  // 平时非受保护页面只多一次带缓存的维护状态查询。
  matcher: [
    '/((?!api/|_next/static|_next/image|__nextjs|favicon\\.ico|.*\\.(?:png|jpe?g|gif|svg|webp|ico|txt|xml|xls|xlsx|css|js|map|woff2?|ttf)$).*)',
  ],
};

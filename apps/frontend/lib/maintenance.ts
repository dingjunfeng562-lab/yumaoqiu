// 全服维护：前端 proxy、维护页、后台共用的类型和小工具。

export type MaintenanceStatus = {
  enabled: boolean;
  title?: string;
  content?: string;
  startedAt?: string | null;
  expectedEndAt?: string | null;
  serverTime?: string;
};

// proxy 把页面换成维护页时带上这个请求头，根布局据此不再拉公告、不弹登录过期跳转。
export const MAINTENANCE_VIEW_HEADER = 'x-maintenance-view';

export const DEFAULT_MAINTENANCE_TITLE = '系统维护中';

// 维护期间仍可浏览的角色；其中只有超级管理员能做写操作（后端把关）。
export function canEnterDuringMaintenance(role?: string | null) {
  return role === 'ROOT' || role === 'ADMIN';
}

// 服务端（proxy、维护页）直连后端，不绕 CDN：生产环境的 NEXT_PUBLIC_API_URL 是公网域名，
// 从服务器内部访问一次要几百毫秒，而 proxy 每个页面都要查一次。
export function serverApiBase() {
  return process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || '';
}

export async function fetchMaintenanceStatus(apiBase: string, timeoutMs = 2000): Promise<MaintenanceStatus | null> {
  if (!apiBase) return null;
  try {
    const res = await fetch(`${apiBase}/maintenance/status`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as MaintenanceStatus;
    return typeof data?.enabled === 'boolean' ? data : null;
  } catch {
    return null;
  }
}

// 只接受站内相对路径，防止 ?from= 被拿来做外链跳转。
export function safeReturnPath(value: string | null | undefined) {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  if (value === '/maintenance' || value.startsWith('/maintenance?')) return '/';
  return value;
}

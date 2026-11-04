import { signOut } from 'next-auth/react';

const BASE = process.env.NEXT_PUBLIC_API_URL!;

export async function apiFetch<T>(
  path: string,
  options: RequestInit & { token?: string; redirectOnForbidden?: boolean } = {},
): Promise<T> {
  const { token, redirectOnForbidden = true, ...rest } = options;
  const res = await fetch(`${BASE}${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(rest.headers ?? {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    if (typeof window !== 'undefined') {
      if (res.status === 401) {
        const redirect = `${window.location.pathname}${window.location.search}`;
        void signOut({
          callbackUrl: `/login?redirect=${encodeURIComponent(redirect)}`,
          redirect: true,
        });
      }
      if (res.status === 403 && redirectOnForbidden) {
        window.location.href = '/forbidden';
      }
      // 维护开启前就打开的页面：一操作就转到维护页，维护结束后自动回到这里。
      // 管理员收到的是 MAINTENANCE_READONLY，只提示"不能进行任何操作"，不跳转。
      if (res.status === 503 && err?.code === 'MAINTENANCE' && window.location.pathname !== '/maintenance') {
        const from = `${window.location.pathname}${window.location.search}`;
        window.location.assign(`/maintenance?from=${encodeURIComponent(from)}`);
      }
    }
    throw Object.assign(new Error(err.message ?? '请求失败'), { status: res.status });
  }
  return res.json();
}

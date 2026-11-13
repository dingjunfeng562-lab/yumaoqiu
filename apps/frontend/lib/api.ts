import { signOut } from 'next-auth/react';

const BASE = process.env.NEXT_PUBLIC_API_URL!;

async function readResponse<T>(res: Response, redirectOnForbidden: boolean): Promise<T> {
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
      // 管理员收到的是 MAINTENANCE_READONLY，只提示不能操作，不跳转。
      if (res.status === 503 && err?.code === 'MAINTENANCE' && window.location.pathname !== '/maintenance') {
        const from = `${window.location.pathname}${window.location.search}`;
        window.location.assign(`/maintenance?from=${encodeURIComponent(from)}`);
      }
    }
    throw Object.assign(new Error(err.message ?? '请求失败'), { status: res.status });
  }
  return res.json();
}

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
  return readResponse<T>(res, redirectOnForbidden);
}

/** multipart 上传：不要手动设置 Content-Type，交给浏览器带 boundary。 */
export async function apiUpload<T>(
  path: string,
  form: FormData,
  options: { token?: string; redirectOnForbidden?: boolean; signal?: AbortSignal } = {},
): Promise<T> {
  const { token, redirectOnForbidden = true, signal } = options;
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    body: form,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal,
  });
  return readResponse<T>(res, redirectOnForbidden);
}

/** 带登录态下载文件（如导入模板），返回 Blob；出错时和 apiFetch 一样抛出后端的提示。 */
export async function apiBlob(
  path: string,
  options: { token?: string; redirectOnForbidden?: boolean } = {},
): Promise<Blob> {
  const { token, redirectOnForbidden = true } = options;
  const res = await fetch(`${BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) return readResponse<never>(res, redirectOnForbidden);
  return res.blob();
}

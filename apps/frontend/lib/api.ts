import { signOut } from 'next-auth/react';

const BASE = process.env.NEXT_PUBLIC_API_URL!;

export async function apiFetch<T>(
  path: string,
  options: RequestInit & { token?: string } = {},
): Promise<T> {
  const { token, ...rest } = options;
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
      if (res.status === 403) {
        window.location.href = '/forbidden';
      }
    }
    throw new Error(err.message ?? '请求失败');
  }
  return res.json();
}

'use client';
import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { apiFetch } from './api';
import { hasFeature } from './admin-permissions';

export function useCurrentAccess() {
  const { data: session, status } = useSession();
  const token = session?.user?.accessToken;
  const [live, setLive] = useState<{ token: string; role: string; permissions: string[] }>();
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const refresh = () => apiFetch<{ role: string; permissions: string[] }>('/auth/me', { token, cache: 'no-store' })
      .then((me) => { if (!cancelled) setLive({ token, ...me }); }).catch(() => {});
    void refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener('permissions-updated', refresh);
    return () => { cancelled = true; window.removeEventListener('focus', refresh); window.removeEventListener('permissions-updated', refresh); };
  }, [token]);
  const current = live && live.token === token ? live : undefined;
  const role = current?.role ?? session?.user?.role;
  return { role, permissions: current?.permissions, ready: !!current || status === 'unauthenticated', can: (key: string) => hasFeature(role, current?.permissions, key) };
}
export function useCurrentRole() { return useCurrentAccess().role; }

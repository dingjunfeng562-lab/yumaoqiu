'use client';

import { useEffect } from 'react';
import { SessionProvider, signOut, useSession } from 'next-auth/react';
import { AntdRegistry } from '@ant-design/nextjs-registry';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <SessionExpiryHandler />
      <AntdRegistry>{children}</AntdRegistry>
    </SessionProvider>
  );
}

function SessionExpiryHandler() {
  const { data: session } = useSession();

  useEffect(() => {
    if (session?.authError !== 'RefreshAccessTokenError') return;
    const redirect = `${window.location.pathname}${window.location.search}`;
    void signOut({
      callbackUrl: `/login?redirect=${encodeURIComponent(redirect)}`,
      redirect: true,
    });
  }, [session?.authError]);

  return null;
}

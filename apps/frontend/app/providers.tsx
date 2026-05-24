'use client';

import { useEffect } from 'react';
import { SessionProvider, signOut, useSession } from 'next-auth/react';
import { AntdRegistry } from '@ant-design/nextjs-registry';
import { GlobalAnnouncementModal } from '@/components/GlobalAnnouncementModal';
import type { ActiveAnnouncement } from '@/components/GlobalAnnouncementModal';

export function Providers({
  children,
  initialAnnouncement,
}: {
  children: React.ReactNode;
  initialAnnouncement?: ActiveAnnouncement | null;
}) {
  return (
    <SessionProvider>
      <SessionExpiryHandler />
      <AntdRegistry>
        {children}
        <GlobalAnnouncementModal initialAnnouncement={initialAnnouncement} />
      </AntdRegistry>
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

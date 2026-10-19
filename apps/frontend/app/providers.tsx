'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
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
  const pathname = usePathname();
  const isAdminPage = pathname === '/nicaiyixiahh' || pathname.startsWith('/nicaiyixiahh/');
  // Dedicated display surfaces: the tournament screen and the OBS scoreboard.
  // Neither may show the global announcement or bounce to /login, which would
  // put a modal or a login form into the live broadcast.
  const isTournamentScreen = pathname.startsWith('/live-screen/')
    || pathname.startsWith('/broadcast/overlay/');

  useEffect(() => {
    if (isAdminPage) {
      // Include portals mounted under body, such as admin modals and drawers.
      document.body.setAttribute('data-allow-copy', '');
      return () => document.body.removeAttribute('data-allow-copy');
    }

    const preventClipboardExport = (event: ClipboardEvent) => {
      const selection = window.getSelection();
      if (event.type === 'copy' && selection && !selection.isCollapsed && selection.rangeCount === 1) {
        const container = selection.getRangeAt(0).commonAncestorContainer;
        const element = container instanceof Element ? container : container.parentElement;
        if (element?.closest('[data-allow-copy]')) return;
      }

      event.preventDefault();
      event.stopPropagation();
    };

    // Capture events from every page, including portals such as modals/drawers.
    document.addEventListener('copy', preventClipboardExport, true);
    document.addEventListener('cut', preventClipboardExport, true);

    return () => {
      document.removeEventListener('copy', preventClipboardExport, true);
      document.removeEventListener('cut', preventClipboardExport, true);
    };
  }, [isAdminPage]);

  return (
    <SessionProvider>
      {!isTournamentScreen && <SessionExpiryHandler />}
      <AntdRegistry>
        {children}
        {!pathname.startsWith('/tupiannicai/') && !isTournamentScreen && (
          <GlobalAnnouncementModal initialAnnouncement={initialAnnouncement} />
        )}
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

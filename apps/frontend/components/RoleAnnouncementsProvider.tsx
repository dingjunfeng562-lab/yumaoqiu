'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useSession } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import type { ActiveAnnouncement } from './GlobalAnnouncementModal';

export type RoleAnnouncement = ActiveAnnouncement & {
  publishedAt: string;
  isPinned: boolean;
};

const empty: RoleAnnouncement[] = [];
const RoleAnnouncementsContext = createContext(empty);

export function useRoleAnnouncements() {
  return useContext(RoleAnnouncementsContext);
}

export function RoleAnnouncementsProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const { data: session } = useSession();
  const token = session?.user.accessToken;
  const pathname = usePathname();
  const [result, setResult] = useState<{ token: string; announcements: RoleAnnouncement[] }>();

  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_API_URL;
    if (!enabled || !token || !base) return;

    const controller = new AbortController();
    fetch(`${base}/announcements/mine`, {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
      .then(async (response) =>
        response.ok ? (await response.json() as { announcements: RoleAnnouncement[] }).announcements : empty,
      )
      .then((announcements) => {
        if (!controller.signal.aborted) setResult({ token, announcements });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ token, announcements: empty });
      });

    return () => controller.abort();
  }, [enabled, pathname, token]);

  return (
    <RoleAnnouncementsContext.Provider value={enabled && result?.token === token ? result?.announcements ?? empty : empty}>
      {children}
    </RoleAnnouncementsContext.Provider>
  );
}

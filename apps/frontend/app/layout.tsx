import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import type { ActiveAnnouncement } from '@/components/GlobalAnnouncementModal';
import { MAINTENANCE_VIEW_HEADER } from '@/lib/maintenance';
import { Providers } from './providers';
import './globals.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '羽动云赛 | 羽毛球赛事管理平台',
  description: '羽动云赛，羽毛球赛事管理平台',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
  themeColor: '#04163f',
};

async function getInitialAnnouncement() {
  const apiBase = process.env.NEXT_PUBLIC_API_URL;
  if (!apiBase) return null;

  try {
    const res = await fetch(`${apiBase}/announcements/active`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;

    return ((await res.json()) as ActiveAnnouncement | null) ?? null;
  } catch {
    return null;
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // proxy 把页面换成了全服维护页：不拉公告，也不让 Providers 弹公告、跳登录。
  const maintenanceView = (await headers()).get(MAINTENANCE_VIEW_HEADER) === '1';
  const initialAnnouncement = maintenanceView ? null : await getInitialAnnouncement();

  return (
    <html lang="zh-CN">
      <body>
        <Providers initialAnnouncement={initialAnnouncement} maintenanceView={maintenanceView}>{children}</Providers>
      </body>
    </html>
  );
}

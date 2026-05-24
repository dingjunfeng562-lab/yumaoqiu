import type { Metadata, Viewport } from 'next';
import type { ActiveAnnouncement } from '@/components/GlobalAnnouncementModal';
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
  const initialAnnouncement = await getInitialAnnouncement();

  return (
    <html lang="zh-CN">
      <body>
        <Providers initialAnnouncement={initialAnnouncement}>{children}</Providers>
      </body>
    </html>
  );
}

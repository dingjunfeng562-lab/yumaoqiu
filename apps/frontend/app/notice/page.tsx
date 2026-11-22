import { PortalFeaturePage } from '@/components/home/PortalFeaturePage';
import { NoticeLists, type PublicAnnouncement } from './NoticeLists';

export const dynamic = 'force-dynamic';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

async function getAnnouncements() {
  try {
    const res = await fetch(`${API_BASE}/public/announcements`, { cache: 'no-store' });
    if (!res.ok) return [];
    const data = (await res.json()) as { announcements?: PublicAnnouncement[] };
    return data.announcements ?? [];
  } catch {
    return [];
  }
}

export default async function NoticePage() {
  const announcements = await getAnnouncements();

  return (
    <PortalFeaturePage
      activeHref="/notice"
      eyebrow="Notice"
      title="通知公告"
      description="集中查看赛事通知、报名提醒、赛程变更和参赛须知。"
    >
      <NoticeLists announcements={announcements} />
    </PortalFeaturePage>
  );
}

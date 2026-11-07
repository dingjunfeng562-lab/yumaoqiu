import { PortalFeaturePage } from '@/components/home/PortalFeaturePage';
import { CompetitionSearchList } from '@/components/competitions/CompetitionSearchList';
import { API_BASE, type PublicCompetition } from '@/components/competitions/types';

export const dynamic = 'force-dynamic';

async function getCompetitions() {
  try {
    const res = await fetch(`${API_BASE}/competitions`, { cache: 'no-store' });
    if (!res.ok) return [];
    return (await res.json()) as PublicCompetition[];
  } catch {
    return [];
  }
}

export default async function CompetitionsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const [competitions, { q }] = await Promise.all([getCompetitions(), searchParams]);
  const initialQuery = typeof q === 'string' ? q : '';

  return (
    <PortalFeaturePage
      activeHref="/competitions"
      eyebrow="Competition"
      title="赛事列表"
      description="查看羽动云赛已发布的校园羽毛球赛事，选择对应赛事完成报名，审核通过后进入该赛事选手名单。"
    >
      <CompetitionSearchList competitions={competitions} initialQuery={initialQuery} />
    </PortalFeaturePage>
  );
}

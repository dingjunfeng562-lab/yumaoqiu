import { PortalFeaturePage } from '@/components/home/PortalFeaturePage';
import { CompetitionSearchList } from '@/components/competitions/CompetitionSearchList';
import { API_BASE, type PublicCompetition } from '@/components/competitions/types';

export const dynamic = 'force-dynamic';

async function getCompetitions() {
  try {
    const res = await fetch(`${API_BASE}/competitions?order=list`, { cache: 'no-store' });
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
    <PortalFeaturePage activeHref="/competitions" title="赛事列表" hideHero>
      <CompetitionSearchList competitions={competitions} initialQuery={initialQuery} />
    </PortalFeaturePage>
  );
}

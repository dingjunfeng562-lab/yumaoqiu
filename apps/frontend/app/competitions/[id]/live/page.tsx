import { notFound } from 'next/navigation';
import { PortalFeaturePage } from '@/components/home/PortalFeaturePage';
import { LiveMatchBoard } from '@/components/competitions/LiveMatchBoard';
import { TournamentSwitcher } from '@/components/competitions/TournamentSwitcher';
import { API_BASE } from '@/components/competitions/types';
import type { KnockoutBracketData } from '@/components/bracket/KnockoutBracket';
import { fetchPublicBrackets } from '@/lib/live-brackets';

export const dynamic = 'force-dynamic';

export const metadata = { title: '比分直播 | 羽动云赛' };

type CompetitionBrief = {
  id: string;
  title: string;
};

async function getCompetition(id: string): Promise<CompetitionBrief | null> {
  try {
    const res = await fetch(`${API_BASE}/competitions/${encodeURIComponent(id)}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as CompetitionBrief;
  } catch {
    return null;
  }
}

async function getBrackets(id: string): Promise<KnockoutBracketData[]> {
  try {
    return await fetchPublicBrackets(id);
  } catch {
    return [];
  }
}

export default async function CompetitionLivePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;
  const [competition, brackets, { player }] = await Promise.all([
    getCompetition(id),
    getBrackets(id),
    searchParams,
  ]);
  if (!competition) notFound();

  return (
    <PortalFeaturePage
      activeHref="/competitions"
      eyebrow="Live Score · 比分直播"
      title={competition.title}
      description="按场地和时间查看全部场次与实时比分。输入运动员姓名，可快速找到他所在的场地、排队顺序和当前比分。"
      actions={<TournamentSwitcher currentId={competition.id} target="live" />}
      back={{ href: `/competitions/${encodeURIComponent(competition.id)}`, label: '赛事主页' }}
    >
      <LiveMatchBoard
        tournamentId={competition.id}
        initialBrackets={brackets.filter((bracket) => bracket.tournamentId === competition.id)}
        initialPlayer={typeof player === 'string' ? player : ''}
      />
    </PortalFeaturePage>
  );
}

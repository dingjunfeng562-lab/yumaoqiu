import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PortalFeaturePage } from '@/components/home/PortalFeaturePage';
import { LiveBracketsSection } from '@/components/bracket/LiveBracketsSection';
import { getBracketList } from '@/app/bracket/data';

export const dynamic = 'force-dynamic';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

type CompetitionBrief = {
  id: string;
  title: string;
  subtitle?: string | null;
};

async function getCompetition(id: string): Promise<CompetitionBrief | null> {
  try {
    const res = await fetch(`${API_BASE}/competitions/${id}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as CompetitionBrief;
  } catch {
    return null;
  }
}

export default async function CompetitionBracketsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [competition, allBrackets] = await Promise.all([getCompetition(id), getBracketList()]);
  if (!competition) notFound();

  const brackets = allBrackets.filter((bracket) => bracket.tournamentId === competition.id);

  return (
    <PortalFeaturePage
      activeHref="/competitions"
      eyebrow="Bracket"
      title={`${competition.title} 对阵表`}
      description={competition.subtitle ?? '查看该赛事全部项目的分组名单、小组赛对阵、淘汰赛进程与实时比分。'}
    >
      <div className="space-y-4 sm:space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-100 bg-white p-4 shadow-sm">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-700/70">Competition Brackets</p>
            <h2 className="mt-1 text-lg font-black text-slate-900">赛事对阵表</h2>
            <p className="mt-1 text-xs font-semibold text-slate-500">
              {brackets.length ? `共 ${brackets.length} 个已发布项目` : '后台发布对阵后会显示在这里'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/competitions/${encodeURIComponent(competition.id)}`}
              className="inline-flex h-10 items-center justify-center rounded-lg border border-blue-200 px-4 text-sm font-black text-blue-700 transition hover:bg-blue-50"
            >
              赛事详情
            </Link>
            <Link
              href="/live-screen"
              className="inline-flex h-10 items-center justify-center rounded-lg bg-blue-600 px-4 text-sm font-black text-white transition hover:bg-blue-700"
            >
              直播大屏
            </Link>
          </div>
        </div>

        <LiveBracketsSection tournamentId={competition.id} initialBrackets={brackets} />
      </div>
    </PortalFeaturePage>
  );
}

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PortalFeaturePage } from '@/components/home/PortalFeaturePage';
import { KnockoutBracket } from '@/components/bracket/KnockoutBracket';
import { getBracketList } from '../data';

export const dynamic = 'force-dynamic';

export default async function BracketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const brackets = await getBracketList();
  const bracket = brackets.find((item) => item.id === decodeURIComponent(id));

  if (!bracket) notFound();

  return (
    <PortalFeaturePage
      activeHref="/bracket"
      eyebrow="Bracket"
      title={bracket.title}
      description={bracket.subtitle ?? '查看完整对阵表、场次安排、实时比分和选手晋级路径。'}
    >
      <div className="space-y-4 sm:space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-100 bg-white p-4 shadow-sm">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-700/70">Current Bracket</p>
            <h2 className="mt-1 text-lg font-black text-slate-900">当前赛事对阵表</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {bracket.tournamentId ? (
              <Link
                href={`/competitions/${encodeURIComponent(bracket.tournamentId)}#brackets`}
                className="inline-flex h-10 items-center justify-center rounded-lg border border-blue-200 px-4 text-sm font-black text-blue-700 transition hover:bg-blue-50"
              >
                赛事详情
              </Link>
            ) : null}
            <Link
              href="/live-screen"
              className="inline-flex h-10 items-center justify-center rounded-lg bg-blue-600 px-4 text-sm font-black text-white transition hover:bg-blue-700"
            >
              直播大屏幕
            </Link>
          </div>
        </div>

        <KnockoutBracket data={bracket} />
      </div>
    </PortalFeaturePage>
  );
}

import { notFound, redirect } from 'next/navigation';
import { LiveScreenClient } from '@/components/screen/LiveScreenClient';
import { fetchPublicBrackets } from '@/lib/live-brackets';

export const dynamic = 'force-dynamic';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

async function getCompetitionTitle(id: string) {
  try {
    const res = await fetch(`${API_BASE}/competitions/${encodeURIComponent(id)}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as { title?: string | null };
    return data.title ?? null;
  } catch {
    return null;
  }
}

// 直播大屏幕统一在赛事里查看：从赛事主页「直播大屏」或对阵页进入（?tournamentId=…），
// 只显示这一个赛事，不能切换或搜到其他赛事。没带赛事时回赛事列表。
export default async function LiveScreenPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { tournamentId } = await searchParams;
  const id = typeof tournamentId === 'string' ? tournamentId.trim() : '';
  if (!id) redirect('/competitions');

  const [brackets, title] = await Promise.all([
    fetchPublicBrackets(id).catch(() => []),
    getCompetitionTitle(id),
  ]);
  const own = brackets.filter((bracket) => bracket.tournamentId === id);
  if (!title && !own.length) notFound();

  return (
    <LiveScreenClient
      initialBrackets={own}
      initialTournamentId={id}
      lockedTournament={{ id, name: title ?? own[0]?.tournamentName ?? '本赛事' }}
    />
  );
}

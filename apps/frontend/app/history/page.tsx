import Image from 'next/image';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

type HistoryMatch = {
  id: string;
  eventTypeLabel: string;
  round: string;
  matchNo: number;
  statusLabel: string;
  venueName: string;
  refereeName?: string | null;
  side1: string;
  side2: string;
  gamesText: string;
  winnerName?: string | null;
};

type HistoryEvent = {
  id: string;
  typeLabel: string;
  registrations: Array<{ id: string; name: string; affiliation: string; groupName?: string | null }>;
  standings: Array<{
    rank: number;
    name: string;
    affiliation: string;
    played: number;
    wins: number;
    losses: number;
    gameDiff: number;
  }>;
  matches: HistoryMatch[];
};

type HistoryTournament = {
  id: string;
  name: string;
  edition: number;
  subtitle?: string | null;
  location?: string | null;
  startDate: string;
  endDate: string;
  statusLabel: string;
  stats: {
    events: number;
    registrations: number;
    matches: number;
    completedMatches: number;
  };
  events: HistoryEvent[];
};

type HistoryResponse = {
  tournaments: HistoryTournament[];
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

async function getHistory() {
  try {
    const res = await fetch(`${API_BASE}/public/history`, { cache: 'no-store' });
    if (!res.ok) return { tournaments: [] };
    return (await res.json()) as HistoryResponse;
  } catch {
    return { tournaments: [] };
  }
}

export default async function HistoryPage() {
  const data = await getHistory();

  return (
    <main className="min-h-screen bg-[#f5f7fb] text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-4 px-5 py-4 lg:px-8">
          <Link href="/" className="flex items-center gap-3">
            <Image src="/logo.png" alt="羽动云赛" width={1536} height={1024} className="h-11 w-16 object-contain" />
            <div>
              <p className="text-lg font-black">羽动云赛</p>
              <p className="text-xs font-semibold text-slate-500">历届数据</p>
            </div>
          </Link>
          <div className="flex gap-2">
            <Link href="/" className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-black text-slate-700">
              数据大屏
            </Link>
            <Link href="/admin/exports" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-black text-white">
              导出数据
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1440px] px-5 py-6 lg:px-8">
        <section className="mb-6">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">Archive</p>
          <h1 className="mt-2 text-3xl font-black md:text-4xl">历届赛事数据</h1>
        </section>

        {data.tournaments.length ? (
          <div className="space-y-6">
            {data.tournaments.map((tournament) => (
              <article key={tournament.id} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-sm font-black text-blue-600">{tournament.statusLabel}</p>
                    <h2 className="mt-1 text-2xl font-black">{tournament.name}</h2>
                    <p className="mt-2 text-sm font-semibold text-slate-500">
                      {formatDate(tournament.startDate)} - {formatDate(tournament.endDate)} · {tournament.location ?? '地点待公布'}
                    </p>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-center sm:min-w-[420px]">
                    {[
                      ['项目', tournament.stats.events],
                      ['报名', tournament.stats.registrations],
                      ['场次', tournament.stats.matches],
                      ['完赛', tournament.stats.completedMatches],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-lg bg-slate-50 px-3 py-2">
                        <strong className="block text-xl font-black text-slate-950">{value}</strong>
                        <span className="text-xs font-semibold text-slate-500">{label}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-5 grid gap-5 xl:grid-cols-2">
                  {tournament.events.map((event) => (
                    <section key={event.id} className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="text-lg font-black">{event.typeLabel}</h3>
                        <span className="text-xs font-bold text-slate-500">{event.registrations.length} 个报名</span>
                      </div>

                      <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
                        <div className="grid grid-cols-[56px_1fr_72px_72px_72px] bg-slate-100 px-3 py-2 text-xs font-black text-slate-500">
                          <span>名次</span>
                          <span>参赛方</span>
                          <span>场次</span>
                          <span>胜</span>
                          <span>负</span>
                        </div>
                        {event.standings.slice(0, 6).map((row) => (
                          <div key={`${event.id}-${row.name}`} className="grid grid-cols-[56px_1fr_72px_72px_72px] items-center border-t border-slate-100 px-3 py-2 text-sm">
                            <strong className="text-blue-700">{row.rank}</strong>
                            <span className="min-w-0 truncate font-bold">{row.name}</span>
                            <span>{row.played}</span>
                            <span>{row.wins}</span>
                            <span>{row.losses}</span>
                          </div>
                        ))}
                      </div>

                      <div className="mt-4 space-y-2">
                        {event.matches.slice(0, 5).map((match) => (
                          <div key={match.id} className="rounded-lg bg-white px-3 py-2 text-sm">
                            <div className="flex justify-between gap-3">
                              <p className="min-w-0 truncate font-black">{match.side1} VS {match.side2}</p>
                              <span className="shrink-0 font-black text-amber-600">{match.gamesText}</span>
                            </div>
                            <p className="mt-1 text-xs font-semibold text-slate-500">
                              {match.round} · 第 {match.matchNo} 场 · 胜方：{match.winnerName ?? '未产生'}
                              {match.refereeName ? ` · 裁判：${match.refereeName}` : ''}
                            </p>
                          </div>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-slate-200 bg-white p-10 text-center shadow-sm">
            <Image src="/generated/icon-trophy.svg" alt="" width={64} height={64} className="mx-auto h-16 w-16" />
            <h2 className="mt-4 text-xl font-black">暂无历届数据</h2>
            <p className="mt-2 text-sm font-semibold text-slate-500">赛事结束或归档后会出现在这里。</p>
          </div>
        )}
      </div>
    </main>
  );
}

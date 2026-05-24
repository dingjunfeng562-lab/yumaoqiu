import Link from 'next/link';
import { PortalFeaturePage } from '@/components/home/PortalFeaturePage';

export const dynamic = 'force-dynamic';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

type RankingRow = {
  rank: number;
  name: string;
  affiliation: string;
  groupName?: string | null;
  played: number;
  wins: number;
  losses: number;
  gameDiff: number;
};

type RankingEvent = {
  id: string;
  typeLabel: string;
  format?: string;
  registrations: number;
  matches: number;
  completedMatches: number;
  standings: RankingRow[];
};

type RankingTournament = {
  id: string;
  name: string;
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
  events: RankingEvent[];
};

type RankingResponse = {
  tournaments: RankingTournament[];
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

async function getRanking(): Promise<RankingResponse> {
  try {
    const res = await fetch(`${API_BASE}/public/ranking`, { cache: 'no-store' });
    if (!res.ok) return { tournaments: [] };
    return (await res.json()) as RankingResponse;
  } catch {
    return { tournaments: [] };
  }
}

export default async function RankingPage() {
  const data = await getRanking();
  const tournaments = data.tournaments.filter((tournament) =>
    tournament.events.some((event) => event.standings.length),
  );

  return (
    <PortalFeaturePage
      activeHref="/ranking"
      eyebrow="Ranking"
      title="成绩排行"
      description="查看各赛事、各项目的胜负统计和实时排名。"
    >
      {tournaments.length ? (
        <div className="space-y-6">
          {tournaments.map((tournament) => (
            <article key={tournament.id} className="rounded-lg border border-blue-100 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-sm font-black text-blue-600">{tournament.statusLabel}</p>
                  <h2 className="mt-1 text-2xl font-black text-slate-950">{tournament.name}</h2>
                  {tournament.subtitle ? (
                    <p className="mt-2 text-sm font-semibold text-slate-500">{tournament.subtitle}</p>
                  ) : null}
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
                    <div key={label} className="rounded-lg bg-blue-50 px-3 py-2">
                      <strong className="block text-xl font-black text-slate-950">{value}</strong>
                      <span className="text-xs font-semibold text-slate-500">{label}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-5 grid gap-5 xl:grid-cols-2">
                {tournament.events
                  .filter((event) => event.standings.length)
                  .map((event) => {
                    const showGameDiff = event.format !== 'SINGLE_ELIMINATION';
                    return (
                    <section key={event.id} className="overflow-hidden rounded-lg border border-slate-200">
                      <div className="flex items-center justify-between gap-3 bg-slate-50 px-4 py-3">
                        <div>
                          <h3 className="text-lg font-black text-slate-950">{event.typeLabel}</h3>
                          <p className="mt-1 text-xs font-semibold text-slate-500">
                            {event.registrations} 个报名 · {event.completedMatches}/{event.matches} 场已完成
                          </p>
                        </div>
                        <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-blue-700">
                          TOP {Math.min(event.standings.length, 8)}
                        </span>
                      </div>

                      <div className="overflow-x-auto">
                        <table className={`w-full min-w-[720px] text-left text-sm ${showGameDiff ? '' : '[&_th:last-child]:hidden'}`}>
                          <thead className="bg-white text-xs font-black text-slate-500">
                            <tr>
                              <th className="px-4 py-3">名次</th>
                              <th className="px-4 py-3">参赛方</th>
                              <th className="px-4 py-3">单位</th>
                              <th className="px-4 py-3">场次</th>
                              <th className="px-4 py-3">胜</th>
                              <th className="px-4 py-3">负</th>
                              <th className="px-4 py-3">净分</th>
                            </tr>
                          </thead>
                          <tbody>
                            {event.standings.slice(0, 8).map((row) => (
                              <tr key={`${event.id}-${row.name}`} className="border-t border-slate-100">
                                <td className="px-4 py-3 font-black text-blue-700">#{row.rank}</td>
                                <td className="px-4 py-3 font-bold text-slate-950">{row.name}</td>
                                <td className="px-4 py-3 text-slate-600">{row.affiliation || '-'}</td>
                                <td className="px-4 py-3 text-slate-600">{row.played}</td>
                                <td className="px-4 py-3 font-black text-emerald-600">{row.wins}</td>
                                <td className="px-4 py-3 text-slate-600">{row.losses}</td>
                                {showGameDiff ? <td className="px-4 py-3 font-bold text-amber-600">{row.gameDiff}</td> : null}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                    );
                  })}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-blue-100 bg-white p-10 text-center shadow-sm">
          <h2 className="text-xl font-black text-slate-950">暂无赛事排行</h2>
          <p className="mt-2 text-sm font-semibold text-slate-500">
            完成记分后，系统会按胜场、净分和负场自动生成各项目排行。
          </p>
          <Link
            href="/competitions"
            className="mt-5 inline-flex h-11 items-center rounded-lg bg-blue-600 px-5 text-sm font-black text-white"
          >
            查看赛事
          </Link>
        </div>
      )}
    </PortalFeaturePage>
  );
}

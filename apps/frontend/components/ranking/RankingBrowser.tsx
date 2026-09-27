'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

export type RankingOption = { id: string; name: string };
type RankingEvent = {
  id: string; typeLabel: string; rankingLimit: number | null;
  standings: Array<{ id: string; name: string; teamName: string | null; rank: number }>;
};
type RankingTournament = RankingOption & { rankingsAvailable: boolean; events: RankingEvent[] };
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

export function RankingBrowser({ tournaments, loadError }: { tournaments: RankingOption[]; loadError: boolean }) {
  const [selected, setSelected] = useState('');
  const [search, setSearch] = useState('');
  const [tournament, setTournament] = useState<RankingTournament>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);

  const load = useCallback(async (id: string, background = false) => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    if (!background) {
      setSelected(id);
      setTournament(undefined);
      setSearch('');
      setLoading(Boolean(id));
    }
    setError('');
    if (!id) return;
    try {
      const response = await fetch(`${API_BASE}/public/ranking?tournamentId=${encodeURIComponent(id)}`, {
        cache: 'no-store', signal: controller.signal,
      });
      if (!response.ok) throw new Error('排名加载失败，请重试');
      const result = await response.json() as { tournaments: RankingTournament[] };
      if (controller.signal.aborted) return;
      const current = result.tournaments.find((item) => item.id === id);
      if (!current) throw new Error('该赛事暂不可查看');
      setTournament(current);
    } catch (err) {
      if (!controller.signal.aborted && !background) setError(err instanceof Error ? err.message : '排名加载失败，请重试');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selected) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { void load(selected, true); }, 250);
    };
    const socket = io(`${API_BASE.replace(/\/api\/?$/, '')}/scores`, {
      transports: ['polling', 'websocket'], withCredentials: true,
    });
    socket.on('connect', refresh);
    socket.on('bracket:update', (payload: { tournamentId?: string | null }) => {
      if (!payload.tournamentId || payload.tournamentId === selected) refresh();
    });
    socket.on('scoreboard:update', (payload: { status?: string }) => {
      if (payload.status === 'COMPLETED' || payload.status === 'CANCELLED') refresh();
    });
    // Also recover from missed notifications, connection loss, and admin edits.
    const interval = setInterval(() => { if (!document.hidden) refresh(); }, 15000);
    window.addEventListener('focus', refresh);
    return () => { clearTimeout(timer); clearInterval(interval); socket.disconnect(); window.removeEventListener('focus', refresh); };
  }, [selected, load]);

  const query = search.trim().toLocaleLowerCase();
  const events = tournament?.events.map((event) => ({
    ...event,
    standings: event.standings.filter((row) => `${row.name} ${row.teamName ?? ''}`.toLocaleLowerCase().includes(query)),
  })).filter((event) => event.standings.length) ?? [];

  return <div className="ranking-browser space-y-5">
    <style jsx>{`
      .ranking-browser { padding: 16px 12px 80px; }
      .ranking-browser > * + * { margin-top: 20px; }
      .ranking-filters, article { padding: 16px; }
      label > span { display: block; margin-bottom: 8px; }
      input, select { padding: 12px; min-width: 0; }
      button { padding: 8px 12px; }
      article h2 { overflow-wrap: anywhere; }
      .ranking-events { margin-top: 20px; }
      .ranking-event-heading { padding: 12px 16px; }
      th, td { padding: 12px 16px; }
      article > p, [role='status'], [role='alert'] { padding: 32px 16px; }
      @media (min-width: 640px) { .ranking-browser { padding: 24px 0 80px; } }
    `}</style>
    <div className="ranking-filters grid gap-4 rounded-lg border border-blue-100 bg-white p-4 shadow-sm sm:grid-cols-2">
      <label className="space-y-2 text-sm font-bold text-slate-700">
        <span>选择赛事</span>
        <select aria-label="选择赛事" value={selected} onChange={(event) => void load(event.target.value)}
          disabled={loadError || !tournaments.length}
          className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-base font-normal focus:border-blue-500">
          <option value="">请选择赛事</option>
          {tournaments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <label className="space-y-2 text-sm font-bold text-slate-700">
        <span>搜索选手／队伍</span>
        <input type="search" aria-label="搜索选手或队伍" placeholder="输入姓名、搭档或队伍名称" value={search}
          disabled={!tournament?.rankingsAvailable || loading} onChange={(event) => setSearch(event.target.value)}
          className="block w-full rounded-lg border border-slate-300 px-3 py-3 text-base font-normal focus:border-blue-500 disabled:bg-slate-50" />
      </label>
    </div>
    {loadError ? <div role="alert" className="rounded-lg bg-white p-8 text-center text-red-700">赛事加载失败，请刷新页面重试。</div>
      : !tournaments.length ? <div className="rounded-lg bg-white p-8 text-center text-slate-500">暂无可查看的赛事</div>
      : !selected ? <div className="rounded-lg border border-dashed border-blue-200 bg-white p-10 text-center text-slate-500">请先选择赛事，再查看最终名次</div>
      : loading ? <div role="status" className="p-10 text-center text-slate-500">正在加载最终名次…</div>
      : error ? <div role="alert" className="rounded-lg bg-white p-8 text-center text-red-700">
        {error}<button className="ml-3 font-bold text-blue-700" onClick={() => void load(selected)}>重试</button>
      </div>
      : tournament && <article className="rounded-lg border border-blue-100 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-xl font-black text-slate-950 sm:text-2xl">{tournament.name}</h2>
          <button className="shrink-0 rounded-lg border border-blue-200 px-3 py-2 text-sm font-bold text-blue-700"
            onClick={() => void load(selected)}>刷新排名</button>
        </div>
        {!tournament.rankingsAvailable ? <p role="status" className="py-10 text-center text-slate-500">比赛尚未结束，结束后公布最终名次</p>
          : events.length ? <div className="ranking-events mt-5 grid gap-5 xl:grid-cols-2">
          {events.map((event) => <section key={event.id} className="overflow-hidden rounded-lg border border-slate-200">
            <div className="ranking-event-heading flex items-center justify-between gap-3 bg-slate-50 px-4 py-3">
              <h3 className="font-black text-slate-950">{event.typeLabel}</h3>
              {event.rankingLimit != null && <span className="shrink-0 text-sm text-slate-500">取前 {event.rankingLimit} 名</span>}
            </div>
            <table className="w-full text-left text-sm">
              <thead className="text-slate-500"><tr>
                <th className="w-28 px-4 py-3">最终名次</th><th className="px-4 py-3">参赛选手／队伍</th>
              </tr></thead>
              <tbody>{event.standings.map((row) => <tr key={row.id} className="border-t border-slate-100">
                <td className="whitespace-nowrap px-4 py-3 font-black text-blue-700">第{row.rank}名</td>
                <td className="break-words px-4 py-3 font-bold text-slate-950">{row.name}
                  {row.teamName && row.teamName !== row.name && <span className="mt-1 block text-xs font-normal text-slate-500">{row.teamName}</span>}
                </td>
              </tr>)}</tbody>
            </table>
          </section>)}
        </div> : <p className="py-10 text-center text-slate-500">{query ? '没有找到匹配的选手或队伍' : '该赛事暂无可展示的最终名次'}</p>}
      </article>}
  </div>;
}

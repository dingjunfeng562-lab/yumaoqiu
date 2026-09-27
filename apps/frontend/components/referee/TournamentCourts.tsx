'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Alert, Button, Empty, Spin, Tag } from 'antd';
import { ReloadOutlined, ScanOutlined } from '@ant-design/icons';
import { apiFetch } from '@/lib/api';
import { roundCn } from '@/lib/round';

type Court = { id: string; name: string; courtNumber: number; matchCount: number };
type CourtsData = {
  tournament: { id: string; name: string };
  courts: Court[];
  unscheduledCount: number;
};
type CourtMatch = {
  id: string;
  status: 'PENDING' | 'LIVE' | 'COMPLETED';
  round: string;
  roundNo: number;
  matchNo: number;
  eventTypeLabel: string;
  scheduledAt: string | null;
  side1: { name: string } | null;
  side2: { name: string } | null;
  referee: { id: string; username: string | null } | null;
  games: Array<{ side1Score: number; side2Score: number }>;
};
const statuses = {
  PENDING: { label: '未开始', color: 'default' },
  LIVE: { label: '进行中', color: 'green' },
  COMPLETED: { label: '已结束', color: 'blue' },
};

export default function TournamentCourts({ tournamentId, initialCourt }: { tournamentId: string; initialCourt?: string }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const token = session?.user?.accessToken;
  const isReferee = session?.user?.role === 'REFEREE';
  const [data, setData] = useState<CourtsData | null>(null);
  const courtId = initialCourt ?? '';
  const [matches, setMatches] = useState<CourtMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [matchesLoading, setMatchesLoading] = useState(!!initialCourt);
  const [claiming, setClaiming] = useState('');
  const [error, setError] = useState('');
  const listVersion = useRef(0);
  const claimingRef = useRef(false);
  const base = `/referee/tournaments/${encodeURIComponent(tournamentId)}`;

  const loadCourts = useCallback(async (signal?: AbortSignal) => {
    if (!token || !isReferee) return;
    try {
      const result = await apiFetch<CourtsData>(`${base}/courts`, { token, signal, redirectOnForbidden: false });
      if (signal?.aborted) return;
      setData(result);
      setError('');
      if (!result.courts.some((court) => court.id === courtId)) setMatchesLoading(false);
    } catch (err) {
      if (!signal?.aborted) setError(err instanceof Error ? err.message : '加载场地失败');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [base, token, isReferee, courtId]);

  const loadMatches = useCallback(async (signal?: AbortSignal) => {
    if (!token || !courtId || !isReferee) return;
    const version = ++listVersion.current;
    try {
      const result = await apiFetch<{ matches: CourtMatch[] }>(`${base}/courts/${encodeURIComponent(courtId)}/matches`, { token, signal, redirectOnForbidden: false });
      if (signal?.aborted || version !== listVersion.current) return;
      setMatches(result.matches);
      setError('');
    } catch (err) {
      if (!signal?.aborted && version === listVersion.current) setError(err instanceof Error ? err.message : '加载比赛失败');
    } finally {
      if (!signal?.aborted && version === listVersion.current) setMatchesLoading(false);
    }
  }, [base, courtId, token, isReferee]);

  useEffect(() => {
    const controller = new AbortController();
    // State updates follow the network response; this effect starts the fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadCourts(controller.signal);
    return () => controller.abort();
  }, [loadCourts]);

  useEffect(() => {
    const controller = new AbortController();
    // State updates follow the network response; this effect starts the fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadMatches(controller.signal);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && !claimingRef.current) void loadMatches(controller.signal);
    }, 15000);
    return () => { controller.abort(); window.clearInterval(timer); listVersion.current += 1; };
  }, [loadMatches]);

  async function enterMatch(match: CourtMatch) {
    if (!token || claimingRef.current) return;
    claimingRef.current = true;
    setClaiming(match.id);
    setError('');
    try {
      await apiFetch(`${base}/courts/${encodeURIComponent(courtId)}/matches/${encodeURIComponent(match.id)}/claim`, { method: 'POST', token, redirectOnForbidden: false });
      router.push(`/referee/matches/${encodeURIComponent(match.id)}`);
    } catch (err) {
      await loadMatches();
      setError(err instanceof Error ? err.message : '进入比赛失败');
    } finally {
      claimingRef.current = false;
      setClaiming('');
    }
  }

  if (status === 'loading') return <div className="grid min-h-screen place-items-center"><Spin /></div>;
  if (!isReferee) return <Alert type="error" title="仅裁判账号可以进入赛事执裁" />;
  const court = data?.courts.find((item) => item.id === courtId);

  return (
    <main className="min-h-screen bg-gradient-to-b from-blue-50 to-white !px-4 !py-5 text-slate-900">
      <div className="!mx-auto flex max-w-5xl flex-col gap-5">
        <header className="flex flex-col gap-3 rounded-2xl border border-blue-100 bg-white !p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link href={courtId ? base : '/referee/my-matches'} className="text-blue-600">{courtId ? '← 返回场地列表' : '← 我的已授权赛事'}</Link>
            <div className="flex gap-2">
              <Button icon={<ScanOutlined />} href="/referee/scan">扫描其他赛事</Button>
              <Button icon={<ReloadOutlined />} loading={loading || matchesLoading} disabled={!!claiming} onClick={() => {
                setLoading(true); setMatchesLoading(!!courtId); setError('');
                void loadCourts(); void loadMatches();
              }}>刷新</Button>
            </div>
          </div>
          <h1 className="text-2xl font-black">{data?.tournament.name ?? '赛事执裁'}</h1>
          {data && <p className="text-sm text-slate-500">{courtId ? `${court?.name ?? '场地'} · 共 ${matchesLoading ? '…' : matches.length} 场比赛` : `共 ${data.courts.length} 个场地，请按场地号选择。`}</p>}
        </header>
        {error && <Alert type="error" title={error} showIcon action={<Button href="/referee/scan">扫码授权</Button>} />}
        {loading ? <div className="!py-12 text-center"><Spin /></div> : data && <>
          {!courtId && (data.courts.length ? <section aria-label="赛事场地" className="flex flex-col gap-3">
            {data.courts.map((item) => <Link
              key={item.id}
              href={`${base}/courts/${encodeURIComponent(item.id)}`}
              prefetch={false}
              className="flex items-center gap-4 rounded-2xl border border-blue-100 bg-white !p-5 text-left shadow-sm transition hover:border-blue-400"
            >
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-blue-600 text-xl font-black text-white">{item.courtNumber}</span>
              <span className="min-w-0 flex-1"><span className="block text-lg font-black">{item.name}</span><span className="!mt-1 block text-sm text-slate-500">共 {item.matchCount} 场比赛</span></span>
              <span className="text-blue-600">查看场次 →</span>
            </Link>)}
          </section> : <Empty description="该赛事暂未配置可用场地，请联系管理员在赛程编排中添加" />)}
          {court ? <section className="flex flex-col gap-4">
            <h2 className="text-xl font-black">{court.name} · 比赛列表</h2>
            {matchesLoading ? <div className="!py-10 text-center"><Spin /></div> : matches.length ? <div className="grid gap-4 md:grid-cols-2">
              {matches.map((match) => {
                const mine = match.referee?.id === session?.user?.id;
                const available = !match.referee && match.status === 'PENDING' && !!match.side1 && !!match.side2;
                const stage = match.roundNo === 0 && !match.round.endsWith('组') ? `${match.round}组` : roundCn(match.round);
                return <article key={match.id} className="flex flex-col gap-4 rounded-2xl border border-blue-100 bg-white !p-5 shadow-sm">
                  <div className="flex justify-between gap-2">
                    <div><h3 className="font-black">{match.eventTypeLabel} · 第 {match.matchNo} 场</h3><p className="!mt-1 text-xs text-slate-500">{stage}</p></div>
                    <Tag color={statuses[match.status].color}>{statuses[match.status].label}</Tag>
                  </div>
                  <p className="rounded-xl bg-blue-50 !p-4 text-center font-bold">{match.side1?.name ?? '待定'} <span className="!px-2 text-blue-600">VS</span> {match.side2?.name ?? '待定'}</p>
                  {!!match.games.length && <p className="text-center font-bold text-blue-600">{match.games.map((game) => `${game.side1Score} : ${game.side2Score}`).join(' / ')}</p>}
                  <p className="text-sm text-slate-500">{match.scheduledAt ? new Date(match.scheduledAt).toLocaleString('zh-CN') : '待排时间'}</p>
                  <p className="break-words text-sm text-slate-500">裁判：{mine ? '我正在负责' : match.referee?.username ?? (match.referee ? '其他裁判' : available ? '未分配，可自行接手' : '未分配')}</p>
                  <Button block size="large" type={mine || available ? 'primary' : 'default'} disabled={(!mine && !available) || (!!claiming && claiming !== match.id)} loading={claiming === match.id} onClick={() => void enterMatch(match)}>
                    {mine ? (match.status === 'COMPLETED' ? '查看记分' : '进入记分') : match.referee ? '已有裁判执裁' : match.status !== 'PENDING' ? '不可接手' : !available ? '等待对阵确定' : '执裁此场比赛'}
                  </Button>
                </article>;
              })}
            </div> : <Empty description="此场地暂无比赛，请等待赛程安排或刷新" />}
          </section> : courtId && <Empty description="场地不存在或已停用，请返回场地列表" />}
        </>}
      </div>
    </main>
  );
}

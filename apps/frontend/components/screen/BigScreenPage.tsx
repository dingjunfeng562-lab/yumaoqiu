'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const SOCKET_BASE = API_BASE.replace(/\/api$/, '');

type PublicMatch = {
  id: string;
  eventTypeLabel: string;
  round: string;
  matchNo: number;
  status: string;
  statusLabel: string;
  scheduledAt?: string | null;
  venueName: string;
  side1: string;
  side2: string;
  score: string;
  gamesText: string;
  winnerName?: string | null;
  matchPaused?: boolean;
  pausedAt?: string | null;
  courtDisplayState?: {
    side1CourtSide: 'left' | 'right';
    side2CourtSide: 'left' | 'right';
    swapCount: number;
  } | null;
  actualDurationSeconds?: number | null;
  updatedAt?: string | null;
};

export type ScreenData = {
  competition: {
    id: string;
    name: string;
    edition: number;
    subtitle?: string | null;
    location?: string | null;
    statusLabel: string;
    startDate: string;
    endDate: string;
    projectText?: string | null;
    formatText?: string | null;
    coverImageUrl?: string | null;
  } | null;
  stats: {
    registrations: number;
    events: number;
    liveMatches: number;
    completedMatches: number;
    scheduledMatches: number;
    venues: number;
  };
  liveMatches: PublicMatch[];
  upcomingMatches: PublicMatch[];
  recentResults: PublicMatch[];
  eventReports: Array<{
    id: string;
    typeLabel: string;
    registrations: number;
    matches: number;
    latestResult?: PublicMatch | null;
  }>;
  generatedAt: string;
};

function formatDate(value?: string | null) {
  if (!value) return '待公布';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

function formatTime(value?: string | null) {
  if (!value) return '未排程';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function displayMatch(match: PublicMatch) {
  const shouldSwap = match.status === 'LIVE' && match.courtDisplayState?.side1CourtSide === 'right';
  const scoreParts = match.score.match(/^(\D*)(\d+)\s*[:：]\s*(\d+)(\D*)$/);
  const score = shouldSwap && scoreParts
    ? `${scoreParts[1]}${scoreParts[3]}:${scoreParts[2]}${scoreParts[4]}`
    : match.score;
  return shouldSwap
    ? { side1: match.side2, side2: match.side1, score }
    : { side1: match.side1, side2: match.side2, score };
}

function MatchRow({ match, compact = false }: { match: PublicMatch; compact?: boolean }) {
  const paused = Boolean(match.matchPaused);
  const display = displayMatch(match);

  return (
    <article className={`grid min-h-[96px] grid-cols-[86px_1fr_86px] items-center gap-3 rounded-lg border px-4 py-3 shadow-[0_14px_34px_rgba(0,0,0,0.16)] ${
      paused ? 'border-amber-300/45 bg-amber-300/12' : 'border-white/10 bg-white/[0.07]'
    }`}>
      <div className="text-left">
        <p className="text-xs font-bold text-cyan-200">{match.eventTypeLabel}</p>
        <p className="mt-1 text-[11px] font-semibold text-white/55">{match.venueName}</p>
      </div>
      <div className="min-w-0 text-center">
        <p className="truncate text-sm font-black text-white">
          {display.side1} <span className="px-2 text-white/35">VS</span> {display.side2}
        </p>
        <p className="mt-1 text-xs font-semibold text-white/48">
          {match.round} · 第 {match.matchNo} 场 · {formatTime(match.scheduledAt)}
        </p>
      </div>
      <div className="text-right">
        <strong className={compact ? 'text-2xl font-black text-amber-300' : 'text-3xl font-black text-amber-300'}>
          {display.score}
        </strong>
        <p className={`mt-1 text-[11px] font-black ${paused ? 'text-amber-200' : 'text-white/50'}`}>
          {paused ? '比赛暂停' : match.statusLabel}
        </p>
      </div>
    </article>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <div className="grid min-h-[96px] place-items-center rounded-lg border border-dashed border-white/14 bg-white/[0.04] text-sm font-bold text-white/42">
      {text}
    </div>
  );
}

export function BigScreenPage({ initialData }: { initialData: ScreenData }) {
  const [data, setData] = useState(initialData);
  const [socketState, setSocketState] = useState<'连接中' | '实时同步' | '已断开'>('连接中');

  const dateRange = useMemo(() => {
    if (!data.competition) return '赛事待发布';
    return `${formatDate(data.competition.startDate)} - ${formatDate(data.competition.endDate)}`;
  }, [data.competition]);

  async function reloadScreen() {
    try {
      const res = await fetch(`${API_BASE}/public/screen`, { cache: 'no-store' });
      if (!res.ok) return;
      setData((await res.json()) as ScreenData);
    } catch {
      setSocketState('已断开');
    }
  }

  useEffect(() => {
    const socket: Socket = io(`${SOCKET_BASE}/scores`, {
      transports: ['polling', 'websocket'],
      withCredentials: true,
    });
    socket.on('connect', () => setSocketState('实时同步'));
    socket.on('disconnect', () => setSocketState('已断开'));
    socket.on('scoreboard:update', reloadScreen);
    socket.on('bracket:update', reloadScreen);
    return () => {
      socket.disconnect();
    };
  }, []);

  if (!data.competition) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#07111f] px-6 text-white">
        <div className="max-w-md text-center">
          <Image src="/logo.png" alt="羽动云赛" width={1536} height={1024} className="mx-auto h-20 w-28 object-contain" />
          <h1 className="mt-5 text-3xl font-black">羽动云赛</h1>
          <p className="mt-3 text-sm font-semibold text-white/60">暂无公开赛事，请在后台创建并发布首页展示赛事。</p>
          <Link href="/admin" className="mt-6 inline-flex h-11 items-center rounded-lg bg-amber-300 px-5 text-sm font-black text-slate-950">
            管理后台
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#07111f] text-white">
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(120deg,rgba(6,95,70,0.28),transparent_32%,rgba(14,165,233,0.16)_68%,rgba(245,158,11,0.18))]" />
      <div
        className="pointer-events-none fixed inset-0 opacity-[0.08]"
        style={{ backgroundImage: "url('/generated/court-lines.svg')", backgroundSize: '900px auto', backgroundPosition: 'center bottom', backgroundRepeat: 'no-repeat' }}
      />

      <div className="relative mx-auto flex min-h-screen w-full max-w-[1680px] flex-col px-5 py-5 lg:px-8">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
          <div className="flex min-w-0 items-center gap-4">
            <Image src="/logo.png" alt="羽动云赛" width={1536} height={1024} priority className="h-14 w-20 shrink-0 object-contain" />
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-200">Live Scoreboard</p>
              <h1 className="truncate text-2xl font-black leading-tight sm:text-4xl">
                {data.competition.name}
              </h1>
              <p className="mt-1 truncate text-sm font-semibold text-white/58">
                {data.competition.location ?? '地点待公布'} · {dateRange} · {data.competition.statusLabel}
              </p>
            </div>
          </div>
          <nav className="flex items-center gap-2">
            <span className={`rounded-full px-3 py-1 text-xs font-black ${socketState === '实时同步' ? 'bg-emerald-400 text-slate-950' : 'bg-white/12 text-white/70'}`}>
              {socketState}
            </span>
            <Link href="/history" className="rounded-lg border border-white/16 px-4 py-2 text-sm font-black text-white/86 transition hover:bg-white/10">
              历届数据
            </Link>
            <Link href="/admin" className="rounded-lg bg-amber-300 px-4 py-2 text-sm font-black text-slate-950 transition hover:bg-amber-200">
              管理后台
            </Link>
          </nav>
        </header>

        <section className="grid gap-4 py-5 sm:grid-cols-3 xl:grid-cols-6">
          {[
            ['报名人数', data.stats.registrations],
            ['比赛项目', data.stats.events],
            ['实时场次', data.stats.liveMatches],
            ['已完赛', data.stats.completedMatches],
            ['已排程', data.stats.scheduledMatches],
            ['场地数', data.stats.venues],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-white/10 bg-white/[0.08] p-4">
              <p className="text-xs font-bold text-white/50">{label}</p>
              <strong className="mt-2 block text-3xl font-black text-white">{value}</strong>
            </div>
          ))}
        </section>

        <section className="grid min-h-0 flex-1 grid-cols-1 gap-5 xl:grid-cols-[1.28fr_0.92fr]">
          <div className="flex min-h-0 flex-col rounded-xl border border-white/10 bg-slate-950/48 p-4">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-200">On Court</p>
                <h2 className="mt-1 text-2xl font-black">正在进行</h2>
              </div>
              <p className="text-xs font-semibold text-white/45">更新 {formatTime(data.generatedAt)}</p>
            </div>
            <div className="mt-4 grid flex-1 content-start gap-3 overflow-hidden">
              {data.liveMatches.length ? (
                data.liveMatches.slice(0, 6).map((match) => <MatchRow key={match.id} match={match} />)
              ) : (
                <EmptyLine text="暂无进行中的比赛" />
              )}
            </div>
          </div>

          <div className="grid min-h-0 gap-5">
            <section className="rounded-xl border border-white/10 bg-white/[0.07] p-4">
              <h2 className="text-xl font-black">即将开始</h2>
              <div className="mt-3 grid gap-3">
                {data.upcomingMatches.length ? (
                  data.upcomingMatches.slice(0, 4).map((match) => <MatchRow key={match.id} match={match} compact />)
                ) : (
                  <EmptyLine text="暂无已排程待赛场次" />
                )}
              </div>
            </section>

            <section className="rounded-xl border border-white/10 bg-white/[0.07] p-4">
              <h2 className="text-xl font-black">最新战报</h2>
              <div className="mt-3 space-y-2">
                {data.recentResults.length ? (
                  data.recentResults.slice(0, 5).map((match) => (
                    <div key={match.id} className="grid grid-cols-[1fr_auto] gap-3 rounded-lg bg-white/[0.06] px-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black">{match.side1} VS {match.side2}</p>
                        <p className="mt-1 text-xs font-semibold text-white/48">{match.eventTypeLabel} · {match.round} · {match.gamesText}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-semibold text-white/45">胜方</p>
                        <p className="mt-1 max-w-32 truncate text-sm font-black text-amber-300">{match.winnerName ?? '待定'}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <EmptyLine text="暂无完赛战报" />
                )}
              </div>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}

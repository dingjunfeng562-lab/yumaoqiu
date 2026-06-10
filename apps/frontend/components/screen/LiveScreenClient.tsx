'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type {
  BracketMatch,
  BracketParticipant,
  KnockoutBracketData,
} from '@/components/bracket/KnockoutBracket';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const SOCKET_BASE = API_BASE.replace(/\/api\/?$/, '');

type SocketState = 'connecting' | 'synced' | 'offline';

const STATUS_LABELS: Record<string, string> = {
  PENDING: '待开始',
  LIVE: '进行中',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
  未开始: '待开始',
  进行中: '进行中',
  已结束: '已完成',
  已完成: '已完成',
};

function normalizeStatus(status?: string | null) {
  const raw = String(status || 'PENDING');
  const upper = raw.toUpperCase();
  if (upper === 'LIVE' || raw === '进行中') return 'LIVE';
  if (upper === 'COMPLETED' || raw === '已结束' || raw === '已完成') return 'COMPLETED';
  if (upper === 'CANCELLED' || raw === '已取消') return 'CANCELLED';
  return 'PENDING';
}

function statusText(status?: string | null) {
  return STATUS_LABELS[String(status)] ?? STATUS_LABELS[normalizeStatus(status)] ?? '待开始';
}

function formatTime(value?: string | null) {
  if (!value) return '待排时间';
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

function parseScore(match: BracketMatch) {
  if (match.forfeitedSide) return { left: 'WO', right: 'WO', detail: match.gamesText || '弃权' };
  const text = match.score || match.gamesText || '0:0';
  const last = text.split(/[/,]/).map((item) => item.trim()).filter(Boolean).pop() ?? text;
  const parts = last.match(/^(\d+)\s*[:：-]\s*(\d+)/);
  return {
    left: parts?.[1] ?? '0',
    right: parts?.[2] ?? '0',
    detail: match.gamesText && match.gamesText !== '-' ? match.gamesText : '当前局',
  };
}

function playerName(participant?: BracketParticipant | null) {
  if (!participant || participant.isBye) return '待定';
  return participant.name;
}

function playersFor(participant?: BracketParticipant | null) {
  if (!participant || participant.isBye) return [];
  return participant.members?.length ? participant.members : [participant.name];
}

function sideFor(bracket: KnockoutBracketData, id?: string | null) {
  if (!id) return null;
  return bracket.participants.find((participant) => participant.id === id) ?? null;
}

function sortMatches(matches: BracketMatch[]) {
  return [...matches].sort((a, b) => a.roundNo - b.roundNo || a.matchNo - b.matchNo);
}

function roundTitle(match: BracketMatch) {
  return match.roundLabel || (match as BracketMatch & { round?: string }).round || `第 ${match.roundNo} 轮`;
}

function groupMatches(matches: BracketMatch[]) {
  const groups: Array<{ key: string; title: string; matches: BracketMatch[] }> = [];
  for (const match of sortMatches(matches)) {
    const title = roundTitle(match);
    const key = `${match.roundNo}-${title}`;
    const group = groups.find((item) => item.key === key);
    if (group) group.matches.push(match);
    else groups.push({ key, title, matches: [match] });
  }
  return groups;
}

function statusClasses(status?: string | null, paused?: boolean) {
  if (paused) return 'border-amber-300/50 bg-amber-300/12 text-amber-100';
  const normalized = normalizeStatus(status);
  if (normalized === 'LIVE') return 'border-emerald-300/55 bg-emerald-400/12 text-emerald-100';
  if (normalized === 'COMPLETED') return 'border-sky-300/35 bg-sky-400/10 text-sky-100';
  if (normalized === 'CANCELLED') return 'border-white/15 bg-white/[0.05] text-white/52';
  return 'border-white/12 bg-white/[0.07] text-white/72';
}

async function fetchBrackets() {
  const res = await fetch(`${API_BASE}/public/brackets`, { cache: 'no-store' });
  if (!res.ok) throw new Error('获取直播大屏数据失败');
  const data = (await res.json()) as { brackets?: KnockoutBracketData[] };
  return data.brackets ?? [];
}

function LivePill({ state }: { state: SocketState }) {
  const text = state === 'synced' ? '实时同步' : state === 'offline' ? '连接断开' : '连接中';
  const cls =
    state === 'synced'
      ? 'bg-emerald-300 text-slate-950'
      : state === 'offline'
        ? 'bg-red-400/20 text-red-100'
        : 'bg-white/12 text-white/70';
  return (
    <span className={`inline-flex h-9 items-center gap-2 rounded-full px-4 text-xs font-black ${cls}`}>
      <span className={`h-2 w-2 rounded-full ${state === 'synced' ? 'bg-slate-950' : 'bg-current'}`} />
      {text}
    </span>
  );
}

function PlayerGrid({ participants }: { participants: BracketParticipant[] }) {
  const players = participants.filter((participant) => !participant.isBye);
  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.07] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-black text-white">选手名单</h2>
        <span className="text-xs font-black text-cyan-100">{players.length} 人 / 每排 6 个</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {players.map((participant) => (
          <div
            key={participant.id}
            className="min-h-[74px] rounded-lg border border-white/10 bg-slate-950/46 px-3 py-2"
          >
            <p className="truncate text-sm font-black text-white">{participant.name}</p>
            {participant.members?.length ? (
              <p className="mt-1 truncate text-xs font-semibold text-white/48">{participant.members.join(' / ')}</p>
            ) : null}
            {participant.seed ? (
              <span className="mt-2 inline-flex rounded-full bg-amber-300 px-2 py-0.5 text-[10px] font-black text-slate-950">
                种子 {participant.seed}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function MatchCard({ bracket, match }: { bracket: KnockoutBracketData; match: BracketMatch }) {
  const side1 = sideFor(bracket, match.side1Id);
  const side2 = sideFor(bracket, match.side2Id);
  const status = normalizeStatus(String(match.status));
  const paused = Boolean(match.matchPaused);
  const score = parseScore(match);
  const displaySwapped = status === 'LIVE' && match.courtDisplayState?.side1CourtSide === 'right';
  const leftSide = displaySwapped ? side2 : side1;
  const rightSide = displaySwapped ? side1 : side2;
  const displayScore = displaySwapped
    ? { left: score.right, right: score.left, detail: score.detail }
    : score;
  const side1Winner = match.winnerSide === 1 || match.winnerId === match.side1Id;
  const side2Winner = match.winnerSide === 2 || match.winnerId === match.side2Id;

  return (
    <article className={`rounded-lg border p-3 shadow-[0_18px_44px_rgba(0,0,0,0.22)] ${statusClasses(String(match.status), paused)}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-black text-cyan-100">{roundTitle(match)}</p>
          <p className="mt-0.5 text-[11px] font-semibold text-white/45">
            第 {match.matchNo} 场 · {formatTime(match.scheduledAt)}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-black ${
          status === 'LIVE' && !paused ? 'bg-emerald-300 text-slate-950' : 'bg-white/12 text-white/72'
        }`}>
          {paused ? '比赛暂停' : statusText(String(match.status))}
        </span>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-3">
        <ScoreSide
          name={playerName(leftSide)}
          players={playersFor(leftSide)}
          score={displayScore.left}
          winner={displaySwapped ? side2Winner : side1Winner}
          align="left"
        />
        <div className="flex min-w-[58px] flex-col items-center justify-center rounded-lg bg-slate-950/56 px-2">
          <span className="text-[10px] font-black uppercase text-white/36">VS</span>
          <span className="mt-1 h-px w-8 bg-white/12" />
          <span className="mt-1 max-w-[56px] truncate text-[10px] font-semibold text-white/42">
            {match.venueName || '待排场地'}
          </span>
        </div>
        <ScoreSide
          name={playerName(rightSide)}
          players={playersFor(rightSide)}
          score={displayScore.right}
          winner={displaySwapped ? side1Winner : side2Winner}
          align="right"
        />
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/10 pt-2 text-[11px] font-semibold text-white/45">
        <span className="truncate">局分：{score.detail}</span>
        {match.latestEvents?.[0]?.text ? <span className="max-w-[45%] truncate">{match.latestEvents[0].text}</span> : null}
      </div>
    </article>
  );
}

function ScoreSide({
  name,
  players,
  score,
  winner,
  align,
}: {
  name: string;
  players: string[];
  score: string;
  winner: boolean;
  align: 'left' | 'right';
}) {
  return (
    <div className={`min-w-0 rounded-lg bg-white/[0.055] p-3 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <div className={`flex items-start gap-3 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-black text-white">{name}</p>
          {players.length > 1 ? (
            <p className="mt-1 truncate text-xs font-semibold text-white/48">{players.join(' / ')}</p>
          ) : null}
          {winner ? (
            <span className="mt-2 inline-flex rounded-full bg-amber-300 px-2 py-0.5 text-[10px] font-black text-slate-950">
              胜
            </span>
          ) : null}
        </div>
        <strong className="shrink-0 text-5xl font-black leading-none text-amber-300 sm:text-6xl">
          {score}
        </strong>
      </div>
    </div>
  );
}

function EmptyState({ brackets }: { brackets: KnockoutBracketData[] }) {
  return (
    <div className="grid min-h-[360px] place-items-center rounded-lg border border-dashed border-white/16 bg-white/[0.05] p-8 text-center">
      <div>
        <h2 className="text-2xl font-black text-white">
          {brackets.length ? '请选择要直播的比赛' : '暂无可直播的对阵'}
        </h2>
        <p className="mt-2 text-sm font-semibold text-white/52">
          后台发布对阵后，这里会显示全部场次安排，并跟随裁判记分实时刷新。
        </p>
      </div>
    </div>
  );
}

export function LiveScreenClient({
  initialBrackets,
  initialTournamentId,
}: {
  initialBrackets: KnockoutBracketData[];
  initialTournamentId?: string | null;
}) {
  const [brackets, setBrackets] = useState(initialBrackets);
  const [selectedId, setSelectedId] = useState(initialBrackets[0]?.id ?? '');
  const [socketState, setSocketState] = useState<SocketState>('connecting');
  const [updatedAt, setUpdatedAt] = useState(new Date());

  const selected = useMemo(
    () => brackets.find((bracket) => bracket.id === selectedId) ?? brackets[0] ?? null,
    [brackets, selectedId],
  );

  const reload = useCallback(async () => {
    try {
      const next = await fetchBrackets();
      setBrackets(next);
      setUpdatedAt(new Date());
      setSelectedId((current) => (next.some((bracket) => bracket.id === current) ? current : (next[0]?.id ?? '')));
    } catch {
      setSocketState('offline');
    }
  }, []);

  useEffect(() => {
    const socket: Socket = io(`${SOCKET_BASE}/scores`, {
      transports: ['websocket'],
      withCredentials: true,
    });
    socket.on('connect', () => setSocketState('synced'));
    socket.on('disconnect', () => setSocketState('offline'));
    socket.on('connect_error', () => setSocketState('offline'));
    socket.on('scoreboard:update', () => {
      void reload();
    });
    // Bracket advance / forfeit / clear events from the scoring service.
    socket.on('bracket:update', () => {
      void reload();
    });
    const timer = window.setInterval(() => {
      void reload();
    }, 15000);
    return () => {
      window.clearInterval(timer);
      socket.disconnect();
    };
  }, [reload]);

  const stats = useMemo(() => {
    const matches = selected?.matches ?? [];
    return {
      total: matches.length,
      live: matches.filter((match) => normalizeStatus(String(match.status)) === 'LIVE').length,
      completed: matches.filter((match) => normalizeStatus(String(match.status)) === 'COMPLETED').length,
      scheduled: matches.filter((match) => match.scheduledAt).length,
    };
  }, [selected]);

  const matchGroups = useMemo(() => groupMatches(selected?.matches ?? []), [selected]);
  const targetTournamentId = selected?.tournamentId ?? initialTournamentId ?? null;
  const bracketHref = targetTournamentId
    ? `/competitions/${encodeURIComponent(targetTournamentId)}#brackets`
    : selected
      ? `/bracket/${encodeURIComponent(selected.id)}`
      : '/bracket';

  return (
    <main className="min-h-screen bg-[#06111f] text-white">
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(120deg,rgba(5,150,105,0.22),transparent_36%,rgba(14,165,233,0.18)_72%,rgba(251,191,36,0.16))]" />
      <div
        className="pointer-events-none fixed inset-0 opacity-[0.08]"
        style={{
          backgroundImage: "url('/generated/court-lines.svg')",
          backgroundPosition: 'center bottom',
          backgroundRepeat: 'no-repeat',
          backgroundSize: '920px auto',
        }}
      />

      <div className="relative mx-auto flex min-h-screen w-full max-w-[1920px] flex-col gap-4 px-5 py-5 lg:px-8">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-100">Live Score Wall</p>
            <h1 className="mt-1 truncate text-3xl font-black leading-tight sm:text-5xl">直播大屏幕</h1>
            <p className="mt-2 truncate text-sm font-semibold text-white/52">
              选择比赛后展示全部场次安排，比分随裁判记分实时同步。
            </p>
          </div>
          <nav className="flex flex-wrap items-center gap-2">
            <LivePill state={socketState} />
            <Link
              href={bracketHref}
              className="inline-flex h-10 items-center rounded-lg border border-white/16 px-4 text-sm font-black text-white/82 transition hover:bg-white/10"
            >
              对阵表
            </Link>
            <Link
              href="/"
              className="inline-flex h-10 items-center rounded-lg bg-amber-300 px-4 text-sm font-black text-slate-950 transition hover:bg-amber-200"
            >
              返回首页
            </Link>
          </nav>
        </header>

        <section className="grid gap-3 rounded-lg border border-white/10 bg-white/[0.07] p-4 lg:grid-cols-[1fr_auto] lg:items-center">
          <label className="min-w-0">
            <span className="mb-2 block text-xs font-black text-white/52">选择比赛</span>
            <select
              value={selected?.id ?? ''}
              onChange={(event) => setSelectedId(event.target.value)}
              className="h-12 w-full rounded-lg border border-white/14 bg-slate-950/72 px-4 text-sm font-black text-white outline-none transition focus:border-cyan-200"
            >
              {brackets.length ? (
                brackets.map((bracket) => (
                  <option key={bracket.id} value={bracket.id}>
                    {bracket.title}
                  </option>
                ))
              ) : (
                <option value="">暂无比赛</option>
              )}
            </select>
          </label>
          <div className="grid grid-cols-4 gap-2 lg:min-w-[520px]">
            {[
              ['总场次', stats.total],
              ['直播中', stats.live],
              ['已完成', stats.completed],
              ['已排程', stats.scheduled],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg bg-slate-950/48 px-3 py-2 text-center">
                <p className="text-[11px] font-bold text-white/45">{label}</p>
                <strong className="mt-1 block text-2xl font-black text-white">{value}</strong>
              </div>
            ))}
          </div>
        </section>

        {selected ? (
          <>
            <PlayerGrid participants={selected.participants} />

            <section className="min-h-0 flex-1 rounded-lg border border-white/10 bg-slate-950/46 p-4">
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-2xl font-black text-white">{selected.title}</h2>
                  {selected.subtitle ? (
                    <p className="mt-1 truncate text-sm font-semibold text-white/48">{selected.subtitle}</p>
                  ) : null}
                </div>
                <p className="text-xs font-semibold text-white/42">
                  更新 {updatedAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
                </p>
              </div>

              <div className="space-y-5">
                {matchGroups.map((group) => (
                  <section key={group.key}>
                    <div className="mb-2 flex items-center gap-3">
                      <h3 className="shrink-0 text-sm font-black text-cyan-100">{group.title}</h3>
                      <span className="h-px flex-1 bg-white/10" />
                      <span className="text-xs font-semibold text-white/38">{group.matches.length} 场</span>
                    </div>
                    <div className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
                      {group.matches.map((match) => (
                        <MatchCard key={match.id} bracket={selected} match={match} />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </section>
          </>
        ) : (
          <EmptyState brackets={brackets} />
        )}
      </div>
    </main>
  );
}

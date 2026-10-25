'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type {
  BracketMatch,
  BracketParticipant,
  KnockoutBracketData,
} from '@/components/bracket/KnockoutBracket';
import type { SecondStageData } from '@/components/bracket/SecondStageBracket';
import { SecondStageCrossBracket } from '@/components/bracket/SecondStageCrossBracket';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const SOCKET_BASE = API_BASE.replace(/\/api\/?$/, '');

type SocketState = 'connecting' | 'synced' | 'offline';
type MatchFilter = 'ALL' | 'LIVE' | 'PENDING' | 'COMPLETED';

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

type ParsedGame = { side1: number; side2: number };

function parseGames(text: string) {
  const games: ParsedGame[] = [];
  for (const segment of text.split(/[/,]/)) {
    const parts = segment.trim().match(/^(\d+)\s*[:：-]\s*(\d+)/);
    if (parts) games.push({ side1: Number(parts[1]), side2: Number(parts[2]) });
  }
  return games;
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

function isByeMatch(bracket: KnockoutBracketData, match: BracketMatch) {
  const side1 = sideFor(bracket, match.side1Id);
  const side2 = sideFor(bracket, match.side2Id);
  if (side1?.isBye || side2?.isBye) return true;

  const hasMissingSide = !match.side1Id || !match.side2Id;
  if (!hasMissingSide) return false;

  // 首轮没有上游场次，缺少任意一方即为轮空。后续轮次在选手尚未晋级时也会
  // 暂时缺少一方，只有系统已经自动完赛/取消时才可确定为轮空或空场。
  const status = normalizeStatus(String(match.status));
  return match.roundNo <= 1 || status === 'COMPLETED' || status === 'CANCELLED';
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
  if (normalized === 'LIVE') return 'border-yellow-300/60 bg-yellow-400/15 text-yellow-100';
  if (normalized === 'COMPLETED') return 'border-red-400/55 bg-red-500/15 text-red-100';
  if (normalized === 'CANCELLED') return 'border-white/15 bg-white/[0.05] text-white/52';
  return 'border-white/12 bg-white/[0.07] text-white/72';
}

function statusPillClasses(status?: string | null, paused?: boolean) {
  if (paused) return 'bg-amber-300 text-slate-950';
  const normalized = normalizeStatus(status);
  if (normalized === 'LIVE') return 'bg-yellow-300 text-slate-950';
  if (normalized === 'COMPLETED') return 'bg-red-500 text-white';
  return 'bg-white/12 text-white/72';
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
    <span className={`inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-[11px] font-black sm:h-9 sm:gap-2 sm:px-4 sm:text-xs ${cls}`}>
      <span
        className={`h-1.5 w-1.5 rounded-full sm:h-2 sm:w-2 ${
          state === 'synced' ? 'bg-slate-950' : state === 'connecting' ? 'animate-pulse bg-current' : 'bg-current'
        }`}
      />
      {text}
    </span>
  );
}

function MatchCard({ bracket, match }: { bracket: KnockoutBracketData; match: BracketMatch }) {
  const side1 = sideFor(bracket, match.side1Id);
  const side2 = sideFor(bracket, match.side2Id);
  const status = normalizeStatus(String(match.status));
  const paused = Boolean(match.matchPaused);
  const forfeit = Boolean(match.forfeitedSide);
  const displaySwapped = status === 'LIVE' && match.courtDisplayState?.side1CourtSide === 'right';

  const sourceText =
    match.gamesText && match.gamesText !== '-'
      ? match.gamesText
      : status === 'LIVE'
        ? match.score ?? ''
        : '';
  const games = forfeit ? [] : parseGames(sourceText);
  const decided = Boolean(match.winnerSide || match.winnerId);
  const currentGameIndex = status === 'LIVE' && !decided && games.length ? games.length - 1 : -1;
  let side1Sets = 0;
  let side2Sets = 0;
  games.forEach((game, index) => {
    if (index === currentGameIndex) return;
    if (game.side1 > game.side2) side1Sets += 1;
    else if (game.side2 > game.side1) side2Sets += 1;
  });

  const orient = (game: ParsedGame) =>
    displaySwapped ? { left: game.side2, right: game.side1 } : { left: game.side1, right: game.side2 };
  const leftSide = displaySwapped ? side2 : side1;
  const rightSide = displaySwapped ? side1 : side2;
  const sets = displaySwapped
    ? { left: side2Sets, right: side1Sets }
    : { left: side1Sets, right: side2Sets };
  const side1Winner = match.winnerSide === 1 || match.winnerId === match.side1Id;
  const side2Winner = match.winnerSide === 2 || match.winnerId === match.side2Id;
  const currentGame = currentGameIndex >= 0 ? orient(games[currentGameIndex]) : null;
  const lastGame = games.length ? orient(games[games.length - 1]) : null;
  const refereeName = match.refereeName?.trim();
  // 底部右侧沿用原来的弃权/最新事件说明，裁判固定放在左下角。
  const footerNote = forfeit && match.gamesText ? match.gamesText : match.latestEvents?.[0]?.text ?? '';

  return (
    <article className={`rounded-xl border p-3 shadow-[0_14px_34px_rgba(0,0,0,0.2)] ${statusClasses(String(match.status), paused)}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-black leading-tight text-cyan-100/90 sm:text-xs">
            {roundTitle(match)} · 第 {match.matchNo} 场 · {match.venueName || '待排场地'}
          </p>
          <p className="mt-1 truncate text-[10px] font-semibold leading-none tabular-nums text-white/45 sm:text-[11px]">
            {status === 'LIVE' && currentGameIndex >= 0
              ? `局数 ${sets.left}:${sets.right} · 第 ${games.length} 局`
              : formatTime(match.scheduledAt)}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black leading-none sm:text-[11px] ${statusPillClasses(String(match.status), paused)}`}>
          {paused ? '比赛暂停' : statusText(String(match.status))}
        </span>
      </div>

      <div className="mt-2.5 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:mt-3 sm:gap-3">
        <SideName
          name={playerName(leftSide)}
          players={playersFor(leftSide)}
          winner={displaySwapped ? side2Winner : side1Winner}
          align="right"
        />
        <div className="text-center">
          {forfeit ? (
            <>
              <strong className="block text-[26px] font-black leading-none text-amber-300 sm:text-3xl">WO</strong>
              <p className="mt-1 text-[10px] font-semibold text-white/45 sm:text-xs">{match.forfeitLabel ?? '弃权'}</p>
            </>
          ) : status === 'LIVE' && currentGame ? (
            <strong className="block whitespace-nowrap text-[34px] font-black leading-none tabular-nums text-amber-300 sm:text-5xl">
              {currentGame.left}
              <span className="px-1 text-white/25 sm:px-1.5">:</span>
              {currentGame.right}
            </strong>
          ) : (status === 'COMPLETED' || decided) && games.length ? (
            <>
              <strong className="block whitespace-nowrap text-[34px] font-black leading-none tabular-nums text-amber-300 sm:text-5xl">
                {sets.left}
                <span className="px-1 text-white/25 sm:px-1.5">:</span>
                {sets.right}
              </strong>
              {lastGame ? (
                <p className="mt-1 text-[10px] font-semibold tabular-nums text-white/45 sm:text-xs">
                  末局 {lastGame.left}:{lastGame.right}
                </p>
              ) : null}
            </>
          ) : (
            <span className="block px-2 text-xl font-black leading-none text-white/25 sm:text-2xl">VS</span>
          )}
        </div>
        <SideName
          name={playerName(rightSide)}
          players={playersFor(rightSide)}
          winner={displaySwapped ? side1Winner : side2Winner}
          align="left"
        />
      </div>

      {games.length && !forfeit ? (
        <div className="mt-2.5 flex flex-wrap items-center justify-center gap-1.5 sm:mt-3 sm:gap-2">
          {games.map((game, index) => {
            const view = orient(game);
            const isCurrent = index === currentGameIndex;
            const leftWon = !isCurrent && view.left > view.right;
            const rightWon = !isCurrent && view.right > view.left;
            return (
              <span
                key={index}
                className={`rounded-md border px-2 py-0.5 text-xs font-black tabular-nums sm:rounded-lg sm:px-2.5 sm:py-1 sm:text-sm ${
                  isCurrent
                    ? 'border-emerald-300/60 bg-emerald-400/10 text-emerald-200'
                    : 'border-white/15 bg-white/[0.04]'
                }`}
              >
                <span className={isCurrent ? '' : leftWon ? 'text-amber-300' : 'text-white/45'}>{view.left}</span>
                <span className={isCurrent ? 'text-emerald-200/70' : 'text-white/30'}>:</span>
                <span className={isCurrent ? '' : rightWon ? 'text-amber-300' : 'text-white/45'}>{view.right}</span>
                {isCurrent ? <span className="ml-1 align-middle text-[9px] sm:text-[10px]">●</span> : null}
              </span>
            );
          })}
        </div>
      ) : null}

      {refereeName || footerNote ? (
        <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-white/10 pt-2">
          <span className="flex min-w-0 items-center gap-1.5 text-[10px] font-semibold sm:text-[11px]">
            <span className="shrink-0 text-white/38">本场裁判</span>
            <span className="truncate font-black text-cyan-100/90">{refereeName || '待分配'}</span>
          </span>
          {footerNote ? (
            <span className="min-w-0 truncate text-right text-[10px] font-semibold text-white/42 sm:text-[11px]">
              {footerNote}
            </span>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function SideName({
  name,
  players,
  winner,
  align,
}: {
  name: string;
  players: string[];
  winner: boolean;
  align: 'left' | 'right';
}) {
  return (
    <div className={`min-w-0 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <p className={`truncate text-[17px] font-black leading-tight sm:text-lg ${winner ? 'text-amber-200' : 'text-white'}`}>
        {name}
      </p>
      {players.length > 1 ? (
        <p className="mt-0.5 truncate text-[11px] font-semibold leading-tight text-white/45 sm:text-xs">
          {players.join(' / ')}
        </p>
      ) : null}
    </div>
  );
}

function EmptyState({ brackets }: { brackets: KnockoutBracketData[] }) {
  return (
    <div className="grid min-h-[260px] place-items-center rounded-xl border border-dashed border-white/16 bg-white/[0.05] p-6 text-center sm:min-h-[360px] sm:p-8">
      <div>
        <h2 className="text-xl font-black text-white sm:text-2xl">
          {brackets.length ? '请选择要直播的比赛' : '暂无可直播的对阵'}
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-xs font-semibold leading-relaxed text-white/52 sm:text-sm">
          后台发布对阵后，这里会显示全部场次安排，并跟随裁判记分实时刷新。
        </p>
      </div>
    </div>
  );
}

function SecondStageWall({ data }: { data: SecondStageData }) {
  const status = String(data.secondStageStatus ?? data.status ?? '').toUpperCase();
  if (status !== 'CONFIRMED' && status !== 'FINISHED') return null;
  if (!data.matches?.length) return null;
  const rankings = [...(data.rankings ?? [])].sort((a, b) => a.rank - b.rank);
  return (
    <section className="rounded-lg border border-emerald-300/25 bg-emerald-400/[0.06] p-4">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-200/80">Second Stage</p>
          <h2 className="mt-1 truncate text-2xl font-black text-white">第二阶段：小组赛排位赛</h2>
        </div>
        <span className="shrink-0 rounded-full bg-emerald-300 px-3 py-1 text-xs font-black text-slate-950">
          {data.rankingModeText ?? '取前8名'}
        </span>
      </div>
      <div className="space-y-5">
        <SecondStageCrossBracket
          matches={data.matches}
          rankingMode={data.rankingMode ?? 'TOP_8'}
          variant="dark"
        />
        {rankings.length ? (
          <section>
            <div className="mb-2 flex items-center gap-3">
              <h3 className="shrink-0 text-sm font-black text-amber-200">最终排名</h3>
              <span className="h-px flex-1 bg-white/10" />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
              {rankings.map((ranking) => (
                <div
                  key={ranking.rank}
                  className="flex items-center justify-between rounded-lg border border-white/10 bg-slate-950/46 px-3 py-2"
                >
                  <span className="text-sm font-black text-amber-300">第{ranking.rank}名</span>
                  <span className="min-w-0 truncate text-right text-sm font-black text-white">
                    {ranking.playerName ?? '待定'}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </section>
  );
}

export function LiveScreenClient({
  initialBrackets,
  initialTournamentId,
}: {
  initialBrackets: KnockoutBracketData[];
  initialTournamentId?: string | null;
}) {
  const initialSelectedTournamentId =
    initialTournamentId && initialBrackets.some((bracket) => bracket.tournamentId === initialTournamentId)
      ? initialTournamentId
      : initialBrackets[0]?.tournamentId ?? '';
  const initialSelectedEventId =
    initialBrackets.find((bracket) => bracket.tournamentId === initialSelectedTournamentId)?.id ??
    initialBrackets[0]?.id ??
    '';
  const [brackets, setBrackets] = useState(initialBrackets);
  const [selectedTournamentId, setSelectedTournamentId] = useState(initialSelectedTournamentId);
  const [selectedId, setSelectedId] = useState(initialSelectedEventId);
  const [socketState, setSocketState] = useState<SocketState>('connecting');
  const [updatedAt, setUpdatedAt] = useState(new Date());

  // 一级：赛事（按 tournamentId 去重，保留后端顺序）。
  const tournaments = useMemo(() => {
    const seen = new Map<string, { id: string; name: string }>();
    for (const bracket of brackets) {
      const tid = bracket.tournamentId;
      if (!tid || seen.has(tid)) continue;
      seen.set(tid, { id: tid, name: bracket.tournamentName ?? bracket.title });
    }
    return [...seen.values()];
  }, [brackets]);

  // 用「有效值」兜底渲染：所选失效（数据刷新/越界）时自动回退首项，无需副作用纠偏。
  const effectiveTournamentId =
    selectedTournamentId && tournaments.some((t) => t.id === selectedTournamentId)
      ? selectedTournamentId
      : tournaments[0]?.id ?? '';

  // 二级：该赛事下的组别（项目）。
  const events = useMemo(
    () => brackets.filter((bracket) => bracket.tournamentId === effectiveTournamentId),
    [brackets, effectiveTournamentId],
  );

  const effectiveEventId =
    selectedId && events.some((e) => e.id === selectedId) ? selectedId : events[0]?.id ?? '';

  const selected = useMemo(
    () => brackets.find((bracket) => bracket.id === effectiveEventId) ?? null,
    [brackets, effectiveEventId],
  );

  // 切赛事时，组别默认落到该赛事第一个项目。
  const handleTournamentChange = useCallback(
    (tid: string) => {
      setSelectedTournamentId(tid);
      const first = brackets.find((bracket) => bracket.tournamentId === tid);
      setSelectedId(first?.id ?? '');
    },
    [brackets],
  );

  const reload = useCallback(async () => {
    try {
      const next = await fetchBrackets();
      setBrackets(next);
      setUpdatedAt(new Date());
      // 选择保持不变；若刷新后所选已不存在，渲染时的「有效值」会自动回退首项。
    } catch {
      setSocketState('offline');
    }
  }, []);

  useEffect(() => {
    const socket: Socket = io(`${SOCKET_BASE}/scores`, {
      transports: ['polling', 'websocket'],
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

  const [filter, setFilter] = useState<MatchFilter>('ALL');

  const allMatches = useMemo(
    () => (selected ? selected.matches.filter((match) => !isByeMatch(selected, match)) : []),
    [selected],
  );

  const counts = useMemo(() => {
    let live = 0;
    let completed = 0;
    let pending = 0;
    for (const match of allMatches) {
      const status = normalizeStatus(String(match.status));
      if (status === 'LIVE') live += 1;
      else if (status === 'COMPLETED') completed += 1;
      else if (status === 'PENDING') pending += 1;
    }
    return { total: allMatches.length, live, completed, pending };
  }, [allMatches]);

  const visibleMatches = useMemo(
    () =>
      filter === 'ALL'
        ? allMatches
        : allMatches.filter((match) => normalizeStatus(String(match.status)) === filter),
    [allMatches, filter],
  );

  const matchGroups = useMemo(() => groupMatches(visibleMatches), [visibleMatches]);

  const filterOptions = useMemo<Array<{ key: MatchFilter; label: string; count: number }>>(
    () => [
      { key: 'ALL', label: '全部', count: counts.total },
      { key: 'LIVE', label: '进行中', count: counts.live },
      { key: 'PENDING', label: '待开始', count: counts.pending },
      { key: 'COMPLETED', label: '已完成', count: counts.completed },
    ],
    [counts],
  );

  const bracketHref = selected
    ? `/bracket/${encodeURIComponent(selected.id)}`
    : '/bracket';
  const updatedText = updatedAt.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  return (
    <main className="min-h-dvh bg-[#06111f] text-white">
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

      <div className="relative mx-auto flex min-h-dvh w-full max-w-[1920px] flex-col gap-3 px-4 pt-[calc(env(safe-area-inset-top)+1rem)] pb-[calc(env(safe-area-inset-bottom)+1.25rem)] sm:gap-4 sm:px-5 sm:py-5 lg:px-8">
        <header className="border-b border-white/10 pb-3 sm:pb-4">
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-100/85 sm:text-xs sm:tracking-[0.18em]">
                Live Score Wall
              </p>
              <h1 className="mt-1 text-3xl font-black leading-tight sm:text-4xl lg:text-5xl">直播大屏幕</h1>
              <p className="mt-1.5 text-[11px] font-semibold leading-snug text-white/45 sm:mt-2 sm:text-sm sm:text-white/52">
                选择比赛后展示全部场次安排，比分随裁判记分实时同步。
              </p>
            </div>
            <nav className="flex w-full items-center gap-2 sm:w-auto">
              <LivePill state={socketState} />
              <Link
                href={bracketHref}
                className="tappable inline-flex h-10 flex-1 items-center justify-center rounded-lg border border-white/16 px-3 text-xs font-black text-white/85 transition hover:bg-white/10 sm:flex-none sm:px-4 sm:text-sm"
              >
                对阵表
              </Link>
              <Link
                href="/"
                className="tappable inline-flex h-10 flex-1 items-center justify-center rounded-lg bg-amber-300 px-3 text-xs font-black text-slate-950 transition hover:bg-amber-200 sm:flex-none sm:px-4 sm:text-sm"
              >
                返回首页
              </Link>
            </nav>
          </div>
        </header>

        <section className="rounded-xl border border-white/10 bg-white/[0.06] p-3 sm:p-4">
          <div className="grid gap-2.5 sm:grid-cols-2 sm:gap-3">
            <label className="min-w-0">
              <span className="mb-1.5 block text-[11px] font-black text-white/50">选择比赛</span>
              <select
                value={effectiveTournamentId}
                onChange={(event) => handleTournamentChange(event.target.value)}
                className="h-11 w-full rounded-lg border border-white/14 bg-slate-950/72 px-3 text-sm font-black text-white outline-none transition focus:border-cyan-200 sm:h-12 sm:px-4"
              >
                {tournaments.length ? (
                  tournaments.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))
                ) : (
                  <option value="">暂无比赛</option>
                )}
              </select>
            </label>
            <label className="min-w-0">
              <span className="mb-1.5 block text-[11px] font-black text-white/50">选择组别</span>
              <select
                value={effectiveEventId}
                onChange={(event) => setSelectedId(event.target.value)}
                className="h-11 w-full rounded-lg border border-white/14 bg-slate-950/72 px-3 text-sm font-black text-white outline-none transition focus:border-cyan-200 sm:h-12 sm:px-4"
              >
                {events.length ? (
                  events.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.groupLabel ?? ev.title}
                    </option>
                  ))
                ) : (
                  <option value="">暂无组别</option>
                )}
              </select>
            </label>
          </div>

          <div className="mt-3 flex gap-1.5 sm:mt-3.5 sm:max-w-[440px] sm:gap-2">
            {filterOptions.map((option) => {
              const active = filter === option.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setFilter(option.key)}
                  aria-pressed={active}
                  className={`tappable flex min-h-[44px] flex-1 flex-col items-center justify-center gap-1 rounded-lg border transition ${
                    active
                      ? 'border-cyan-300/70 bg-cyan-300/15 text-cyan-50'
                      : 'border-white/10 bg-slate-950/40 text-white/55 hover:border-white/25 hover:text-white/80'
                  }`}
                >
                  <span className="text-[15px] font-black leading-none tabular-nums sm:text-lg">{option.count}</span>
                  <span className="text-[10px] font-bold leading-none sm:text-[11px]">{option.label}</span>
                </button>
              );
            })}
          </div>
        </section>

        {selected ? (
          <>
            <section className="min-h-0 flex-1 rounded-xl border border-white/10 bg-slate-950/40 p-3 sm:p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-[11px] font-black uppercase tracking-[0.16em] text-white/45">场次安排</h2>
                <p className="text-[10px] font-semibold tabular-nums text-white/35 sm:text-[11px]">更新 {updatedText}</p>
              </div>

              {visibleMatches.length ? (
                <div className="space-y-4 sm:space-y-5">
                  {matchGroups.map((group) => (
                    <section key={group.key}>
                      <div className="mb-2 flex items-center gap-3">
                        <h3 className="shrink-0 text-xs font-black text-cyan-100 sm:text-sm">{group.title}</h3>
                        <span className="h-px flex-1 bg-white/10" />
                        <span className="text-[10px] font-semibold text-white/38 sm:text-xs">
                          {group.matches.length} 场
                        </span>
                      </div>
                      <div className="grid gap-2 sm:gap-3 md:grid-cols-2 2xl:grid-cols-3">
                        {group.matches.map((match) => (
                          <MatchCard key={match.id} bracket={selected} match={match} />
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              ) : (
                <div className="grid min-h-[180px] place-items-center rounded-lg border border-dashed border-white/12 p-6 text-center">
                  <div>
                    <p className="text-sm font-black text-white/75">当前筛选没有场次</p>
                    <p className="mt-1 text-[11px] font-semibold text-white/40">
                      切换筛选可查看该组别的全部安排。
                    </p>
                    <button
                      type="button"
                      onClick={() => setFilter('ALL')}
                      className="tappable mt-3 inline-flex h-9 items-center rounded-lg border border-white/16 px-3 text-xs font-black text-white/85 transition hover:bg-white/10"
                    >
                      查看全部 {counts.total} 场
                    </button>
                  </div>
                </div>
              )}
            </section>

            {selected.secondStage ? <SecondStageWall data={selected.secondStage} /> : null}
          </>
        ) : (
          <EmptyState brackets={brackets} />
        )}
      </div>
    </main>
  );
}

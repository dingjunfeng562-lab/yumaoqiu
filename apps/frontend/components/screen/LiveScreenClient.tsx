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
    <article className={`rounded-lg border p-3 shadow-[0_18px_44px_rgba(0,0,0,0.22)] ${statusClasses(String(match.status), paused)}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-black text-cyan-100">
            {roundTitle(match)} · 第 {match.matchNo} 场 · {match.venueName || '待排场地'}
          </p>
          <p className="mt-0.5 truncate text-[11px] font-semibold tabular-nums text-white/45">
            {status === 'LIVE' && currentGameIndex >= 0
              ? `局数 ${sets.left}:${sets.right} · 第 ${games.length} 局`
              : formatTime(match.scheduledAt)}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-black ${
          status === 'LIVE' && !paused ? 'bg-emerald-300 text-slate-950' : 'bg-white/12 text-white/72'
        }`}>
          {paused ? '比赛暂停' : statusText(String(match.status))}
        </span>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
        <SideName
          name={playerName(leftSide)}
          players={playersFor(leftSide)}
          winner={displaySwapped ? side2Winner : side1Winner}
          align="right"
        />
        <div className="text-center">
          {forfeit ? (
            <>
              <strong className="block text-3xl font-black leading-none text-amber-300">WO</strong>
              <p className="mt-1 text-xs font-semibold text-white/45">{match.forfeitLabel ?? '弃权'}</p>
            </>
          ) : status === 'LIVE' && currentGame ? (
            <strong className="block whitespace-nowrap text-4xl font-black leading-none tabular-nums text-amber-300 sm:text-5xl">
              {currentGame.left}
              <span className="px-1.5 text-white/30">:</span>
              {currentGame.right}
            </strong>
          ) : (status === 'COMPLETED' || decided) && games.length ? (
            <>
              <strong className="block whitespace-nowrap text-4xl font-black leading-none tabular-nums text-amber-300 sm:text-5xl">
                {sets.left}
                <span className="px-1.5 text-white/30">:</span>
                {sets.right}
              </strong>
              {lastGame ? (
                <p className="mt-1 text-xs font-semibold tabular-nums text-white/45">
                  末局 {lastGame.left}:{lastGame.right}
                </p>
              ) : null}
            </>
          ) : (
            <span className="block px-2 text-2xl font-black leading-none text-white/30">VS</span>
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
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          {games.map((game, index) => {
            const view = orient(game);
            const isCurrent = index === currentGameIndex;
            const leftWon = !isCurrent && view.left > view.right;
            const rightWon = !isCurrent && view.right > view.left;
            return (
              <span
                key={index}
                className={`rounded-lg border px-2.5 py-1 text-sm font-black tabular-nums ${
                  isCurrent
                    ? 'border-emerald-300/60 bg-emerald-400/10 text-emerald-200'
                    : 'border-white/15 bg-white/[0.04]'
                }`}
              >
                <span className={isCurrent ? '' : leftWon ? 'text-amber-300' : 'text-white/45'}>{view.left}</span>
                <span className={isCurrent ? 'text-emerald-200/70' : 'text-white/30'}>:</span>
                <span className={isCurrent ? '' : rightWon ? 'text-amber-300' : 'text-white/45'}>{view.right}</span>
                {isCurrent ? <span className="ml-1 align-middle text-[10px]">●</span> : null}
              </span>
            );
          })}
        </div>
      ) : null}

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/10 pt-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold">
          <span className="shrink-0 text-white/40">本场裁判</span>
          <span className="truncate font-black text-cyan-100">{refereeName || '待分配'}</span>
        </span>
        {footerNote ? (
          <span className="min-w-0 truncate text-right text-[11px] font-semibold text-white/45">
            {footerNote}
          </span>
        ) : null}
      </div>
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
      <p className="truncate text-lg font-black text-white">{name}</p>
      {players.length > 1 ? (
        <p className="mt-0.5 truncate text-xs font-semibold text-white/48">{players.join(' / ')}</p>
      ) : null}
      {winner ? (
        <span className="mt-1.5 inline-flex rounded-full bg-amber-300 px-2 py-0.5 text-[10px] font-black text-slate-950">
          胜
        </span>
      ) : null}
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
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="min-w-0">
              <span className="mb-2 block text-xs font-black text-white/52">选择比赛</span>
              <select
                value={effectiveTournamentId}
                onChange={(event) => handleTournamentChange(event.target.value)}
                className="h-12 w-full rounded-lg border border-white/14 bg-slate-950/72 px-4 text-sm font-black text-white outline-none transition focus:border-cyan-200"
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
              <span className="mb-2 block text-xs font-black text-white/52">选择组别</span>
              <select
                value={effectiveEventId}
                onChange={(event) => setSelectedId(event.target.value)}
                className="h-12 w-full rounded-lg border border-white/14 bg-slate-950/72 px-4 text-sm font-black text-white outline-none transition focus:border-cyan-200"
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
            <section className="min-h-0 flex-1 rounded-lg border border-white/10 bg-slate-950/46 p-4">
              <div className="mb-4 flex justify-end">
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

            {selected.secondStage ? <SecondStageWall data={selected.secondStage} /> : null}
          </>
        ) : (
          <EmptyState brackets={brackets} />
        )}
      </div>
    </main>
  );
}

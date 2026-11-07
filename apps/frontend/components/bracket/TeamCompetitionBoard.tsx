'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  fetchTeamBoard,
  teamFormatText,
  teamRoundText,
  teamScoringText,
  teamTimeText,
  type TeamBoardChild,
  type TeamBoardCompetition,
  type TeamBoardEncounter,
  type TeamBoardGroup,
  type TeamBoardTeam,
} from '@/lib/team-board';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const SOCKET_BASE = API_BASE.replace(/\/api\/?$/, '');
/** 兜底刷新间隔；平时靠计分推送更新，页面不可见时不刷新。 */
const POLL_MS = 60_000;

/** scoreboard:update 推送里用得到的字段（裁判端每记一分都会推）。 */
type ScorePush = {
  id?: string;
  status?: string;
  winnerSide?: number | null;
  forfeitedSide?: number | null;
  games?: Array<{ gameNo: number; side1Score: number; side2Score: number; winnerSide: number | null }>;
};

function findChild(competitions: TeamBoardCompetition[], id: string) {
  for (const competition of competitions) {
    for (const encounter of competition.encounters) {
      const child = encounter.children.find((item) => item.id === id);
      if (child) return child;
    }
  }
  return null;
}

/** 把一条计分推送里的比分写进对应子项，其它数据不动。 */
function patchChild(competitions: TeamBoardCompetition[], push: ScorePush): TeamBoardCompetition[] {
  let changed = false;
  const next = competitions.map((competition) => {
    let competitionChanged = false;
    const encounters = competition.encounters.map((encounter) => {
      const index = encounter.children.findIndex((child) => child.id === push.id);
      if (index < 0) return encounter;
      competitionChanged = true;
      const children = encounter.children.slice();
      const child = children[index];
      children[index] = {
        ...child,
        status: push.status ?? child.status,
        winnerSide: push.winnerSide !== undefined ? push.winnerSide : child.winnerSide,
        forfeitedSide: push.forfeitedSide !== undefined ? push.forfeitedSide : child.forfeitedSide,
        games: push.games
          ? push.games.map((game) => ({ gameNo: game.gameNo, side1Score: game.side1Score, side2Score: game.side2Score, winnerSide: game.winnerSide }))
          : child.games,
      };
      return { ...encounter, children };
    });
    if (!competitionChanged) return competition;
    changed = true;
    return { ...competition, encounters };
  });
  return changed ? next : competitions;
}

/**
 * 团体赛对阵表的实时数据。
 * - 子项每记一分：直接用推送里的比分改这一个子项，不重新拉取。
 * - 子项开赛或结束（出场名单、团体总比分、积分榜会变）、对阵变化、断线重连：重新拉取本赛事的团体赛。
 */
function useLiveTeamBoard(initial: TeamBoardCompetition[], tournamentId: string) {
  const [competitions, setCompetitions] = useState(initial);
  const competitionsRef = useRef(competitions);
  useEffect(() => {
    competitionsRef.current = competitions;
  });

  const syncRef = useRef({ running: false, rerun: false });
  const reload = useCallback(async () => {
    const sync = syncRef.current;
    if (sync.running) {
      sync.rerun = true;
      return;
    }
    sync.running = true;
    try {
      do {
        sync.rerun = false;
        try {
          setCompetitions(await fetchTeamBoard(tournamentId));
        } catch {
          // 网络抖动时保留当前数据，下一次推送或兜底刷新再取。
        }
      } while (sync.rerun);
    } finally {
      sync.running = false;
    }
  }, [tournamentId]);

  const timerRef = useRef<number | null>(null);
  const scheduleReload = useCallback((delay: number) => {
    if (timerRef.current !== null) return;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void reload();
    }, delay);
  }, [reload]);
  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  useEffect(() => {
    const socket: Socket = io(`${SOCKET_BASE}/scores`, { transports: ['polling', 'websocket'], withCredentials: true });
    let connectedBefore = false;
    socket.on('connect', () => {
      // 断线期间的推送收不到，重连后补拉一次。
      if (connectedBefore) scheduleReload(0);
      connectedBefore = true;
    });
    socket.on('scoreboard:update', (push: ScorePush) => {
      if (!push?.id) return;
      const current = findChild(competitionsRef.current, push.id);
      if (!current) return;
      const structural = (push.status !== undefined && push.status !== current.status)
        || (push.forfeitedSide !== undefined && push.forfeitedSide !== current.forfeitedSide);
      setCompetitions((prev) => patchChild(prev, push));
      if (structural) scheduleReload(1500);
    });
    socket.on('bracket:update', (payload: { tournamentId?: string | null }) => {
      if (payload?.tournamentId && payload.tournamentId !== tournamentId) return;
      scheduleReload(800);
    });
    return () => {
      socket.disconnect();
    };
  }, [tournamentId, scheduleReload]);

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') void reload();
    };
    const timer = window.setInterval(refreshIfVisible, POLL_MS);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [reload]);

  return competitions;
}

export function TeamCompetitionBoard({
  tournamentId,
  initialCompetitions,
}: {
  tournamentId: string;
  initialCompetitions: TeamBoardCompetition[];
}) {
  const competitions = useLiveTeamBoard(initialCompetitions, tournamentId);
  if (!competitions.length) return null;
  return (
    <>
      {competitions.map((competition) => (
        <TeamCompetitionCard key={competition.id} competition={competition} />
      ))}
    </>
  );
}

const hasBothTeams = (encounter: TeamBoardEncounter) => Boolean(encounter.team1 && encounter.team2);

function TeamCompetitionCard({ competition }: { competition: TeamBoardCompetition }) {
  const groupEncounters = competition.encounters.filter((encounter) => encounter.stage === 'GROUP');
  const knockout = competition.encounters.filter((encounter) => encounter.stage !== 'GROUP');
  const hasGroups = competition.groups.length > 0;
  const hasKnockout = knockout.length > 0;
  // 淘汰赛已经开打（或小组赛已全部结束）时默认看淘汰赛，否则看小组赛。
  const [tab, setTab] = useState<'group' | 'knockout'>(() => {
    if (!hasGroups) return 'knockout';
    const groupsDone = groupEncounters.length > 0 && groupEncounters.every((encounter) => encounter.status === 'COMPLETED' || encounter.status === 'CANCELLED');
    return hasKnockout && (groupsDone || knockout.some((encounter) => encounter.status !== 'PENDING' && hasBothTeams(encounter))) ? 'knockout' : 'group';
  });
  const activeTab = tab === 'knockout' && !hasKnockout ? 'group' : tab === 'group' && !hasGroups ? 'knockout' : tab;

  const real = competition.encounters.filter(hasBothTeams);
  const liveCount = real.filter((encounter) => encounter.status === 'LIVE').length;
  const completedCount = real.filter((encounter) => encounter.status === 'COMPLETED').length;
  const items = competition.items.map((item) => item.label).join('、');

  return (
    <section className="overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-sm">
      <header className="border-b border-emerald-100 bg-gradient-to-r from-[#053b2e] via-[#0b7a5a] to-[#053b2e] px-4 py-4 text-white sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-black tracking-wide sm:text-lg">{competition.name}</h2>
            <p className="mt-1 text-[11px] font-semibold text-emerald-50/85 sm:text-xs">
              团体赛 · {competition.entrantTypeLabel} · {teamFormatText(competition.format)} · {competition.teamCount} 队
            </p>
            <p className="mt-0.5 text-[11px] font-semibold text-emerald-50/75 sm:text-xs">
              每场 {competition.items.length} 项（{items}），先胜 {competition.winThreshold} 项；子项 {teamScoringText(competition)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold text-emerald-50/90 sm:text-xs">
            <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
              {real.length} 场对阵
            </span>
            {liveCount > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-500/85 px-2.5 py-1 text-white">
                <span className="bracket-live-pulse h-1.5 w-1.5 rounded-full bg-white" />
                {liveCount} 进行中
              </span>
            ) : null}
            {completedCount > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-300" />
                {completedCount} 已结束
              </span>
            ) : null}
          </div>
        </div>
        {hasGroups && hasKnockout ? (
          <div className="mt-3 inline-flex rounded-lg bg-white/10 p-0.5">
            {([
              { key: 'group', label: '小组赛' },
              { key: 'knockout', label: '淘汰赛' },
            ] as const).map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setTab(item.key)}
                className={`h-7 rounded-md px-3 text-[11px] font-black transition sm:h-8 sm:text-xs ${
                  activeTab === item.key ? 'bg-white text-[#053b2e] shadow-sm' : 'text-emerald-50/85 hover:text-white'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : null}
      </header>

      <div className="space-y-4 p-3 sm:p-5">
        {!competition.encounters.length ? (
          <p className="py-6 text-center text-sm font-bold text-slate-500">抽签完成后，这里会显示团体赛对阵。</p>
        ) : activeTab === 'group' ? (
          <>
            {competition.groups.map((group) => (
              <GroupCard
                key={group.id}
                group={group}
                encounters={groupEncounters.filter((encounter) => encounter.groupId === group.id)}
                showAdvanced={competition.format === 'GROUP_PLUS_KNOCKOUT'}
                singleGroup={competition.groups.length === 1}
              />
            ))}
            <p className="px-1 text-[11px] font-medium leading-5 text-slate-400">
              积分榜依次比较胜场（赢下的团体对阵数）、胜次（正式子项获胜数）、净胜分（正式子项逐局得分减失分）；仍相同时比较同分队之间的相互战绩，再比较负次。
              {competition.playAllMatches ? '胜负确定后补打的子项只保留比分，不计入积分。' : ''}
              {competition.format === 'GROUP_PLUS_KNOCKOUT' && competition.advancePerGroup ? `每组前 ${competition.advancePerGroup} 名进入淘汰赛。` : ''}
            </p>
          </>
        ) : (
          <KnockoutRounds encounters={knockout} />
        )}
      </div>
    </section>
  );
}

function GroupCard({
  group,
  encounters,
  showAdvanced,
  singleGroup,
}: {
  group: TeamBoardGroup;
  encounters: TeamBoardEncounter[];
  showAdvanced: boolean;
  singleGroup: boolean;
}) {
  const ordered = [...encounters].sort((a, b) => a.roundNo - b.roundNo || a.matchNo - b.matchNo);
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 sm:p-4">
      <h3 className="text-sm font-black text-slate-900">{singleGroup ? '循环赛' : group.groupName}</h3>
      <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[380px] text-xs">
          <thead className="bg-slate-50 text-[11px] font-bold text-slate-500">
            <tr>
              <th className="w-12 px-2 py-2 text-center">名次</th>
              <th className="px-2 py-2 text-left">队伍</th>
              <th className="px-2 py-2 text-center">胜/负</th>
              <th className="px-2 py-2 text-center">胜次</th>
              <th className="px-2 py-2 text-center">净胜分</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {group.standings.map((row) => (
              <tr key={row.teamId}>
                <td className="px-2 py-2 text-center font-black tabular-nums text-slate-700">{row.rank ?? '—'}</td>
                <td className="px-2 py-2">
                  <span className="font-black text-slate-900">{row.teamName}</span>
                  {showAdvanced && row.advanced ? (
                    <span className="ml-1.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-black text-emerald-700">出线</span>
                  ) : null}
                  {row.affiliation && row.affiliation !== row.teamName ? (
                    <span className="block truncate text-[11px] font-semibold text-slate-400">{row.affiliation}</span>
                  ) : null}
                </td>
                <td className="px-2 py-2 text-center tabular-nums font-bold text-slate-700">{row.wins}/{row.losses}</td>
                <td className="px-2 py-2 text-center tabular-nums text-slate-700">{row.matchesWon}</td>
                <td className="px-2 py-2 text-center tabular-nums text-slate-700">{row.netMatches > 0 ? `+${row.netMatches}` : row.netMatches}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {ordered.length ? (
        <div className="mt-3 grid items-start gap-2 lg:grid-cols-2">
          {ordered.map((encounter) => (
            <EncounterCard key={encounter.id} encounter={encounter} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function KnockoutRounds({ encounters }: { encounters: TeamBoardEncounter[] }) {
  // 季军赛与决赛同一轮，排在决赛后面。
  const rounds = useMemo(() => {
    const byRound = new Map<string, TeamBoardEncounter[]>();
    const ordered = [...encounters].sort((a, b) =>
      a.roundNo - b.roundNo || Number(a.round === 'BRONZE') - Number(b.round === 'BRONZE') || a.matchNo - b.matchNo);
    for (const encounter of ordered) {
      const list = byRound.get(encounter.round) ?? [];
      list.push(encounter);
      byRound.set(encounter.round, list);
    }
    return [...byRound.entries()];
  }, [encounters]);
  return (
    <>
      {rounds.map(([round, list]) => (
        <div key={round}>
          <h3 className="mb-2 px-1 text-sm font-black text-slate-900">{teamRoundText({ stage: 'KNOCKOUT', round })}</h3>
          <div className="grid items-start gap-2 lg:grid-cols-2">
            {list.map((encounter) => (
              <EncounterCard key={encounter.id} encounter={encounter} showRound={false} />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

const ENCOUNTER_STATUS: Record<string, { text: string; className: string }> = {
  PENDING: { text: '未开始', className: 'bg-slate-100 text-slate-500' },
  LIVE: { text: '进行中', className: 'bg-red-50 text-red-600' },
  COMPLETED: { text: '已结束', className: 'bg-emerald-50 text-emerald-700' },
  CANCELLED: { text: '已取消', className: 'bg-slate-100 text-slate-400' },
};

function EncounterCard({ encounter, showRound = true }: { encounter: TeamBoardEncounter; showRound?: boolean }) {
  const [open, setOpen] = useState(encounter.status === 'LIVE');
  const bye = encounter.status === 'COMPLETED' && !hasBothTeams(encounter) && Boolean(encounter.winnerTeamId);
  const status = bye ? { text: '轮空晋级', className: 'bg-slate-100 text-slate-500' } : ENCOUNTER_STATUS[encounter.status] ?? ENCOUNTER_STATUS.PENDING;
  const started = encounter.status !== 'PENDING' && !bye;
  const time = encounter.status === 'PENDING' ? teamTimeText(encounter.scheduledAt) : '';
  const meta = [showRound ? teamRoundText(encounter) : '', time, encounter.status !== 'COMPLETED' ? encounter.venueName ?? '' : '']
    .filter(Boolean)
    .join(' · ');
  const canOpen = hasBothTeams(encounter) && encounter.children.length > 0;
  return (
    <div className={`rounded-xl border bg-white ${encounter.status === 'LIVE' ? 'border-red-200 shadow-sm' : 'border-slate-200'}`}>
      <button
        type="button"
        disabled={!canOpen}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={canOpen ? open : undefined}
        className="w-full px-3 py-2.5 text-left disabled:cursor-default"
      >
        <div className="flex items-center justify-between gap-2 text-[11px] font-bold text-slate-500">
          <span className="min-w-0 truncate">{meta || ' '}</span>
          <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 ${status.className}`}>
            {encounter.status === 'LIVE' ? <span className="bracket-live-pulse h-1.5 w-1.5 rounded-full bg-red-500" /> : null}
            {status.text}
          </span>
        </div>
        <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
          <TeamLabel team={encounter.team1} winner={encounter.winnerTeamId !== null && encounter.winnerTeamId === encounter.team1?.id} placeholder={bye ? '轮空' : '待定'} />
          <span className={`text-center text-lg font-black tabular-nums ${started ? 'text-slate-900' : 'text-slate-300'}`}>
            {started ? `${encounter.team1Wins} : ${encounter.team2Wins}` : 'VS'}
          </span>
          <TeamLabel team={encounter.team2} winner={encounter.winnerTeamId !== null && encounter.winnerTeamId === encounter.team2?.id} placeholder={bye ? '轮空' : '待定'} alignRight />
        </div>
        {canOpen ? (
          <p className="mt-1 text-center text-[11px] font-bold text-emerald-700">{open ? '收起子项比分' : '查看子项比分'}</p>
        ) : null}
      </button>
      {open && canOpen ? (
        <ul className="divide-y divide-slate-100 border-t border-slate-100">
          {encounter.children.map((child) => (
            <ChildRow key={child.id} child={child} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function TeamLabel({ team, winner, placeholder, alignRight = false }: { team: TeamBoardTeam | null; winner: boolean; placeholder: string; alignRight?: boolean }) {
  return (
    <span className={`min-w-0 ${alignRight ? 'text-right' : ''}`}>
      <span className={`block truncate text-sm ${team ? (winner ? 'font-black text-emerald-700' : 'font-black text-slate-900') : 'font-bold text-slate-400'}`}>
        {team?.name ?? placeholder}
      </span>
      {team?.affiliation && team.affiliation !== team.name ? (
        <span className="block truncate text-[11px] font-semibold text-slate-400">{team.affiliation}</span>
      ) : null}
    </span>
  );
}

const CHILD_STATUS: Record<string, string> = {
  PENDING: '未开始',
  LIVE: '进行中',
  COMPLETED: '已结束',
  CANCELLED: '无需比赛',
};

function ChildRow({ child }: { child: TeamBoardChild }) {
  const games = child.games.filter((game) => game.side1Score > 0 || game.side2Score > 0 || game.winnerSide);
  const time = child.status === 'PENDING' ? teamTimeText(child.scheduledAt) : '';
  const names = (players: string[]) => (players.length ? players.join(' / ') : child.status === 'CANCELLED' ? '—' : '名单待公布');
  return (
    <li className={`px-3 py-2 ${child.status === 'CANCELLED' ? 'opacity-60' : ''}`}>
      <div className="flex items-center justify-between gap-2 text-[11px] font-bold">
        <span className="text-slate-700">第 {child.matchNo} 项 · {child.label}</span>
        <span className={child.status === 'LIVE' ? 'text-red-600' : 'text-slate-400'}>
          {CHILD_STATUS[child.status] ?? child.status}
          {time ? ` · ${time}` : ''}
          {child.isSupplemental ? ' · 补打，不计成绩' : ''}
        </span>
      </div>
      <div className="mt-1 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 text-xs">
        <SidePlayers text={names(child.side1Players)} winner={child.winnerSide === 1 && child.status === 'COMPLETED'} forfeited={child.forfeitedSide === 1} />
        <span className="text-center font-black tabular-nums text-slate-800">
          {games.length ? games.map((game) => `${game.side1Score}:${game.side2Score}`).join('  ') : '—'}
        </span>
        <SidePlayers text={names(child.side2Players)} winner={child.winnerSide === 2 && child.status === 'COMPLETED'} forfeited={child.forfeitedSide === 2} alignRight />
      </div>
    </li>
  );
}

function SidePlayers({ text, winner, forfeited, alignRight = false }: { text: string; winner: boolean; forfeited: boolean; alignRight?: boolean }) {
  return (
    <span className={`min-w-0 truncate ${alignRight ? 'text-right' : ''} ${winner ? 'font-black text-emerald-700' : 'font-semibold text-slate-600'}`}>
      {forfeited ? <span className="mr-1 rounded bg-red-50 px-1 text-[10px] font-black text-red-600">弃权</span> : null}
      {text}
    </span>
  );
}

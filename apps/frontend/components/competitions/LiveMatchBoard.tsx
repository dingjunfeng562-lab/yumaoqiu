'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  BracketMatch,
  BracketParticipant,
  KnockoutBracketData,
} from '@/components/bracket/KnockoutBracket';
import {
  isByeMatch,
  normalizeStatus,
  parseGames,
  playerName,
  playersFor,
  roundTitle,
  type ParsedGame,
} from '@/lib/match-display';
import { matchesSearch } from '@/lib/search-text';
import { useLiveBrackets } from '@/lib/use-live-brackets';
import { HighlightText, SearchBox, replaceSearchParam } from './SearchBox';
import { formatClock, formatMonthDayTime } from './types';

// 赛事比分直播：把该赛事所有单打/双打项目的场次按场地、时间排成一列，
// 可按运动员姓名筛选。比分沿用对阵表的实时推送（useLiveBrackets），
// 每得一分只就地更新那一场，不会让每个观众重新拉全部数据。
// 团体赛不在公开对阵数据里，暂不显示。

type SocketState = 'connecting' | 'synced' | 'offline';
type BoardStatus = 'LIVE' | 'PENDING' | 'COMPLETED';
type Tab = 'ALL' | BoardStatus;

type SideView = {
  name: string;
  members: string[];
  showMembers: boolean;
  affiliation: string | null;
  winner: boolean;
  placeholder: boolean;
};

type BoardMatch = {
  key: string;
  eventLabel: string;
  roundLabel: string;
  roundNo: number;
  matchNo: number;
  status: BoardStatus;
  paused: boolean;
  side1: SideView;
  side2: SideView;
  venue: string | null;
  scheduledAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  games: ParsedGame[];
  currentGameIndex: number;
  sets: { side1: number; side2: number };
  forfeitText: string | null;
  secondStage: boolean;
  /** 该场地按排定顺序的第几场 */
  courtSeq: number | null;
  /** 待开始：同一场地前面还有几场（正在打的 + 排在前面还没打的） */
  ahead: number | null;
};

const NO_VENUE = '待排场地';

function sideView(participant: BracketParticipant | null, winner: boolean): SideView {
  const placeholder = !participant || Boolean(participant.isBye);
  const members = playersFor(participant);
  const name = playerName(participant);
  const joined = members.join('/').replace(/\s+/g, '');
  return {
    name,
    members,
    showMembers: members.length > 1 && joined !== name.replace(/\s+/g, ''),
    affiliation: participant?.affiliation?.trim() || null,
    winner,
    placeholder,
  };
}

function scoreParts(text: string, status: BoardStatus, decided: boolean) {
  const games = parseGames(text);
  const currentGameIndex = status === 'LIVE' && !decided && games.length ? games.length - 1 : -1;
  const sets = { side1: 0, side2: 0 };
  games.forEach((game, index) => {
    if (index === currentGameIndex) return;
    if (game.side1 > game.side2) sets.side1 += 1;
    else if (game.side2 > game.side1) sets.side2 += 1;
  });
  return { games, currentGameIndex, sets };
}

// 选手查找表：淘汰赛签位 + 小组名单。小组赛+淘汰赛的项目生成淘汰赛后，participants 只剩
// 出线选手，小组赛里被淘汰的选手只在 groups 里，不合并就会显示成「待定」、也搜不到。
function participantLookup(bracket: KnockoutBracketData) {
  const lookup = new Map<string, BracketParticipant>();
  for (const group of bracket.groups ?? []) {
    for (const member of group.members) lookup.set(member.id, member);
  }
  for (const participant of bracket.participants) lookup.set(participant.id, participant);
  return (id?: string | null) => (id ? lookup.get(id) ?? null : null);
}

function bracketMatchView(
  bracket: KnockoutBracketData,
  match: BracketMatch,
  eventLabel: string,
  findSide: (id?: string | null) => BracketParticipant | null,
): BoardMatch | null {
  const status = normalizeStatus(String(match.status));
  if (status === 'CANCELLED' || isByeMatch(bracket, match)) return null;
  const forfeit = Boolean(match.forfeitedSide);
  const decided = Boolean(match.winnerSide || match.winnerId);
  const sourceText =
    match.gamesText && match.gamesText !== '-' ? match.gamesText : status === 'LIVE' ? match.score ?? '' : '';
  const score = forfeit ? scoreParts('', status, decided) : scoreParts(sourceText, status, decided);
  const venue = match.venueName && match.venueName !== NO_VENUE ? match.venueName : null;
  return {
    key: `${bracket.id}:${match.id}`,
    eventLabel,
    roundLabel: roundTitle(match),
    roundNo: match.roundNo,
    matchNo: match.matchNo,
    status,
    paused: Boolean(match.matchPaused),
    side1: sideView(findSide(match.side1Id), match.winnerSide === 1 || (!!match.winnerId && match.winnerId === match.side1Id)),
    side2: sideView(findSide(match.side2Id), match.winnerSide === 2 || (!!match.winnerId && match.winnerId === match.side2Id)),
    venue,
    scheduledAt: match.scheduledAt ?? null,
    startedAt: match.startedAt ?? null,
    finishedAt: match.finishedAt ?? null,
    ...score,
    forfeitText: forfeit ? match.gamesText || match.forfeitLabel || '弃权' : null,
    secondStage: false,
    courtSeq: null,
    ahead: null,
  };
}

// 「单淘汰 + 小组排位」的第二阶段排位赛：公开数据里没有场地和时间。
function secondStageViews(bracket: KnockoutBracketData, eventLabel: string): BoardMatch[] {
  const stage = bracket.secondStage;
  const stageStatus = String(stage?.secondStageStatus ?? stage?.status ?? '').toUpperCase();
  if (!stage?.matches?.length || (stageStatus !== 'CONFIRMED' && stageStatus !== 'FINISHED')) return [];
  return stage.matches.flatMap((match): BoardMatch[] => {
    const status = normalizeStatus(match.status);
    if (status === 'CANCELLED') return [];
    const side = (no: 1 | 2): SideView => {
      const id = no === 1 ? match.player1Id : match.player2Id;
      const name = (no === 1 ? match.player1Name : match.player2Name) || (no === 1 ? match.source1 : match.source2) || '待定';
      const members = (no === 1 ? match.player1Members : match.player2Members) ?? [];
      return {
        name,
        members: members.length ? members : [name],
        showMembers: members.length > 1 && members.join('/').replace(/\s+/g, '') !== name.replace(/\s+/g, ''),
        affiliation: null,
        winner: match.winnerSide === no || (!!match.winnerId && match.winnerId === id),
        placeholder: !id,
      };
    };
    return [{
      key: `${bracket.id}:second:${match.id ?? match.matchNo}`,
      eventLabel,
      roundLabel: match.roundName ? `排位赛 ${match.roundName}` : '第二阶段排位赛',
      roundNo: 10_000,
      matchNo: match.matchNo,
      status,
      paused: false,
      side1: side(1),
      side2: side(2),
      venue: null,
      scheduledAt: null,
      startedAt: null,
      finishedAt: null,
      ...scoreParts(match.score ?? '', status, Boolean(match.winnerSide || match.winnerId)),
      forfeitText: null,
      secondStage: true,
      courtSeq: null,
      ahead: null,
    }];
  });
}

function timeOf(value: string | null) {
  if (!value) return Number.POSITIVE_INFINITY;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
}

function compareVenue(a: string | null, b: string | null) {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b, 'zh-CN', { numeric: true });
}

// 同一场地的排定顺序：先按预计时间（没有则用实际开始/结束时间），再按轮次、场次。
function compareCourtOrder(a: BoardMatch, b: BoardMatch) {
  const at = timeOf(a.scheduledAt ?? a.startedAt ?? a.finishedAt);
  const bt = timeOf(b.scheduledAt ?? b.startedAt ?? b.finishedAt);
  if (at !== bt) return at < bt ? -1 : 1;
  return a.roundNo - b.roundNo || a.matchNo - b.matchNo || a.key.localeCompare(b.key);
}

/** 算出每场比赛在其场地上的「第几场」和「前面还有几场」。会直接改写传入的对象。 */
function assignCourtQueue(matches: BoardMatch[]) {
  const courts = new Map<string, BoardMatch[]>();
  for (const match of matches) {
    if (!match.venue || match.secondStage) continue;
    const list = courts.get(match.venue) ?? [];
    list.push(match);
    courts.set(match.venue, list);
  }
  for (const list of courts.values()) {
    list.sort(compareCourtOrder);
    let waiting = list.filter((match) => match.status === 'LIVE').length;
    list.forEach((match, index) => {
      match.courtSeq = index + 1;
      if (match.status !== 'PENDING') return;
      match.ahead = waiting;
      waiting += 1;
    });
  }
}

const STATUS_RANK: Record<BoardStatus, number> = { LIVE: 0, PENDING: 1, COMPLETED: 2 };

// 列表顺序：进行中（按场地）→ 待开始（按预计时间、排队位置）→ 已结束（最近结束的在前）。
function compareBoard(a: BoardMatch, b: BoardMatch) {
  if (a.status !== b.status) return STATUS_RANK[a.status] - STATUS_RANK[b.status];
  if (a.status === 'LIVE') return compareVenue(a.venue, b.venue) || compareCourtOrder(a, b);
  if (a.status === 'PENDING') {
    const at = timeOf(a.scheduledAt);
    const bt = timeOf(b.scheduledAt);
    if (at !== bt) return at < bt ? -1 : 1;
    const aAhead = a.ahead ?? Number.POSITIVE_INFINITY;
    const bAhead = b.ahead ?? Number.POSITIVE_INFINITY;
    if (aAhead !== bAhead) return aAhead < bAhead ? -1 : 1;
    return compareVenue(a.venue, b.venue) || compareCourtOrder(a, b);
  }
  const af = timeOf(a.finishedAt);
  const bf = timeOf(b.finishedAt);
  if (af !== bf) return af === Number.POSITIVE_INFINITY ? 1 : bf === Number.POSITIVE_INFINITY ? -1 : bf - af;
  return compareCourtOrder(a, b);
}

function buildBoard(brackets: KnockoutBracketData[]) {
  const matches = brackets.flatMap((bracket) => {
    const eventLabel = bracket.groupLabel || bracket.title;
    const findSide = participantLookup(bracket);
    const main = bracket.matches.flatMap((match) => {
      const view = bracketMatchView(bracket, match, eventLabel, findSide);
      return view ? [view] : [];
    });
    return [...main, ...secondStageViews(bracket, eventLabel)];
  });
  assignCourtQueue(matches);
  return matches.sort(compareBoard);
}

function sideMatches(side: SideView, keyword: string) {
  if (side.placeholder) return false;
  return matchesSearch(side.name, keyword) || side.members.some((member) => matchesSearch(member, keyword));
}

/** 命中的选手姓名（双打按个人算），用于判断是否锁定到同一个人。 */
function matchedPeople(match: BoardMatch, keyword: string) {
  const people: string[] = [];
  for (const side of [match.side1, match.side2]) {
    if (!sideMatches(side, keyword)) continue;
    const hits = side.members.filter((member) => matchesSearch(member, keyword));
    people.push(...(hits.length ? hits : [side.name]));
  }
  return people;
}

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'ALL', label: '全部' },
  { key: 'LIVE', label: '进行中' },
  { key: 'PENDING', label: '待开始' },
  { key: 'COMPLETED', label: '已结束' },
];

export function LiveMatchBoard({
  tournamentId,
  initialBrackets,
  initialPlayer,
}: {
  tournamentId: string;
  initialBrackets: KnockoutBracketData[];
  initialPlayer: string;
}) {
  const [socketState, setSocketState] = useState<SocketState>('connecting');
  const { brackets } = useLiveBrackets(initialBrackets, {
    tournamentId,
    pollMs: 60_000,
    onSocketState: setSocketState,
    onRefetchError: () => setSocketState('offline'),
  });
  const [query, setQuery] = useState(initialPlayer);
  const [tab, setTab] = useState<Tab>('ALL');
  const keyword = query.trim();

  const board = useMemo(
    () => buildBoard(brackets.filter((bracket) => bracket.tournamentId === tournamentId)),
    [brackets, tournamentId],
  );
  const searched = useMemo(
    () => (keyword ? board.filter((match) => sideMatches(match.side1, keyword) || sideMatches(match.side2, keyword)) : board),
    [board, keyword],
  );
  const counts = useMemo(() => {
    const result: Record<Tab, number> = { ALL: searched.length, LIVE: 0, PENDING: 0, COMPLETED: 0 };
    for (const match of searched) result[match.status] += 1;
    return result;
  }, [searched]);
  const visible = useMemo(
    () => (tab === 'ALL' ? searched : searched.filter((match) => match.status === tab)),
    [searched, tab],
  );
  // 搜到的是同一个人时，把他当前/下一场标出来（「锁定」）。
  const focus = useMemo(() => {
    if (!keyword || !searched.length) return null;
    const people = new Set(searched.flatMap((match) => matchedPeople(match, keyword)));
    if (people.size !== 1) return null;
    const next = searched.find((match) => match.status !== 'COMPLETED');
    return next ? { key: next.key, person: [...people][0] } : null;
  }, [searched, keyword]);

  const handleQuery = (value: string) => {
    setQuery(value);
    replaceSearchParam('player', value);
  };

  // 状态栏 + 搜索框滚出屏幕后固定在顶部。不能用 CSS sticky：globals.css 给 html 和 body
  // 都设了 overflow-x: hidden，body 变成一个不会滚动的滚动容器，sticky 永远不会生效
  //（站点顶栏的 sticky 也因此失效）。这里用一个哨兵元素判断是否滚过，改用 fixed。
  const sentinelRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(false);
  const [toolbarHeight, setToolbarHeight] = useState(0);
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(([entry]) => {
      const scrolledPast = !entry.isIntersecting && entry.boundingClientRect.top < 0;
      if (scrolledPast && toolbarRef.current) setToolbarHeight(toolbarRef.current.offsetHeight);
      setPinned(scrolledPast);
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="flex items-center justify-end gap-3">
        <LivePill state={socketState} />
      </div>

      <div>
        <div ref={sentinelRef} aria-hidden />
        {pinned ? <div style={{ height: toolbarHeight }} aria-hidden /> : null}
        <div
          ref={toolbarRef}
          className={pinned ? 'fixed inset-x-0 top-0 z-30 border-b border-blue-100 bg-[#f5f8ff]/95 shadow-sm backdrop-blur' : ''}
        >
          <div className={pinned ? 'mx-auto max-w-[1440px] space-y-2.5 px-3 py-2.5 sm:px-6 lg:px-8' : 'space-y-2.5'}>
            <div role="tablist" aria-label="比赛状态" className="grid grid-cols-4 gap-1 rounded-xl border border-blue-100 bg-white p-1 shadow-sm sm:max-w-xl">
              {TABS.map((item) => {
                const active = tab === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => {
                      setTab(item.key);
                      // 已固定在顶部时切换状态，回到列表开头
                      if (pinned) sentinelRef.current?.scrollIntoView({ block: 'start' });
                    }}
                    className={`tappable flex h-10 items-center justify-center gap-1 rounded-lg text-[13px] font-black transition sm:text-sm ${
                      active ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-blue-50'
                    }`}
                  >
                    {item.label}
                    <span className={`text-[11px] tabular-nums ${active ? 'text-white/80' : 'text-slate-400'}`}>{counts[item.key]}</span>
                  </button>
                );
              })}
            </div>
            <div className="sm:max-w-xl">
              <SearchBox
                value={query}
                onChange={handleQuery}
                label="按运动员姓名查找场次"
                placeholder="输入运动员姓名查找相关场次信息…"
              />
            </div>
            {keyword ? (
              <p className="px-1 text-xs font-semibold text-slate-500" aria-live="polite">
                {searched.length
                  ? `「${keyword}」共 ${searched.length} 场：进行中 ${counts.LIVE} · 待开始 ${counts.PENDING} · 已结束 ${counts.COMPLETED}`
                  : `没有找到「${keyword}」的场次`}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {!board.length ? (
        <EmptyCard title="该赛事暂未发布对阵" text="对阵发布并排好场地后，这里会显示全部场次、场地顺序和实时比分。" />
      ) : keyword && !searched.length ? (
        <EmptyCard
          title={`没有找到「${keyword}」的场次`}
          text="请输入报名时填写的运动员姓名，可只输入其中几个字。团体赛暂不支持按姓名查询。"
        />
      ) : !visible.length ? (
        <EmptyCard title={`暂无${TABS.find((item) => item.key === tab)?.label}的比赛`} text="切换上方状态查看其他场次。" />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((match) => (
            <li key={match.key}>
              <MatchCard
                match={match}
                keyword={keyword}
                focusLabel={focus?.key === match.key ? (match.status === 'LIVE' ? `${focus.person} 正在比赛` : `${focus.person} 的下一场`) : null}
              />
            </li>
          ))}
        </ul>
      )}

      {board.length ? (
        <p className="px-1 pt-1 text-xs font-medium leading-5 text-slate-400">
          场地顺序按后台排定的时间计算，实际以现场裁判安排为准。比分随裁判记分实时更新；团体赛暂未接入此页面。
        </p>
      ) : null}
    </div>
  );
}

function LivePill({ state }: { state: SocketState }) {
  const text = state === 'synced' ? '实时更新中' : state === 'offline' ? '连接断开，重试中' : '连接中';
  const cls =
    state === 'synced'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : state === 'offline'
        ? 'bg-red-50 text-red-600 border-red-200'
        : 'bg-slate-50 text-slate-500 border-slate-200';
  const dot = state === 'synced' ? 'bg-emerald-500 animate-pulse' : state === 'offline' ? 'bg-red-500' : 'bg-slate-400 animate-pulse';
  return (
    <span className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-black ${cls}`}>
      <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden />
      {text}
    </span>
  );
}

function EmptyCard({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-blue-200 bg-white px-6 py-10 text-center shadow-sm">
      <h2 className="text-base font-black text-slate-800">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm font-semibold leading-6 text-slate-500">{text}</p>
    </div>
  );
}

function StatusPill({ match }: { match: BoardMatch }) {
  if (match.paused) {
    return <span className="shrink-0 rounded-full bg-amber-400 px-3 py-1 text-xs font-black text-white">比赛暂停</span>;
  }
  if (match.status === 'LIVE') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-red-500 px-3 py-1 text-xs font-black text-white">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" aria-hidden />
        进行中
      </span>
    );
  }
  if (match.status === 'COMPLETED') {
    return <span className="shrink-0 rounded-full bg-slate-200 px-3 py-1 text-xs font-black text-slate-600">已结束</span>;
  }
  return <span className="shrink-0 rounded-full bg-blue-600 px-3 py-1 text-xs font-black text-white">等待开始</span>;
}

function MatchCard({ match, keyword, focusLabel }: { match: BoardMatch; keyword: string; focusLabel: string | null }) {
  const live = match.status === 'LIVE';
  const current = match.currentGameIndex >= 0 ? match.games[match.currentGameIndex] : null;
  const timeText =
    match.status === 'PENDING'
      ? `预计：${formatMonthDayTime(match.scheduledAt) ?? '时间待定'}`
      : live
        ? `开始：${formatClock(match.startedAt) ?? '--:--'}`
        : `结束：${formatMonthDayTime(match.finishedAt) ?? '--'}`;

  return (
    <article
      className={`overflow-hidden rounded-xl border bg-white shadow-sm ${
        focusLabel ? 'border-emerald-400 ring-2 ring-emerald-300/70' : live ? 'border-red-200' : 'border-blue-100'
      }`}
    >
      {focusLabel ? (
        <p className="bg-emerald-500 px-4 py-1.5 text-xs font-black text-white">▶ {focusLabel}</p>
      ) : null}
      <header className="flex items-start justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <h3 className="min-w-0 text-[15px] font-black leading-snug text-blue-700">
          {match.eventLabel}
          <span className="text-blue-300"> - </span>
          {match.roundLabel}
        </h3>
        <StatusPill match={match} />
      </header>

      <QueueBanner match={match} />

      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-4 py-3.5">
        <SideBlock side={match.side1} keyword={keyword} align="left" />
        <div className="min-w-[72px] text-center">
          {match.forfeitText ? (
            <span className="block text-lg font-black text-amber-500">弃权</span>
          ) : live && current ? (
            <>
              <strong className="block whitespace-nowrap text-[32px] font-black leading-none tabular-nums text-red-500">
                {current.side1}
                <span className="px-1 text-slate-300">:</span>
                {current.side2}
              </strong>
              <span className="mt-1 block text-[11px] font-semibold tabular-nums text-slate-400">
                局分 {match.sets.side1}:{match.sets.side2} · 第{match.games.length}局
              </span>
            </>
          ) : match.status === 'COMPLETED' && match.games.length ? (
            <strong className="block whitespace-nowrap text-2xl font-black leading-none tabular-nums text-slate-800">
              {match.sets.side1}
              <span className="px-1 text-slate-300">:</span>
              {match.sets.side2}
            </strong>
          ) : (
            <span className="block text-lg font-black text-slate-300">VS</span>
          )}
        </div>
        <SideBlock side={match.side2} keyword={keyword} align="right" />
      </div>

      {match.forfeitText ? (
        <p className="-mt-1 px-4 pb-3 text-center text-xs font-semibold text-amber-600">{match.forfeitText}</p>
      ) : match.games.length && match.status !== 'PENDING' ? (
        <div className="-mt-1 flex flex-wrap items-center justify-center gap-1.5 px-4 pb-3">
          {match.games.map((game, index) => {
            const isCurrent = index === match.currentGameIndex;
            return (
              <span
                key={index}
                className={`rounded-md border px-2 py-0.5 text-xs font-black tabular-nums ${
                  isCurrent ? 'border-red-200 bg-red-50 text-red-600' : 'border-slate-200 bg-slate-50 text-slate-600'
                }`}
              >
                <span className={!isCurrent && game.side1 > game.side2 ? 'text-blue-700' : ''}>{game.side1}</span>
                <span className="text-slate-300">:</span>
                <span className={!isCurrent && game.side2 > game.side1 ? 'text-blue-700' : ''}>{game.side2}</span>
                {isCurrent ? <span className="ml-1 text-[10px]">进行中</span> : null}
              </span>
            );
          })}
        </div>
      ) : null}

      <footer className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-slate-100 bg-slate-50/70 px-4 py-2.5 text-[13px] font-semibold text-slate-600">
        <span>
          场地：
          {match.venue ? (
            <>
              <b className="font-black text-slate-900">{match.venue}</b>
              {match.courtSeq ? `（第${match.courtSeq}场）` : ''}
            </>
          ) : match.secondStage ? (
            '以现场安排为准'
          ) : (
            '待安排'
          )}
        </span>
        {match.secondStage ? null : <span className="tabular-nums">{timeText}</span>}
      </footer>
    </article>
  );
}

function QueueBanner({ match }: { match: BoardMatch }) {
  if (match.status !== 'PENDING' || !match.venue || match.ahead === null) return null;
  if (match.ahead > 0) {
    return (
      <p className="flex items-start gap-2 bg-orange-500 px-4 py-2.5 text-[13px] font-black leading-5 text-white">
        <span aria-hidden>⚠</span>
        <span>
          前面还有 <span className="text-base text-yellow-200">{match.ahead}</span> 场比赛，请注意检录及比赛时间。
        </span>
      </p>
    );
  }
  return (
    <p className="flex items-start gap-2 border-b border-emerald-100 bg-emerald-50 px-4 py-2.5 text-[13px] font-black leading-5 text-emerald-700">
      <span aria-hidden>●</span>
      <span>本场是 {match.venue} 的下一场，请尽快检录候场。</span>
    </p>
  );
}

function SideBlock({ side, keyword, align }: { side: SideView; keyword: string; align: 'left' | 'right' }) {
  return (
    <div className={`min-w-0 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <p
        className={`break-words text-[16px] font-black leading-tight ${
          side.placeholder ? 'text-slate-400' : side.winner ? 'text-blue-700' : 'text-slate-900'
        }`}
      >
        {side.winner ? <span className="mr-1 align-middle text-[11px] text-blue-500">胜</span> : null}
        <HighlightText text={side.name} query={keyword} />
      </p>
      {side.showMembers ? (
        <p className="mt-0.5 break-words text-xs font-semibold leading-tight text-slate-500">
          {side.members.map((member, index) => (
            <span key={`${member}-${index}`}>
              {index ? ' / ' : ''}
              <HighlightText text={member} query={keyword} />
            </span>
          ))}
        </p>
      ) : null}
      {side.affiliation ? (
        <p className="mt-0.5 truncate text-[11px] font-semibold text-slate-400">{side.affiliation}</p>
      ) : null}
    </div>
  );
}

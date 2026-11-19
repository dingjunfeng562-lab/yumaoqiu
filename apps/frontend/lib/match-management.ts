// 裁判员对局管理（/nicaiyixiahh/match-management）的纯逻辑：需处理判断、状态标签计数、筛选搜索、
// 场地视图分组、赛事排序。只有类型导入，没有运行时依赖，方便 node --test 直接测。

export type MMStatus = 'PENDING' | 'LIVE' | 'COMPLETED' | 'CANCELLED';

export type MMSide = {
  id: string;
  name: string;
  teamName?: string | null;
  affiliation?: string | null;
  players?: Array<{ id: string; index: number; name: string; affiliation?: string | null }>;
};

/** 页面上的场次（对局管理 overview 接口的 matches 元素里本库用到的字段）。 */
export type MMMatch = {
  id: string;
  code?: string | null;
  eventId: string | null;
  teamMatchId: string | null;
  teamCompetitionId: string | null;
  eventTypeLabel: string;
  itemTypeLabel: string | null;
  matchNo: number;
  stageLabel: string;
  stageOrder: number;
  scheduledAt: string | null;
  status: MMStatus;
  winnerSide: number | null;
  forfeitedSide: number | null;
  venue: { id: string; name: string; isActive: boolean; sortOrder: number } | null;
  referee: { id: string; username: string } | null;
  side1: MMSide | null;
  side2: MMSide | null;
  team1Name: string | null;
  team2Name: string | null;
  scoreText: string;
  hasBothSides: boolean;
};

export type MMVenue = { id: string; name: string; isActive: boolean; sortOrder: number };

// ---------------- 需处理 ----------------

/** 计划时间过了这么多分钟还没开始，算「需处理」。 */
export const OVERDUE_MINUTES = 15;

export type Attention = 'NO_REFEREE' | 'OVERDUE' | 'UNFINISHED';

export const ATTENTION_LABELS: Record<Attention, string> = {
  NO_REFEREE: '进行中没有裁判',
  OVERDUE: `过了计划时间 ${OVERDUE_MINUTES} 分钟还没开始`,
  UNFINISHED: '已分出胜负，还没结束',
};

export const ATTENTION_SHORT: Record<Attention, string> = {
  NO_REFEREE: '无裁判',
  OVERDUE: '超时未开始',
  UNFINISHED: '待结束',
};

/**
 * 需处理的三种情况：
 * - 进行中但没有裁判；
 * - 未开始、双方已确定、过了计划时间 15 分钟；
 * - 未结束但比分已经分出胜负（winnerSide 已有，等着点「结束」推进晋级）。
 */
export function matchAttention(match: Pick<MMMatch, 'status' | 'referee' | 'scheduledAt' | 'hasBothSides' | 'winnerSide'>, now: number): Attention[] {
  const result: Attention[] = [];
  if (match.status === 'LIVE' && !match.referee) result.push('NO_REFEREE');
  if (match.status === 'PENDING' && match.hasBothSides && match.scheduledAt) {
    const time = Date.parse(match.scheduledAt);
    if (Number.isFinite(time) && now - time > OVERDUE_MINUTES * 60_000) result.push('OVERDUE');
  }
  if ((match.status === 'PENDING' || match.status === 'LIVE') && match.hasBothSides && (match.winnerSide === 1 || match.winnerSide === 2)) {
    result.push('UNFINISHED');
  }
  return result;
}

// ---------------- 状态标签 ----------------

export type StatusTab = 'ALL' | 'LIVE' | 'PENDING' | 'COMPLETED' | 'UNSCHEDULED' | 'ATTENTION' | 'CANCELLED';

export const STATUS_TABS: Array<{ key: StatusTab; label: string }> = [
  { key: 'ALL', label: '全部' },
  { key: 'LIVE', label: '进行中' },
  { key: 'PENDING', label: '未开始' },
  { key: 'COMPLETED', label: '已结束' },
  { key: 'UNSCHEDULED', label: '待排时间' },
  { key: 'ATTENTION', label: '需处理' },
  { key: 'CANCELLED', label: '已取消' },
];

export function inStatusTab(match: MMMatch, tab: StatusTab, now: number): boolean {
  switch (tab) {
    case 'ALL': return true;
    case 'LIVE': return match.status === 'LIVE';
    case 'PENDING': return match.status === 'PENDING';
    case 'COMPLETED': return match.status === 'COMPLETED';
    case 'CANCELLED': return match.status === 'CANCELLED';
    case 'UNSCHEDULED': return match.status === 'PENDING' && (!match.scheduledAt || !match.venue);
    case 'ATTENTION': return matchAttention(match, now).length > 0;
    default: return true;
  }
}

/** 各状态标签的数量（不受其它筛选影响，标签上的数字就是整个赛事的数字）。 */
export function statusTabCounts(matches: MMMatch[], now: number): Record<StatusTab, number> {
  const counts = Object.fromEntries(STATUS_TABS.map((tab) => [tab.key, 0])) as Record<StatusTab, number>;
  for (const match of matches) {
    for (const tab of STATUS_TABS) if (inStatusTab(match, tab.key, now)) counts[tab.key] += 1;
  }
  return counts;
}

// ---------------- 筛选与搜索 ----------------

/** 筛选里「未分配 / 待排」这类空值的取值。 */
export const NONE = '__NONE__';

export type MatchFilters = {
  tab: StatusTab;
  keyword: string;
  /** 项目：`E:<eventId>` 单项、`T:<teamCompetitionId>` 团体赛。 */
  projects: string[];
  /** 场地 id；NONE = 待排场地。 */
  venues: string[];
  /** 裁判 id；NONE = 未分配。 */
  referees: string[];
  /** 比赛日 YYYY-MM-DD（本地时间）；NONE = 待排时间。 */
  dates: string[];
};

export const EMPTY_FILTERS: MatchFilters = { tab: 'ALL', keyword: '', projects: [], venues: [], referees: [], dates: [] };

export function hasActiveFilters(filters: MatchFilters) {
  return Boolean(filters.keyword.trim() || filters.projects.length || filters.venues.length || filters.referees.length || filters.dates.length);
}

export function sideLabel(side: MMSide | null | undefined) {
  if (!side) return '待定';
  return side.teamName?.trim() || side.name || '待定';
}

export function sidePlayerNames(side: MMSide | null | undefined) {
  if (!side) return '';
  return side.players?.map((player) => player.name).filter(Boolean).join(' / ') ?? '';
}

/** 本地时间的比赛日 YYYY-MM-DD；没排时间返回 null。 */
export function matchDateKey(match: Pick<MMMatch, 'scheduledAt'>): string | null {
  if (!match.scheduledAt) return null;
  const date = new Date(match.scheduledAt);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 搜索用的文字：场次号、选手、单位、队伍、裁判、场地、项目、阶段、第几场。 */
export function matchSearchText(match: MMMatch) {
  const side = (value: MMSide | null) => [
    value?.name, value?.teamName, value?.affiliation,
    ...(value?.players ?? []).flatMap((player) => [player.name, player.affiliation]),
  ];
  return [
    match.code,
    ...side(match.side1),
    ...side(match.side2),
    match.team1Name,
    match.team2Name,
    match.referee?.username,
    match.venue?.name,
    match.eventTypeLabel,
    match.itemTypeLabel,
    match.stageLabel,
    `第${match.matchNo}场`,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/** 搜索词去掉空格、统一小写；「男单 12」也能搜到「男单12」。 */
export function normalizeKeyword(keyword: string) {
  return keyword.trim().toLowerCase().replace(/\s+/g, '');
}

export function matchesKeyword(match: MMMatch, keyword: string) {
  const q = normalizeKeyword(keyword);
  if (!q) return true;
  return matchSearchText(match).replace(/\s+/g, '').includes(q);
}

export function filterMatches(matches: MMMatch[], filters: MatchFilters, now: number): MMMatch[] {
  return matches.filter((match) => {
    if (!inStatusTab(match, filters.tab, now)) return false;
    if (filters.projects.length) {
      const key = match.teamCompetitionId ? `T:${match.teamCompetitionId}` : `E:${match.eventId}`;
      if (!filters.projects.includes(key)) return false;
    }
    if (filters.venues.length && !filters.venues.includes(match.venue?.id ?? NONE)) return false;
    if (filters.referees.length && !filters.referees.includes(match.referee?.id ?? NONE)) return false;
    if (filters.dates.length && !filters.dates.includes(matchDateKey(match) ?? NONE)) return false;
    return matchesKeyword(match, filters.keyword);
  });
}

/** 列表默认顺序：按时间，没排时间的在最后；同一时间按场地顺序、阶段、第几场。 */
export function compareMatches(a: MMMatch, b: MMMatch) {
  const aTime = a.scheduledAt ? Date.parse(a.scheduledAt) : Number.MAX_SAFE_INTEGER;
  const bTime = b.scheduledAt ? Date.parse(b.scheduledAt) : Number.MAX_SAFE_INTEGER;
  return aTime - bTime
    || (a.venue?.sortOrder ?? 9999) - (b.venue?.sortOrder ?? 9999)
    || a.stageOrder - b.stageOrder
    || a.matchNo - b.matchNo
    || a.id.localeCompare(b.id);
}

// ---------------- 场地视图 ----------------

export type CourtCard = {
  venue: MMVenue;
  /** 正在这片场地上打的（正常只有一场，多于一场要提醒）。 */
  live: MMMatch[];
  /** 接下来要在这片场地打的，按时间排，最多 nextLimit 场。 */
  next: MMMatch[];
  /** 这片场地今天（按 now 所在日）还剩多少场没打。 */
  remaining: number;
};

export type CourtBoard = {
  courts: CourtCard[];
  /** 进行中但没有场地的。 */
  liveWithoutVenue: MMMatch[];
  /** 未开始、还没排场地或时间的（待排队列）。 */
  unscheduled: MMMatch[];
};

/**
 * 场地视图：每片场地（启用的，按场地顺序）一张卡，显示正在打的和接下来要打的。
 * 只看传进来的场次（页面上的项目、搜索等筛选照样生效）。停用的场地上如果还有场次也照样列出。
 */
export function buildCourtBoard(matches: MMMatch[], venues: MMVenue[], options: { nextLimit?: number } = {}): CourtBoard {
  const nextLimit = options.nextLimit ?? 2;
  const used = new Set(matches.map((match) => match.venue?.id).filter(Boolean));
  const shown = venues
    .filter((venue) => venue.isActive || used.has(venue.id))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
  const courts = shown.map((venue) => {
    const onVenue = matches.filter((match) => match.venue?.id === venue.id);
    const live = onVenue.filter((match) => match.status === 'LIVE').sort(compareMatches);
    const pending = onVenue.filter((match) => match.status === 'PENDING' && match.scheduledAt).sort(compareMatches);
    return { venue, live, next: pending.slice(0, nextLimit), remaining: pending.length };
  });
  return {
    courts,
    liveWithoutVenue: matches.filter((match) => match.status === 'LIVE' && !match.venue).sort(compareMatches),
    unscheduled: matches.filter((match) => match.status === 'PENDING' && (!match.scheduledAt || !match.venue)).sort(compareMatches),
  };
}

// ---------------- 赛事列表 ----------------

export type MMTournament = {
  id: string;
  name: string;
  edition?: number;
  status: string;
  startDate: string;
  endDate: string;
  location?: string | null;
  organizer?: string | null;
  isArchived?: boolean;
  /** 创建赛事的账号（只有超级管理员看得到）。 */
  owner?: string | null;
  matchTotal?: number;
  matchLive?: number;
  matchCompleted?: number;
};

export const TOURNAMENT_STATUS_LABELS: Record<string, string> = {
  REGISTRATION_NOT_STARTED: '报名未开始',
  REGISTRATION_OPEN: '报名中',
  REGISTRATION_CLOSED: '报名截止',
  ONGOING: '进行中',
  FINISHED: '已结束',
};

/** 赛事分组：进行中 → 即将开始 → 已结束；已归档的最后。 */
export function tournamentBucket(tournament: MMTournament, now: number): 0 | 1 | 2 | 3 {
  if (tournament.isArchived) return 3;
  if (tournament.status === 'ONGOING' || (tournament.matchLive ?? 0) > 0) return 0;
  const end = Date.parse(tournament.endDate);
  if (tournament.status !== 'FINISHED' && (!Number.isFinite(end) || end + 86_400_000 >= now)) return 1;
  return 2;
}

/** 选赛事的顺序：进行中的在最前；即将开始的按开赛日由近到远；已结束的按结束日由近到远；归档的最后。 */
export function sortTournaments<T extends MMTournament>(list: T[], now: number): T[] {
  return [...list].sort((a, b) => {
    const bucket = tournamentBucket(a, now) - tournamentBucket(b, now);
    if (bucket) return bucket;
    const group = tournamentBucket(a, now);
    if (group === 1) return Date.parse(a.startDate) - Date.parse(b.startDate);
    return Date.parse(b.endDate) - Date.parse(a.endDate) || a.name.localeCompare(b.name, 'zh-CN');
  });
}

export function tournamentSearchText(tournament: MMTournament) {
  return [tournament.name, tournament.location, tournament.organizer, tournament.owner, tournament.edition ? `第${tournament.edition}届` : '']
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function filterTournaments<T extends MMTournament>(list: T[], keyword: string): T[] {
  const q = normalizeKeyword(keyword);
  if (!q) return list;
  return list.filter((tournament) => tournamentSearchText(tournament).replace(/\s+/g, '').includes(q));
}

/** 进来时自动选哪个赛事：上次选的（还在列表里）；否则只有一个进行中的就选它；否则不选。 */
export function pickInitialTournament(list: MMTournament[], remembered: string | null, now: number): string | null {
  if (remembered && list.some((tournament) => tournament.id === remembered)) return remembered;
  const ongoing = list.filter((tournament) => tournamentBucket(tournament, now) === 0);
  return ongoing.length === 1 ? ongoing[0].id : null;
}

// ---------------- 操作记录 ----------------

export type MatchLogRow = {
  id: string;
  action: string;
  operatorName: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
};

export const LOG_ACTION_LABELS: Record<string, string> = {
  UPDATE_INFO: '改时间 / 场地 / 裁判',
  CORRECT_SCORE: '改比分',
  COMPLETE: '结束本场',
  REOPEN: '重开本场',
  RELEASE_REFEREE: '解除裁判',
};

const LOG_FIELD_LABELS: Record<string, string> = {
  status: '状态',
  winnerSide: '胜方',
  scheduledAt: '时间',
  durationMinutes: '时长',
  venue: '场地',
  referee: '裁判',
  score: '比分',
};

const STATUS_TEXT: Record<string, string> = { PENDING: '未开始', LIVE: '进行中', COMPLETED: '已结束', CANCELLED: '已取消' };

function logValue(field: string, value: unknown, formatTime: (iso: string) => string) {
  if (value === null || value === undefined || value === '') {
    return field === 'referee' ? '未分配' : field === 'score' ? '未记分' : field === 'winnerSide' ? '无' : '待排';
  }
  if (field === 'status') return STATUS_TEXT[String(value)] ?? String(value);
  if (field === 'winnerSide') return value === 1 ? '甲方（上）' : value === 2 ? '乙方（下）' : String(value);
  if (field === 'scheduledAt') return formatTime(String(value));
  if (field === 'durationMinutes') return `${value} 分钟`;
  return String(value);
}

/** 一条记录里每个改动的字段：「场地：3号场 → 5号场」。 */
export function describeLogChanges(row: MatchLogRow, formatTime: (iso: string) => string): string[] {
  const fields = [...new Set([...Object.keys(row.before ?? {}), ...Object.keys(row.after ?? {})])];
  const order = Object.keys(LOG_FIELD_LABELS);
  return fields
    .sort((a, b) => order.indexOf(a) - order.indexOf(b))
    .map((field) => `${LOG_FIELD_LABELS[field] ?? field}：${logValue(field, row.before?.[field], formatTime)} → ${logValue(field, row.after?.[field], formatTime)}`);
}

// ---------------- 全部场次 ----------------

/** 「全部场次」里的一场：和赛事 overview 同一格式，另带赛事和项目名。 */
export type MMAllMatch = MMMatch & {
  tournamentId: string | null;
  tournamentName: string;
  /** 「甲组 · 男子单打」「团体 · 教工团体 · 男子单打」。 */
  projectLabel: string;
};

export type AllDatePreset = 'ALL' | 'TODAY' | 'TOMORROW' | 'CUSTOM';

export type AllMatchesQuery = {
  tab: StatusTab;
  keyword: string;
  /** 只看这些赛事；空 = 全部。 */
  tournaments: string[];
  datePreset: AllDatePreset;
  /** 选日期时的起止日（YYYY-MM-DD，本地时间，两头都算）。 */
  customRange: [string, string] | null;
  /** 只看未结束、未归档的赛事。 */
  activeOnly: boolean;
  page: number;
  pageSize: number;
};

export const ALL_PAGE_SIZES = [20, 50, 100, 200];

export const DEFAULT_ALL_QUERY: AllMatchesQuery = {
  tab: 'ALL',
  keyword: '',
  tournaments: [],
  datePreset: 'ALL',
  customRange: null,
  activeOnly: true,
  page: 1,
  pageSize: 50,
};

export type AllMatchesResponse = {
  items: MMAllMatch[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<StatusTab, number>;
};

/** 赛事还没结束、没归档（「只看未结束的赛事」用）。 */
export function isActiveTournament(tournament: Pick<MMTournament, 'status' | 'isArchived'>) {
  return !tournament.isArchived && tournament.status !== 'FINISHED';
}

export function hasAllMatchesFilters(query: AllMatchesQuery) {
  return Boolean(query.keyword.trim() || query.tournaments.length || query.datePreset !== 'ALL');
}

function localDateKey(time: number) {
  const date = new Date(time);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 本地时间某天（YYYY-MM-DD）往后 addDays 天的 0 点。 */
function localDayStart(key: string, addDays = 0) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day + addDays);
}

/**
 * 日期条件 → 计划时间的起止时刻（ISO，含起不含止）；全部日期返回 null。
 * 按浏览器本地时间算「今天」（后端容器是 UTC，不能让后端算）。
 */
export function allMatchesDateRange(query: Pick<AllMatchesQuery, 'datePreset' | 'customRange'>, now: number): { from: string; to: string } | null {
  const today = localDateKey(now);
  let start: Date;
  let end: Date;
  if (query.datePreset === 'TODAY') {
    start = localDayStart(today);
    end = localDayStart(today, 1);
  } else if (query.datePreset === 'TOMORROW') {
    start = localDayStart(today, 1);
    end = localDayStart(today, 2);
  } else if (query.datePreset === 'CUSTOM' && query.customRange) {
    const [first, last] = [...query.customRange].sort();
    start = localDayStart(first);
    end = localDayStart(last, 1);
  } else {
    return null;
  }
  return { from: start.toISOString(), to: end.toISOString() };
}

/** GET /match-management/matches 的查询串。 */
export function allMatchesSearchParams(query: AllMatchesQuery, now: number): string {
  const params = new URLSearchParams();
  if (query.tab !== 'ALL') params.set('tab', query.tab);
  const keyword = query.keyword.trim().slice(0, 50);
  if (keyword) params.set('q', keyword);
  if (query.tournaments.length) params.set('tournaments', query.tournaments.join(','));
  const range = allMatchesDateRange(query, now);
  if (range) {
    params.set('from', range.from);
    params.set('to', range.to);
  }
  if (!query.activeOnly) params.set('activeOnly', '0');
  params.set('page', String(query.page));
  params.set('pageSize', String(query.pageSize));
  return params.toString();
}

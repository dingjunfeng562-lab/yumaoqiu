import { MatchStatus } from '@prisma/client';

// 裁判员对局管理「全部场次」的纯逻辑：状态标签、需处理、排序、分页。
// 标签和「需处理」的规则与后台页面（apps/frontend/lib/match-management.ts）一致，改一边要同步另一边。

export const ALL_MATCH_TABS = [
  'ALL',
  'LIVE',
  'PENDING',
  'COMPLETED',
  'UNSCHEDULED',
  'ATTENTION',
  'CANCELLED',
] as const;
export type AllMatchTab = (typeof ALL_MATCH_TABS)[number];

export const ALL_MATCH_PAGE_SIZES = [20, 50, 100, 200] as const;
export const DEFAULT_ALL_MATCH_PAGE_SIZE = 50;

/** 计划时间过了这么多分钟还没开始，算「需处理」。 */
export const OVERDUE_MINUTES = 15;

/** 判断标签、排序要用到的场次字段（轻量查询只取这些）。 */
export type LightMatch = {
  id: string;
  status: MatchStatus;
  scheduledAt: Date | null;
  finishedAt: Date | null;
  venueId: string | null;
  refereeId: string | null;
  side1Id: string | null;
  side2Id: string | null;
  winnerSide: number | null;
  roundNo: number;
  matchNo: number;
  venue: { sortOrder: number } | null;
};

/**
 * 需处理的三种情况：
 * - 进行中但没有裁判；
 * - 未开始、双方已确定、过了计划时间 15 分钟；
 * - 未结束但比分已经分出胜负（等着点「结束」推进晋级）。
 */
export function needsAttention(match: LightMatch, now: number): boolean {
  const bothSides = Boolean(match.side1Id && match.side2Id);
  if (match.status === MatchStatus.LIVE && !match.refereeId) return true;
  if (
    match.status === MatchStatus.PENDING &&
    bothSides &&
    match.scheduledAt &&
    now - match.scheduledAt.getTime() > OVERDUE_MINUTES * 60_000
  )
    return true;
  return (
    (match.status === MatchStatus.PENDING ||
      match.status === MatchStatus.LIVE) &&
    bothSides &&
    (match.winnerSide === 1 || match.winnerSide === 2)
  );
}

export function inAllMatchTab(
  match: LightMatch,
  tab: AllMatchTab,
  now: number,
): boolean {
  switch (tab) {
    case 'LIVE':
      return match.status === MatchStatus.LIVE;
    case 'PENDING':
      return match.status === MatchStatus.PENDING;
    case 'COMPLETED':
      return match.status === MatchStatus.COMPLETED;
    case 'CANCELLED':
      return match.status === MatchStatus.CANCELLED;
    case 'UNSCHEDULED':
      return (
        match.status === MatchStatus.PENDING &&
        (!match.scheduledAt || !match.venueId)
      );
    case 'ATTENTION':
      return needsAttention(match, now);
    default:
      return true;
  }
}

export function countAllMatchTabs(
  matches: LightMatch[],
  now: number,
): Record<AllMatchTab, number> {
  const counts = Object.fromEntries(
    ALL_MATCH_TABS.map((tab) => [tab, 0]),
  ) as Record<AllMatchTab, number>;
  for (const match of matches) {
    for (const tab of ALL_MATCH_TABS)
      if (inAllMatchTab(match, tab, now)) counts[tab] += 1;
  }
  return counts;
}

const STATUS_RANK: Record<MatchStatus, number> = {
  [MatchStatus.LIVE]: 0,
  [MatchStatus.PENDING]: 1,
  [MatchStatus.COMPLETED]: 2,
  [MatchStatus.CANCELLED]: 3,
};

/**
 * 全部场次的顺序：进行中 → 未开始（按时间由近到远，没排时间的在后）→ 已结束（最近结束的在前）→ 已取消。
 * 同一时间按场地顺序、轮次、第几场。
 */
export function compareAllMatches(a: LightMatch, b: LightMatch): number {
  const rank = (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9);
  if (rank) return rank;
  const open =
    a.status === MatchStatus.LIVE || a.status === MatchStatus.PENDING;
  let time = 0;
  if (open) {
    const at = a.scheduledAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bt = b.scheduledAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    time = at - bt;
  } else {
    const at =
      (a.finishedAt ?? a.scheduledAt)?.getTime() ?? Number.MIN_SAFE_INTEGER;
    const bt =
      (b.finishedAt ?? b.scheduledAt)?.getTime() ?? Number.MIN_SAFE_INTEGER;
    time = bt - at;
  }
  return (
    time ||
    (a.venue?.sortOrder ?? 9999) - (b.venue?.sortOrder ?? 9999) ||
    a.roundNo - b.roundNo ||
    a.matchNo - b.matchNo ||
    a.id.localeCompare(b.id)
  );
}

/** 取第几页；页码超出时落到最后一页（比如筛选后总数变少了）。 */
export function pageOf<T>(
  list: T[],
  page: number,
  pageSize: number,
): { page: number; items: T[] } {
  const pages = Math.max(1, Math.ceil(list.length / pageSize));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  return {
    page: current,
    items: list.slice((current - 1) * pageSize, current * pageSize),
  };
}

/** 逗号分隔的 id 列表，去空去重，最多 200 个。 */
export function splitIds(value: string | undefined | null): string[] {
  if (!value) return [];
  return [
    ...new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ].slice(0, 200);
}

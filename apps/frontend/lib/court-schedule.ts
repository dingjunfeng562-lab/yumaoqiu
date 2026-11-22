import { roundCn } from '@/lib/round';

export interface ConflictItem {
  type: 'VENUE' | 'PLAYER' | 'DEPENDENCY' | 'UNSCHEDULED' | 'GROUP_VENUE' | 'GROUP_DATE';
  matchIds: string[];
  message: string;
}

export interface ScheduleMatch {
  /** 轮空场：首轮一方没有对手、直接晋级，不用排场地和时间。 */
  isBye?: boolean;
  /** 预排的淘汰赛空位：双方占位名（A组第1名 / 待定）。 */
  placeholderNames?: [string, string] | null;
  groupId: string | null;
  groupName: string | null;
  scheduleLocked: boolean;
  scheduleOverride: boolean;
  allowedVenueIds: string[] | null;
  /** 组别比赛日期（YYYY-MM-DD），null 为不限；dateOverride 为人工确认的临时改期。 */
  allowedDates?: string[] | null;
  dateOverride?: boolean;
  id: string;
  teamMatchId?: string | null;
  team1Name?: string | null;
  team2Name?: string | null;
  eventId: string | null;
  eventType: string;
  eventTypeLabel: string;
  round: string;
  roundNo: number;
  matchNo: number;
  venueSequence?: number | null;
  side1Id?: string | null;
  side2Id?: string | null;
  side1?: { name: string; affiliation: string } | null;
  side2?: { name: string; affiliation: string } | null;
  status: string;
  scheduleStatus: string;
  dependenciesReady: boolean;
  venueId?: string | null;
  venueName?: string | null;
  scheduledAt?: string | null;
  scheduledAtLocal?: string | null;
  durationMinutes: number;
  startedAt?: string | null;
  finishedAt?: string | null;
  conflicts: ConflictItem[];
}

// 对阵文字：团体赛写两队；轮空场没有对手的一边写「轮空」，其余未定的写「待定」。
export function matchupText(match: ScheduleMatch) {
  if (match.teamMatchId) return `${match.team1Name ?? '待定'} VS ${match.team2Name ?? '待定'}`;
  const side = (value: { name: string } | null | undefined, index: 0 | 1) =>
    value?.name ?? (match.isBye ? '轮空' : match.placeholderNames?.[index] ?? '待定');
  return `${side(match.side1, 0)} VS ${side(match.side2, 1)}`;
}

export function scheduleGroupLabel(row: ScheduleMatch) {
  const round = row.round?.trim();
  if (!round) return '—';
  if (row.roundNo === 0) return round.endsWith('组') ? round : `${round}组`;
  return roundCn(round);
}

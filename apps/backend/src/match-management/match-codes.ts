import { MIX_CATEGORY_LABELS, mixCategory } from '../common/event-mix';
import type { ExportMatch } from '../exports/exports.service';
import { eventMatchCodes } from '../exports/orderbook-workbook';

/** 算场次号要用到的场次字段（Prisma 查出来的 Match 都有）。 */
export type CodeMatch = {
  id: string;
  eventId: string | null;
  teamMatchId: string | null;
  scheduledAt: Date | null;
  venueId: string | null;
  venue: { sortOrder: number } | null;
  matchNo: number;
  roundNo: number;
};

/**
 * 场次号，和秩序册、对阵图（PNG）上印的一致（同一个 eventMatchCodes）：
 * - 单项：项目简称 + 序号（男单1、男单2…），混编里项目不同（男单 + 女单）时前缀改用「单打 / 双打」；
 * - 团体赛：统一「团体」，按团体赛创建顺序接着往下编；
 * - 只有排了时间和场地的场次有场次号，按时间、场地顺序编号。
 */
export function computeMatchCodes(input: {
  events: Array<{ id: string; type: string; mixHostId: string | null }>;
  /** 团体赛 id，按创建顺序。 */
  teamCompetitionIds: string[];
  /** 场次 id → 所属团体赛 id（团体子项才有）。 */
  teamCompetitionOf: (match: CodeMatch) => string | null;
  matches: CodeMatch[];
}): Map<string, string> {
  const codes = new Map<string, string>();
  const asExport = (matches: CodeMatch[]) => matches as unknown as ExportMatch[];

  for (const event of input.events) {
    if (event.mixHostId) continue; // 并入的单项没有自己的场次，场次都在主项目上
    const members = input.events.filter((item) => item.mixHostId === event.id);
    const sameType = members.every((member) => member.type === event.type);
    const codePrefix = members.length && !sameType ? MIX_CATEGORY_LABELS[mixCategory(event.type)] : undefined;
    const matches = input.matches.filter((match) => match.eventId === event.id);
    for (const [id, code] of eventMatchCodes({ type: event.type, codePrefix, matches: asExport(matches) })) {
      codes.set(id, code);
    }
  }

  let codeOffset = 0;
  for (const competitionId of input.teamCompetitionIds) {
    const matches = input.matches.filter((match) => match.teamMatchId && input.teamCompetitionOf(match) === competitionId);
    if (!matches.length) continue;
    for (const [id, code] of eventMatchCodes({ type: 'TEAM_COMPETITION', codePrefix: '团体', codeStart: codeOffset, matches: asExport(matches) })) {
      codes.set(id, code);
    }
    codeOffset += matches.filter((match) => match.scheduledAt && match.venueId).length;
  }
  return codes;
}

import * as ExcelJS from 'exceljs';
import {
  buildKnockoutSkeleton,
  compareGroupCode,
  groupSizesFromGroupMatches,
  knockoutPlaceholderNames,
  knockoutPlaceholdersOnly,
  knockoutSlotKey,
  skeletonFromGroupMatches,
  type SkeletonMatch,
} from '../common/knockout-skeleton';
import { isByeMatch, knockoutPlacements } from '../common/knockout-placement';
import { teamStandings } from '../common/final-rankings';
import { withOfficialTeamResult } from '../common/team-official-result';
import { teamResultsReady } from '../common/tournament-results-ready';
import { hasEventMix } from './export-mix';
import type {
  ExportEvent,
  ExportMatch,
  ExportRegistration,
  ExportSecondStage,
  ExportSecondStageMatch,
  ExportTournament,
  ExportVenue,
} from './exports.service';

// 秩序册导出（高保真 .xlsx）：日程表 + 秩序表 + 各项目「流程表」。
// 流程表 = 第一阶段（小组循环成绩网格）+ 第二阶段（淘汰赛对阵树）。按用户口径：
// 第二阶段始终输出；第一阶段仅当赛制为「小组循环+淘汰(标准2023)」(GROUP_PLUS_KNOCKOUT_STD) 时输出。
// 只有一个阶段的赛制不写「第二阶段」：单淘汰标「单淘汰」，单循环（单项）只画循环成绩网格；
// 淘汰+分组排名的淘汰赛是第一阶段，排位赛是第二阶段。

const EVENT_TYPE_LABELS: Record<string, string> = {
  MENS_SINGLES: '男子单打',
  WOMENS_SINGLES: '女子单打',
  MENS_DOUBLES: '男子双打',
  WOMENS_DOUBLES: '女子双打',
  MIXED_DOUBLES: '混合双打',
};

// 秩序表「场次号」前缀。
const EVENT_TYPE_ABBR: Record<string, string> = {
  MENS_SINGLES: '男单',
  WOMENS_SINGLES: '女单',
  MENS_DOUBLES: '男双',
  WOMENS_DOUBLES: '女双',
  MIXED_DOUBLES: '混双',
};

// 模板工作簿按项目拆分名次/淘汰赛页。名称统一从项目类型派生，
// 再由 uniqueWorksheetName() 处理同类型项目或 Excel 31 字符限制。
function eventAbbr(event: ExportEvent) {
  return EVENT_TYPE_ABBR[event.type] ?? '项目';
}

function uniqueWorksheetName(base: string, used: Set<string>) {
  const normalized = (base.trim() || '工作表').slice(0, 31);
  let name = normalized;
  let suffix = 2;
  while (used.has(name)) {
    const tail = `-${suffix}`;
    name = `${normalized.slice(0, Math.max(1, 31 - tail.length))}${tail}`;
    suffix += 1;
  }
  used.add(name);
  return name;
}

const KNOCKOUT_ROUND_LABELS: Record<string, string> = {
  F: '决赛',
  SF: '半决赛',
  QF: '1/4决赛',
  R1: '1/8决赛',
  R2: '1/16决赛',
  R3: '1/32决赛',
  R4: '1/64决赛',
  BRONZE: '季军赛',
};

// 带「第一阶段」小组循环流程表的赛制（另有单循环、团体单组循环画同样的循环网格）。
const GROUP_KNOCKOUT_STD = 'GROUP_PLUS_KNOCKOUT_STD';

const ACCENT = 'FF2563EB';
const DIAGONAL = 'FFE5E7EB';
const SUBHEAD = 'FFEFF3FF';
const SCHEDULE_TIME_ZONE = 'Asia/Shanghai';

type Cell = ExcelJS.Cell;

const scheduleDateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: SCHEDULE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

type ScheduleDateParts = { year: number; month: number; day: number; hour: number; minute: number };

function scheduleDateParts(date: Date): ScheduleDateParts {
  const parts = new Map(scheduleDateTimeFormatter.formatToParts(date).map((part) => [part.type, part.value]));
  const year = Number(parts.get('year') ?? date.getUTCFullYear());
  const month = Number(parts.get('month') ?? date.getUTCMonth() + 1);
  const day = Number(parts.get('day') ?? date.getUTCDate());
  const hour = Number(parts.get('hour') ?? date.getUTCHours()) % 24;
  const minute = Number(parts.get('minute') ?? date.getUTCMinutes());
  return { year, month, day, hour, minute };
}

function scheduleDatePartsFromLocal(value?: string | null): ScheduleDateParts | null {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{1,2})/.exec(value ?? '');
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  if ([year, month, day, hour, minute].some((part) => !Number.isFinite(part))) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return { year, month, day, hour, minute };
}

function scheduleDatePartsForMatch(match: ExportMatch): ScheduleDateParts | null {
  return scheduleDatePartsFromLocal(match.scheduledAtLocal) ?? (match.scheduledAt ? scheduleDateParts(match.scheduledAt) : null);
}

function fmtScheduleDateTimeParts({ year, month, day, hour, minute }: ScheduleDateParts) {
  return `${year}-${pad2(month)}-${pad2(day)} ${pad2(hour)}:${pad2(minute)}`;
}

function fmtScheduleDateTime(date: Date) {
  return fmtScheduleDateTimeParts(scheduleDateParts(date));
}

function fmtMatchScheduleDateTime(match: ExportMatch) {
  const parts = scheduleDatePartsForMatch(match);
  return parts ? fmtScheduleDateTimeParts(parts) : '';
}

function scheduleTimeKey(match: ExportMatch) {
  return fmtMatchScheduleDateTime(match);
}

function scheduleSortValueForMatch(match: ExportMatch) {
  const parts = scheduleDatePartsForMatch(match);
  return parts ? (((parts.year * 100 + parts.month) * 100 + parts.day) * 10000 + parts.hour * 100 + parts.minute) : Number.MAX_SAFE_INTEGER;
}

function eventLabel(event: ExportEvent) {
  const base = event.label ?? EVENT_TYPE_LABELS[event.type] ?? event.type;
  return event.groupLabel ? `${event.groupLabel} · ${base}` : base;
}

function orderVenueLabel(name: string) {
  const value = name.trim();
  const match = /^(\d+)\s*号(?:场)?$/.exec(value);
  return match ? `${match[1]} 号场` : value;
}

function registrationName(registration: ExportRegistration | null | undefined) {
  if (!registration) return '';
  return registration.player2
    ? `${registration.player1.name}/${registration.player2.name}`
    : registration.player1.name;
}

function sideUnit(registration: ExportRegistration | null | undefined) {
  if (!registration) return '';
  const team = registration.teamName?.trim();
  if (team) return team;
  return registration.player2
    ? `${registration.player1.affiliation}/${registration.player2.affiliation}`
    : registration.player1.affiliation;
}

function eventGroupCodes(event: ExportEvent) {
  return [
    ...new Set(
      event.matches
        .filter((m) => (m.roundNo ?? 0) === 0)
        .map((m) => (typeof m.round === 'string' ? m.round : m.round != null ? String(m.round) : ''))
        .filter(Boolean),
    ),
  ].sort(compareGroupCode);
}

function playoffRank(match: ExportMatch) {
  if (match.matchNo != null) return match.matchNo;
  const parsed = /^P(\d+)$/.exec(typeof match.round === 'string' ? match.round : String(match.round ?? ''));
  return parsed ? Math.floor((Number(parsed[1]) + 1) / 2) : null;
}

function playoffSideSource(event: ExportEvent, match: ExportMatch, side: 1 | 2) {
  if (!isPlayoff(match)) return null;
  const group = eventGroupCodes(event)[side - 1];
  const rank = playoffRank(match);
  return group && rank ? `${group}组第${rank}名` : '待定';
}

function secondStagePlanningMatch(event: ExportEvent, match: ExportMatch) {
  if ((match.roundNo ?? 0) < 100) return null;
  return event.secondStage?.matches.find((item) => item.matchNo === match.matchNo) ?? null;
}

function orderSideText(
  event: ExportEvent,
  match: ExportMatch,
  side: 1 | 2,
  regMap: Map<string, ExportRegistration>,
) {
  const id = side === 1 ? match.side1Id : match.side2Id;
  const override = side === 1 ? match.side1Text : match.side2Text;
  if (override) return { unit: override.unit, name: override.name };
  const registration = id ? regMap.get(id) ?? null : null;
  if (registration) {
    return {
      unit: sideUnit(registration),
      name: registrationName(registration),
    };
  }

  const planning = secondStagePlanningMatch(event, match);
  const source = side === 1 ? planning?.side1Source : planning?.side2Source;
  const snapshot = side === 1 ? planning?.side1NameSnapshot : planning?.side2NameSnapshot;
  const playoffSource = playoffSideSource(event, match, side);
  return {
    unit: source ?? '',
    name: snapshot ?? (source ? '待定' : playoffSource ?? (match.scheduledAt || match.venueId ? '待定' : '')),
  };
}

function registrationMap(tournament: ExportTournament) {
  const map = new Map<string, ExportRegistration>();
  for (const event of tournament.events) {
    for (const registration of event.registrations) map.set(registration.id, registration);
  }
  return map;
}

function thinBorder(): Partial<ExcelJS.Borders> {
  const side: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: 'FFBFBFBF' } };
  return { top: side, left: side, bottom: side, right: side };
}

const REFERENCE_FONT = '宋体';
const REFERENCE_TEXT = { name: REFERENCE_FONT, size: 11 } as ExcelJS.Font;

function referenceBorder(style: ExcelJS.BorderStyle = 'thin'): Partial<ExcelJS.Borders> {
  const side: Partial<ExcelJS.Border> = { style, color: { argb: 'FFBFBFBF' } };
  return { top: side, left: side, bottom: side, right: side };
}

function referenceCell(cell: Cell, options?: { bold?: boolean; size?: number; horizontal?: 'left' | 'center' | 'right'; wrapText?: boolean }) {
  cell.font = {
    ...REFERENCE_TEXT,
    bold: options?.bold ?? false,
    size: options?.size ?? REFERENCE_TEXT.size,
    color: { argb: 'FF000000' },
  };
  cell.alignment = {
    horizontal: options?.horizontal ?? 'center',
    vertical: 'middle',
    wrapText: options?.wrapText ?? true,
  };
  cell.border = referenceBorder();
}

function orderPairBorder(rowIndex: number, firstRow: boolean, lastRow: boolean, left: boolean, right: boolean) {
  return {
    top: { style: firstRow ? (rowIndex > 0 ? 'thick' : undefined) : 'dotted', color: { argb: 'FF7F7F7F' } },
    bottom: { style: lastRow ? 'thick' : 'dotted', color: { argb: 'FF7F7F7F' } },
    left: { style: left ? 'thick' : 'dotted', color: { argb: 'FF7F7F7F' } },
    right: { style: right ? 'thick' : 'dotted', color: { argb: 'FF7F7F7F' } },
  } as Partial<ExcelJS.Borders>;
}

function styleHeaderCell(cell: Cell) {
  // 参考秩序册的蓝色仅用于真正的列标题；节标题使用白底黑字。
  cell.font = { ...REFERENCE_TEXT, bold: true, color: { argb: 'FFFFFFFF' } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ACCENT } };
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  cell.border = thinBorder();
}

function styleTitleCell(cell: Cell) {
  cell.font = { ...REFERENCE_TEXT, bold: true, size: 20, color: { argb: 'FFFFFFFF' } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ACCENT } };
  cell.alignment = { horizontal: 'center', vertical: 'middle' };
}

function shortScheduleTime(match: ExportMatch) {
  const parts = scheduleDatePartsForMatch(match);
  return parts ? `${pad2(parts.hour)}:${pad2(parts.minute)}` : '未排程';
}

// ===== 数据整形（从 matches 还原阶段/分组/签位，与 exports.service 中口径一致）=====

function isPlayoff(match: ExportMatch) {
  const roundNo = match.roundNo ?? 0;
  return roundNo >= 1 && roundNo < 100 && typeof match.round === 'string' && match.round.startsWith('P');
}

function playoffRoundLabel(round: string) {
  const playoff = /^P(\d+)$/.exec(round);
  if (!playoff) return null;
  const hi = Number(playoff[1]);
  return `${hi}-${hi + 1}名决赛`;
}

function secondStageFormalRoundLabel(match: ExportMatch) {
  const round = typeof match.round === 'string' ? match.round : match.round != null ? String(match.round) : '';
  const rankFinalLabels: Record<string, string> = {
    决赛: '1-2名决赛',
    三四名决赛: '3-4名决赛',
    五六名决赛: '5-6名决赛',
    七八名决赛: '7-8名决赛',
  };
  return rankFinalLabels[round] ?? (round || '第二阶段');
}

function roundLabel(match: ExportMatch) {
  const roundNo = match.roundNo ?? 0;
  const round = typeof match.round === 'string' ? match.round : match.round != null ? String(match.round) : '';
  if (roundNo === 0) return round ? `${round}组` : '小组循环';
  if (roundNo >= 100) return secondStageFormalRoundLabel(match);
  if (round.startsWith('P')) return playoffRoundLabel(round) ?? '排位赛';
  return KNOCKOUT_ROUND_LABELS[round] ?? round;
}

function stageText(matches: ExportMatch[]) {
  const parts: string[] = [];
  if (matches.some((m) => (m.roundNo ?? 0) === 0)) parts.push('第一阶段·小组循环');
  const playoffLabels = [
    ...new Set(
      matches
        .filter((m) => isPlayoff(m))
        .map((m) => (typeof m.round === 'string' ? playoffRoundLabel(m.round) : null))
        .filter((label): label is string => Boolean(label)),
    ),
  ];
  if (playoffLabels.length) parts.push('第二阶段·' + playoffLabels.join('、'));
  const koLabels = [
    ...new Set(
      matches
        .filter((m) => (m.roundNo ?? 0) >= 1 && (m.roundNo ?? 0) < 100 && !isPlayoff(m))
        .map((m) => roundLabel(m)),
    ),
  ];
  if (koLabels.length) parts.push('第二阶段·' + koLabels.join('、'));
  const formalSecondStageLabels = [
    ...new Set(
      matches
        .filter((m) => (m.roundNo ?? 0) >= 100)
        .map((m) => roundLabel(m)),
    ),
  ];
  if (formalSecondStageLabels.length) parts.push('第二阶段·' + formalSecondStageLabels.join('、'));
  return parts.join('；') || '—';
}

function sessionKeyFromParts({ year, month, day, hour }: ScheduleDateParts) {
  return `${year}-${month}-${day}-${hour < 12 ? 'AM' : 'PM'}`;
}
function sessionLabelFromParts({ month, day, hour }: ScheduleDateParts) {
  return `${pad2(month)}\u6708${pad2(day)}\u65e5${hour < 12 ? '\u4e0a\u5348' : '\u4e0b\u5348'}`;
}
function sessionSortValueFromParts({ year, month, day, hour }: ScheduleDateParts) {
  return ((year * 100 + month) * 100 + day) * 10 + (hour < 12 ? 0 : 1);
}
function sessionKeyForMatch(match: ExportMatch) {
  const parts = scheduleDatePartsForMatch(match);
  return parts ? sessionKeyFromParts(parts) : '';
}

function sessions(tournament: ExportTournament) {
  const map = new Map<string, { key: string; label: string; sort: number }>();
  for (const event of tournament.events) {
    for (const match of event.matches) {
      const parts = scheduleDatePartsForMatch(match);
      if (!parts) continue;
      const key = sessionKeyFromParts(parts);
      if (map.has(key)) continue;
      const sort = sessionSortValueFromParts(parts);
      map.set(key, { key, label: sessionLabelFromParts(parts), sort });
    }
  }
  return [...map.values()].sort((a, b) => a.sort - b.sort);
}

function venues(tournament: ExportTournament): ExportVenue[] {
  if (tournament.venues?.length) return tournament.venues;
  const map = new Map<string, ExportVenue>();
  for (const event of tournament.events) {
    for (const match of event.matches) {
      if (match.venueId && match.venue && !map.has(match.venueId)) {
        map.set(match.venueId, { id: match.venueId, name: match.venue.name, sortOrder: match.venue.sortOrder });
      }
    }
  }
  return [...map.values()].sort((a, b) => a.sortOrder - b.sortOrder);
}

// 每个项目内，已排程场次按时间→场地→场序编「场次号」（男双1、男双2…）。
export function eventMatchCodes(event: Pick<ExportEvent, 'type' | 'matches' | 'codePrefix' | 'codeStart'>) {
  const map = new Map<string, string>();
  const abbr = event.codePrefix ?? EVENT_TYPE_ABBR[event.type] ?? '场';
  const ordered = event.matches
    .filter((m) => m.scheduledAt && m.venueId)
    .sort(
      (a, b) =>
        scheduleSortValueForMatch(a) - scheduleSortValueForMatch(b) ||
        (a.venue?.sortOrder ?? 0) - (b.venue?.sortOrder ?? 0) ||
        (a.matchNo ?? 0) - (b.matchNo ?? 0) ||
        a.id.localeCompare(b.id),
    );
  ordered.forEach((m, i) => map.set(m.id, `${abbr}${(event.codeStart ?? 0) + i + 1}`));
  return map;
}

// 按阶段导出时 matches 只有本阶段场次，场次号由导出方按整个项目算好放在 matchCodes，
// 这样和整本秩序册、对阵图（PNG）的场次号一致。
function matchCodeMap(tournament: Pick<ExportTournament, 'events'>) {
  const map = new Map<string, string>();
  for (const event of tournament.events) {
    const codes = event.matchCodes ? Object.entries(event.matchCodes) : eventMatchCodes(event);
    for (const [id, code] of codes) map.set(id, code);
  }
  return map;
}

// 组内循环按 i<j 嵌套生成；据此还原每个成员的组内签位号。
function groupPositions(event: ExportEvent) {
  const map = new Map<string, { group: string; pos: number }>();
  const byGroup = new Map<string, ExportMatch[]>();
  for (const match of event.matches) {
    if ((match.roundNo ?? 0) !== 0) continue;
    const group = typeof match.round === 'string' ? match.round : match.round != null ? String(match.round) : '';
    if (!group) continue;
    const list = byGroup.get(group) ?? [];
    list.push(match);
    byGroup.set(group, list);
  }
  for (const [group, groupMatches] of byGroup) {
    const sorted = [...groupMatches].sort((a, b) => (a.matchNo ?? 0) - (b.matchNo ?? 0));
    const member0 = sorted[0]?.side1Id;
    if (!member0) continue;
    const order = [member0];
    for (const match of sorted) {
      if (match.side1Id === member0 && match.side2Id) order.push(match.side2Id);
    }
    order.forEach((id, index) => {
      if (!map.has(id)) map.set(id, { group, pos: index + 1 });
    });
  }
  return map;
}

function pairKey(a: string, b: string) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// 团体赛一场对外对阵包含多个子项场次；流程表/对阵表按“场”呈现，
// 因此同一轮次、同一场团体对阵（第N场）只保留一条。单项每条都是独立场次，不去重——
// 否则淘汰赛后面几轮双方都还是「待定」的场次会被当成同一场，只剩一个框。
function dedupeFixtures(matches: ExportMatch[]) {
  const seen = new Set<string>();
  const kept: ExportMatch[] = [];
  for (const match of matches) {
    const key = match.matchNoText
      ? `${match.roundNo ?? 0}|${String(match.round)}|${match.matchNoText}`
      : match.id;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(match);
  }
  return kept;
}

// 一场比赛中某一方赢下的局数。
function gamesWonBy(match: ExportMatch, side: 1 | 2) {
  let won = 0;
  for (const g of match.games) {
    if (side === 1 ? g.side1Score > g.side2Score : g.side2Score > g.side1Score) won += 1;
  }
  return won;
}

// ===== 工作表 1：日程表 =====

// ===== 团体赛 → 伪项目（共用单项秩序的版式与分页）=====

const TEAM_ITEM_ABBR: Record<string, string> = {
  MENS_SINGLES: '男单', WOMENS_SINGLES: '女单',
  MENS_DOUBLES: '男双', WOMENS_DOUBLES: '女双', MIXED_DOUBLES: '混双',
};

export function teamCompetitionEvents(tournament: ExportTournament): ExportEvent[] {
  const events: ExportEvent[] = [];
  let codeOffset = 0;
  for (const competition of tournament.teamCompetitions ?? []) {
    if (!competition.teamMatches.length) continue;
    const groups = competition.groups ?? [];
    const groupCodeById = new Map(groups.map((group) => [group.id, group.groupName.replace(/组$/, '')]));
    const groupCodeByTeam = new Map<string, string>();
    for (const group of groups) {
      for (const member of group.teams ?? []) groupCodeByTeam.set(member.teamId, group.groupName.replace(/组$/, ''));
    }
    const teamById = new Map(competition.teams.map((team) => [team.id, team]));

    const registrations: ExportRegistration[] = competition.teams.map((team) => ({
      id: team.id,
      eventId: competition.name,
      studentId: null,
      createdAt: tournament.startDate,
      className: null,
      groupName: groupCodeByTeam.get(team.id) ?? null,
      teamName: team.affiliation,
      isSeed: false,
      seedRank: null,
      player1: { name: team.name, gender: '', affiliation: team.affiliation, contact: null },
      player2: null,
      competitionRegistration: null,
      finalRank: team.finalRank ?? null,
    }));

    const knockoutRoundNos = [...new Set(
      competition.teamMatches.filter((m) => m.stage !== 'GROUP').map((m) => m.roundNo),
    )].sort((a, b) => a - b);

    const matches: ExportMatch[] = [];
    for (const storedEncounter of competition.teamMatches) {
      const encounter = withOfficialTeamResult(storedEncounter, competition.winThreshold);
      const isGroup = encounter.stage === 'GROUP';
      const groupCode = encounter.groupId ? groupCodeById.get(encounter.groupId) ?? '' : '';
      const roundNo = isGroup ? 0 : knockoutRoundNos.indexOf(encounter.roundNo) + 1;
      const round = isGroup ? groupCode || encounter.round : encounter.round;
      // 出场名单只有在锁定后才写入秩序册；未提交的场次保持占位，不提前泄露选手。
      const playerText = (teamId: string | null, itemId: string | null, locked: boolean) => {
        if (!teamId) return '待定';
        if (!locked || !itemId) return '待提交名单';
        const lineup = (encounter.lineups ?? []).find(
          (row) => row.teamId === teamId && row.teamCompetitionItemId === itemId,
        );
        if (!lineup) return '待提交名单';
        return [lineup.player1?.name, lineup.player2?.name].filter(Boolean).join('/') || '待提交名单';
      };
      const unitOf = (teamId: string | null) => (teamId ? teamById.get(teamId)?.affiliation ?? '' : '');

      (encounter.matches ?? []).forEach((child, index) => {
        const item = child.teamCompetitionItem;
        matches.push({
          id: child.id,
          round,
          roundNo,
          matchNo: item?.sortOrder ?? index + 1,
          venueId: child.venue?.id ?? null,
          scheduledAt: child.scheduledAt,
          scheduledAtLocal: child.scheduledAtLocal ?? null,
          status: child.status,
          durationMinutes: 45,
          side1Id: encounter.team1Id,
          side2Id: encounter.team2Id,
          winnerSide: child.winnerSide,
          updatedAt: child.scheduledAt ?? tournament.startDate,
          venue: child.venue ? { name: child.venue.name, sortOrder: child.venue.sortOrder } : null,
          referee: null,
          games: child.games ?? [],
          label: item ? TEAM_ITEM_ABBR[item.eventType] ?? item.eventType : '团体赛',
          side1Text: { unit: unitOf(encounter.team1Id), name: playerText(encounter.team1Id, child.teamCompetitionItemId, child.lineupLocked) },
          side2Text: { unit: unitOf(encounter.team2Id), name: playerText(encounter.team2Id, child.teamCompetitionItemId, child.lineupLocked) },
          side1Name: encounter.team1Id ? teamById.get(encounter.team1Id)?.name ?? '' : '',
          side2Name: encounter.team2Id ? teamById.get(encounter.team2Id)?.name ?? '' : '',
          matchNoText: `第${encounter.matchNo}场`,
          scoreText: encounter.resultDecided ? `${encounter.team1Wins}:${encounter.team2Wins}` : '',
        });
      });
    }

    events.push({
      type: 'TEAM_COMPETITION',
      teamCompetition: competition,
      label: competition.name,
      codePrefix: '团体',
      codeStart: codeOffset,
      format: competition.format === 'ROUND_ROBIN' ? 'ROUND_ROBIN' : groups.length ? GROUP_KNOCKOUT_STD : 'SINGLE_ELIMINATION',
      registrations,
      matches,
      secondStage: null,
    });
    codeOffset += matches.filter((match) => match.scheduledAt && match.venueId).length;
  }
  return events;
}

// 团体赛与单项共用同一套分页：并入 events 后，日程表/秩序表/流程表/小组赛/
// 分组表/名次汇总都会按单项的口径一起输出。
function withTeamEvents(tournament: ExportTournament): ExportTournament {
  const teamEvents = teamCompetitionEvents(tournament);
  return teamEvents.length ? { ...tournament, events: [...tournament.events, ...teamEvents] } : tournament;
}

function buildScheduleSheet(wb: ExcelJS.Workbook, tournament: ExportTournament) {  const ws = wb.addWorksheet('日程表', { views: [{ state: 'frozen', ySplit: 2 }] });
  ws.columns = [{ width: 16 }, { width: 18 }, { width: 64 }];

  ws.mergeCells(1, 1, 1, 3);
  styleTitleCell(ws.getCell(1, 1));
  ws.getCell(1, 1).value = '日  程  表';

  ['日期', '项目', '阶段'].forEach((text, i) => {
    const cell = ws.getCell(2, i + 1);
    cell.value = text;
    styleHeaderCell(cell);
  });

  let row = 3;
  for (const session of sessions(tournament)) {
    const sessionStart = row;
    for (const event of tournament.events) {
      const matches = event.matches.filter((m) => sessionKeyForMatch(m) === session.key);
      if (!matches.length) continue;
      ws.getCell(row, 1).value = session.label;
      ws.getCell(row, 2).value = eventLabel(event);
      ws.getCell(row, 3).value = stageText(matches);
      for (let c = 1; c <= 3; c += 1) {
        ws.getCell(row, c).border = thinBorder();
        ws.getCell(row, c).alignment = { vertical: 'middle', wrapText: true };
      }
      row += 1;
    }
    if (row > sessionStart + 1) {
      ws.mergeCells(sessionStart, 1, row - 1, 1);
      ws.getCell(sessionStart, 1).alignment = { vertical: 'middle', horizontal: 'center' };
    }
  }
  if (row === 3) ws.getCell(3, 3).value = '暂无已排程的项目';
}

// ===== 工作表 2：秩序表（按节分块，每场 4 行 × 每场地 2 列）=====

function buildOrderSheet(wb: ExcelJS.Workbook, tournament: ExportTournament) {
  const ws = wb.addWorksheet('秩序表');
  const title = `${tournament.name.trim()} 秩 序 表`.trim();
  const preserveTeamCourts = tournament.teamCompetitions?.some(competition => competition.format === 'ROUND_ROBIN');
  const usedVenueIds = new Set(tournament.events.flatMap(event => event.matches.map(match => match.venueId)));
  const venueList = venues(tournament).filter(venue => !preserveTeamCourts || venue.isActive !== false || usedVenueIds.has(venue.id));
  const regMap = registrationMap(tournament);
  const codeMap = matchCodeMap(tournament);
  const posMap = new Map<string, { group: string; pos: number }>();
  for (const event of tournament.events) {
    for (const [id, p] of groupPositions(event)) posMap.set(id, p);
  }

  const colCount = 2 + venueList.length * 2;
  ws.getColumn(1).width = 10;
  ws.getColumn(2).width = 10;
  const referenceVenueWidths = [17.58, 18.16, 21.84, 18.77, 18.55, 19.13, 19.03, 18.94];
  for (let i = 0; i < venueList.length; i += 1) {
    ws.getColumn(3 + i * 2).width = referenceVenueWidths[i * 2] ?? 18;
    ws.getColumn(4 + i * 2).width = referenceVenueWidths[i * 2 + 1] ?? 18;
  }

  ws.mergeCells(1, 1, 2, colCount);
  styleTitleCell(ws.getCell(1, 1));
  ws.getCell(1, 1).value = title;
  ws.getCell(1, 1).alignment = { ...ws.getCell(1, 1).alignment, shrinkToFit: true };
  ws.getRow(1).height = 14.4;
  ws.getRow(2).height = 22;

  const scheduled = tournament.events.flatMap((event) =>
    event.matches.filter((m) => scheduleTimeKey(m) && m.venueId).map((match) => ({ event, match })),
  );

  let row = 2;
  let sessionNo = 0;
  for (const session of sessions(tournament)) {
    const sessionMatches = scheduled.filter(({ match }) => sessionKeyForMatch(match) === session.key);
    if (!sessionMatches.length) continue;
    const activeVenueIndexes = venueList
      .map((venue, index) => (sessionMatches.some(({ match }) => match.venueId === venue.id) ? index : -1))
      .filter((index) => index >= 0);
    // 场地列保持全局顺序与编号；若某节只使用后面的场地，前面的列留空，避免“2号场”被挪到“1号场”位置。
    const sessionVenues = preserveTeamCourts ? venueList : activeVenueIndexes.length ? venueList.slice(0, Math.max(...activeVenueIndexes) + 1) : [];
    const sessionColCount = 2 + sessionVenues.length * 2;
    sessionNo += 1;

    // 总标题只在表格开头出现；上午、下午及后续日期仅保留分节标题。
    row += 1;
    ws.mergeCells(row, 1, row, sessionColCount);
    const sessionCell = ws.getCell(row, 1);
    sessionCell.value = `第${sessionNo}节（${session.label}）`;
    sessionCell.font = { ...REFERENCE_TEXT, bold: true, size: 18, color: { argb: 'FF000000' } };
    sessionCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
    sessionCell.alignment = { horizontal: 'center', vertical: 'middle' };
    sessionCell.border = referenceBorder();
    ws.getRow(row).height = 42;
    row += 1;

    const headerRow = row;
    ws.getCell(headerRow, 1).value = '场次';
    ws.getCell(headerRow, 2).value = '时间';
    referenceCell(ws.getCell(headerRow, 1), { bold: true, size: 12 });
    referenceCell(ws.getCell(headerRow, 2), { bold: true, size: 12 });
    sessionVenues.forEach((venue, i) => {
      const col = 3 + i * 2;
      ws.mergeCells(headerRow, col, headerRow, col + 1);
      ws.getCell(headerRow, col).value = orderVenueLabel(venue.name);
      referenceCell(ws.getCell(headerRow, col), { bold: true, size: 16 });
      ws.getCell(headerRow, col).border = {
        top: { style: 'thick', color: { argb: 'FF7F7F7F' } },
        bottom: { style: 'thick', color: { argb: 'FF7F7F7F' } },
        left: { style: i === 0 ? 'thick' : 'thin', color: { argb: 'FF7F7F7F' } },
        right: { style: 'thin', color: { argb: 'FF7F7F7F' } },
      };
      ws.getCell(headerRow, col + 1).border = {
        top: { style: 'thick', color: { argb: 'FF7F7F7F' } },
        bottom: { style: 'thick', color: { argb: 'FF7F7F7F' } },
        left: { style: 'thin', color: { argb: 'FF7F7F7F' } },
        right: { style: 'thick', color: { argb: 'FF7F7F7F' } },
      };
    });
    ws.getRow(headerRow).height = 35;
    row += 1;

    const times = [...new Set(sessionMatches.map(({ match }) => scheduleTimeKey(match)).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b),
    );
    times.forEach((time, index) => {
      const top = row;
      ws.mergeCells(top, 1, top + 3, 1);
      ws.mergeCells(top, 2, top + 3, 2);
      ws.getCell(top, 1).value = `第${index + 1}场`;
      const firstMatch = sessionMatches.find(({ match }) => scheduleTimeKey(match) === time)?.match;
      ws.getCell(top, 2).value = firstMatch ? shortScheduleTime(firstMatch) : time;
      referenceCell(ws.getCell(top, 1));
      referenceCell(ws.getCell(top, 2));

      sessionVenues.forEach((venue, i) => {
        const col = 3 + i * 2;
        const found = sessionMatches.find(
          ({ match }) => scheduleTimeKey(match) === time && match.venueId === venue.id,
        );
        if (found) {
          const { event, match } = found;
          const side1 = orderSideText(event, match, 1, regMap);
          const side2 = orderSideText(event, match, 2, regMap);
          ws.getCell(top, col).value = match.label ?? eventLabel(event);
          ws.getCell(top, col + 1).value = codeMap.get(match.id) ?? '';
          ws.getCell(top + 1, col).value = match.roundText ?? roundLabel(match);
          ws.getCell(top + 1, col + 1).value = pairLabel(match, posMap);
          ws.getCell(top + 2, col).value = side1.unit;
          ws.getCell(top + 2, col + 1).value = side2.unit;
          ws.getCell(top + 3, col).value = side1.name;
          ws.getCell(top + 3, col + 1).value = side2.name;
        }
      });

      for (let r = top; r <= top + 3; r += 1) {
        for (let c = 1; c <= sessionColCount; c += 1) {
          const cell = ws.getCell(r, c);
          if (c <= 2) {
            referenceCell(cell);
          } else {
            const venueIndex = Math.floor((c - 3) / 2);
            const isLeft = (c - 3) % 2 === 0;
            cell.font = { ...REFERENCE_TEXT, color: { argb: 'FF000000' } };
            cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
            cell.border = orderPairBorder(index + sessionNo - 1, r === top, r === top + 3, isLeft, !isLeft);
          }
        }
      }
      for (let r = top; r <= top + 3; r += 1) ws.getRow(r).height = 24;
      row += 4;
    });
  }
  if (sessionNo === 0) ws.getCell(3, 1).value = '暂无已排程的场次';
}

function pairLabel(match: ExportMatch, posMap: Map<string, { group: string; pos: number }>) {
  if ((match.roundNo ?? 0) !== 0) return '';
  const a = match.side1Id ? posMap.get(match.side1Id) : null;
  const b = match.side2Id ? posMap.get(match.side2Id) : null;
  if (!a || !b) return '';
  return `${a.group}${a.pos}-${b.group}${b.pos}`;
}

// ===== 工作表 3：流程表（各项目第一阶段小组网格 + 第二阶段淘汰树）=====

function buildFlowSheet(
  wb: ExcelJS.Workbook,
  tournament: ExportTournament,
  stage?: 'first' | 'second',
) {
  // 打印：横向、缩到一页宽，高度按内容分页；对阵树每段从新的一页开始（见 renderBracketTree）。
  const ws = wb.addWorksheet('流程表', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.properties.defaultColWidth = 8;
  const regMap = registrationMap(tournament);
  const codeMap = matchCodeMap(tournament);

  let row = 1;
  for (const item of tournament.events) {
    // 团体赛按“场”呈现：多子项场次折叠为一条，避免签位被重复画多次。
    const event: ExportEvent = { ...item, matches: dedupeFixtures(item.matches) };
    const label = eventLabel(event);
    const teamRoundRobin = event.teamCompetition?.format === 'ROUND_ROBIN';
    // 只有一个阶段的赛制不写「第二阶段」：单淘汰的对阵树标「单淘汰」，单项单循环画循环成绩网格。
    const singleElimination = event.format === 'SINGLE_ELIMINATION';
    const roundRobin = event.format === 'ROUND_ROBIN' && !event.teamCompetition;
    // 淘汰+分组排名：第一阶段是淘汰赛，第二阶段是排位赛（A-H 签位）。
    const eliminationThenRanking = event.format === 'SINGLE_ELIMINATION_PLUS_GROUP_RANKING';
    // 第一阶段：「小组循环+淘汰(标准2023)」和单循环输出循环成绩网格，淘汰+分组排名输出淘汰对阵树。
    // 按阶段导出时，第二阶段不画第一阶段；第一阶段不画第二阶段（全量导出 stage 为空时两段都画）。
    if (stage !== 'second' && (event.format === GROUP_KNOCKOUT_STD || teamRoundRobin || roundRobin)) {
      row = sectionTitle(ws, row, teamRoundRobin ? `${label}单组循环：` : roundRobin ? `${label}单循环：` : `${label}第一阶段：`);
      row = renderGroupGrids(ws, row, event, regMap, codeMap);
      row += 1;
    } else if (stage !== 'second' && eliminationThenRanking) {
      const tree = eventBracketTree(event, regMap, codeMap);
      row = tree ? renderBracketTree(ws, row, tree, `${label}第一阶段`) : sectionTitle(ws, row, `${label}第一阶段：`);
      row += 1;
    }
    // 第二阶段：优先用后台手动指定的「前8/前6晋级赛」对阵图；否则画淘汰赛对阵树（已生成的
    // 淘汰赛场次，或标准2023 出线前按「X组第N名」预排的骨架）。都没有时仅留标题占位，与参考件一致。
    if (stage !== 'first' && !roundRobin) {
      const placement = Boolean(event.secondStage && event.secondStage.matches.length);
      const playoff = event.matches.some((m) => isPlayoff(m));
      const tree = teamRoundRobin || placement || playoff || eliminationThenRanking ? null : eventBracketTree(event, regMap, codeMap);
      const title = singleElimination ? `${label}单淘汰` : `${label}第二阶段`;
      if (tree) {
        row = renderBracketTree(ws, row, tree, title);
      } else {
        row = sectionTitle(ws, row, `${title}：`);
        if (teamRoundRobin) {
          // 保留秩序册模板的第二阶段占位；单组循环打完即结束，不生成淘汰场次。
          ws.getCell(row, 1).value = '单组循环全部结束后确定各队名次，见“名次汇总”。';
          row += 2;
        } else if (event.secondStage && event.secondStage.matches.length) {
          row = renderSecondStagePlacement(ws, row, event, event.secondStage, regMap);
        } else if (playoff) {
          row = renderPlayoffPlacementMatches(ws, row, event, regMap);
        }
      }
    }
    row += 2;
  }
  if (row === 1) ws.getCell(1, 1).value = '暂无项目';
}

function sectionTitle(ws: ExcelJS.Worksheet, row: number, text: string) {
  const cell = ws.getCell(row, 1);
  cell.value = text;
  cell.font = { bold: true, size: 12, color: { argb: ACCENT } };
  return row + 1;
}

// 第一阶段：每个小组一张「成员 × 成员」交叉网格，含胜次/净胜/名次。
function renderGroupGrids(
  ws: ExcelJS.Worksheet,
  startRow: number,
  event: ExportEvent,
  regMap: Map<string, ExportRegistration>,
  codeMap: Map<string, string>,
) {
  const positions = groupPositions(event);
  if (!positions.size) {
    ws.getCell(startRow, 1).value = '暂无小组循环数据';
    return startRow + 1;
  }

  // 按组聚合成员（按签位号排序）。
  const groups = new Map<string, Array<{ id: string; pos: number }>>();
  for (const [id, p] of positions) {
    const list = groups.get(p.group) ?? [];
    list.push({ id, pos: p.pos });
    groups.set(p.group, list);
  }
  for (const list of groups.values()) list.sort((a, b) => a.pos - b.pos);

  // 组内循环场次：按无序成员对索引。
  const groupMatchByPair = new Map<string, ExportMatch>();
  for (const match of event.matches) {
    if ((match.roundNo ?? 0) !== 0 || !match.side1Id || !match.side2Id) continue;
    groupMatchByPair.set(pairKey(match.side1Id, match.side2Id), match);
  }

  const POS_W = 1;
  const NAME_W = 3;
  const CROSS_W = 4;
  const STAT_W = 2;

  let row = startRow;
  for (const groupCode of [...groups.keys()].sort(compareGroupCode)) {
    const members = groups.get(groupCode)!;
    const n = members.length;

    // 表头行：组名(占 pos+name) + 各对手序号 + 胜次/净胜/名次。
    const headerRow = row;
    let col = 1;
    ws.mergeCells(headerRow, col, headerRow, col + POS_W + NAME_W - 1);
    ws.getCell(headerRow, col).value = `${groupCode}组`;
    styleHeaderCell(ws.getCell(headerRow, col));
    col += POS_W + NAME_W;
    const crossStart = col;
    for (let j = 0; j < n; j += 1) {
      ws.mergeCells(headerRow, col, headerRow, col + CROSS_W - 1);
      ws.getCell(headerRow, col).value = j + 1;
      styleHeaderCell(ws.getCell(headerRow, col));
      col += CROSS_W;
    }
    const statStart = col;
    (event.teamCompetition ? ['胜场', '胜次', '净胜分', '名次'] : ['胜次', '净胜', '名次']).forEach((text) => {
      ws.mergeCells(headerRow, col, headerRow, col + STAT_W - 1);
      ws.getCell(headerRow, col).value = text;
      styleHeaderCell(ws.getCell(headerRow, col));
      col += STAT_W;
    });
    const lastCol = col - 1;
    row += 1;

    const standings = computeGroupStandings(members, groupMatchByPair, event);

    members.forEach((member, i) => {
      const reg = regMap.get(member.id) ?? null;
      ws.getCell(row, 1).value = member.pos;
      ws.mergeCells(row, 1 + POS_W, row, POS_W + NAME_W);
      ws.getCell(row, 1 + POS_W).value = registrationName(reg);
      ws.getCell(row, 1 + POS_W).alignment = { vertical: 'middle', wrapText: true };

      for (let j = 0; j < n; j += 1) {
        const c = crossStart + j * CROSS_W;
        ws.mergeCells(row, c, row, c + CROSS_W - 1);
        const cell = ws.getCell(row, c);
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        if (i === j) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DIAGONAL } };
        } else {
          cell.value = crossCellText(member.id, members[j].id, groupMatchByPair, codeMap);
        }
      }

      const stat = standings.get(member.id)!;
      const stats = [stat.played ? stat.wins : '',
        ...(event.teamCompetition ? [stat.played ? stat.matchesWon : ''] : []),
        stat.played ? stat.netGames : '', stat.rank ?? '-'];
      stats.forEach((value, index) => {
        const statCol = statStart + index * STAT_W;
        ws.mergeCells(row, statCol, row, statCol + STAT_W - 1);
        ws.getCell(row, statCol).value = value;
      });

      for (let c = 1; c <= lastCol; c += 1) ws.getCell(row, c).border = thinBorder();
      row += 1;
    });
    row += 1; // 组间空行
  }
  return row;
}

function crossCellText(
  selfId: string,
  oppId: string,
  groupMatchByPair: Map<string, ExportMatch>,
  codeMap: Map<string, string>,
) {
  const match = groupMatchByPair.get(pairKey(selfId, oppId));
  if (!match) return '';
  // 团体赛直接显示这场对阵的团体比分。
  if (match.scoreText) return match.side1Id === selfId ? match.scoreText : match.scoreText.split(':').reverse().join(':');
  // 已赛完：从本方视角显示比局数（赢局:输局）。
  if (match.winnerSide && match.games.length) {
    const self1 = match.side1Id === selfId;
    const selfGames = gamesWonBy(match, self1 ? 1 : 2);
    const oppGames = gamesWonBy(match, self1 ? 2 : 1);
    return `${selfGames}:${oppGames}`;
  }
  // 未赛：显示场次号 / 时间 / 场地，便于查表。
  const code = codeMap.get(match.id) ?? (match.matchNo != null ? `#${match.matchNo}` : '');
  const when = fmtMatchScheduleDateTime(match);
  const venue = match.venue?.name ? `场地:${match.venue.name}` : '';
  return [code, when, venue].filter(Boolean).join('\n');
}

// 分组表沿用参考文件的“成绩录入矩阵”：未完赛格保持空白，
// 已完赛格才显示双方局分，避免把秩序表中的场次/时间说明混进统计表。
function standingCrossCellText(
  selfId: string,
  oppId: string,
  groupMatchByPair: Map<string, ExportMatch>,
) {
  const match = groupMatchByPair.get(pairKey(selfId, oppId));
  if (match?.scoreText) return match.side1Id === selfId ? match.scoreText : match.scoreText.split(':').reverse().join(':');
  if (!match || !match.winnerSide || !match.games.length) return '';
  const self1 = match.side1Id === selfId;
  return `${gamesWonBy(match, self1 ? 1 : 2)}:${gamesWonBy(match, self1 ? 2 : 1)}`;
}

function computeGroupStandings(
  members: Array<{ id: string; pos: number }>,
  groupMatchByPair: Map<string, ExportMatch>,
  event: ExportEvent,
) {
  if (event.teamCompetition) {
    const ids = new Set(members.map(member => member.id));
    const competition = event.teamCompetition;
    const standings = teamStandings({
      format: competition.format,
      winThreshold: competition.winThreshold,
      teams: competition.teams.filter(team => ids.has(team.id)).map(team => ({ ...team, finalRank: null })),
      teamMatches: competition.teamMatches.filter(match => match.stage === 'GROUP'
        && match.team1Id && ids.has(match.team1Id) && match.team2Id && ids.has(match.team2Id)),
    });
    return new Map(standings.map(row => [row.id, {
      wins: row.wins, played: row.played, matchesWon: row.matchesWon, netGames: row.gameDiff, pointDiff: row.gameDiff,
      rank: row.played ? row.rank : null,
    }]));
  }
  const rows = members.map((m) => ({
    id: m.id,
    wins: 0,
    losses: 0,
    netGames: 0,
    pointDiff: 0,
    played: 0,
  }));
  const byId = new Map(rows.map((r) => [r.id, r]));

  for (let i = 0; i < members.length; i += 1) {
    for (let j = i + 1; j < members.length; j += 1) {
      const match = groupMatchByPair.get(pairKey(members[i].id, members[j].id));
      if (!match || !match.winnerSide) continue;
      const a = byId.get(members[i].id)!;
      const b = byId.get(members[j].id)!;
      a.played += 1;
      b.played += 1;
      const aIsSide1 = match.side1Id === members[i].id;
      const aGames = gamesWonBy(match, aIsSide1 ? 1 : 2);
      const bGames = gamesWonBy(match, aIsSide1 ? 2 : 1);
      a.netGames += aGames - bGames;
      b.netGames += bGames - aGames;
      for (const g of match.games) {
        const aScore = aIsSide1 ? g.side1Score : g.side2Score;
        const bScore = aIsSide1 ? g.side2Score : g.side1Score;
        a.pointDiff += aScore - bScore;
        b.pointDiff += bScore - aScore;
      }
      const winnerId = match.winnerSide === 1 ? match.side1Id : match.side2Id;
      if (winnerId === a.id) {
        a.wins += 1;
        b.losses += 1;
      } else {
        b.wins += 1;
        a.losses += 1;
      }
    }
  }

  const ranked = [...rows].sort(
    (x, y) => y.wins - x.wins || y.netGames - x.netGames || y.pointDiff - x.pointDiff,
  );
  const result = new Map<string, {
    wins: number;
    matchesWon: number;
    netGames: number;
    pointDiff: number;
    played: number;
    rank: number | null;
  }>();
  ranked.forEach((r, index) => {
    result.set(r.id, {
      wins: r.wins,
      matchesWon: 0,
      netGames: r.netGames,
      pointDiff: r.pointDiff,
      played: r.played,
      rank: r.played ? index + 1 : null,
    });
  });
  return result;
}

// ===== 第二阶段淘汰对阵树 =====
// 秩序册「流程表」第二阶段与后台「对阵图（PNG）」共用同一份数据（eventBracketTree），
// 名字、比分、场次号、轮空、冠军都从这里来，两边内容一致。

export type BracketTreeSide = {
  name: string;
  /** 单位（学校/队伍），PNG 对阵图用。 */
  unit: string;
  /** 每局得分（团体赛为团体总比分），打了才有。 */
  scores: string[];
  winner: boolean;
  /** 轮空场空着的一方（写「轮空」）。 */
  bye: boolean;
};

export type BracketTreeMatch = {
  /** 场次号 · 时间 · 场地，排了才有。 */
  info: string;
  sides: [BracketTreeSide, BracketTreeSide];
};

export type BracketTreeRound = { label: string; matches: BracketTreeMatch[] };

export type BracketTree = {
  /** 按轮次升序；每轮场次按签位顺序，第 2m、2m+1 场的胜者进下一轮第 m 场。 */
  rounds: BracketTreeRound[];
  bronze: BracketTreeMatch | null;
  /** 最后一轮只有一场（决赛）时画冠军位：'' = 还没决出；null = 不画。 */
  champion: string | null;
  /** 小组赛结束前按出线名次预排的骨架（签位写「X组第N名」）。 */
  preview: boolean;
  /** 签位数 = 首轮场次 × 2。 */
  drawSize: number;
};

function knockoutTreeMatches(event: ExportEvent) {
  return event.matches.filter((m) => (m.roundNo ?? 0) >= 1 && (m.roundNo ?? 0) < 100 && !isPlayoff(m));
}

function shortMatchDateTime(match: ExportMatch) {
  const parts = scheduleDatePartsForMatch(match);
  return parts ? `${pad2(parts.month)}-${pad2(parts.day)} ${pad2(parts.hour)}:${pad2(parts.minute)}` : '';
}

// 对阵图上的单位：双打两人同单位只写一次。
function treeUnit(registration: ExportRegistration | null | undefined) {
  if (!registration) return '';
  const team = registration.teamName?.trim();
  if (team) return team;
  const units = [registration.player1.affiliation, registration.player2?.affiliation]
    .map((unit) => unit?.trim() ?? '')
    .filter(Boolean);
  return [...new Set(units)].join('/');
}

function treeMatchFromExport(
  match: ExportMatch,
  regMap: Map<string, ExportRegistration>,
  codeMap: Map<string, string>,
): BracketTreeMatch {
  const bye = isByeMatch(match);
  // 团体赛：scoreText 是团体总比分（子项胜场），胜负也按它算；子项场次的胜负不代表整场。
  const team = /^(\d+):(\d+)$/.exec(match.scoreText ?? '');
  const winnerSide = team
    ? Number(team[1]) > Number(team[2]) ? 1 : Number(team[2]) > Number(team[1]) ? 2 : null
    : match.winnerSide;
  const side = (no: 1 | 2): BracketTreeSide => {
    const id = no === 1 ? match.side1Id : match.side2Id;
    const named = no === 1 ? match.side1Name : match.side2Name;
    const registration = id ? regMap.get(id) ?? null : null;
    const scores = team
      ? [team[no]]
      : match.games.map((game) => String(no === 1 ? game.side1Score : game.side2Score));
    return {
      name: named || (id ? registrationName(registration) || '待定' : bye ? '轮空' : '待定'),
      unit: named ? '' : treeUnit(registration),
      scores: bye ? [] : scores,
      winner: !bye && winnerSide === no,
      bye: bye && !id,
    };
  };
  return {
    info: bye ? '' : [codeMap.get(match.id), shortMatchDateTime(match), match.venue?.name].filter(Boolean).join('  '),
    sides: [side(1), side(2)],
  };
}

function finishTree(rounds: BracketTreeRound[], bronze: BracketTreeMatch | null, preview: boolean): BracketTree {
  const last = rounds[rounds.length - 1];
  const final = last?.matches.length === 1 ? last.matches[0] : null;
  const champion = final ? final.sides.find((side) => side.winner)?.name ?? '' : null;
  return { rounds, bronze, champion, preview, drawSize: (rounds[0]?.matches.length ?? 0) * 2 };
}

/**
 * 项目的淘汰对阵树：已生成淘汰赛按真实场次；标准2023 出线前按各组人数×出线数预排骨架。
 * 没有淘汰赛（循环赛、排位赛、还没抽签）返回 null。
 */
function eventBracketTree(
  event: ExportEvent,
  regMap: Map<string, ExportRegistration>,
  codeMap: Map<string, string>,
): BracketTree | null {
  const knockout = knockoutTreeMatches(event);
  // 预排的淘汰赛空位（双方都空）：签位名照出线前骨架画，场次号 / 时间 / 场地取已排的空位场次。
  const placeholders = event.format === GROUP_KNOCKOUT_STD && knockout.length > 0 && knockoutPlaceholdersOnly(knockout);
  if (knockout.length && !placeholders) {
    const main = knockout.filter((m) => m.round !== 'BRONZE');
    const roundNos = [...new Set(main.map((m) => m.roundNo ?? 0))].sort((a, b) => a - b);
    const rounds = roundNos.map((roundNo) => {
      const list = main
        .filter((m) => (m.roundNo ?? 0) === roundNo)
        .sort((a, b) => (a.matchNo ?? 0) - (b.matchNo ?? 0) || a.id.localeCompare(b.id));
      return {
        label: KNOCKOUT_ROUND_LABELS[String(list[0].round)] ?? roundLabel(list[0]),
        matches: list.map((m) => treeMatchFromExport(m, regMap, codeMap)),
      };
    });
    const bronze = knockout.find((m) => m.round === 'BRONZE');
    return finishTree(rounds, bronze ? treeMatchFromExport(bronze, regMap, codeMap) : null, false);
  }

  if (event.format !== GROUP_KNOCKOUT_STD) return null;
  // 出线前：签位排法与小组赛结束后实际生成的淘汰赛相同（placeGroupQualifiers）。
  // 按阶段导出第二阶段时 matches 里没有小组赛场次，各组人数由 groupSizes 带进来。
  const sizes = event.groupSizes
    ? new Map(Object.entries(event.groupSizes))
    : groupSizesFromGroupMatches(event.matches);
  const skeleton = buildKnockoutSkeleton([...sizes.keys()], event.qualifiersPerGroup ?? 2, sizes);
  if (!skeleton) return null;
  const nameById = new Map(skeleton.participants.map((p) => [p.id, p.name]));
  const rowByKey = new Map(knockout.map((m) => [knockoutSlotKey(m), m]));
  const toTree = (m: SkeletonMatch): BracketTreeMatch => {
    const bye = isByeMatch(m);
    const side = (id: string | null): BracketTreeSide => ({
      name: id ? nameById.get(id) ?? '待定' : bye ? '轮空' : '待定',
      unit: '',
      scores: [],
      winner: false,
      bye: bye && !id,
    });
    const row = rowByKey.get(knockoutSlotKey(m));
    return { info: row ? treeMatchFromExport(row, regMap, codeMap).info : '', sides: [side(m.side1Id), side(m.side2Id)] };
  };
  const main = skeleton.matches.filter((m) => m.round !== 'BRONZE');
  const roundNos = [...new Set(main.map((m) => m.roundNo))].sort((a, b) => a - b);
  const rounds = roundNos.map((roundNo) => {
    const list = main.filter((m) => m.roundNo === roundNo).sort((a, b) => a.matchNo - b.matchNo);
    return { label: KNOCKOUT_ROUND_LABELS[list[0].round] ?? `第${roundNo}轮`, matches: list.map(toTree) };
  });
  const bronze = skeleton.matches.find((m) => m.round === 'BRONZE');
  return finishTree(rounds, bronze ? toTree(bronze) : null, true);
}

/**
 * 后台「对阵图（PNG）」：单个项目的淘汰对阵树，与秩序册流程表第二阶段同一份数据。
 * 循环赛、第二阶段是「前8/前6晋级赛」或排位赛、还没有淘汰赛时返回画不了的原因。
 */
export function eventBracketTreeForImage(event: ExportEvent): { tree: BracketTree } | { reason: string } {
  if (event.format === 'ROUND_ROBIN') return { reason: '循环赛没有淘汰对阵图' };
  if (event.secondStage?.matches.length || event.matches.some((m) => isPlayoff(m))) {
    return { reason: '该项目第二阶段是排位赛，没有淘汰对阵图，请看秩序册「流程表」' };
  }
  const regMap = new Map(event.registrations.map((registration) => [registration.id, registration]));
  const tree = eventBracketTree(event, regMap, matchCodeMap({ events: [event] }));
  return tree ? { tree } : { reason: '该项目还没有淘汰赛对阵（抽签后再下载）' };
}

/** 对阵图（PNG）按阶段导出：first 第一阶段、second 第二阶段、all 全部阶段（单阶段赛制三者相同）。 */
export type EventImageStage = 'first' | 'second' | 'all';
/** 图里的一段：淘汰对阵树，或画好表格的临时工作表（小组赛成绩表、A-H 晋级赛、交叉排位赛）。 */
export type EventImagePart = { label: string; tree?: BracketTree; sheet?: ExcelJS.Worksheet };

const GROUP_STAGE_IMAGE_FORMATS = [GROUP_KNOCKOUT_STD, 'GROUP_PLUS_KNOCKOUT', 'GROUP_PLUS_PLAYOFF'];

// 在一张临时工作表上画表格（列宽、样式与秩序册流程表相同），画不出内容时返回 null。
function scratchSheet(draw: (ws: ExcelJS.Worksheet) => number) {
  const ws = new ExcelJS.Workbook().addWorksheet('对阵图');
  ws.properties.defaultColWidth = 8;
  return draw(ws) > 1 ? ws : null;
}

/**
 * 对阵图（PNG）：一个项目指定阶段要画的内容，与秩序册流程表同一份数据。
 * - 小组+淘汰 / 小组+交叉排位：第一阶段 = 小组赛成绩表；第二阶段 = 淘汰对阵树（出线前为预排骨架）、
 *   A-H 前8/前6名晋级赛或交叉排位赛。
 * - 淘汰+分组排名：第一阶段 = 淘汰对阵树，第二阶段 = 排位赛（A-H）。
 * - 单淘汰、单循环只有一个阶段，不分 first / second。
 * 画不出来时返回原因。
 */
export function eventImageParts(
  event: ExportEvent,
  stage: EventImageStage,
): { label: string; parts: EventImagePart[]; tree: BracketTree | null } | { reason: string } {
  const deduped: ExportEvent = { ...event, matches: dedupeFixtures(event.matches) };
  const regMap = new Map(deduped.registrations.map((registration) => [registration.id, registration]));
  const codeMap = matchCodeMap({ events: [deduped] });
  const groupsPart = (label: string): EventImagePart | null => {
    if (!groupPositions(deduped).size) return null;
    const sheet = scratchSheet((ws) => renderGroupGrids(ws, 1, deduped, regMap, codeMap));
    return sheet ? { label, sheet } : null;
  };
  const treePart = (label: string): EventImagePart | null => {
    const tree = eventBracketTree(deduped, regMap, codeMap);
    return tree ? { label, tree } : null;
  };
  const placementPart = (label: string): EventImagePart | null => {
    const secondStage = deduped.secondStage;
    if (!secondStage?.matches.length) return null;
    const sheet = scratchSheet((ws) => renderSecondStagePlacement(ws, 1, deduped, secondStage, regMap));
    return sheet ? { label, sheet } : null;
  };
  const playoffPart = (label: string): EventImagePart | null => {
    if (!deduped.matches.some((m) => isPlayoff(m))) return null;
    const sheet = scratchSheet((ws) => renderPlayoffPlacementMatches(ws, 1, deduped, regMap));
    return sheet ? { label, sheet } : null;
  };
  const single = (part: EventImagePart | null, reason: string) =>
    part ? { label: part.label, parts: [part], tree: part.tree ?? null } : { reason };

  if (event.format === 'SINGLE_ELIMINATION') return single(treePart('单淘汰'), '该项目还没有淘汰赛对阵（抽签后再下载）');
  if (event.format === 'ROUND_ROBIN') return single(groupsPart('单循环'), '该项目还没有循环赛场次（抽签后再下载）');

  let first: EventImagePart | null;
  let second: EventImagePart | null;
  let firstReason: string;
  let secondReason: string;
  if (event.format === 'SINGLE_ELIMINATION_PLUS_GROUP_RANKING') {
    // 淘汰对阵树只取第一阶段场次（roundNo 1–99），排位赛不进树。
    first = treePart('第一阶段（淘汰赛）');
    second = placementPart('第二阶段（排位赛）');
    firstReason = '该项目还没有淘汰赛对阵（抽签后再下载）';
    secondReason = '第二阶段排位赛还没有对阵（淘汰赛结束后在抽签编排页确定）';
  } else if (GROUP_STAGE_IMAGE_FORMATS.includes(event.format ?? '')) {
    first = groupsPart('第一阶段（小组赛）');
    const top6 = deduped.secondStage?.rankingMode === 'TOP_6';
    second = placementPart(`第二阶段（前${top6 ? 6 : 8}名晋级赛）`)
      ?? playoffPart('第二阶段（交叉排位赛）')
      ?? (event.format === 'GROUP_PLUS_PLAYOFF' ? null : treePart('第二阶段（淘汰赛）'));
    firstReason = '该项目还没有小组赛场次（抽签后再下载）';
    secondReason = '第二阶段还没有对阵（小组赛结束后生成）';
  } else {
    return { reason: '该项目的赛制暂不支持导出对阵图' };
  }

  if (stage === 'first') return single(first, firstReason);
  if (stage === 'second') return single(second, secondReason);
  const parts = [first, second].filter((part): part is EventImagePart => Boolean(part));
  if (!parts.length) return { reason: firstReason };
  return { label: '全部阶段', parts, tree: parts.find((part) => part.tree)?.tree ?? null };
}

// ---- 秩序册流程表里的对阵树（单元格画框、边框画连线）----
// 每轮占 4 列：名字 2 列 + 比分 1 列 + 连线 1 列；首轮每场占 4 行：场次信息、双方各一行、空行。
// 下一轮的框画在上一轮两场正中，连线的竖线就是下一轮框的左边。
const TREE_NAME_COLS = 2;
const TREE_ROUND_COLS = 4;
const TREE_SLOT_ROWS = 4;
// 超过 32 签时每 32 个签位一段（首轮 16 场），各段画到该段只剩一场，最后单独画「决赛阶段」。
const TREE_SECTION_FIRST_ROUND = 16;
const TREE_LINE_COLOR = 'FF6B7280';
const TREE_MUTED_COLOR = 'FF9CA3AF';

type TreeSection = {
  title: string | null;
  rounds: BracketTreeRound[];
  bronze: BracketTreeMatch | null;
  champion: string | null;
};

function bracketTreeSections(tree: BracketTree): TreeSection[] {
  const whole: TreeSection = { title: null, rounds: tree.rounds, bronze: tree.bronze, champion: tree.champion };
  const first = tree.rounds[0]?.matches.length ?? 0;
  const depth = Math.log2(TREE_SECTION_FIRST_ROUND) + 1;
  const halving = tree.rounds.every(
    (round, k) => k === 0 || round.matches.length * 2 === tree.rounds[k - 1].matches.length,
  );
  if (first <= TREE_SECTION_FIRST_ROUND || first % TREE_SECTION_FIRST_ROUND || !halving || tree.rounds.length <= depth) {
    return [whole];
  }
  const count = first / TREE_SECTION_FIRST_ROUND;
  const slots = TREE_SECTION_FIRST_ROUND * 2;
  const sections: TreeSection[] = Array.from({ length: count }, (_, s) => ({
    title: `第${s * slots + 1}–${(s + 1) * slots}号签位`,
    rounds: tree.rounds.slice(0, depth).map((round) => {
      const per = round.matches.length / count;
      return { label: round.label, matches: round.matches.slice(s * per, (s + 1) * per) };
    }),
    bronze: null,
    champion: null,
  }));
  sections.push({ title: '决赛阶段', rounds: tree.rounds.slice(depth), bronze: tree.bronze, champion: tree.champion });
  return sections;
}

function addCellBorder(cell: Cell, edges: Partial<ExcelJS.Borders>) {
  cell.border = { ...(cell.border ?? {}), ...edges };
}

function treeLine(style: ExcelJS.BorderStyle = 'thin'): Partial<ExcelJS.Border> {
  return { style, color: { argb: TREE_LINE_COLOR } };
}

// 一场：side1 行 = row，side2 行 = row + 1，场次信息在 row - 1；两方之间的横线就是出线的高度。
function drawTreeMatch(ws: ExcelJS.Worksheet, row: number, col: number, match: BracketTreeMatch, caption?: string) {
  const infoText = [caption, match.info].filter(Boolean).join('  ');
  if (infoText) {
    ws.mergeCells(row - 1, col, row - 1, col + TREE_NAME_COLS);
    const info = ws.getCell(row - 1, col);
    info.value = infoText;
    info.font = { size: 8, bold: Boolean(caption), color: { argb: caption ? ACCENT : 'FF6B7280' } };
    info.alignment = { horizontal: 'left', vertical: 'bottom', shrinkToFit: true };
  }
  match.sides.forEach((side, index) => {
    const r = row + index;
    const outer = index === 0 ? { top: treeLine() } : { bottom: treeLine() };
    const inner = index === 0 ? { bottom: treeLine('hair') } : { top: treeLine('hair') };
    ws.mergeCells(r, col, r, col + TREE_NAME_COLS - 1);
    const name = ws.getCell(r, col);
    name.value = side.name;
    name.font = {
      size: 10,
      bold: side.winner,
      color: { argb: side.bye || side.name === '待定' ? TREE_MUTED_COLOR : 'FF111827' },
    };
    name.alignment = { horizontal: 'left', vertical: 'middle', indent: 1, shrinkToFit: true };
    name.border = { left: treeLine(), right: { style: 'hair', color: { argb: TREE_LINE_COLOR } }, ...outer, ...inner };
    const score = ws.getCell(r, col + TREE_NAME_COLS);
    score.value = side.scores.join(' ');
    score.font = { size: 9, bold: side.winner, color: { argb: 'FF374151' } };
    score.alignment = { horizontal: 'center', vertical: 'middle', shrinkToFit: true };
    score.border = { right: treeLine(), ...outer, ...inner };
  });
}

function renderTreeSection(ws: ExcelJS.Worksheet, startRow: number, section: TreeSection) {
  const { rounds } = section;
  if (!rounds.length) return startRow;
  const headerRow = startRow;
  const bodyTop = startRow + 1;
  // 每场 side1 所在行：首轮等距，后面各轮取两场来源的正中（间距是偶数，正好落在整行上）。
  const rows: number[][] = [];
  rounds.forEach((round, k) => {
    rows[k] = round.matches.map((_, m) => {
      if (k === 0) return bodyTop + 1 + m * TREE_SLOT_ROWS;
      const a = rows[k - 1][2 * m];
      const b = rows[k - 1][2 * m + 1];
      if (a === undefined) return bodyTop + 1 + m * TREE_SLOT_ROWS * 2 ** k;
      return b === undefined ? a : Math.floor((a + b) / 2);
    });
  });

  let bottom = bodyTop;
  rounds.forEach((round, k) => {
    const col = 1 + k * TREE_ROUND_COLS;
    ws.mergeCells(headerRow, col, headerRow, col + TREE_NAME_COLS);
    const head = ws.getCell(headerRow, col);
    head.value = round.label;
    styleHeaderCell(head);
    const lineCol = col + TREE_NAME_COLS + 1;
    const next = rounds[k + 1];
    round.matches.forEach((match, m) => {
      const row = rows[k][m];
      drawTreeMatch(ws, row, col, match);
      bottom = Math.max(bottom, row + 1);
      if (!next) return;
      // 出线：从两方之间横着连到下一轮那一场的左边；每两场之间再连一条竖线。
      addCellBorder(ws.getCell(row, lineCol), { bottom: treeLine() });
      const partner = rows[k][m + 1];
      if (m % 2 === 0 && partner !== undefined) {
        for (let r = row + 1; r <= partner; r += 1) addCellBorder(ws.getCell(r, lineCol), { right: treeLine() });
      }
    });
  });

  const lastIndex = rounds.length - 1;
  const lastCol = 1 + lastIndex * TREE_ROUND_COLS;
  const finalRow = rounds[lastIndex].matches.length === 1 ? rows[lastIndex][0] : null;
  if (section.champion !== null && finalRow !== null) {
    // 冠军：决赛出线横线接到冠军名字下面。
    const lineCol = lastCol + TREE_NAME_COLS + 1;
    const nameCol = lineCol + 1;
    addCellBorder(ws.getCell(finalRow, lineCol), { bottom: treeLine() });
    ws.mergeCells(headerRow, nameCol, headerRow, nameCol + TREE_NAME_COLS - 1);
    const head = ws.getCell(headerRow, nameCol);
    head.value = '冠军';
    styleHeaderCell(head);
    ws.mergeCells(finalRow, nameCol, finalRow, nameCol + TREE_NAME_COLS - 1);
    const champion = ws.getCell(finalRow, nameCol);
    champion.value = section.champion || '待定';
    champion.font = { size: 11, bold: Boolean(section.champion), color: { argb: section.champion ? 'FFB45309' : TREE_MUTED_COLOR } };
    champion.alignment = { horizontal: 'center', vertical: 'bottom', shrinkToFit: true };
    champion.border = { bottom: treeLine('medium') };
  }
  if (section.bronze) {
    // 季军赛：画在决赛下面（同一列）；没有单场决赛时画在树下方。
    const row = finalRow !== null ? finalRow + 5 : bottom + 3;
    const col = finalRow !== null ? lastCol : 1;
    drawTreeMatch(ws, row, col, section.bronze, '季军赛');
    bottom = Math.max(bottom, row + 1);
  }
  return bottom + 2;
}

/** 流程表第二阶段：画对阵树；超过 32 签时按签位分段，每段从新的一页开始。返回下一可用行。 */
function renderBracketTree(ws: ExcelJS.Worksheet, startRow: number, tree: BracketTree, title: string) {
  let row = startRow;
  for (const section of bracketTreeSections(tree)) {
    if (row > 1) ws.getRow(row - 1).addPageBreak();
    row = sectionTitle(ws, row, section.title ? `${title}（${section.title}）：` : `${title}：`);
    row = renderTreeSection(ws, row, section);
  }
  return row;
}

const MATCH_STATUS_LABELS: Record<string, string> = {
  PENDING: '未开始',
  LIVE: '进行中',
  COMPLETED: '已结束',
  CANCELLED: '已取消',
};

function matchScoreText(match: ExportMatch) {
  if (match.scoreText) return match.scoreText;
  return match.games.length ? match.games.map((game) => `${game.side1Score}:${game.side2Score}`).join('  ') : '';
}

function scheduleMeta(match: ExportMatch | null | undefined) {
  if (!match) return '';
  const parts = [
    fmtMatchScheduleDateTime(match),
    match.venue?.name ? `场地:${match.venue.name}` : '',
  ].filter(Boolean);
  return parts.join('\n');
}

function playoffSideName(
  event: ExportEvent,
  match: ExportMatch,
  side: 1 | 2,
  regMap: Map<string, ExportRegistration>,
) {
  const id = side === 1 ? match.side1Id : match.side2Id;
  const registration = id ? regMap.get(id) ?? null : null;
  return registrationName(registration) || playoffSideSource(event, match, side) || '待定';
}

function renderPlayoffPlacementMatches(
  ws: ExcelJS.Worksheet,
  startRow: number,
  event: ExportEvent,
  regMap: Map<string, ExportRegistration>,
) {
  const matches = event.matches
    .filter((match) => isPlayoff(match))
    .sort((a, b) => (a.matchNo ?? 0) - (b.matchNo ?? 0) || a.id.localeCompare(b.id));
  if (!matches.length) return startRow;

  const headers = ['场次', '名次赛', '时间', '场地', '对阵', '比分', '状态'];
  const widths = [8, 14, 17, 12, 30, 12, 10];
  widths.forEach((width, index) => {
    const column = ws.getColumn(index + 1);
    column.width = Math.max(column.width ?? 0, width);
  });

  let row = startRow;
  headers.forEach((header, index) => {
    const cell = ws.getCell(row, index + 1);
    cell.value = header;
    styleHeaderCell(cell);
  });
  row += 1;

  for (const match of matches) {
    const values = [
      match.matchNo != null ? `第${match.matchNo}场` : '',
      roundLabel(match),
      fmtMatchScheduleDateTime(match),
      match.venue?.name ?? '',
      `${playoffSideName(event, match, 1, regMap)} VS ${playoffSideName(event, match, 2, regMap)}`,
      matchScoreText(match),
      MATCH_STATUS_LABELS[match.status] ?? match.status,
    ];
    values.forEach((value, index) => {
      const cell = ws.getCell(row, index + 1);
      cell.value = value;
      cell.border = thinBorder();
      cell.alignment = { vertical: 'middle', wrapText: true };
    });
    row += 1;
  }

  return row;
}

// ===== 模板风格综合页 =====
// 模板中的“小组赛 / 分组表 / 名次 / 八强”都是静态展示页。
// 这里保留相同的阅读顺序，但所有内容均从抽签后物化的 registrations、matches、secondStage 生成，
// 这样重新抽签或调整排程后再次导出即可得到最新秩序册。

// 预排的淘汰赛空位（淘汰赛场次双方都空）的占位名；不是空位时为 null。每个项目对象算一次。
const placeholderNameCache = new WeakMap<ExportEvent, Map<string, [string, string]> | null>();
function placeholderNamesOf(event: ExportEvent) {
  if (placeholderNameCache.has(event)) return placeholderNameCache.get(event) ?? null;
  let names: Map<string, [string, string]> | null = null;
  if (event.format === GROUP_KNOCKOUT_STD && knockoutPlaceholdersOnly(event.matches)) {
    // 按阶段导出第二阶段时 matches 里没有小组赛场次，各组人数由 groupSizes 带进来。
    const sizes = event.groupSizes ? new Map(Object.entries(event.groupSizes)) : undefined;
    const { skeleton } = skeletonFromGroupMatches(
      event.matches.filter((m) => (m.roundNo ?? 0) === 0),
      event.qualifiersPerGroup ?? 2,
      sizes,
    );
    names = skeleton ? knockoutPlaceholderNames(skeleton) : null;
  }
  placeholderNameCache.set(event, names);
  return names;
}

function displayMatchSide(
  event: ExportEvent,
  match: ExportMatch,
  side: 1 | 2,
  regMap: Map<string, ExportRegistration>,
) {
  const id = side === 1 ? match.side1Id : match.side2Id;
  const named = side === 1 ? match.side1Name : match.side2Name;
  if (named) return named;
  const override = side === 1 ? match.side1Text : match.side2Text;
  if (override) return override.name;
  const registration = id ? regMap.get(id) ?? null : null;
  if (registration) {
    const team = registration.teamName?.trim();
    const name = registrationName(registration);
    return team ? `${team}（${name}）` : name;
  }
  // 轮空场（已结束、只有一方）空的一方写「轮空」，不写「待定」。
  if (!id && isByeMatch(match)) return '轮空';
  // 预排的淘汰赛空位：写出线前骨架的占位名（A组第1名），后面各轮仍是「待定」。
  const placeholder = placeholderNamesOf(event)?.get(knockoutSlotKey(match));
  if (placeholder) return placeholder[side - 1];
  const planning = secondStagePlanningMatch(event, match);
  const source = side === 1 ? planning?.side1Source : planning?.side2Source;
  const snapshot = side === 1 ? planning?.side1NameSnapshot : planning?.side2NameSnapshot;
  return snapshot ?? source ?? '待定';
}

function matchStatusLabel(status: string) {
  return MATCH_STATUS_LABELS[status] ?? status;
}

function styleBodyRange(ws: ExcelJS.Worksheet, top: number, bottom: number, left: number, right: number) {
  for (let r = top; r <= bottom; r += 1) {
    for (let c = left; c <= right; c += 1) {
      const cell = ws.getCell(r, c);
      cell.font = { ...REFERENCE_TEXT, color: { argb: 'FF000000' } };
      cell.border = thinBorder();
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    }
  }
}

function addTemplateTitle(ws: ExcelJS.Worksheet, title: string, lastCol: number) {
  ws.mergeCells(1, 1, 1, lastCol);
  const cell = ws.getCell(1, 1);
  cell.value = title;
  cell.font = { ...REFERENCE_TEXT, bold: true, size: 18, color: { argb: 'FF000000' } };
  cell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 30;
}

function buildGroupMatchDetailSheet(wb: ExcelJS.Workbook, tournament: ExportTournament) {
  const ws = wb.addWorksheet('小组赛');
  ws.columns = [
    { width: 14 }, { width: 8 }, { width: 18 }, { width: 16 }, { width: 8 },
    { width: 12 }, { width: 42 }, { width: 14 }, { width: 12 },
  ];
  addTemplateTitle(ws, '小       组      赛', 9);
  const headers = ['场地', '场次', '比赛时间', '项目', '组别', '轮次', '对阵', '比分', '状态'];
  headers.forEach((header, index) => {
    const cell = ws.getCell(2, index + 1);
    cell.value = header;
    styleHeaderCell(cell);
  });

  const venueMatchNo = new Map<string, number>();
  const seenGroupFixtures = new Set<string>();
  const rows = tournament.events
    .flatMap((event) => event.matches
      .filter((match) => (match.roundNo ?? 0) === 0)
      .map((match) => ({ event, match })))
    .filter(({ match }) => {
      // 团体赛一场对外对阵含多个子项场次，此处每场对阵只列一行。
      const key = `${match.roundNo ?? 0}|${String(match.round)}|${match.side1Id}|${match.side2Id}`;
      if (seenGroupFixtures.has(key)) return false;
      seenGroupFixtures.add(key);
      return true;
    })
    .sort((a, b) => scheduleSortValueForMatch(a.match) - scheduleSortValueForMatch(b.match)
      || (a.match.venue?.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.match.venue?.sortOrder ?? Number.MAX_SAFE_INTEGER)
      || (a.match.matchNo ?? 0) - (b.match.matchNo ?? 0));
  const regMap = registrationMap(tournament);
  let row = 3;
  for (const { event, match } of rows) {
    const venueKey = match.venueId ?? match.venue?.name ?? '';
    const sequence = (venueMatchNo.get(venueKey) ?? 0) + 1;
    venueMatchNo.set(venueKey, sequence);
    const values = [
      match.venue?.name ?? '未分配',
      sequence,
      fmtMatchScheduleDateTime(match) || '未排程',
      eventLabel(event),
      typeof match.round === 'string' ? `${match.round}组` : '',
      '小组循环',
      `${displayMatchSide(event, match, 1, regMap)} VS ${displayMatchSide(event, match, 2, regMap)}`,
      matchScoreText(match) || '—',
      matchStatusLabel(match.status),
    ];
    values.forEach((value, index) => { ws.getCell(row, index + 1).value = value; });
    styleBodyRange(ws, row, row, 1, headers.length);
    row += 1;
  }
  if (row === 3) {
    ws.getCell(row, 1).value = '暂无小组赛场次';
    ws.mergeCells(row, 1, row, headers.length);
  }
  ws.views = [{ state: 'frozen', ySplit: 2 }];
}

function eventGroups(event: ExportEvent) {
  const positions = groupPositions(event);
  const groups = new Map<string, Array<{ id: string; pos: number }>>();
  for (const registration of event.registrations) {
    const group = registration.groupName?.trim() || positions.get(registration.id)?.group;
    if (!group) continue;
    const position = positions.get(registration.id)?.pos ?? (groups.get(group)?.length ?? 0) + 1;
    const list = groups.get(group) ?? [];
    if (!list.some((item) => item.id === registration.id)) list.push({ id: registration.id, pos: position });
    groups.set(group, list);
  }
  // 某些历史赛事只有场次的 round 分组，没有回写 registration.groupName；
  // 仍从小组赛签位补齐参赛队，避免导出的分组表出现空白项目。
  for (const [id, position] of positions) {
    const list = groups.get(position.group) ?? [];
    if (!list.some((item) => item.id === id)) list.push({ id, pos: position.pos });
    groups.set(position.group, list);
  }
  for (const list of groups.values()) list.sort((a, b) => a.pos - b.pos);
  return [...groups.entries()].sort((a, b) => compareGroupCode(a[0], b[0]));
}

function buildGroupStandingSheet(wb: ExcelJS.Workbook, tournament: ExportTournament) {
  const ws = wb.addWorksheet('分组表');
  // 参考文件的分组表不是一张“总表”：每个项目从一个合并的大标题开始，
  // 标题宽度随该项目最大组人数变化（男子 5 人组到 L 列，女子 3 人组到 J 列）。
  // A 列是签位，B:D 合并显示队名/选手，E 列起是交叉表，最后三列是统计。
  ws.getColumn(1).width = 5.5;
  for (let c = 2; c <= 20; c += 1) ws.getColumn(c).width = 8.9;
  ws.getColumn(2).width = 8.9;
  ws.getColumn(3).width = 8.9;
  ws.getColumn(4).width = 8.9;
  ws.getColumn(10).width = 9.4;
  const regMap = registrationMap(tournament);
  let row = 1;
  let wrote = false;
  for (const event of tournament.events) {
    const groups = eventGroups(event);
    if (!groups.length) continue;
    wrote = true;
    const eventMaxGroupSize = Math.max(...groups.map(([, members]) => members.length));
    const eventLastCol = eventMaxGroupSize + (event.teamCompetition ? 8 : 7);
    ws.mergeCells(row, 1, row, eventLastCol);
    const titleCell = ws.getCell(row, 1);
    titleCell.font = { ...REFERENCE_TEXT, bold: true, size: 18, color: { argb: 'FF000000' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    titleCell.border = referenceBorder();
    titleCell.value = `${eventLabel(event)}分组表`;
    ws.getRow(row).height = 40;
    row += 1;
    const matchesByPair = new Map<string, ExportMatch>();
    for (const match of event.matches) {
      if ((match.roundNo ?? 0) === 0 && match.side1Id && match.side2Id) {
        matchesByPair.set(pairKey(match.side1Id, match.side2Id), match);
      }
    }
    for (const [group, members] of groups) {
      const n = members.length;
      const lastCross = 4 + n;
      const headerRow = row;
      ws.mergeCells(headerRow, 1, headerRow, 4);
      ws.getCell(headerRow, 1).value = `${group}组`;
      referenceCell(ws.getCell(headerRow, 1), { bold: true });
      for (let i = 0; i < n; i += 1) {
        // 交叉表从 E 列开始（A:D 是序号与姓名）。
        ws.getCell(headerRow, 5 + i).value = i + 1;
        referenceCell(ws.getCell(headerRow, 5 + i), { bold: true });
      }
      (event.teamCompetition ? ['胜场', '胜次', '净胜分', '名次'] : ['胜次', '净胜分', '名次']).forEach((header, i) => {
        ws.getCell(headerRow, lastCross + i + 1).value = header;
        referenceCell(ws.getCell(headerRow, lastCross + i + 1), { bold: true });
      });
      for (let c = 2; c <= 4; c += 1) referenceCell(ws.getCell(headerRow, c), { bold: true });
      row += 1;
      const standings = computeGroupStandings(members, matchesByPair, event);
      members.forEach((member) => {
        ws.getCell(row, 1).value = member.pos;
        referenceCell(ws.getCell(row, 1));
        ws.mergeCells(row, 2, row, 4);
        ws.getCell(row, 2).value = registrationName(regMap.get(member.id) ?? null);
        referenceCell(ws.getCell(row, 2));
        for (let c = 3; c <= 4; c += 1) referenceCell(ws.getCell(row, c));
        const stat = standings.get(member.id);
        for (let j = 0; j < n; j += 1) {
          const cell = ws.getCell(row, 5 + j);
          if (member.id === members[j].id) {
            cell.value = '';
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DIAGONAL } };
          } else {
            cell.value = standingCrossCellText(member.id, members[j].id, matchesByPair);
          }
          referenceCell(cell);
          if (member.id === members[j].id) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DIAGONAL } };
          }
        }
        const stats = [stat?.played ? stat.wins : '',
          ...(event.teamCompetition ? [stat?.played ? stat.matchesWon : ''] : []),
          stat?.played ? stat.pointDiff : '', stat?.rank ?? ''];
        stats.forEach((value, index) => {
          const cell = ws.getCell(row, lastCross + index + 1);
          cell.value = value;
          referenceCell(cell);
        });
        row += 1;
      });
      row += 1;
    }
    row += 3;
  }
  if (!wrote) ws.getCell(3, 1).value = '暂无已抽签分组';
  ws.views = [{ state: 'frozen', ySplit: 2 }];
}

function buildRankingSummarySheet(wb: ExcelJS.Workbook, tournament: ExportTournament) {
  const ws = wb.addWorksheet('名次汇总');
  // 有混编时多一列「原项目」：混编排名里每个人来自哪个组别、哪个项目。
  const showOrigin = hasEventMix(tournament);
  const lastCol = showOrigin ? 6 : 5;
  ws.columns = [{ width: 16 }, { width: 10 }, { width: 32 }, { width: 28 }, { width: 14 }, ...(showOrigin ? [{ width: 24 }] : [])];
  addTemplateTitle(ws, '名       次       汇       总', lastCol);
  ['项目', '名次', '参赛队/选手', '来源', '状态', ...(showOrigin ? ['原项目'] : [])].forEach((header, i) => {
    ws.getCell(2, i + 1).value = header;
    styleHeaderCell(ws.getCell(2, i + 1));
  });
  let row = 3;
  for (const event of tournament.events) {
    if (event.teamCompetition) {
      const competition = event.teamCompetition;
      const ready = teamResultsReady(competition);
      const manual = competition.teams.some(team => team.finalRank != null);
      // 以正式团体成绩统计胜场、逐局净胜分及相互胜负；保留并列和全部名次。
      for (const standing of teamStandings(competition)) {
        ws.getCell(row, 1).value = eventLabel(event);
        ws.getCell(row, 2).value = manual || ready
          ? standing.rank == null ? '未设置' : `第${standing.rank}名`
          : standing.played ? `暂列第${standing.rank}名` : '待定';
        ws.getCell(row, 3).value = standing.name;
        ws.getCell(row, 4).value = manual ? '手动设置' : ready ? '团体赛最终排名' : '团体赛实时积分';
        ws.getCell(row, 5).value = (manual ? standing.rank != null : ready) ? '已确定' : '待定';
        styleBodyRange(ws, row, row, 1, lastCol);
        row++;
      }
      continue;
    }
    if (event.registrations.some((registration) => registration.finalRank != null)) {
      for (const registration of [...event.registrations].sort((a, b) => (a.finalRank ?? Infinity) - (b.finalRank ?? Infinity) || a.id.localeCompare(b.id))) {
        ws.getCell(row, 1).value = eventLabel(event);
        ws.getCell(row, 2).value = registration.finalRank == null ? '未设置' : `第${registration.finalRank}名`;
        ws.getCell(row, 3).value = registrationName(registration);
        ws.getCell(row, 4).value = '手动设置';
        ws.getCell(row, 5).value = registration.finalRank == null ? '待定' : '已确定';
        if (showOrigin) ws.getCell(row, 6).value = registration.mixOrigin ?? '';
        styleBodyRange(ws, row, row, 1, lastCol);
        row++;
      }
      continue;
    }
    const regMap = registrationMap(tournament);
    const origins = new Map(event.registrations.map((registration) => [registration.id, registration.mixOrigin ?? '']));
    const writeRow = (rank: string, name: string, source: string, status: string, entrantId?: string | null) => {
      ws.getCell(row, 1).value = eventLabel(event);
      ws.getCell(row, 2).value = rank;
      ws.getCell(row, 3).value = name;
      ws.getCell(row, 4).value = source;
      ws.getCell(row, 5).value = status;
      if (showOrigin) ws.getCell(row, 6).value = (entrantId && origins.get(entrantId)) || '';
      styleBodyRange(ws, row, row, 1, lastCol);
      row += 1;
    };

    // 第二阶段排名（抽签时指定的名次）优先。
    const stageRankings = event.secondStage?.rankings ?? [];
    if (stageRankings.length) {
      for (const item of [...stageRankings].sort((a, b) => a.rank - b.rank)) {
        const registration = item.entrantId ? regMap.get(item.entrantId) : null;
        writeRow(`第${item.rank}名`, registrationName(registration) || item.entrantNameSnapshot || '待定', '第二阶段排名', '已确定', item.entrantId);
      }
      continue;
    }

    // 淘汰赛名次：决赛 1-2、季军赛 3-4（无季军赛时半决赛负者并列第3）、1/4 负者并列第5、1/8 负者并列第9。
    // 只要有一场淘汰赛打完就用这个口径；一场没打时继续用下面小组赛的口径。
    const knockout = knockoutPlacements(event.matches);
    if (knockout.decided) {
      for (const item of knockout.rows) {
        const registration = item.entrantId ? regMap.get(item.entrantId) : null;
        writeRow(item.label, registrationName(registration) || '待定', '淘汰赛成绩', item.status, item.entrantId);
      }
      continue;
    }

    const rankingMap = new Map<number, { id: string; name: string; source: string; status: string }>();
    const standings = event.registrations
      .map((registration) => ({ registration, stats: computeEventStats(event, registration.id) }))
      .sort((a, b) => b.stats.wins - a.stats.wins || b.stats.netGames - a.stats.netGames || a.registration.id.localeCompare(b.registration.id));
    standings.forEach((item, index) => rankingMap.set(index + 1, {
      id: item.registration.id,
      name: registrationName(item.registration),
      source: item.stats.played ? '小组赛排名' : '抽签签位',
      status: item.stats.played ? '已确定' : '待定',
    }));
    for (const [rank, item] of [...rankingMap.entries()].sort((a, b) => a[0] - b[0])) {
      writeRow(`第${rank}名`, item.name, item.source, item.status, item.id);
    }
  }
  if (row === 3) ws.getCell(row, 1).value = '暂无名次数据';
  ws.views = [{ state: 'frozen', ySplit: 2 }];
}

function computeEventStats(event: ExportEvent, registrationId: string) {
  let played = 0;
  let wins = 0;
  let netGames = 0;
  for (const match of event.matches) {
    if ((match.roundNo ?? 0) !== 0 || !match.winnerSide) continue;
    const side = match.side1Id === registrationId ? 1 : match.side2Id === registrationId ? 2 : null;
    if (!side) continue;
    played += 1;
    if (match.winnerSide === side) wins += 1;
    netGames += gamesWonBy(match, side) - gamesWonBy(match, side === 1 ? 2 : 1);
  }
  return { played, wins, netGames };
}

function buildKnockoutDetailSheet(wb: ExcelJS.Workbook, tournament: ExportTournament) {
  const ws = wb.addWorksheet('淘汰赛');
  ws.columns = [{ width: 16 }, { width: 10 }, { width: 12 }, { width: 18 }, { width: 18 }, { width: 42 }, { width: 14 }, { width: 14 }];
  addTemplateTitle(ws, '淘       汰       赛', 8);
  ['项目', '场次', '阶段', '场地', '比赛时间', '对阵', '比分', '状态'].forEach((header, i) => {
    ws.getCell(2, i + 1).value = header;
    styleHeaderCell(ws.getCell(2, i + 1));
  });
  const regMap = registrationMap(tournament);
  let row = 3;
  for (const event of tournament.events) {
    const seenFixtures = new Set<string>();
    const matches = event.matches
      .filter((match) => (match.roundNo ?? 0) >= 1)
      .filter((match) => {
        const key = `${match.roundNo ?? 0}|${String(match.round)}|${match.side1Id}|${match.side2Id}`;
        if (seenFixtures.has(key)) return false;
        seenFixtures.add(key);
        return true;
      })
      .sort((a, b) => (a.roundNo ?? 0) - (b.roundNo ?? 0) || (a.matchNo ?? 0) - (b.matchNo ?? 0));
    for (const match of matches) {
      const values = [
        eventLabel(event),
        match.matchNoText ?? (match.matchNo != null ? `第${match.matchNo}场` : ''),
        roundLabel(match),
        match.venue?.name ?? '未分配',
        fmtMatchScheduleDateTime(match) || '未排程',
        `${displayMatchSide(event, match, 1, regMap)} VS ${displayMatchSide(event, match, 2, regMap)}`,
        matchScoreText(match) || '—',
        matchStatusLabel(match.status),
      ];
      values.forEach((value, index) => { ws.getCell(row, index + 1).value = value; });
      styleBodyRange(ws, row, row, 1, 8);
      row += 1;
    }
  }
  if (row === 3) ws.getCell(row, 1).value = '暂无淘汰赛场次';
  ws.views = [{ state: 'frozen', ySplit: 2 }];
}

// ===== 第二阶段：后台手动指定的「前8/前6晋级赛」交叉对阵图 =====
// 版式镜像前端 SecondStageCrossBracket：1-4 名争夺区在上、5-8 名争夺区在下，
// 拓扑与 common/second-stage-bracket.ts 的推进边一致。

const SLOT_ORDER = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

// 12 场在网格中的位置：{colGroup(0/1/2), 行偏移}。每张卡片占 3 行、6 列；列组间距 7 列。
const PLACEMENT_POS: Record<number, { col: number; row: number }> = {
  1: { col: 0, row: 0 },
  2: { col: 0, row: 4 },
  3: { col: 0, row: 8 },
  4: { col: 0, row: 12 },
  5: { col: 1, row: 2 },
  6: { col: 1, row: 10 },
  7: { col: 2, row: 6 },
  8: { col: 2, row: 10 },
  9: { col: 1, row: 17 },
  10: { col: 1, row: 21 },
  11: { col: 2, row: 19 },
  12: { col: 2, row: 23 },
};

function placementRoundLabel(no: number, top6: boolean) {
  if (no <= 4) return '前8初始赛';
  if (no === 5 || no === 6) return '1-4 半决赛';
  if (no === 7) return '1-2名决赛';
  if (no === 8) return '3-4名决赛';
  if (no === 9 || no === 10) return top6 ? '5-6 资格赛' : '5-8 半决赛';
  if (no === 11) return '5-6名决赛';
  return '7-8名决赛';
}

type NameResolver = (id: string | null, snapshot: string | null, source: string | null) => string;

function renderSecondStagePlacement(
  ws: ExcelJS.Worksheet,
  startRow: number,
  event: ExportEvent,
  stage: ExportSecondStage,
  regMap: Map<string, ExportRegistration>,
) {
  const top6 = stage.rankingMode === 'TOP_6';
  const displayName: NameResolver = (id, snapshot, source) => {
    const reg = id ? regMap.get(id) ?? null : null;
    if (reg) return reg.teamName?.trim() || registrationName(reg) || snapshot || source || '待定';
    return snapshot ?? source ?? '待定';
  };

  let row = startRow;

  // A-H 签位表（后台指定）。
  const slots = [...stage.slots].sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
  if (slots.length) {
    ws.getCell(row, 1).value = `A-H 签位（${stage.rankingMode === 'TOP_6' ? '取前6名' : '取前8名'}，后台手动指定）`;
    ws.getCell(row, 1).font = { bold: true };
    row += 1;
    for (const slot of slots) {
      const tag = ws.getCell(row, 1);
      tag.value = slot.slot;
      tag.alignment = { horizontal: 'center', vertical: 'middle' };
      tag.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      tag.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF059669' } };
      ws.mergeCells(row, 2, row, 5);
      ws.getCell(row, 2).value = slot.entrantId
        ? displayName(slot.entrantId, slot.entrantNameSnapshot, null)
        : '轮空';
      for (let c = 1; c <= 5; c += 1) ws.getCell(row, c).border = thinBorder();
      row += 1;
    }
    row += 1;
  }

  // 交叉对阵区。
  const byNo = new Map(stage.matches.map((m) => [m.matchNo, m]));
  const formalMatchByNo = new Map(
    event.matches
      .filter((match) => (match.roundNo ?? 0) >= 100 && match.matchNo != null)
      .map((match) => [match.matchNo!, match]),
  );
  const bracketTop = row;
  const matchNos = Object.keys(PLACEMENT_POS)
    .map(Number)
    .filter((no) => !(top6 && no === 12));
  let maxRel = 0;
  for (const no of matchNos) {
    const pos = PLACEMENT_POS[no];
    drawPlacementCard(
      ws,
      bracketTop + pos.row,
      1 + pos.col * 7,
      no,
      byNo.get(no),
      placementRoundLabel(no, top6),
      displayName,
      scheduleMeta(formalMatchByNo.get(no)),
    );
    maxRel = Math.max(maxRel, pos.row + 3);
  }
  const dividerCell = ws.getCell(bracketTop + 16, 1 + 7);
  dividerCell.value = '▲ 1-4名争夺区 ／ ▼ 5-8名争夺区';
  dividerCell.font = { italic: true, size: 9, color: { argb: 'FF6B7280' } };
  row = bracketTop + maxRel + 1;

  if (top6) {
    ws.getCell(row, 1).value = '本项目仅取前6名，不进行第7、第8名排位赛。';
    ws.getCell(row, 1).font = { italic: true, size: 9, color: { argb: 'FFB45309' } };
    row += 2;
  }

  // 最终排名（如已产生）。
  const rankings = [...stage.rankings].filter((r) => !top6 || r.rank <= 6).sort((a, b) => a.rank - b.rank);
  if (rankings.length) {
    ws.getCell(row, 1).value = '最终排名';
    ws.getCell(row, 1).font = { bold: true };
    row += 1;
    for (const ranking of rankings) {
      ws.getCell(row, 1).value = `第${ranking.rank}名`;
      ws.mergeCells(row, 2, row, 5);
      ws.getCell(row, 2).value =
        ranking.entrantNameSnapshot ?? (ranking.entrantId ? displayName(ranking.entrantId, null, null) : '待定');
      for (let c = 1; c <= 5; c += 1) ws.getCell(row, c).border = thinBorder();
      row += 1;
    }
  }

  return row;
}

function drawPlacementCard(
  ws: ExcelJS.Worksheet,
  top: number,
  col: number,
  no: number,
  match: ExportSecondStageMatch | undefined,
  label: string,
  displayName: NameResolver,
  meta: string,
) {
  const W = 6;
  ws.mergeCells(top, col, top, col + W - 2);
  const head = ws.getCell(top, col);
  head.value = [`第${no}场·${label}`, meta].filter(Boolean).join('\n');
  head.font = { bold: true, size: 9, color: { argb: 'FF64748B' } };
  head.alignment = { vertical: 'middle', wrapText: true };
  if (meta) {
    const currentHeight = ws.getRow(top).height ?? 15;
    ws.getRow(top).height = Math.max(currentHeight, 34);
  }
  const scoreCell = ws.getCell(top, col + W - 1);
  if (match?.score) {
    scoreCell.value = match.score.replace(/\s*[:：]\s*/g, ':');
    scoreCell.font = { size: 9, color: { argb: 'FF6B7280' } };
    scoreCell.alignment = { horizontal: 'right', vertical: 'middle' };
  }

  const side1 = placementSide(match, 1, displayName);
  const side2 = placementSide(match, 2, displayName);
  ws.mergeCells(top + 1, col, top + 1, col + W - 1);
  ws.mergeCells(top + 2, col, top + 2, col + W - 1);
  ws.getCell(top + 1, col).value = side1;
  ws.getCell(top + 2, col).value = side2;
  ws.getCell(top + 1, col).alignment = { vertical: 'middle', wrapText: true };
  ws.getCell(top + 2, col).alignment = { vertical: 'middle', wrapText: true };
  if (match?.winnerSide === 1) ws.getCell(top + 1, col).font = { bold: true };
  if (match?.winnerSide === 2) ws.getCell(top + 2, col).font = { bold: true };

  for (let r = top; r <= top + 2; r += 1) {
    for (let c = col; c < col + W; c += 1) ws.getCell(r, c).border = thinBorder();
  }
}

function placementSide(
  match: ExportSecondStageMatch | undefined,
  side: 1 | 2,
  displayName: NameResolver,
) {
  if (!match) return '待定';
  const id = side === 1 ? match.side1Id : match.side2Id;
  const snapshot = side === 1 ? match.side1NameSnapshot : match.side2NameSnapshot;
  const source = side === 1 ? match.side1Source : match.side2Source;
  const name = displayName(id, snapshot, source);
  const slot = source && /^[A-H]$/.test(source.trim()) ? source.trim() : null;
  return slot ? `${slot}  ${name}` : name;
}

/**
 * 秩序册（高保真 .xlsx）：日程表 + 秩序表 + 流程表。
 * options.stage 留空 = 全量（数据导出页用）；'first'/'second' = 只导出对应阶段的流程表段
 *（场地排程页「按阶段导出秩序册」用，格式与全量秩序册保持一致）。
 */
export async function buildOrderbookWorkbook(
  tournament: ExportTournament,
  options?: { stage?: 'first' | 'second' },
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = '羽毛球赛事系统';
  wb.created = new Date();
  // 团体赛并入 events 后，与单项共用同一套页面与排版。
  tournament = withTeamEvents(tournament);
  // 参考文件的前两个标签页就是“秩序表”和“分组表”；其它明细页放在后面，
  // 不影响后台现有的日程、流程与结果导出能力。
  buildOrderSheet(wb, tournament);
  // 严格沿用参考模板的核心页顺序：秩序表 → 小组赛 → 分组表。
  // 其余综合数据页继续追加在核心页之后，避免影响已有导出能力。
  buildGroupMatchDetailSheet(wb, tournament);
  buildGroupStandingSheet(wb, tournament);
  buildScheduleSheet(wb, tournament);
  buildRankingSummarySheet(wb, tournament);
  buildKnockoutDetailSheet(wb, tournament);
  buildFlowSheet(wb, tournament, options?.stage);

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}

import * as ExcelJS from 'exceljs';
import { buildKnockoutSkeleton } from '../common/knockout-skeleton';
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

const KNOCKOUT_ROUND_LABELS: Record<string, string> = {
  F: '决赛',
  SF: '半决赛',
  QF: '1/4决赛',
  R1: '1/8决赛',
  R2: '1/16决赛',
  R3: '1/32决赛',
  BRONZE: '季军赛',
};

// 仅此赛制带「第一阶段」小组循环流程表。
const GROUP_KNOCKOUT_STD = 'GROUP_PLUS_KNOCKOUT_STD';

const ACCENT = 'FF2563EB';
const DIAGONAL = 'FFE5E7EB';
const SUBHEAD = 'FFEFF3FF';

type Cell = ExcelJS.Cell;

function pad2(value: number) {
  return String(value).padStart(2, '0');
}
function fmtMD(date: Date) {
  return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}
function fmtHM(date: Date) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function eventLabel(event: ExportEvent) {
  return EVENT_TYPE_LABELS[event.type] ?? event.type;
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

function styleHeaderCell(cell: Cell) {
  cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ACCENT } };
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  cell.border = thinBorder();
}

function styleTitleCell(cell: Cell) {
  cell.font = { bold: true, size: 14 };
  cell.alignment = { horizontal: 'center', vertical: 'middle' };
}

// ===== 数据整形（从 matches 还原阶段/分组/签位，与 exports.service 中口径一致）=====

function isPlayoff(match: ExportMatch) {
  const roundNo = match.roundNo ?? 0;
  return roundNo >= 1 && roundNo < 100 && typeof match.round === 'string' && match.round.startsWith('P');
}

function roundLabel(match: ExportMatch) {
  const roundNo = match.roundNo ?? 0;
  const round = typeof match.round === 'string' ? match.round : match.round != null ? String(match.round) : '';
  if (roundNo === 0) return round ? `${round}组` : '小组循环';
  if (roundNo >= 100) return '第二阶段';
  if (round.startsWith('P')) return '排位赛';
  return KNOCKOUT_ROUND_LABELS[round] ?? round;
}

function stageText(matches: ExportMatch[]) {
  const parts: string[] = [];
  if (matches.some((m) => (m.roundNo ?? 0) === 0)) parts.push('第一阶段·小组循环');
  if (matches.some((m) => isPlayoff(m))) parts.push('排位赛');
  const koLabels = [
    ...new Set(
      matches
        .filter((m) => (m.roundNo ?? 0) >= 1 && (m.roundNo ?? 0) < 100 && !isPlayoff(m))
        .map((m) => roundLabel(m)),
    ),
  ];
  if (koLabels.length) parts.push('第二阶段·' + koLabels.join('、'));
  if (matches.some((m) => (m.roundNo ?? 0) >= 100)) parts.push('第二阶段·排位赛');
  return parts.join('；') || '—';
}

function sessionKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}-${date.getHours() < 12 ? 'AM' : 'PM'}`;
}
function sessionLabel(date: Date) {
  return `${pad2(date.getMonth() + 1)}月${pad2(date.getDate())}日${date.getHours() < 12 ? '上午' : '下午'}`;
}

function sessions(tournament: ExportTournament) {
  const map = new Map<string, { key: string; label: string; sort: number }>();
  for (const event of tournament.events) {
    for (const match of event.matches) {
      if (!match.scheduledAt) continue;
      const key = sessionKey(match.scheduledAt);
      if (map.has(key)) continue;
      const d = match.scheduledAt;
      const sort = ((d.getFullYear() * 100 + d.getMonth() + 1) * 100 + d.getDate()) * 10 + (d.getHours() < 12 ? 0 : 1);
      map.set(key, { key, label: sessionLabel(d), sort });
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
function matchCodeMap(tournament: ExportTournament) {
  const map = new Map<string, string>();
  for (const event of tournament.events) {
    const abbr = EVENT_TYPE_ABBR[event.type] ?? '场';
    const ordered = event.matches
      .filter((m) => m.scheduledAt && m.venueId)
      .sort(
        (a, b) =>
          a.scheduledAt!.getTime() - b.scheduledAt!.getTime() ||
          (a.venue?.sortOrder ?? 0) - (b.venue?.sortOrder ?? 0) ||
          (a.matchNo ?? 0) - (b.matchNo ?? 0) ||
          a.id.localeCompare(b.id),
      );
    ordered.forEach((m, i) => map.set(m.id, `${abbr}${i + 1}`));
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

// 一场比赛中某一方赢下的局数。
function gamesWonBy(match: ExportMatch, side: 1 | 2) {
  let won = 0;
  for (const g of match.games) {
    if (side === 1 ? g.side1Score > g.side2Score : g.side2Score > g.side1Score) won += 1;
  }
  return won;
}

// ===== 工作表 1：日程表 =====

function buildScheduleSheet(wb: ExcelJS.Workbook, tournament: ExportTournament) {
  const ws = wb.addWorksheet('日程表', { views: [{ state: 'frozen', ySplit: 2 }] });
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
      const matches = event.matches.filter((m) => m.scheduledAt && sessionKey(m.scheduledAt) === session.key);
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
  const venueList = venues(tournament);
  const regMap = registrationMap(tournament);
  const codeMap = matchCodeMap(tournament);
  const posMap = new Map<string, { group: string; pos: number }>();
  for (const event of tournament.events) {
    for (const [id, p] of groupPositions(event)) posMap.set(id, p);
  }

  const colCount = 2 + venueList.length * 2;
  ws.getColumn(1).width = 8;
  ws.getColumn(2).width = 8;
  for (let i = 0; i < venueList.length; i += 1) {
    ws.getColumn(3 + i * 2).width = 14;
    ws.getColumn(4 + i * 2).width = 14;
  }

  ws.mergeCells(1, 1, 1, colCount);
  styleTitleCell(ws.getCell(1, 1));
  ws.getCell(1, 1).value = '秩  序  表';

  const scheduled = tournament.events.flatMap((event) =>
    event.matches.filter((m) => m.scheduledAt && m.venueId).map((match) => ({ event, match })),
  );

  let row = 2;
  let sessionNo = 0;
  for (const session of sessions(tournament)) {
    const sessionMatches = scheduled.filter(({ match }) => sessionKey(match.scheduledAt!) === session.key);
    if (!sessionMatches.length) continue;
    sessionNo += 1;

    row += 1; // 空行
    ws.mergeCells(row, 1, row, colCount);
    const sessionCell = ws.getCell(row, 1);
    sessionCell.value = `第${sessionNo}节（${session.label}）`;
    sessionCell.font = { bold: true };
    sessionCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SUBHEAD } };
    sessionCell.alignment = { horizontal: 'center', vertical: 'middle' };
    row += 1;

    const headerRow = row;
    ws.getCell(headerRow, 1).value = '场次';
    ws.getCell(headerRow, 2).value = '时间';
    styleHeaderCell(ws.getCell(headerRow, 1));
    styleHeaderCell(ws.getCell(headerRow, 2));
    venueList.forEach((venue, i) => {
      const col = 3 + i * 2;
      ws.mergeCells(headerRow, col, headerRow, col + 1);
      ws.getCell(headerRow, col).value = venue.name;
      styleHeaderCell(ws.getCell(headerRow, col));
    });
    row += 1;

    const times = [...new Set(sessionMatches.map(({ match }) => match.scheduledAt!.getTime()))].sort((a, b) => a - b);
    times.forEach((time, index) => {
      const top = row;
      ws.mergeCells(top, 1, top + 3, 1);
      ws.mergeCells(top, 2, top + 3, 2);
      ws.getCell(top, 1).value = `第${index + 1}场`;
      ws.getCell(top, 2).value = fmtHM(new Date(time));
      ws.getCell(top, 1).alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getCell(top, 2).alignment = { horizontal: 'center', vertical: 'middle' };

      venueList.forEach((venue, i) => {
        const col = 3 + i * 2;
        const found = sessionMatches.find(
          ({ match }) => match.scheduledAt!.getTime() === time && match.venueId === venue.id,
        );
        if (found) {
          const { event, match } = found;
          const side1 = match.side1Id ? regMap.get(match.side1Id) ?? null : null;
          const side2 = match.side2Id ? regMap.get(match.side2Id) ?? null : null;
          ws.getCell(top, col).value = eventLabel(event);
          ws.getCell(top, col + 1).value = codeMap.get(match.id) ?? '';
          ws.getCell(top + 1, col).value = roundLabel(match);
          ws.getCell(top + 1, col + 1).value = pairLabel(match, posMap);
          ws.getCell(top + 2, col).value = sideUnit(side1);
          ws.getCell(top + 2, col + 1).value = sideUnit(side2);
          ws.getCell(top + 3, col).value = registrationName(side1);
          ws.getCell(top + 3, col + 1).value = registrationName(side2);
        }
      });

      for (let r = top; r <= top + 3; r += 1) {
        for (let c = 1; c <= colCount; c += 1) {
          const cell = ws.getCell(r, c);
          cell.border = thinBorder();
          if (!cell.alignment) cell.alignment = { vertical: 'middle', wrapText: true };
        }
      }
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

function buildFlowSheet(wb: ExcelJS.Workbook, tournament: ExportTournament) {
  const ws = wb.addWorksheet('流程表');
  ws.properties.defaultColWidth = 8;
  const regMap = registrationMap(tournament);
  const codeMap = matchCodeMap(tournament);

  let row = 1;
  for (const event of tournament.events) {
    const label = eventLabel(event);
    // 第一阶段：仅「小组循环+淘汰(标准2023)」输出小组循环成绩网格。
    if (event.format === GROUP_KNOCKOUT_STD) {
      row = sectionTitle(ws, row, `${label}第一阶段：`);
      row = renderGroupGrids(ws, row, event, regMap, codeMap);
      row += 1;
    }
    // 第二阶段：优先用后台手动指定的「前8/前6晋级赛」对阵图；否则退回到淘汰赛对阵树
    //（无任何场次时仅留标题占位，与参考件一致）。
    row = sectionTitle(ws, row, `${label}第二阶段：`);
    if (event.secondStage && event.secondStage.matches.length) {
      row = renderSecondStagePlacement(ws, row, event.secondStage, regMap);
    } else if (event.matches.some((m) => (m.roundNo ?? 0) >= 1 && (m.roundNo ?? 0) < 100 && !isPlayoff(m))) {
      row = renderKnockoutBracket(ws, row, event, regMap);
    } else if (event.format === GROUP_KNOCKOUT_STD) {
      // 出线前也按组数×出线数预画对阵骨架（X组第N名占位）。
      row = renderSkeletonBracket(ws, row, event);
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
  for (const groupCode of [...groups.keys()].sort((a, b) => a.localeCompare(b, 'en'))) {
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
    ['胜次', '净胜', '名次'].forEach((text) => {
      ws.mergeCells(headerRow, col, headerRow, col + STAT_W - 1);
      ws.getCell(headerRow, col).value = text;
      styleHeaderCell(ws.getCell(headerRow, col));
      col += STAT_W;
    });
    const lastCol = col - 1;
    row += 1;

    const standings = computeGroupStandings(members, groupMatchByPair);

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
      ws.mergeCells(row, statStart, row, statStart + STAT_W - 1);
      ws.getCell(row, statStart).value = stat.played ? stat.wins : '';
      ws.mergeCells(row, statStart + STAT_W, row, statStart + STAT_W * 2 - 1);
      ws.getCell(row, statStart + STAT_W).value = stat.played ? stat.netGames : '';
      ws.mergeCells(row, statStart + STAT_W * 2, row, statStart + STAT_W * 3 - 1);
      ws.getCell(row, statStart + STAT_W * 2).value = stat.rank ?? '-';

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
  // 已赛完：从本方视角显示比局数（赢局:输局）。
  if (match.winnerSide && match.games.length) {
    const self1 = match.side1Id === selfId;
    const selfGames = gamesWonBy(match, self1 ? 1 : 2);
    const oppGames = gamesWonBy(match, self1 ? 2 : 1);
    return `${selfGames}:${oppGames}`;
  }
  // 未赛：显示场次号 / 时间 / 场地，便于查表。
  const code = codeMap.get(match.id) ?? (match.matchNo != null ? `#${match.matchNo}` : '');
  const when = match.scheduledAt ? `${fmtMD(match.scheduledAt)} ${fmtHM(match.scheduledAt)}` : '';
  const venue = match.venue?.name ? `场地:${match.venue.name}` : '';
  return [code, when, venue].filter(Boolean).join('\n');
}

function computeGroupStandings(
  members: Array<{ id: string; pos: number }>,
  groupMatchByPair: Map<string, ExportMatch>,
) {
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
  const result = new Map<string, { wins: number; netGames: number; played: number; rank: number | null }>();
  ranked.forEach((r, index) => {
    result.set(r.id, { wins: r.wins, netGames: r.netGames, played: r.played, rank: r.played ? index + 1 : null });
  });
  return result;
}

// 第二阶段对阵树的一个「场次盒子」（已脱离数据源，供统一布局复用）。
type BracketBox = {
  side1: string;
  side2: string;
  winnerSide: number | null;
  score: string;
};

// 通用对阵树布局：rounds 升序为列，每场两行盒子，季军赛置于树下方。返回下一可用行。
function layoutBracketTree(
  ws: ExcelJS.Worksheet,
  startRow: number,
  rounds: Array<{ label: string; boxes: BracketBox[] }>,
  bronze: BracketBox | null,
) {
  const SLOT = 3; // 首轮每场占的纵向基准格数
  const BOX_W = 5;
  const GAP = 2; // 轮间空列，承载比分

  // 每轮每场的纵向中心：首轮等距，后续轮取两个来源场的中点。
  const centers: number[][] = [];
  rounds.forEach((round, k) => {
    if (k === 0) {
      centers[k] = round.boxes.map((_, m) => m * SLOT + 0.5);
    } else {
      centers[k] = round.boxes.map((_, m) => {
        const a = centers[k - 1][2 * m] ?? m * SLOT + 0.5;
        const b = centers[k - 1][2 * m + 1] ?? a;
        return (a + b) / 2;
      });
    }
  });

  const headerRow = startRow;
  const bodyTop = startRow + 1;
  let maxRow = bodyTop;
  rounds.forEach((round, k) => {
    const col = 1 + k * (BOX_W + GAP);
    ws.mergeCells(headerRow, col, headerRow, col + BOX_W - 1);
    const head = ws.getCell(headerRow, col);
    head.value = round.label;
    styleHeaderCell(head);
    round.boxes.forEach((box, m) => {
      const top = bodyTop + Math.floor(centers[k][m]);
      drawBracketBox(ws, top, col, BOX_W, box);
      maxRow = Math.max(maxRow, top + 2);
    });
  });

  if (bronze) {
    const col = 1;
    const top = maxRow + 2;
    ws.mergeCells(top - 1, col, top - 1, col + BOX_W - 1);
    const head = ws.getCell(top - 1, col);
    head.value = '季军赛';
    styleHeaderCell(head);
    drawBracketBox(ws, top, col, BOX_W, bronze);
    maxRow = top + 2;
  }
  return maxRow + 1;
}

function drawBracketBox(ws: ExcelJS.Worksheet, top: number, col: number, width: number, box: BracketBox) {
  ws.mergeCells(top, col, top, col + width - 1);
  ws.mergeCells(top + 1, col, top + 1, col + width - 1);
  const c1 = ws.getCell(top, col);
  const c2 = ws.getCell(top + 1, col);
  c1.value = box.side1;
  c2.value = box.side2;
  c1.alignment = { vertical: 'middle', wrapText: true };
  c2.alignment = { vertical: 'middle', wrapText: true };
  c1.border = thinBorder();
  c2.border = thinBorder();
  if (box.winnerSide === 1) c1.font = { bold: true };
  if (box.winnerSide === 2) c2.font = { bold: true };
  if (box.score) {
    ws.mergeCells(top, col + width, top + 1, col + width);
    const scoreCell = ws.getCell(top, col + width);
    scoreCell.value = box.score;
    scoreCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    scoreCell.font = { size: 9, color: { argb: 'FF6B7280' } };
  }
}

// 第二阶段：把已生成的淘汰赛场次铺成对阵树。
function renderKnockoutBracket(
  ws: ExcelJS.Worksheet,
  startRow: number,
  event: ExportEvent,
  regMap: Map<string, ExportRegistration>,
) {
  const knockout = event.matches.filter(
    (m) => (m.roundNo ?? 0) >= 1 && (m.roundNo ?? 0) < 100 && !isPlayoff(m),
  );
  if (!knockout.length) return startRow; // 无淘汰赛时仅保留标题占位。

  const rn = (m: ExportMatch) => m.roundNo ?? 0;
  const sideName = (id: string | null, match: ExportMatch) =>
    id ? registrationName(regMap.get(id) ?? null) || '待定' : match.status === 'COMPLETED' ? '轮空' : '待定';
  const toBox = (m: ExportMatch): BracketBox => ({
    side1: sideName(m.side1Id, m),
    side2: sideName(m.side2Id, m),
    winnerSide: m.winnerSide ?? null,
    score: m.winnerSide && m.games.length ? m.games.map((g) => `${g.side1Score}:${g.side2Score}`).join('  ') : '',
  });

  const main = knockout.filter((m) => m.round !== 'BRONZE');
  const roundNos = [...new Set(main.map(rn))].sort((a, b) => a - b);
  const rounds = roundNos.map((roundNo) => {
    const boxes = main.filter((m) => rn(m) === roundNo).sort((a, b) => (a.matchNo ?? 0) - (b.matchNo ?? 0));
    return {
      label: KNOCKOUT_ROUND_LABELS[boxes[0].round as string] ?? roundLabel(boxes[0]),
      boxes: boxes.map(toBox),
    };
  });
  const bronzeMatch = knockout.find((m) => m.round === 'BRONZE');
  return layoutBracketTree(ws, startRow, rounds, bronzeMatch ? toBox(bronzeMatch) : null);
}

// 第二阶段（GROUP_PLUS_KNOCKOUT_STD 出线前）：按组数×出线数预生成对阵骨架，签位用「X组第N名」占位。
function renderSkeletonBracket(ws: ExcelJS.Worksheet, startRow: number, event: ExportEvent) {
  const groupCodes = [
    ...new Set(
      event.matches
        .filter((m) => (m.roundNo ?? 0) === 0)
        .map((m) => (typeof m.round === 'string' ? m.round : m.round != null ? String(m.round) : ''))
        .filter(Boolean),
    ),
  ];
  const skeleton = buildKnockoutSkeleton(groupCodes, event.qualifiersPerGroup ?? 2);
  if (!skeleton) return startRow;

  const nameById = new Map(skeleton.participants.map((p) => [p.id, p.name]));
  const sideName = (id: string | null, status: string) =>
    id ? nameById.get(id) ?? '待定' : status === 'COMPLETED' ? '轮空' : '待定';
  const main = skeleton.matches.filter((m) => m.round !== 'BRONZE');
  const roundNos = [...new Set(main.map((m) => m.roundNo))].sort((a, b) => a - b);
  const rounds = roundNos.map((roundNo) => {
    const boxes = main.filter((m) => m.roundNo === roundNo).sort((a, b) => a.matchNo - b.matchNo);
    return {
      label: KNOCKOUT_ROUND_LABELS[boxes[0].round] ?? `第${roundNo}轮`,
      boxes: boxes.map((m) => ({
        side1: sideName(m.side1Id, m.status),
        side2: sideName(m.side2Id, m.status),
        winnerSide: null,
        score: '',
      })),
    };
  });
  const bronze = skeleton.matches.some((m) => m.round === 'BRONZE')
    ? { side1: '待定', side2: '待定', winnerSide: null, score: '' }
    : null;
  return layoutBracketTree(ws, startRow, rounds, bronze);
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
  if (no === 7) return '决赛·1/2名';
  if (no === 8) return '3/4名';
  if (no === 9 || no === 10) return top6 ? '5-6 资格赛' : '5-8 半决赛';
  if (no === 11) return top6 ? '5/6名决赛' : '5/6名';
  return '7/8名';
}

type NameResolver = (id: string | null, snapshot: string | null, source: string | null) => string;

function renderSecondStagePlacement(
  ws: ExcelJS.Worksheet,
  startRow: number,
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
  const bracketTop = row;
  const matchNos = Object.keys(PLACEMENT_POS)
    .map(Number)
    .filter((no) => !(top6 && no === 12));
  let maxRel = 0;
  for (const no of matchNos) {
    const pos = PLACEMENT_POS[no];
    drawPlacementCard(ws, bracketTop + pos.row, 1 + pos.col * 7, no, byNo.get(no), placementRoundLabel(no, top6), displayName);
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
) {
  const W = 6;
  ws.mergeCells(top, col, top, col + W - 2);
  const head = ws.getCell(top, col);
  head.value = `第${no}场·${label}`;
  head.font = { bold: true, size: 9, color: { argb: 'FF64748B' } };
  head.alignment = { vertical: 'middle' };
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

export async function buildOrderbookWorkbook(tournament: ExportTournament): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = '羽毛球赛事系统';
  wb.created = new Date();
  buildScheduleSheet(wb, tournament);
  buildOrderSheet(wb, tournament);
  buildFlowSheet(wb, tournament);
  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}

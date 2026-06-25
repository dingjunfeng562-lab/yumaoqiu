import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MatchStatus, RegistrationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type ExportKind = 'schedule' | 'results' | 'registrations' | 'bracket' | 'orderbook';
type CellValue = string | number | boolean | null | undefined;
type Worksheet = {
  name: string;
  rows: CellValue[][];
};
type StandingRow = {
  id: string;
  name: string;
  affiliation: string;
  played: number;
  wins: number;
  losses: number;
  gameDiff: number;
};

type ExportRegistration = {
  id: string;
  eventId: string;
  studentId: string | null;
  createdAt: Date;
  className: string | null;
  groupName: string | null;
  teamName: string | null;
  isSeed: boolean;
  seedRank: number | null;
  player1: {
    name: string;
    gender: string;
    affiliation: string;
    contact: string | null;
  };
  player2: {
    name: string;
    gender: string;
    affiliation: string;
    contact: string | null;
  } | null;
  competitionRegistration: {
    school: string | null;
    eventItems: Array<{
      eventId: string;
      partnerStudentId: string | null;
    }>;
  } | null;
};

type ExportMatch = {
  id: string;
  round: string | number | null;
  roundNo: number | null;
  matchNo: number | null;
  venueId: string | null;
  scheduledAt: Date | null;
  status: string;
  durationMinutes: number;
  side1Id: string | null;
  side2Id: string | null;
  winnerSide: number | null;
  updatedAt: Date;
  venue: {
    name: string;
    sortOrder: number;
  } | null;
  referee: {
    username: string | null;
  } | null;
  games: Array<{
    gameNo: number;
    side1Score: number;
    side2Score: number;
  }>;
};

type ExportEvent = {
  type: string;
  format?: string;
  registrations: ExportRegistration[];
  matches: ExportMatch[];
};

type ExportVenue = {
  id: string;
  name: string;
  sortOrder: number;
};

type ExportTournament = {
  name: string;
  startDate: Date;
  endDate: Date;
  events: ExportEvent[];
  venues?: ExportVenue[];
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  MENS_SINGLES: '男子单打',
  WOMENS_SINGLES: '女子单打',
  MENS_DOUBLES: '男子双打',
  WOMENS_DOUBLES: '女子双打',
  MIXED_DOUBLES: '混合双打',
};

// 秩序册「场次号」前缀:项目类型缩写,如 男双1、女双2。
const EVENT_TYPE_ABBR: Record<string, string> = {
  MENS_SINGLES: '男单',
  WOMENS_SINGLES: '女单',
  MENS_DOUBLES: '男双',
  WOMENS_DOUBLES: '女双',
  MIXED_DOUBLES: '混双',
};

// 与前端 lib/round.ts 的 roundCn 保持一致的淘汰赛轮次中文名。
const KNOCKOUT_ROUND_LABELS: Record<string, string> = {
  F: '决赛',
  SF: '半决赛',
  QF: '1/4决赛',
  R1: '1/8决赛',
  R2: '1/16决赛',
  R3: '1/32决赛',
  BRONZE: '季军赛',
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: '未开始',
  LIVE: '进行中',
  COMPLETED: '已结束',
};

const GENDER_LABELS: Record<string, string> = {
  MALE: '男',
  FEMALE: '女',
};

@Injectable()
export class ExportsService {
  constructor(private prisma: PrismaService) {}

  async exportTournament(tournamentId: string, kind: string) {
    if (!this.isExportKind(kind)) {
      throw new BadRequestException('导出类型必须是 schedule、results、registrations、bracket 或 orderbook');
    }

    const tournament = await this.findTournamentForExport(tournamentId, kind);
    if (!tournament) throw new NotFoundException('赛事不存在');

    const worksheets = this.buildWorksheets(tournament, kind);
    const label = this.exportLabel(kind);

    return {
      filename: this.exportFilename(tournament.name, label),
      content: this.toWorkbookXml(worksheets),
    };
  }

  private async findTournamentForExport(tournamentId: string, kind: ExportKind): Promise<ExportTournament | null> {
    const baseSelect = {
      name: true,
      startDate: true,
      endDate: true,
    } as const;

    if (kind === 'registrations') {
      return this.prisma.tournament.findUnique({
        where: { id: tournamentId },
        select: {
          ...baseSelect,
          events: {
            orderBy: { type: 'asc' },
            select: {
              type: true,
              registrations: {
                where: { status: RegistrationStatus.APPROVED },
                orderBy: [{ groupName: 'asc' }, { isSeed: 'desc' }, { seedRank: 'asc' }, { createdAt: 'asc' }],
                select: {
                  id: true,
                  eventId: true,
                  studentId: true,
                  createdAt: true,
                  className: true,
                  groupName: true,
                  teamName: true,
                  isSeed: true,
                  seedRank: true,
                  player1: {
                    select: {
                      name: true,
                      gender: true,
                      affiliation: true,
                      contact: true,
                    },
                  },
                  player2: {
                    select: {
                      name: true,
                      gender: true,
                      affiliation: true,
                      contact: true,
                    },
                  },
                  competitionRegistration: {
                    select: {
                      school: true,
                      eventItems: {
                        select: {
                          eventId: true,
                          partnerStudentId: true,
                        },
                      },
                    },
                  },
                },
              },
              matches: {
                select: {
                  id: true,
                  round: true,
                  roundNo: true,
                  matchNo: true,
                  venueId: true,
                  scheduledAt: true,
                  status: true,
                  durationMinutes: true,
                  side1Id: true,
                  side2Id: true,
                  winnerSide: true,
                  updatedAt: true,
                  venue: { select: { name: true, sortOrder: true } },
                  referee: { select: { username: true } },
                  games: {
                    orderBy: { gameNo: 'asc' },
                    select: {
                      gameNo: true,
                      side1Score: true,
                      side2Score: true,
                    },
                  },
                },
                orderBy: [{ scheduledAt: 'asc' }, { roundNo: 'asc' }, { matchNo: 'asc' }],
              },
            },
          },
        },
      }) as Promise<ExportTournament | null>;
    }

    return this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: {
        ...baseSelect,
        venues: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          select: { id: true, name: true, sortOrder: true },
        },
        events: {
          orderBy: { type: 'asc' },
          select: {
            type: true,
            format: true,
            registrations: {
              where: { status: RegistrationStatus.APPROVED },
              orderBy: [{ groupName: 'asc' }, { isSeed: 'desc' }, { seedRank: 'asc' }, { createdAt: 'asc' }],
              select: {
                id: true,
                eventId: true,
                studentId: true,
                createdAt: true,
                className: true,
                groupName: true,
                teamName: true,
                isSeed: true,
                seedRank: true,
                player1: {
                  select: {
                    name: true,
                    gender: true,
                    affiliation: true,
                    contact: true,
                  },
                },
                player2: {
                  select: {
                    name: true,
                    gender: true,
                    affiliation: true,
                    contact: true,
                  },
                },
                competitionRegistration: {
                  select: {
                    school: true,
                    eventItems: {
                      select: {
                        eventId: true,
                        partnerStudentId: true,
                      },
                    },
                  },
                },
              },
            },
            matches: {
              orderBy: [{ scheduledAt: 'asc' }, { roundNo: 'asc' }, { matchNo: 'asc' }],
              select: {
                id: true,
                round: true,
                roundNo: true,
                matchNo: true,
                venueId: true,
                scheduledAt: true,
                status: true,
                durationMinutes: true,
                side1Id: true,
                side2Id: true,
                winnerSide: true,
                updatedAt: true,
                venue: { select: { name: true, sortOrder: true } },
                referee: { select: { username: true } },
                games: {
                  orderBy: { gameNo: 'asc' },
                  select: {
                    gameNo: true,
                    side1Score: true,
                    side2Score: true,
                  },
                },
              },
            },
          },
        },
      },
    }) as Promise<ExportTournament | null>;
  }

  private buildWorksheets(tournament: ExportTournament, kind: ExportKind): Worksheet[] {
    if (kind === 'schedule') return [this.scheduleWorksheet(tournament)];
    if (kind === 'registrations') return [this.registrationsWorksheet(tournament)];
    if (kind === 'bracket') return [this.bracketWorksheet(tournament)];
    if (kind === 'orderbook') return this.orderbookWorksheets(tournament);
    return [this.resultsWorksheet(tournament), this.standingsWorksheet(tournament)];
  }

  private scheduleWorksheet(tournament: ExportTournament): Worksheet {
    const rows: CellValue[][] = [
      [
        '赛事',
        '项目',
        '轮次',
        '场次',
        '比赛时间',
        '场地',
        '对阵',
        '状态',
        '裁判',
        '预计时长',
      ],
    ];
    const venueMatchNoMap = this.venueSequentialMatchNoMap(tournament);

    for (const event of tournament.events) {
      const registrationMap = this.registrationMap(event.registrations);
      for (const match of event.matches) {
        rows.push([
          tournament.name,
          EVENT_TYPE_LABELS[event.type] ?? event.type,
          match.round,
          this.exportMatchNo(match, venueMatchNoMap),
          this.formatDateTime(match.scheduledAt),
          match.venue?.name ?? '未分配',
          `${this.sideName(match.side1Id, registrationMap)} VS ${this.sideName(match.side2Id, registrationMap)}`,
          STATUS_LABELS[match.status] ?? match.status,
          match.referee?.username ?? '未分配',
          `${match.durationMinutes} 分钟`,
        ]);
      }
    }

    if (rows.length === 1) rows.push([tournament.name, '', '', '', '', '', '暂无赛程', '', '', '']);
    return { name: '赛程表', rows };
  }

  private resultsWorksheet(tournament: ExportTournament): Worksheet {
    const rows: CellValue[][] = [
      ['赛事', '项目', '轮次', '场次', '对阵', '局分', '胜方', '状态', '场地', '更新时间'],
    ];

    for (const event of tournament.events) {
      const registrationMap = this.registrationMap(event.registrations);
      for (const match of event.matches) {
        rows.push([
          tournament.name,
          EVENT_TYPE_LABELS[event.type] ?? event.type,
          match.round,
          match.matchNo,
          `${this.sideName(match.side1Id, registrationMap)} VS ${this.sideName(match.side2Id, registrationMap)}`,
          this.gamesText(match.games),
          match.winnerSide
            ? this.sideName(match.winnerSide === 1 ? match.side1Id : match.side2Id, registrationMap)
            : '未产生',
          STATUS_LABELS[match.status] ?? match.status,
          match.venue?.name ?? '未分配',
          this.formatDateTime(match.updatedAt),
        ]);
      }
    }

    if (rows.length === 1) rows.push([tournament.name, '', '', '', '暂无成绩', '', '', '', '', '']);
    return { name: '成绩明细', rows };
  }

  private standingsWorksheet(tournament: ExportTournament): Worksheet {
    const rows: CellValue[][] = [
      ['赛事', '项目', '名次', '参赛方', '院系/班级', '场次', '胜场', '负场', '小分差'],
    ];

    for (const event of tournament.events) {
      for (const row of this.eventStandings(event)) {
        rows.push([
          tournament.name,
          EVENT_TYPE_LABELS[event.type] ?? event.type,
          row.rank,
          row.name,
          row.affiliation,
          row.played,
          row.wins,
          row.losses,
          row.gameDiff,
        ]);
      }
    }

    if (rows.length === 1) rows.push([tournament.name, '', '', '暂无名次', '', '', '', '', '']);
    return { name: '名次汇总', rows };
  }

  private registrationsWorksheet(tournament: ExportTournament): Worksheet {
    const rows: CellValue[][] = [
      [
        '赛事',
        '项目',
        '参赛方',
        '学校',
        '选手1',
        '学号1',
        '性别1',
        '院系/班级1',
        '联系方式1',
        '选手2',
        '学号2',
        '性别2',
        '院系/班级2',
        '联系方式2',
        '种子',
        '种子序',
        '分组',
        '报名时间',
      ],
    ];

    for (const event of tournament.events) {
      for (const registration of event.registrations) {
        const school =
          registration.competitionRegistration?.school ??
          registration.className ??
          registration.player1.affiliation ??
          '';
        rows.push([
          tournament.name,
          EVENT_TYPE_LABELS[event.type] ?? event.type,
          this.registrationName(registration),
          school,
          registration.player1.name,
          registration.studentId ?? '',
          GENDER_LABELS[registration.player1.gender] ?? registration.player1.gender,
          registration.player1.affiliation,
          registration.player1.contact ?? '',
          registration.player2?.name ?? '',
          registration.player2 ? this.partnerStudentId(registration) : '',
          registration.player2 ? (GENDER_LABELS[registration.player2.gender] ?? registration.player2.gender) : '',
          registration.player2?.affiliation ?? '',
          registration.player2?.contact ?? '',
          registration.isSeed ? '是' : '否',
          registration.seedRank ?? '',
          registration.groupName ?? '',
          this.formatDateTime(registration.createdAt),
        ]);
      }
    }

    if (rows.length === 1) rows.push([tournament.name, '', '暂无报名', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);
    return { name: '报名表', rows };
  }

  private bracketWorksheet(tournament: ExportTournament): Worksheet {
    const rows: CellValue[][] = [
      ['赛事', '场地', '场次', '比赛时间', '项目', '组别', '轮次', '对阵', '状态'],
    ];
    const venueMatchNoMap = this.venueSequentialMatchNoMap(tournament);
    const matchRows = tournament.events
      .flatMap((event) => {
        const registrationMap = this.registrationMap(event.registrations);
        return event.matches.map((match) => ({ event, match, registrationMap }));
      })
      .sort((a, b) =>
        this.bracketExportSort(a.match, b.match) ||
        (EVENT_TYPE_LABELS[a.event.type] ?? a.event.type).localeCompare(
          EVENT_TYPE_LABELS[b.event.type] ?? b.event.type,
          'zh-CN',
        ),
      );

    for (const { event, match, registrationMap } of matchRows) {
      rows.push([
        tournament.name,
        match.venue?.name ?? '未分配',
        this.exportMatchNo(match, venueMatchNoMap),
        this.formatDateTime(match.scheduledAt),
        EVENT_TYPE_LABELS[event.type] ?? event.type,
        this.matchGroupLabel(match),
        match.round,
        `${this.sideName(match.side1Id, registrationMap, true)} VS ${this.sideName(match.side2Id, registrationMap, true)}`,
        STATUS_LABELS[match.status] ?? match.status,
      ]);
    }

    if (rows.length === 1) rows.push([tournament.name, '', '', '', '', '', '', '暂无对阵', '']);
    return { name: '对阵表', rows };
  }

  // 组内循环赛 roundNo=0，round 即组别代码(A/B/…)；淘汰赛/排位赛 roundNo≥1，无固定组别。
  private matchGroupLabel(match: ExportMatch): string {
    if (match.roundNo === 0 && match.round != null && match.round !== '') {
      return `${match.round} 组`;
    }
    return '';
  }

  // ===== 秩序册：日程表 + 秩序表 =====

  private orderbookWorksheets(tournament: ExportTournament): Worksheet[] {
    return [
      this.orderbookScheduleSheet(tournament),
      this.orderbookOrderSheet(tournament),
    ];
  }

  // 日程表：每个项目按节次（上午/下午）列出该节进行的阶段/轮次。
  private orderbookScheduleSheet(tournament: ExportTournament): Worksheet {
    const rows: CellValue[][] = [['日期', '项目', '阶段']];
    for (const session of this.orderbookSessions(tournament)) {
      for (const event of tournament.events) {
        const matches = event.matches.filter(
          (match) => match.scheduledAt && this.orderbookSessionKey(match.scheduledAt) === session.key,
        );
        if (!matches.length) continue;
        rows.push([
          session.label,
          EVENT_TYPE_LABELS[event.type] ?? event.type,
          this.orderbookStageText(matches),
        ]);
      }
    }
    if (rows.length === 1) rows.push([tournament.name, '暂无已排程的项目', '']);
    return { name: '日程表', rows };
  }

  // 秩序表：按「节」分块；每节为「场次 | 时间 | 各号场地」网格，每个场次占 4 行
  // （项目+场次号 / 组别轮次+签位对阵 / 单位 / 姓名），每个场地占 2 列（对阵双方）。
  private orderbookOrderSheet(tournament: ExportTournament): Worksheet {
    const venues = this.orderbookVenues(tournament);
    const regMap = this.orderbookRegistrationMap(tournament);
    const codeMap = this.orderbookMatchCodeMap(tournament);
    const posMap = this.orderbookGroupPositions(tournament);

    const scheduled = tournament.events.flatMap((event) =>
      event.matches
        .filter((match) => match.scheduledAt && match.venueId)
        .map((match) => ({ event, match })),
    );

    const rows: CellValue[][] = [['秩 序 表']];
    let sessionNo = 0;
    for (const session of this.orderbookSessions(tournament)) {
      const sessionMatches = scheduled.filter(
        ({ match }) => this.orderbookSessionKey(match.scheduledAt!) === session.key,
      );
      if (!sessionMatches.length) continue;
      sessionNo += 1;

      const times = [...new Set(sessionMatches.map(({ match }) => match.scheduledAt!.getTime()))].sort(
        (a, b) => a - b,
      );

      rows.push([]);
      rows.push([`第${sessionNo}节（${session.label}）`]);
      const header: CellValue[] = ['场次', '时间'];
      for (const venue of venues) header.push(venue.name, '');
      rows.push(header);

      times.forEach((time, index) => {
        const rowItem: CellValue[] = [`第${index + 1}场`, this.orderbookTimeHM(new Date(time))];
        const rowGroup: CellValue[] = ['', ''];
        const rowUnit: CellValue[] = ['', ''];
        const rowName: CellValue[] = ['', ''];

        for (const venue of venues) {
          const found = sessionMatches.find(
            ({ match }) => match.scheduledAt!.getTime() === time && match.venueId === venue.id,
          );
          if (!found) {
            rowItem.push('', '');
            rowGroup.push('', '');
            rowUnit.push('', '');
            rowName.push('', '');
            continue;
          }
          const { event, match } = found;
          const side1 = match.side1Id ? regMap.get(match.side1Id) ?? null : null;
          const side2 = match.side2Id ? regMap.get(match.side2Id) ?? null : null;
          rowItem.push(EVENT_TYPE_LABELS[event.type] ?? event.type, codeMap.get(match.id) ?? '');
          rowGroup.push(this.orderbookRoundLabel(match), this.orderbookPairLabel(match, posMap));
          rowUnit.push(this.orderbookSideUnit(side1), this.orderbookSideUnit(side2));
          rowName.push(this.orderbookSideName(side1), this.orderbookSideName(side2));
        }

        rows.push(rowItem, rowGroup, rowUnit, rowName);
      });
    }

    if (rows.length === 1) rows.push([], [tournament.name, '暂无已排程的场次']);
    return { name: '秩序表', rows };
  }

  private orderbookVenues(tournament: ExportTournament): ExportVenue[] {
    if (tournament.venues?.length) return tournament.venues;
    const map = new Map<string, ExportVenue>();
    for (const event of tournament.events) {
      for (const match of event.matches) {
        if (match.venueId && match.venue && !map.has(match.venueId)) {
          map.set(match.venueId, {
            id: match.venueId,
            name: match.venue.name,
            sortOrder: match.venue.sortOrder,
          });
        }
      }
    }
    return [...map.values()].sort((a, b) => a.sortOrder - b.sortOrder);
  }

  private orderbookSessions(tournament: ExportTournament) {
    const map = new Map<string, { key: string; label: string; sort: number }>();
    for (const event of tournament.events) {
      for (const match of event.matches) {
        if (!match.scheduledAt) continue;
        const key = this.orderbookSessionKey(match.scheduledAt);
        if (map.has(key)) continue;
        const d = match.scheduledAt;
        const sort = ((d.getFullYear() * 100 + d.getMonth() + 1) * 100 + d.getDate()) * 10 + (d.getHours() < 12 ? 0 : 1);
        map.set(key, { key, label: this.orderbookSessionLabel(d), sort });
      }
    }
    return [...map.values()].sort((a, b) => a.sort - b.sort);
  }

  private orderbookSessionKey(date: Date) {
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}-${date.getHours() < 12 ? 'AM' : 'PM'}`;
  }

  private orderbookSessionLabel(date: Date) {
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${mm}月${dd}日${date.getHours() < 12 ? '上午' : '下午'}`;
  }

  private orderbookTimeHM(date: Date) {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  private orderbookStageText(matches: ExportMatch[]) {
    const parts: string[] = [];
    if (matches.some((match) => (match.roundNo ?? 0) === 0)) parts.push('第一阶段·小组循环');
    if (matches.some((match) => this.orderbookIsPlayoff(match))) parts.push('排位赛');
    const koLabels = [
      ...new Set(
        matches
          .filter(
            (match) =>
              (match.roundNo ?? 0) >= 1 && (match.roundNo ?? 0) < 100 && !this.orderbookIsPlayoff(match),
          )
          .map((match) => this.orderbookRoundLabel(match)),
      ),
    ];
    if (koLabels.length) parts.push('第二阶段·' + koLabels.join('、'));
    if (matches.some((match) => (match.roundNo ?? 0) >= 100)) parts.push('第二阶段·排位赛');
    return parts.join('；') || '—';
  }

  private orderbookIsPlayoff(match: ExportMatch) {
    const roundNo = match.roundNo ?? 0;
    return roundNo >= 1 && roundNo < 100 && typeof match.round === 'string' && match.round.startsWith('P');
  }

  private orderbookRoundLabel(match: ExportMatch) {
    const roundNo = match.roundNo ?? 0;
    const round = typeof match.round === 'string' ? match.round : match.round != null ? String(match.round) : '';
    if (roundNo === 0) return round ? `${round}组` : '小组循环';
    if (roundNo >= 100) return '第二阶段';
    if (round.startsWith('P')) return '排位赛';
    return KNOCKOUT_ROUND_LABELS[round] ?? round;
  }

  private orderbookPairLabel(match: ExportMatch, posMap: Map<string, { group: string; pos: number }>) {
    if ((match.roundNo ?? 0) !== 0) return '';
    const a = match.side1Id ? posMap.get(match.side1Id) : null;
    const b = match.side2Id ? posMap.get(match.side2Id) : null;
    if (!a || !b) return '';
    return `${a.group}${a.pos}-${b.group}${b.pos}`;
  }

  private orderbookSideUnit(registration: ExportRegistration | null) {
    if (!registration) return '';
    const team = registration.teamName?.trim();
    if (team) return team;
    return registration.player2
      ? `${registration.player1.affiliation}/${registration.player2.affiliation}`
      : registration.player1.affiliation;
  }

  private orderbookSideName(registration: ExportRegistration | null) {
    return registration ? this.registrationName(registration) : '';
  }

  private orderbookRegistrationMap(tournament: ExportTournament) {
    const map = new Map<string, ExportRegistration>();
    for (const event of tournament.events) {
      for (const registration of event.registrations) map.set(registration.id, registration);
    }
    return map;
  }

  // 每个项目内，已排程的场次按时间→场地→场序编「场次号」（如 男双1、男双2）。
  private orderbookMatchCodeMap(tournament: ExportTournament) {
    const map = new Map<string, string>();
    for (const event of tournament.events) {
      const abbr = EVENT_TYPE_ABBR[event.type] ?? '场';
      const ordered = event.matches
        .filter((match) => match.scheduledAt && match.venueId)
        .sort(
          (a, b) =>
            a.scheduledAt!.getTime() - b.scheduledAt!.getTime() ||
            (a.venue?.sortOrder ?? 0) - (b.venue?.sortOrder ?? 0) ||
            (a.matchNo ?? 0) - (b.matchNo ?? 0) ||
            a.id.localeCompare(b.id),
        );
      ordered.forEach((match, index) => map.set(match.id, `${abbr}${index + 1}`));
    }
    return map;
  }

  // 组内循环按 i<j 嵌套生成（round=组码、roundNo=0、matchNo 递增），据此还原每个成员的组内签位号：
  // member0 = 首场 side1；其余成员 = 与 member0 同为 side1 的各场 side2，依 matchNo 顺序排列。
  private orderbookGroupPositions(tournament: ExportTournament) {
    const map = new Map<string, { group: string; pos: number }>();
    for (const event of tournament.events) {
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
    }
    return map;
  }

  private venueSequentialMatchNoMap(tournament: ExportTournament) {
    const matches = tournament.events
      .flatMap((event) => event.matches)
      .filter((match) => this.venueSequenceKey(match));
    const sortedMatches = [...matches].sort((a, b) => {
      const venueCompare = this.venueSequenceKey(a)!.localeCompare(this.venueSequenceKey(b)!, 'zh-CN');
      if (venueCompare !== 0) return venueCompare;
      return this.matchSortValue(a) - this.matchSortValue(b)
        || (a.roundNo ?? 0) - (b.roundNo ?? 0)
        || (a.matchNo ?? 0) - (b.matchNo ?? 0)
        || a.id.localeCompare(b.id);
    });
    const counters = new Map<string, number>();
    const result = new Map<string, number>();
    for (const match of sortedMatches) {
      const key = this.venueSequenceKey(match);
      if (!key) continue;
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      result.set(match.id, next);
    }
    return result;
  }

  private bracketExportSort(a: ExportMatch, b: ExportMatch) {
    const assignedCompare = Number(!a.venueId) - Number(!b.venueId);
    if (assignedCompare !== 0) return assignedCompare;
    return (a.venue?.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.venue?.sortOrder ?? Number.MAX_SAFE_INTEGER)
      || (a.venue?.name ?? '').localeCompare(b.venue?.name ?? '', 'zh-CN')
      || this.matchSortValue(a) - this.matchSortValue(b)
      || (a.roundNo ?? 0) - (b.roundNo ?? 0)
      || (a.matchNo ?? 0) - (b.matchNo ?? 0)
      || a.id.localeCompare(b.id);
  }

  private exportMatchNo(match: ExportMatch, venueMatchNoMap: Map<string, number>) {
    return venueMatchNoMap.get(match.id) ?? match.matchNo ?? '';
  }

  private venueSequenceKey(match: ExportMatch) {
    return match.venueId || match.venue?.name || '';
  }

  private matchSortValue(match: ExportMatch) {
    return match.scheduledAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
  }

  private exportLabel(kind: ExportKind) {
    if (kind === 'schedule') return '赛程表';
    if (kind === 'results') return '成绩册';
    if (kind === 'bracket') return '对阵表';
    if (kind === 'orderbook') return '秩序册';
    return '报名表';
  }

  private exportFilename(tournamentName: string, label: string) {
    const safeName = this.sanitizeFilenamePart(tournamentName) || '赛事';
    return `${safeName}-${this.formatFileDate(new Date())}-${label}.xls`;
  }

  private formatFileDate(value: Date | string) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return 'unknown-date';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }

  private sanitizeFilenamePart(value: string) {
    return value.trim().replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ');
  }

  private registrationMap(registrations: ExportRegistration[]) {
    return new Map(registrations.map((registration) => [registration.id, registration]));
  }

  private sideName(
    id: string | null,
    registrationMap: Map<string, ExportRegistration>,
    withTeam = false,
  ) {
    if (!id) return '待定';
    const registration = registrationMap.get(id);
    if (!registration) return '待定';
    return withTeam
      ? this.teamRegistrationName(registration)
      : this.registrationName(registration);
  }

  private registrationName(registration: ExportRegistration) {
    return registration.player2
      ? `${registration.player1.name} / ${registration.player2.name}`
      : registration.player1.name;
  }

  // 对阵表用：有队伍名称时显示「队伍名称（队员名）」，否则仅队员名。
  private teamRegistrationName(registration: ExportRegistration) {
    const players = this.registrationName(registration);
    const team = registration.teamName?.trim();
    return team ? `${team}（${players}）` : players;
  }

  private partnerStudentId(registration: ExportRegistration) {
    return (
      registration.competitionRegistration?.eventItems.find((item) => item.eventId === registration.eventId)
        ?.partnerStudentId ?? ''
    );
  }

  private gamesText(games: ExportMatch['games']) {
    if (!games.length) return '-';
    return games.map((game) => `${game.side1Score}:${game.side2Score}`).join(' / ');
  }

  private eventStandings(event: ExportEvent) {
    const rows: StandingRow[] = event.registrations.map((registration) => ({
      id: registration.id,
      name: this.registrationName(registration),
      affiliation: registration.player2
        ? `${registration.player1.affiliation} / ${registration.player2.affiliation}`
        : registration.player1.affiliation,
      played: 0,
      wins: 0,
      losses: 0,
      gameDiff: 0,
    }));
    const rowMap = new Map<string, StandingRow>(rows.map((row) => [row.id, row]));

    for (const match of event.matches) {
      if (match.status !== MatchStatus.COMPLETED || !match.winnerSide) continue;
      const side1 = match.side1Id ? rowMap.get(match.side1Id) : null;
      const side2 = match.side2Id ? rowMap.get(match.side2Id) : null;
      if (!side1 || !side2) continue;

      side1.played += 1;
      side2.played += 1;
      if (match.winnerSide === 1) {
        side1.wins += 1;
        side2.losses += 1;
      } else {
        side2.wins += 1;
        side1.losses += 1;
      }
      for (const game of match.games) {
        side1.gameDiff += game.side1Score - game.side2Score;
        side2.gameDiff += game.side2Score - game.side1Score;
      }
    }

    return rows
      .sort((a, b) => b.wins - a.wins || b.gameDiff - a.gameDiff || a.losses - b.losses)
      .map((row, index) => ({ rank: index + 1, ...row }));
  }

  private formatDateTime(value?: Date | string | null) {
    if (!value) return '未安排';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('zh-CN', { hour12: false });
  }

  private isExportKind(kind: string): kind is ExportKind {
    return ['schedule', 'results', 'registrations', 'bracket', 'orderbook'].includes(kind);
  }

  private toWorkbookXml(worksheets: Worksheet[]) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:html="http://www.w3.org/TR/REC-html40">
  <Styles>
    <Style ss:ID="Header">
      <Font ss:Bold="1" ss:Color="#FFFFFF"/>
      <Interior ss:Color="#2563EB" ss:Pattern="Solid"/>
      <Alignment ss:Horizontal="Center"/>
    </Style>
  </Styles>
${worksheets.map((worksheet) => this.toWorksheetXml(worksheet)).join('\n')}
</Workbook>`;
  }

  private toWorksheetXml(worksheet: Worksheet) {
    return `  <Worksheet ss:Name="${this.escapeXml(worksheet.name).slice(0, 31)}">
    <Table>
${worksheet.rows.map((row, index) => this.toRowXml(row, index === 0)).join('\n')}
    </Table>
  </Worksheet>`;
  }

  private toRowXml(row: CellValue[], isHeader: boolean) {
    return `      <Row>
${row.map((cell) => this.toCellXml(cell, isHeader)).join('\n')}
      </Row>`;
  }

  private toCellXml(value: CellValue, isHeader: boolean) {
    const type = typeof value === 'number' ? 'Number' : 'String';
    const text = value === null || value === undefined ? '' : String(value);
    const style = isHeader ? ' ss:StyleID="Header"' : '';
    return `        <Cell${style}><Data ss:Type="${type}">${this.escapeXml(text)}</Data></Cell>`;
  }

  private escapeXml(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}

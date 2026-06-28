import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Format, MatchStatus, RegistrationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SECOND_STAGE_FORMAL_ROUND_NO_BASE } from '../common/second-stage-bracket';
import { buildOrderbookWorkbook } from './orderbook-workbook';

const XLS_CONTENT_TYPE = 'application/vnd.ms-excel';
const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const EXPORT_TIME_ZONE = 'Asia/Shanghai';

const exportDateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: EXPORT_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

type ExportKind = 'schedule' | 'results' | 'registrations' | 'bracket' | 'orderbook';
type CellValue = string | number | boolean | null | undefined;
type Worksheet = {
  name: string;
  rows: CellValue[][];
};
export type {
  ExportTournament,
  ExportEvent,
  ExportMatch,
  ExportRegistration,
  ExportVenue,
  ExportSecondStage,
  ExportSecondStageMatch,
  ExportSecondStageSlot,
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
  scheduledAtLocal?: string | null;
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

type ExportSecondStageSlot = {
  slot: string;
  sortOrder: number;
  entrantId: string | null;
  entrantNameSnapshot: string | null;
};

type ExportSecondStageMatch = {
  matchNo: number;
  roundName: string;
  area: string;
  slotInfo: string | null;
  side1Source: string | null;
  side2Source: string | null;
  side1Id: string | null;
  side2Id: string | null;
  side1NameSnapshot: string | null;
  side2NameSnapshot: string | null;
  score: string | null;
  status: string;
  winnerSide: number | null;
  winnerId: string | null;
  winnerNameSnapshot: string | null;
};

type ExportSecondStage = {
  status: string;
  mode: string;
  rankingMode: string;
  slots: ExportSecondStageSlot[];
  matches: ExportSecondStageMatch[];
  rankings: Array<{ rank: number; entrantId: string | null; entrantNameSnapshot: string | null }>;
};

type ExportEvent = {
  type: string;
  format?: string;
  qualifiersPerGroup?: number | null;
  registrations: ExportRegistration[];
  matches: ExportMatch[];
  secondStage?: ExportSecondStage | null;
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

    // 秩序册走高保真 .xlsx（含日程表、秩序表、各项目流程表）；其余沿用轻量 .xls。
    if (kind === 'orderbook') {
      return {
        filename: this.exportFilename(tournament.name, '秩序册', 'xlsx'),
        content: await buildOrderbookWorkbook(this.withScheduledAtLocal(tournament)),
        contentType: XLSX_CONTENT_TYPE,
      };
    }

    const worksheets = this.buildWorksheets(tournament, kind);
    const label = this.exportLabel(kind);

    return {
      filename: this.exportFilename(tournament.name, label, 'xls'),
      content: this.toWorkbookXml(worksheets),
      contentType: XLS_CONTENT_TYPE,
    };
  }

  /**
   * 单项「按阶段」秩序册（高保真 .xlsx）：场地排程页「按阶段导出秩序册」用。
   * 复用全量秩序册的同一套生成器（日程表 + 秩序表 + 流程表），与数据导出页「秩序册」格式内容一致；
   * stage 仅决定流程表只画第一阶段或第二阶段，日程表/秩序表按该阶段场次（含未排程的，流程表会完整呈现）。
   */
  async exportEventStageOrder(eventId: string, stage: 'first' | 'second') {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: {
        type: true,
        format: true,
        qualifiersPerGroup: true,
        tournament: {
          select: {
            name: true,
            startDate: true,
            endDate: true,
            venues: {
              orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
              select: { id: true, name: true, sortOrder: true },
            },
          },
        },
        registrations: {
          where: { status: RegistrationStatus.APPROVED },
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
            player1: { select: { name: true, gender: true, affiliation: true, contact: true } },
            player2: { select: { name: true, gender: true, affiliation: true, contact: true } },
            competitionRegistration: {
              select: { school: true, eventItems: { select: { eventId: true, partnerStudentId: true } } },
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
              select: { gameNo: true, side1Score: true, side2Score: true },
            },
          },
        },
        // 第二阶段（前8/前6晋级赛）后台指定的签位与对阵，用于流程表第二阶段对阵图。
        secondStage: {
          select: {
            status: true,
            mode: true,
            rankingMode: true,
            slots: {
              orderBy: { sortOrder: 'asc' },
              select: { slot: true, sortOrder: true, entrantId: true, entrantNameSnapshot: true },
            },
            matches: {
              orderBy: { matchNo: 'asc' },
              select: {
                matchNo: true,
                roundName: true,
                area: true,
                slotInfo: true,
                side1Source: true,
                side2Source: true,
                side1Id: true,
                side2Id: true,
                side1NameSnapshot: true,
                side2NameSnapshot: true,
                score: true,
                status: true,
                winnerSide: true,
                winnerId: true,
                winnerNameSnapshot: true,
              },
            },
            rankings: {
              orderBy: { rank: 'asc' },
              select: { rank: true, entrantId: true, entrantNameSnapshot: true },
            },
          },
        },
      },
    });
    if (!event) throw new NotFoundException('单项不存在');

    // 只取目标阶段的场次喂给日程表/秩序表；流程表会按 stage 完整呈现该阶段结构（含未排程的）。
    const stageMatches = this.orderStageMatches(
      (event.matches as unknown as ExportMatch[]).filter((match) =>
        this.isStageMatch(event.format, match.roundNo ?? 0, stage),
      ),
    ).map((match) => this.withMatchScheduledAtLocal(match));

    const tournament: ExportTournament = {
      name: event.tournament.name,
      startDate: event.tournament.startDate,
      endDate: event.tournament.endDate,
      venues: event.tournament.venues,
      events: [
        {
          type: event.type,
          format: event.format,
          qualifiersPerGroup: event.qualifiersPerGroup,
          registrations: event.registrations as unknown as ExportRegistration[],
          matches: stageMatches,
          secondStage: event.secondStage as unknown as ExportSecondStage | null,
        },
      ],
    };

    const eventLabel = EVENT_TYPE_LABELS[event.type] ?? event.type;
    const stageLabel = stage === 'first' ? '第一阶段' : '第二阶段';
    return {
      filename: this.exportFilename(`${event.tournament.name}-${eventLabel}`, `${stageLabel}秩序册`, 'xlsx'),
      content: await buildOrderbookWorkbook(tournament, { stage }),
      contentType: XLSX_CONTENT_TYPE,
    };
  }

  /**
   * 阶段归属判定（按赛制）：
   * - 单淘汰+小组排位(SINGLE_ELIMINATION_PLUS_GROUP_RANKING)：第一阶段=单淘汰(1≤roundNo<100)，第二阶段=排位赛(roundNo≥100)；
   * - 其余含小组的赛制（含标准2023）：第一阶段=小组循环(roundNo=0)，第二阶段=淘汰/排位(roundNo≥1)。
   */
  private isStageMatch(format: Format, roundNo: number, stage: 'first' | 'second') {
    if (format === Format.SINGLE_ELIMINATION_PLUS_GROUP_RANKING) {
      return stage === 'first'
        ? roundNo >= 1 && roundNo < SECOND_STAGE_FORMAL_ROUND_NO_BASE
        : roundNo >= SECOND_STAGE_FORMAL_ROUND_NO_BASE;
    }
    return stage === 'first' ? roundNo === 0 : roundNo >= 1;
  }

  private orderStageMatches(matches: ExportMatch[]) {
    return [...matches].sort(
      (a, b) =>
        Number(!a.scheduledAt) - Number(!b.scheduledAt) ||
        this.matchSortValue(a) - this.matchSortValue(b) ||
        (a.venue?.sortOrder ?? Number.MAX_SAFE_INTEGER) -
          (b.venue?.sortOrder ?? Number.MAX_SAFE_INTEGER) ||
        (a.venue?.name ?? '').localeCompare(b.venue?.name ?? '', 'zh-CN') ||
        (a.roundNo ?? 0) - (b.roundNo ?? 0) ||
        (a.matchNo ?? 0) - (b.matchNo ?? 0) ||
        a.id.localeCompare(b.id),
    );
  }

  private withScheduledAtLocal(tournament: ExportTournament): ExportTournament {
    return {
      ...tournament,
      events: tournament.events.map((event) => ({
        ...event,
        matches: event.matches.map((match) => this.withMatchScheduledAtLocal(match)),
      })),
    };
  }

  private withMatchScheduledAtLocal(match: ExportMatch): ExportMatch {
    return {
      ...match,
      scheduledAtLocal: match.scheduledAt ? this.formatDateTime(match.scheduledAt) : null,
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
            qualifiersPerGroup: true,
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
            // 第二阶段（前8/前6晋级赛）由后台手动指定的签位与对阵，用于秩序册流程图。
            secondStage: {
              select: {
                status: true,
                mode: true,
                rankingMode: true,
                slots: {
                  orderBy: { sortOrder: 'asc' },
                  select: { slot: true, sortOrder: true, entrantId: true, entrantNameSnapshot: true },
                },
                matches: {
                  orderBy: { matchNo: 'asc' },
                  select: {
                    matchNo: true,
                    roundName: true,
                    area: true,
                    slotInfo: true,
                    side1Source: true,
                    side2Source: true,
                    side1Id: true,
                    side2Id: true,
                    side1NameSnapshot: true,
                    side2NameSnapshot: true,
                    score: true,
                    status: true,
                    winnerSide: true,
                    winnerId: true,
                    winnerNameSnapshot: true,
                  },
                },
                rankings: {
                  orderBy: { rank: 'asc' },
                  select: { rank: true, entrantId: true, entrantNameSnapshot: true },
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

  private exportFilename(tournamentName: string, label: string, ext: 'xls' | 'xlsx') {
    const safeName = this.sanitizeFilenamePart(tournamentName) || '赛事';
    return `${safeName}-${this.formatFileDate(new Date())}-${label}.${ext}`;
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
    const parts = new Map(exportDateTimeFormatter.formatToParts(date).map((part) => [part.type, part.value]));
    const year = parts.get('year') ?? String(date.getUTCFullYear());
    const month = parts.get('month') ?? String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = parts.get('day') ?? String(date.getUTCDate()).padStart(2, '0');
    const hour = String(Number(parts.get('hour') ?? date.getUTCHours()) % 24).padStart(2, '0');
    const minute = parts.get('minute') ?? String(date.getUTCMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hour}:${minute}`;
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

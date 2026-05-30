import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MatchStatus, RegistrationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type ExportKind = 'schedule' | 'results' | 'registrations';
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
  round: string | number | null;
  matchNo: number | null;
  scheduledAt: Date | null;
  status: string;
  durationMinutes: number;
  side1Id: string | null;
  side2Id: string | null;
  winnerSide: number | null;
  updatedAt: Date;
  venue: {
    name: string;
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
  registrations: ExportRegistration[];
  matches: ExportMatch[];
};

type ExportTournament = {
  name: string;
  startDate: Date;
  endDate: Date;
  events: ExportEvent[];
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
      throw new BadRequestException('导出类型必须是 schedule、results 或 registrations');
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
                  round: true,
                  matchNo: true,
                  scheduledAt: true,
                  status: true,
                  durationMinutes: true,
                  side1Id: true,
                  side2Id: true,
                  winnerSide: true,
                  updatedAt: true,
                  venue: { select: { name: true } },
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
                round: true,
                matchNo: true,
                scheduledAt: true,
                status: true,
                durationMinutes: true,
                side1Id: true,
                side2Id: true,
                winnerSide: true,
                updatedAt: true,
                venue: { select: { name: true } },
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

    for (const event of tournament.events) {
      const registrationMap = this.registrationMap(event.registrations);
      for (const match of event.matches) {
        rows.push([
          tournament.name,
          EVENT_TYPE_LABELS[event.type] ?? event.type,
          match.round,
          match.matchNo,
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

  private exportLabel(kind: ExportKind) {
    return kind === 'schedule' ? '赛程表' : kind === 'results' ? '成绩册' : '报名表';
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

  private sideName(id: string | null, registrationMap: Map<string, ExportRegistration>) {
    if (!id) return '待定';
    const registration = registrationMap.get(id);
    return registration ? this.registrationName(registration) : '待定';
  }

  private registrationName(registration: ExportRegistration) {
    return registration.player2
      ? `${registration.player1.name} / ${registration.player2.name}`
      : registration.player1.name;
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
    return ['schedule', 'results', 'registrations'].includes(kind);
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

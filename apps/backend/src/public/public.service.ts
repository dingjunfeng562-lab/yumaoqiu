import { Injectable } from '@nestjs/common';
import { MatchStatus, RegistrationStatus, TournamentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TeamCompetitionsService } from '../team-competitions/team-competitions.service';
import { AnnouncementsService } from '../announcements/announcements.service';

const EVENT_TYPE_LABELS: Record<string, string> = {
  MENS_SINGLES: '男子单打',
  WOMENS_SINGLES: '女子单打',
  MENS_DOUBLES: '男子双打',
  WOMENS_DOUBLES: '女子双打',
  MIXED_DOUBLES: '混合双打',
};

const STATUS_LABELS: Record<MatchStatus, string> = {
  PENDING: '未开始',
  LIVE: '进行中',
  COMPLETED: '已结束',
  CANCELLED: '已取消',
};

const TOURNAMENT_STATUS_LABELS: Record<TournamentStatus, '报名中' | '即将开始' | '进行中' | '已结束'> = {
  REGISTRATION_NOT_STARTED: '即将开始',
  REGISTRATION_OPEN: '报名中',
  REGISTRATION_CLOSED: '即将开始',
  ONGOING: '进行中',
  FINISHED: '已结束',
};

const FORMAT_LABELS: Record<string, string> = {
  SINGLE_ELIMINATION: '单淘汰制',
  GROUP_PLUS_KNOCKOUT: '小组赛+淘汰',
};

type StandingRow = {
  id: string;
  name: string;
  affiliation: string;
  groupName: string | null;
  played: number;
  wins: number;
  losses: number;
  gameDiff: number;
};

@Injectable()
export class PublicService {
  constructor(
    private prisma: PrismaService,
    private teamCompetitionsService: TeamCompetitionsService,
    private announcementsService: AnnouncementsService,
  ) {}

  async getLobby() {
    const tournaments = await this.prisma.tournament.findMany({
      where: { isArchived: false, isPublished: true },
      include: {
        events: {
          include: {
            registrations: {
              where: { status: RegistrationStatus.APPROVED },
              select: { id: true },
            },
          },
        },
        teamCompetitions: {
          where: { isPublished: true },
          include: {
            teams: true,
          },
        },
      },
      orderBy: [{ startDate: 'desc' }, { edition: 'desc' }],
    });

    const competitions = tournaments.map((tournament) => {
      const registeredCount = tournament.events.reduce(
        (sum, event) => sum + event.registrations.length,
        0,
      );
      const teamCompetitionCount = tournament.teamCompetitions.length;

      return {
        id: tournament.id,
        title: tournament.name,
        subtitle: tournament.subtitle,
        status: TOURNAMENT_STATUS_LABELS[tournament.status],
        rawStatus: tournament.status,
        startDate: tournament.startDate.toISOString(),
        endDate: tournament.endDate.toISOString(),
        projects: this.projectLabels(tournament),
        formatText: tournament.formatText,
        description: tournament.description ?? tournament.rules,
        location: tournament.location || '待公布',
        registeredCount,
        teamCompetitionCount,
        teamCount: tournament.teamCompetitions.reduce((sum, item) => sum + item.teams.length, 0),
        cover: tournament.coverImageUrl,
      };
    });
    const publicAnnouncements = await this.announcementsService.findPublished(4);

    return {
      competitions,
      stats: {
        totalCompetitions: competitions.length,
        totalRegistrations: competitions.reduce((sum, item) => sum + item.registeredCount, 0),
        registrationOpen: competitions.filter((item) => item.status === '报名中').length,
        ongoing: competitions.filter((item) => item.status === '进行中').length,
        finished: competitions.filter((item) => item.status === '已结束').length,
      },
      announcements: publicAnnouncements.length
        ? publicAnnouncements
        : this.buildLobbyAnnouncements(competitions),
    };
  }

  async getHome() {
    const publicAnnouncements = await this.announcementsService.findPublished(4);
    const competition =
      (await this.prisma.tournament.findFirst({
        where: { showOnHome: true, isArchived: false, isPublished: true },
        include: { events: true },
        orderBy: [{ updatedAt: 'desc' }],
      })) ??
      (await this.prisma.tournament.findFirst({
        where: { isArchived: false, isPublished: true },
        include: { events: true },
        orderBy: [{ edition: 'desc' }],
      }));

    if (!competition) {
      return {
        competition: null,
        stats: { registrations: 0, events: 0, liveMatches: 0, promotedPlayers: 0 },
        schedules: [],
        bracketPreviews: [],
        announcements: publicAnnouncements,
      };
    }

    const eventIds = competition.events.map((event) => event.id);
    const teamCompetitions = await this.teamCompetitionsService.getPublicCompetitions(competition.id);
    const [registrationCount, liveMatches, promotedMatches, scheduleMatches, bracketEvents] =
      await Promise.all([
        this.prisma.registration.count({
          where: { eventId: { in: eventIds }, status: RegistrationStatus.APPROVED },
        }),
        this.prisma.match.count({
          where: { eventId: { in: eventIds }, status: MatchStatus.LIVE },
        }),
        this.prisma.match.count({
          where: {
            eventId: { in: eventIds },
            status: MatchStatus.COMPLETED,
            winnerSide: { not: null },
          },
        }),
        this.prisma.match.findMany({
          where: { eventId: { in: eventIds } },
          include: {
            event: true,
            venue: true,
          },
          orderBy: [{ scheduledAt: 'asc' }, { roundNo: 'asc' }, { matchNo: 'asc' }],
          take: 6,
        }),
        this.prisma.event.findMany({
          where: { tournamentId: competition.id },
          include: {
            matches: {
              where: { roundNo: { gt: 0 } },
              orderBy: [{ roundNo: 'asc' }, { matchNo: 'asc' }],
              take: 4,
            },
            registrations: {
              where: { status: RegistrationStatus.APPROVED },
              include: { player1: true, player2: true },
              orderBy: [{ isSeed: 'desc' }, { seedRank: 'asc' }, { createdAt: 'asc' }],
              take: 4,
            },
          },
          take: 2,
        }),
      ]);

    const registrations = await this.prisma.registration.findMany({
      where: {
        id: {
          in: scheduleMatches.flatMap((match) =>
            [match.side1Id, match.side2Id].filter(Boolean) as string[],
          ),
        },
      },
      include: { player1: true, player2: true },
    });
    const registrationMap = new Map(registrations.map((registration) => [registration.id, registration]));

    return {
      competition,
      stats: {
        registrations: registrationCount,
        events: competition.events.length,
        liveMatches,
        promotedPlayers: promotedMatches,
      },
      teamCompetitions,
      schedules: scheduleMatches.map((match) => ({
        id: match.id,
        time: (match.scheduledAt ?? match.createdAt).toISOString(),
        event: match.event ? (EVENT_TYPE_LABELS[match.event.type] ?? match.event.type) : '团体赛',
        match: `${this.sideName(match.side1Id, registrationMap)} VS ${this.sideName(match.side2Id, registrationMap)}`,
        court: match.venue?.name ?? '待排场地',
        status: STATUS_LABELS[match.status],
      })),
      bracketPreviews: bracketEvents.map((event) => ({
        id: event.id,
        title: `${EVENT_TYPE_LABELS[event.type] ?? event.type}对阵表`,
        players: event.registrations.map((registration) => this.registrationName(registration)),
      })),
      announcements: publicAnnouncements.length
        ? publicAnnouncements
        : this.buildAnnouncements(competition),
    };
  }

  async getScreen() {
    const competition =
      (await this.prisma.tournament.findFirst({
        where: { showOnHome: true, isArchived: false, isPublished: true },
        include: { events: true, venues: true },
        orderBy: [{ updatedAt: 'desc' }],
      })) ??
      (await this.prisma.tournament.findFirst({
        where: { isArchived: false, isPublished: true },
        include: { events: true, venues: true },
        orderBy: [{ edition: 'desc' }],
      }));

    if (!competition) {
      return {
        competition: null,
        stats: {
          registrations: 0,
          events: 0,
          liveMatches: 0,
          completedMatches: 0,
          scheduledMatches: 0,
          venues: 0,
        },
        liveMatches: [],
        upcomingMatches: [],
        recentResults: [],
        eventReports: [],
        generatedAt: new Date().toISOString(),
      };
    }

    const eventIds = competition.events.map((event) => event.id);
    const [
      registrationCount,
      liveMatchCount,
      completedMatchCount,
      scheduledMatchCount,
      liveMatches,
      upcomingMatches,
      recentResults,
      eventReports,
    ] = await Promise.all([
      this.prisma.registration.count({
        where: { eventId: { in: eventIds }, status: RegistrationStatus.APPROVED },
      }),
      this.prisma.match.count({
        where: { eventId: { in: eventIds }, status: MatchStatus.LIVE },
      }),
      this.prisma.match.count({
        where: { eventId: { in: eventIds }, status: MatchStatus.COMPLETED },
      }),
      this.prisma.match.count({
        where: { eventId: { in: eventIds }, scheduledAt: { not: null } },
      }),
      this.prisma.match.findMany({
        where: { eventId: { in: eventIds }, status: MatchStatus.LIVE },
        include: {
          event: true,
          venue: true,
          games: { orderBy: { gameNo: 'asc' } },
        },
        orderBy: [{ updatedAt: 'desc' }],
        take: 8,
      }),
      this.prisma.match.findMany({
        where: {
          eventId: { in: eventIds },
          status: MatchStatus.PENDING,
          scheduledAt: { not: null },
        },
        include: {
          event: true,
          venue: true,
          games: { orderBy: { gameNo: 'asc' } },
        },
        orderBy: [{ scheduledAt: 'asc' }, { roundNo: 'asc' }, { matchNo: 'asc' }],
        take: 8,
      }),
      this.prisma.match.findMany({
        where: { eventId: { in: eventIds }, status: MatchStatus.COMPLETED },
        include: {
          event: true,
          venue: true,
          games: { orderBy: { gameNo: 'asc' } },
        },
        orderBy: [{ updatedAt: 'desc' }],
        take: 8,
      }),
      this.prisma.event.findMany({
        where: { tournamentId: competition.id },
        include: {
          _count: {
            select: {
              registrations: { where: { status: RegistrationStatus.APPROVED } },
              matches: true,
            },
          },
          matches: {
            where: { status: MatchStatus.COMPLETED },
            include: {
              games: { orderBy: { gameNo: 'asc' } },
            },
            orderBy: [{ updatedAt: 'desc' }],
            take: 1,
          },
        },
        orderBy: { type: 'asc' },
      }),
    ]);

    const registrationMap = await this.registrationMap([
      ...liveMatches.flatMap((match) => [match.side1Id, match.side2Id]),
      ...upcomingMatches.flatMap((match) => [match.side1Id, match.side2Id]),
      ...recentResults.flatMap((match) => [match.side1Id, match.side2Id]),
      ...eventReports.flatMap((event) =>
        event.matches.flatMap((match) => [match.side1Id, match.side2Id]),
      ),
    ]);

    return {
      competition: {
        id: competition.id,
        name: competition.name,
        edition: competition.edition,
        subtitle: competition.subtitle,
        location: competition.location,
        status: competition.status,
        statusLabel: TOURNAMENT_STATUS_LABELS[competition.status],
        startDate: competition.startDate.toISOString(),
        endDate: competition.endDate.toISOString(),
        projectText: competition.projectText,
        formatText: competition.formatText,
        coverImageUrl: competition.coverImageUrl,
      },
      stats: {
        registrations: registrationCount,
        events: competition.events.length,
        liveMatches: liveMatchCount,
        completedMatches: completedMatchCount,
        scheduledMatches: scheduledMatchCount,
        venues: competition.venues.length,
      },
      liveMatches: liveMatches.map((match) => this.publicMatchView(match, registrationMap)),
      upcomingMatches: upcomingMatches.map((match) => this.publicMatchView(match, registrationMap)),
      recentResults: recentResults.map((match) => this.publicMatchView(match, registrationMap)),
      eventReports: eventReports.map((event) => ({
        id: event.id,
        type: event.type,
        typeLabel: EVENT_TYPE_LABELS[event.type] ?? event.type,
        registrations: event._count.registrations,
        matches: event._count.matches,
        latestResult: event.matches[0]
          ? this.publicMatchView(
              {
                ...event.matches[0],
                event,
                venue: null,
              },
              registrationMap,
            )
          : null,
      })),
      generatedAt: new Date().toISOString(),
    };
  }

  async getTeamCompetitions() {
    return {
      teamCompetitions: await this.teamCompetitionsService.getPublicCompetitions(),
    };
  }

  async getAnnouncements() {
    return {
      announcements: await this.announcementsService.findPublished(50),
    };
  }

  async getBrackets() {
    const events = await this.prisma.event.findMany({
      where: {
        tournament: {
          isPublished: true,
          isArchived: false,
        },
        matches: { some: { roundNo: { gt: 0 } } },
      },
      include: {
        tournament: true,
        registrations: {
          where: { status: RegistrationStatus.APPROVED },
          include: { player1: true, player2: true },
          orderBy: [{ isSeed: 'desc' }, { seedRank: 'asc' }, { createdAt: 'asc' }],
        },
        matches: {
          where: { roundNo: { gt: 0 } },
          include: {
            venue: true,
            referee: { select: { username: true } },
            games: { orderBy: { gameNo: 'asc' } },
          },
          orderBy: [{ roundNo: 'asc' }, { matchNo: 'asc' }],
        },
      },
      orderBy: [{ tournament: { startDate: 'desc' } }, { type: 'asc' }],
    });

    return {
      brackets: events.map((event) => this.publicBracketView(event)),
    };
  }

  async getHistory() {
    const tournaments = await this.prisma.tournament.findMany({
      where: {
        OR: [{ isArchived: true }, { status: TournamentStatus.FINISHED }],
      },
      include: {
        events: {
          include: {
            registrations: {
              where: { status: RegistrationStatus.APPROVED },
              include: { player1: true, player2: true },
              orderBy: [{ groupName: 'asc' }, { isSeed: 'desc' }, { seedRank: 'asc' }],
            },
            matches: {
              include: {
                venue: true,
                games: { orderBy: { gameNo: 'asc' } },
              },
              orderBy: [{ roundNo: 'asc' }, { matchNo: 'asc' }],
            },
          },
          orderBy: { type: 'asc' },
        },
      },
      orderBy: [{ edition: 'desc' }, { startDate: 'desc' }],
    });

    return {
      tournaments: tournaments.map((tournament) => {
        const events = tournament.events.map((event) => {
          const registrationMap = new Map(
            event.registrations.map((registration) => [registration.id, registration]),
          );
          const matches = event.matches.map((match) =>
            this.publicMatchView(
              {
                ...match,
                event,
              },
              registrationMap,
            ),
          );
          const standings = this.eventStandings(event, registrationMap);

          return {
            id: event.id,
            type: event.type,
            typeLabel: EVENT_TYPE_LABELS[event.type] ?? event.type,
            registrations: event.registrations.map((registration) => ({
              id: registration.id,
              name: this.registrationName(registration),
              affiliation: registration.player2
                ? `${registration.player1.affiliation} / ${registration.player2.affiliation}`
                : registration.player1.affiliation,
              groupName: registration.groupName,
              isSeed: registration.isSeed,
              seedRank: registration.seedRank,
            })),
            standings,
            matches,
          };
        });

        return {
          id: tournament.id,
          name: tournament.name,
          edition: tournament.edition,
          subtitle: tournament.subtitle,
          location: tournament.location,
          startDate: tournament.startDate.toISOString(),
          endDate: tournament.endDate.toISOString(),
          status: tournament.status,
          statusLabel: TOURNAMENT_STATUS_LABELS[tournament.status],
          isArchived: tournament.isArchived,
          stats: {
            events: events.length,
            registrations: events.reduce((sum, event) => sum + event.registrations.length, 0),
            matches: events.reduce((sum, event) => sum + event.matches.length, 0),
            completedMatches: events.reduce(
              (sum, event) =>
                sum + event.matches.filter((match) => match.status === MatchStatus.COMPLETED).length,
              0,
            ),
          },
          events,
        };
      }),
      generatedAt: new Date().toISOString(),
    };
  }

  private sideName(id: string | null, map: Map<string, any>) {
    if (!id) return '待定';
    const registration = map.get(id);
    return registration ? this.registrationName(registration) : '待定';
  }

  private registrationName(registration: any) {
    return registration.player2
      ? `${registration.player1.name} / ${registration.player2.name}`
      : registration.player1.name;
  }

  private publicBracketView(event: any) {
    const registrationMap = new Map<string, any>(
      event.registrations.map((item: any) => [item.id, item]),
    );
    const firstRound = event.matches
      .filter((match: any) => match.roundNo === 1)
      .sort((a: any, b: any) => a.matchNo - b.matchNo);
    const participants = firstRound.length
      ? firstRound.flatMap((match: any, index: number) => [
          this.bracketParticipant(match.side1Id, index * 2 + 1, registrationMap),
          this.bracketParticipant(match.side2Id, index * 2 + 2, registrationMap),
        ])
      : event.registrations.map((registration: any, index: number) => ({
          id: registration.id,
          position: index + 1,
          name: this.registrationName(registration),
          seed: registration.seedRank,
          isBye: false,
        }));

    return {
      id: event.id,
      title: `${event.tournament.name} · ${EVENT_TYPE_LABELS[event.type] ?? event.type}`,
      subtitle: `第 ${event.tournament.edition} 届 · ${FORMAT_LABELS[event.format] ?? event.format} · ${participants.filter((item: any) => !item.isBye).length} 个签位`,
      generatedAt: event.drawGeneratedAt?.toISOString?.() ?? null,
      participants,
      matches: event.matches.map((match: any) => ({
        id: match.id,
        roundNo: match.roundNo,
        roundLabel: match.round,
        matchNo: match.matchNo,
        status: match.status,
        side1Id: match.side1Id,
        side2Id: match.side2Id,
        winnerSide: match.winnerSide,
        winnerId: match.winnerSide === 1 ? match.side1Id : match.winnerSide === 2 ? match.side2Id : null,
        forfeitedSide: match.forfeitedSide ?? null,
        forfeitReason: match.forfeitReason ?? null,
        venueName: match.venue?.name ?? '待排场地',
        refereeName: match.referee?.username ?? null,
        scheduledAt: match.scheduledAt?.toISOString?.() ?? null,
        score: match.forfeitedSide
          ? '弃权'
          : match.games.length
            ? `${match.games.at(-1)?.side1Score ?? 0}:${match.games.at(-1)?.side2Score ?? 0}`
            : '0:0',
        gamesText: match.forfeitedSide
          ? `选手 ${match.forfeitedSide} 弃权`
          : match.games.length
            ? match.games.map((game: any) => `${game.side1Score}:${game.side2Score}`).join(' / ')
            : '-',
      })),
    };
  }

  private bracketParticipant(
    registrationId: string | null,
    position: number,
    registrationMap: Map<string, any>,
  ) {
    if (!registrationId) {
      return {
        id: `bye-position-${position}`,
        position,
        name: '— 轮空 —',
        isBye: true,
      };
    }
    const registration = registrationMap.get(registrationId);
    return {
      id: registrationId,
      position,
      name: registration ? this.registrationName(registration) : '待定',
      seed: registration?.seedRank ?? null,
      isBye: false,
    };
  }

  private async registrationMap(ids: Array<string | null>) {
    const compactIds = [...new Set(ids.filter(Boolean) as string[])];
    if (!compactIds.length) return new Map<string, any>();
    const registrations = await this.prisma.registration.findMany({
      where: { id: { in: compactIds } },
      include: { player1: true, player2: true },
    });
    return new Map(registrations.map((registration) => [registration.id, registration]));
  }

  private publicMatchView(match: any, registrationMap: Map<string, any>) {
    const games = match.games ?? [];
    const currentGame =
      games.find((game: { winnerSide: number | null }) => !game.winnerSide) ??
      games.at(-1) ??
      null;

    return {
      id: match.id,
      eventId: match.eventId,
      eventType: match.event.type,
      eventTypeLabel: EVENT_TYPE_LABELS[match.event.type] ?? match.event.type,
      round: match.round,
      roundNo: match.roundNo,
      matchNo: match.matchNo,
      status: match.status,
      statusLabel: STATUS_LABELS[match.status as MatchStatus],
      scheduledAt: match.scheduledAt?.toISOString?.() ?? null,
      venueName: match.venue?.name ?? '待排场地',
      side1: this.sideName(match.side1Id, registrationMap),
      side2: this.sideName(match.side2Id, registrationMap),
      score: currentGame ? `${currentGame.side1Score}:${currentGame.side2Score}` : '0:0',
      games: games.map((game: { gameNo: number; side1Score: number; side2Score: number; winnerSide: number | null }) => ({
        gameNo: game.gameNo,
        score: `${game.side1Score}:${game.side2Score}`,
        winnerSide: game.winnerSide,
      })),
      gamesText: games.length
        ? games.map((game: { side1Score: number; side2Score: number }) => `${game.side1Score}:${game.side2Score}`).join(' / ')
        : '-',
      winnerSide: match.winnerSide,
      winnerName: match.winnerSide
        ? this.sideName(match.winnerSide === 1 ? match.side1Id : match.side2Id, registrationMap)
        : null,
      forfeitedSide: match.forfeitedSide ?? null,
      forfeitReason: match.forfeitReason ?? null,
      updatedAt: match.updatedAt?.toISOString?.() ?? null,
    };
  }

  private eventStandings(event: any, registrationMap: Map<string, any>) {
    const rows: StandingRow[] = event.registrations.map((registration: any) => ({
      id: registration.id,
      name: this.registrationName(registration),
      affiliation: registration.player2
        ? `${registration.player1.affiliation} / ${registration.player2.affiliation}`
        : registration.player1.affiliation,
      groupName: registration.groupName,
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
      for (const game of match.games ?? []) {
        side1.gameDiff += game.side1Score - game.side2Score;
        side2.gameDiff += game.side2Score - game.side1Score;
      }
    }

    return rows
      .sort((a, b) => b.wins - a.wins || b.gameDiff - a.gameDiff || a.losses - b.losses)
      .map((row, index) => ({
        rank: index + 1,
        ...row,
        displayName: registrationMap.has(row.id) ? row.name : row.name,
      }));
  }

  private projectLabels(tournament: {
    projectText: string | null;
    events: Array<{ type: string }>;
  }) {
    const fromText = (tournament.projectText ?? '')
      .split(/[\/、,，|]/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (fromText.length) return fromText;

    const labels = tournament.events.map((event) => EVENT_TYPE_LABELS[event.type] ?? event.type);
    return [...new Set(labels)].slice(0, 4);
  }

  private buildLobbyAnnouncements(
    competitions: Array<{
      title: string;
      status: '报名中' | '即将开始' | '进行中' | '已结束';
      startDate: string;
      endDate: string;
    }>,
  ) {
    const announcements: Array<{ text: string; date: string }> = [];
    const open = competitions.find((item) => item.status === '报名中');
    const upcoming = competitions.find((item) => item.status === '即将开始');
    const ongoing = competitions.find((item) => item.status === '进行中');
    const finished = competitions.find((item) => item.status === '已结束');

    if (open) announcements.push({ text: `${open.title} 正在报名，请及时完成报名信息提交。`, date: '报名' });
    if (ongoing) announcements.push({ text: `${ongoing.title} 正在进行，请参赛选手按赛程到场。`, date: '赛程' });
    if (upcoming) announcements.push({ text: `${upcoming.title} 即将开始，赛程与对阵将陆续公布。`, date: '预告' });
    if (finished) announcements.push({ text: `${finished.title} 已结束，可进入比赛页面查看成绩。`, date: '成绩' });

    if (!announcements.length) {
      announcements.push(
        { text: '欢迎进入校园羽毛球赛事大厅，新的比赛将在后台发布后展示。', date: '公告' },
        { text: '请参赛选手自备球拍和运动鞋，按比赛规程文明参赛。', date: '提醒' },
      );
    }

    return announcements.slice(0, 4);
  }

  private buildAnnouncements(competition: {
    rules: string | null;
    registrationStartDate: Date | null;
    registrationEndDate: Date | null;
    status: TournamentStatus;
  }) {
    const ruleLines = (competition.rules ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 4);
    if (ruleLines.length) {
      return ruleLines.map((text) => ({ text, date: '规则' }));
    }
    const announcements = [
      '请所有参赛选手提前10分钟到达比赛场地，进行签到检录。',
      '比赛开始后5分钟未到场视为弃权，取消本场比赛资格。',
      '请自备球拍和运动鞋，穿着符合比赛要求的运动服装参赛。',
    ];
    if (competition.registrationEndDate) {
      announcements.unshift(
        `报名截止时间：${competition.registrationEndDate.toLocaleDateString('zh-CN')}。`,
      );
    }
    return announcements.slice(0, 4).map((text) => ({ text, date: '公告' }));
  }
}

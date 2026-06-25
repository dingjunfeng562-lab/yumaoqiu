import { Injectable } from '@nestjs/common';
import { Format, MatchEventType, MatchStatus, RegistrationStatus, TournamentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TeamCompetitionsService } from '../team-competitions/team-competitions.service';
import { AnnouncementsService } from '../announcements/announcements.service';
import { effectiveTournamentStatus } from '../tournaments/tournament-status';

const SECOND_STAGE_FORMAL_ROUND_NO_BASE = 100;

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

function deriveTournamentDisplayStatus(tournament: {
  status: TournamentStatus;
  startDate: Date;
  endDate: Date;
  registrationStartDate: Date | null;
  registrationEndDate: Date | null;
}): '报名中' | '即将开始' | '进行中' | '已结束' {
  return TOURNAMENT_STATUS_LABELS[effectiveTournamentStatus(tournament)];
}

const FORMAT_LABELS: Record<string, string> = {
  SINGLE_ELIMINATION: '单淘汰制',
  GROUP_PLUS_KNOCKOUT_STD: '小组循环+淘汰(标准2023)',
  GROUP_PLUS_KNOCKOUT: '小组赛+淘汰',
  ROUND_ROBIN: '单循环排名赛',
  GROUP_PLUS_PLAYOFF: '小组循环+交叉排位',
  SINGLE_ELIMINATION_PLUS_GROUP_RANKING: '单淘汰+小组赛排位赛',
};

const COURT_SWAP_NOTE_PREFIX = 'COURT_SWAP:';
const COURT_SWAP_REQUIRED_NOTE_PREFIX = 'COURT_SWAP_REQUIRED:';
const RETIRE_NOTE_PREFIX = 'RETIRE:';
const BLACK_CARD_NOTE_PREFIX = 'BLACK_CARD:';
const INTERVAL_REST_NOTE_PREFIX = 'INTERVAL_REST:';

type ForfeitKind = 'normal' | 'retire' | 'black_card';

type ForfeitDecode = {
  kind: ForfeitKind;
  reason: string | null;
  label: '弃权' | '退赛' | '黑牌取消资格';
};

type CourtSide = 'left' | 'right';

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

type RankedStandingRow = StandingRow & {
  rank: number;
  displayName: string;
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
      where: { isArchived: false, isPublished: true, approvalStatus: 'APPROVED' },
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
        status: deriveTournamentDisplayStatus(tournament),
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
        where: { showOnHome: true, isArchived: false, isPublished: true, approvalStatus: 'APPROVED' },
        include: { events: true },
        orderBy: [{ updatedAt: 'desc' }],
      })) ??
      (await this.prisma.tournament.findFirst({
        where: { isArchived: false, isPublished: true, approvalStatus: 'APPROVED' },
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
            referee: { select: { username: true } },
          },
          orderBy: [{ scheduledAt: 'asc' }, { roundNo: 'asc' }, { matchNo: 'asc' }],
          take: 6,
        }),
        this.prisma.event.findMany({
          where: { tournamentId: competition.id },
          include: {
            matches: {
              where: { roundNo: { gt: 0, lt: SECOND_STAGE_FORMAL_ROUND_NO_BASE } },
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
      schedules: scheduleMatches
        .map((match) => ({
          id: match.id,
          time: (match.scheduledAt ?? match.createdAt).toISOString(),
          event: match.event ? (EVENT_TYPE_LABELS[match.event.type] ?? match.event.type) : '团体赛',
          match: `${this.sideName(match.side1Id, registrationMap)} VS ${this.sideName(match.side2Id, registrationMap)}`,
          court: match.venue?.name ?? '待排场地',
          referee: match.referee?.username ?? null,
          status: STATUS_LABELS[match.status],
        }))
        // 按实际展示的时间（scheduledAt 优先，否则 createdAt）升序，保证前端顺序与显示时间一致。
        // time 为 ISO 8601 UTC 串，字典序即时间序。
        .sort((a, b) => a.time.localeCompare(b.time)),
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
        where: { showOnHome: true, isArchived: false, isPublished: true, approvalStatus: 'APPROVED' },
        include: { events: true, venues: true },
        orderBy: [{ updatedAt: 'desc' }],
      })) ??
      (await this.prisma.tournament.findFirst({
        where: { isArchived: false, isPublished: true, approvalStatus: 'APPROVED' },
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
          events: {
            where: { type: { in: [MatchEventType.TIMEOUT, MatchEventType.SERVE_CHANGE] } },
            orderBy: { createdAt: 'asc' },
          },
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
          events: {
            where: { type: { in: [MatchEventType.TIMEOUT, MatchEventType.SERVE_CHANGE] } },
            orderBy: { createdAt: 'asc' },
          },
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
          events: {
            where: { type: { in: [MatchEventType.TIMEOUT, MatchEventType.SERVE_CHANGE] } },
            orderBy: { createdAt: 'asc' },
          },
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
        statusLabel: deriveTournamentDisplayStatus(competition),
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

  async getAnnouncementPopup() {
    return {
      announcement: await this.announcementsService.findActivePopup(),
    };
  }

  async getBrackets() {
    const events = await this.prisma.event.findMany({
      where: {
        tournament: {
          isPublished: true,
          isArchived: false,
          approvalStatus: 'APPROVED',
        },
        drawPublished: true,
        matches: { some: { roundNo: { lt: SECOND_STAGE_FORMAL_ROUND_NO_BASE } } },
      },
      include: {
        tournament: true,
        registrations: {
          where: { status: RegistrationStatus.APPROVED },
          include: { player1: true, player2: true },
          orderBy: [{ isSeed: 'desc' }, { seedRank: 'asc' }, { createdAt: 'asc' }],
        },
        matches: {
          where: { roundNo: { lt: SECOND_STAGE_FORMAL_ROUND_NO_BASE } },
          include: {
            venue: true,
            referee: { select: { username: true } },
            games: { orderBy: { gameNo: 'asc' } },
            events: {
              where: {
                type: {
                  in: [
                    MatchEventType.TIMEOUT,
                    MatchEventType.MEDICAL_TIMEOUT,
                    MatchEventType.WARNING,
                    MatchEventType.YELLOW_CARD,
                    MatchEventType.FORFEIT,
                    MatchEventType.SERVE_CHANGE,
                  ],
                },
              },
              orderBy: { createdAt: 'desc' },
            },
          },
          orderBy: [{ roundNo: 'asc' }, { matchNo: 'asc' }],
        },
        secondStage: {
          include: {
            slots: { orderBy: { sortOrder: 'asc' } },
            matches: { orderBy: { matchNo: 'asc' } },
            rankings: { orderBy: { rank: 'asc' } },
          },
        },
      },
      orderBy: [{ tournament: { startDate: 'desc' } }, { type: 'asc' }],
    });

    return {
      brackets: events.map((event) => this.publicBracketView(event)),
    };
  }

  async getHistory() {
    const now = new Date();
    const tournaments = await this.prisma.tournament.findMany({
      where: {
        OR: [{ isArchived: true }, { status: TournamentStatus.FINISHED }, { endDate: { lte: now } }],
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
                referee: { select: { username: true } },
                games: { orderBy: { gameNo: 'asc' } },
              },
              orderBy: [{ roundNo: 'asc' }, { matchNo: 'asc' }],
            },
            secondStage: {
              include: {
                slots: { orderBy: { sortOrder: 'asc' } },
                rankings: { orderBy: { rank: 'asc' } },
              },
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
            format: event.format,
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
          statusLabel: deriveTournamentDisplayStatus(tournament),
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

  async getRanking() {
    const tournaments = await this.prisma.tournament.findMany({
      where: {
        isPublished: true,
        approvalStatus: 'APPROVED',
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
                games: { orderBy: { gameNo: 'asc' } },
              },
              orderBy: [{ roundNo: 'asc' }, { matchNo: 'asc' }],
            },
            secondStage: {
              include: {
                slots: { orderBy: { sortOrder: 'asc' } },
                rankings: { orderBy: { rank: 'asc' } },
              },
            },
          },
          orderBy: { type: 'asc' },
        },
      },
      orderBy: [{ startDate: 'desc' }, { edition: 'desc' }],
    });

    return {
      tournaments: tournaments.map((tournament) => {
        const events = tournament.events.map((event) => {
          const registrationMap = new Map(
            event.registrations.map((registration) => [registration.id, registration]),
          );
          const standings = this.eventStandings(event, registrationMap);
          const completedMatches = event.matches.filter((match) => match.status === MatchStatus.COMPLETED);

          return {
            id: event.id,
            type: event.type,
            typeLabel: EVENT_TYPE_LABELS[event.type] ?? event.type,
            format: event.format,
            registrations: event.registrations.length,
            matches: event.matches.length,
            completedMatches: completedMatches.length,
            standings,
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
          statusLabel: deriveTournamentDisplayStatus(tournament),
          stats: {
            events: events.length,
            registrations: events.reduce((sum, event) => sum + event.registrations, 0),
            matches: events.reduce((sum, event) => sum + event.matches, 0),
            completedMatches: events.reduce((sum, event) => sum + event.completedMatches, 0),
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
    const bracketMatches = event.matches
      .filter((match: any) => !this.isSecondStageFormalMatch(match))
      .sort((a: any, b: any) => this.publicBracketMatchCompare(a, b));
    const firstRound = bracketMatches
      .filter((match: any) => match.roundNo === 1)
      .sort((a: any, b: any) => a.matchNo - b.matchNo);
    const participants = firstRound.length
      ? firstRound.flatMap((match: any, index: number) => [
          this.bracketParticipant(match.side1Id, index * 2 + 1, registrationMap),
          this.bracketParticipant(match.side2Id, index * 2 + 2, registrationMap),
        ])
      : event.registrations.map((registration: any, index: number) => {
          const teamName = registration.teamName?.trim() || null;
          const members = [registration.player1?.name, registration.player2?.name].filter(Boolean) as string[];
          return {
            id: registration.id,
            position: index + 1,
            name: teamName || this.registrationName(registration),
            teamName,
            members,
            seed: registration.seedRank,
            isBye: false,
          };
        });
    const groups = this.publicGroupsView(event.registrations);

    return {
      id: event.id,
      tournamentId: event.tournament.id,
      tournamentName: event.tournament.name,
      groupLabel: EVENT_TYPE_LABELS[event.type] ?? event.type,
      title: `${event.tournament.name} · ${EVENT_TYPE_LABELS[event.type] ?? event.type}`,
      subtitle: `${FORMAT_LABELS[event.format] ?? event.format} · ${participants.filter((item: any) => !item.isBye).length} 个签位`,
      generatedAt: event.drawGeneratedAt?.toISOString?.() ?? null,
      participants,
      groups,
      matches: bracketMatches.map((match: any) => {
        const pauseState = this.computePublicPauseState(match.events ?? [], match.finishedAt);
        const courtDisplayState = this.computePublicCourtDisplayState(match.events ?? []);
        const forfeitedSideName = match.forfeitedSide === 1
          ? this.sideName(match.side1Id, registrationMap)
          : match.forfeitedSide === 2
            ? this.sideName(match.side2Id, registrationMap)
            : null;
        const forfeit = this.decodeForfeit(match.forfeitReason);
        return {
        id: match.id,
        roundNo: match.roundNo,
        roundLabel: this.publicRoundLabel(match.round),
        matchNo: match.matchNo,
        status: match.status,
        side1Id: match.side1Id,
        side2Id: match.side2Id,
        winnerSide: match.winnerSide,
        winnerId: match.winnerSide === 1 ? match.side1Id : match.winnerSide === 2 ? match.side2Id : null,
        forfeitedSide: match.forfeitedSide ?? null,
        forfeitKind: match.forfeitedSide ? forfeit.kind : null,
        forfeitLabel: match.forfeitedSide ? forfeit.label : null,
        forfeitReason: match.forfeitedSide ? forfeit.reason : null,
        venueName: match.venue?.name ?? '待排场地',
        refereeName: match.referee?.username ?? null,
        scheduledAt: match.scheduledAt?.toISOString?.() ?? null,
        startedAt: match.startedAt?.toISOString?.() ?? null,
        finishedAt: match.finishedAt?.toISOString?.() ?? null,
        durationMinutes: match.durationMinutes ?? null,
        matchPaused: pauseState.paused,
        pausedAt: pauseState.pausedAt?.toISOString?.() ?? null,
        courtDisplayState,
        actualDurationSeconds: this.publicActualDurationSeconds(match.startedAt, match.finishedAt, match.status, pauseState),
        latestEvents: match.events
          ?.filter((event: any) => this.decodePublicMatchPauseNote(event.note) !== 'END')
          .filter((event: any) => !this.isPublicCourtEvent(event))
          .slice(0, 3)
          .map((event: any) => this.publicMatchEventView(event, match, registrationMap)) ?? [],
        score: match.forfeitedSide
          ? forfeit.label
          : match.games.length
            ? `${match.games.at(-1)?.side1Score ?? 0}:${match.games.at(-1)?.side2Score ?? 0}`
            : '0:0',
        gamesText: match.forfeitedSide
          ? `${forfeitedSideName ?? `选手 ${match.forfeitedSide}`} ${forfeit.label}`
          : match.games.length
            ? match.games.map((game: any) => `${game.side1Score}:${game.side2Score}`).join(' / ')
            : '-',
        };
      }),
      secondStage: this.publicSecondStageView(event.secondStage, event.format, registrationMap),
    };
  }

  private isSecondStageFormalMatch(match: { roundNo: number }) {
    return match.roundNo >= SECOND_STAGE_FORMAL_ROUND_NO_BASE;
  }

  private publicSecondStageView(
    stage: any | null | undefined,
    eventFormat: Format,
    registrationMap: Map<string, any>,
  ) {
    if (!stage) {
      if (eventFormat !== Format.SINGLE_ELIMINATION_PLUS_GROUP_RANKING) return null;
      return {
        status: 'NOT_STARTED',
        secondStageStatus: 'NOT_STARTED',
        mode: 'MANUAL_BY_REFEREE',
        secondStageMode: 'MANUAL_BY_REFEREE',
        modeText: '裁判手动指定',
        rankingMode: 'TOP_8',
        rankingModeText: '取前8名',
        slotSourceText: '组委会手动安排',
        slots: [],
        matches: [],
        rankings: [],
      };
    }

    const rankingMode = String(stage.rankingMode ?? 'TOP_8');
    // 第二阶段对阵卡片统一显示「队伍名称 + 队员名」：按 entrantId 实时回查报名信息，
    // 既能拿到双打队伍名/队员名，也兼容旧的快照数据（无需重新确认即可显示队伍名）。
    const membersOf = (id: string | null): string[] => {
      const reg = id ? registrationMap.get(id) : null;
      if (!reg) return [];
      return [reg.player1?.name, reg.player2?.name].filter(Boolean) as string[];
    };
    const displayName = (id: string | null, snapshot: string | null, source: string | null) => {
      const reg = id ? registrationMap.get(id) : null;
      if (reg) return reg.teamName?.trim() || membersOf(id).join(' / ') || snapshot || source || '待定';
      return snapshot ?? source ?? '待定';
    };
    return {
      id: stage.id,
      status: stage.status,
      secondStageStatus: stage.status,
      mode: stage.mode,
      secondStageMode: stage.mode,
      modeText: '裁判手动指定',
      rankingMode,
      rankingModeText: rankingMode === 'TOP_6' ? '取前6名' : '取前8名',
      slotSourceText: '组委会手动安排',
      confirmedAt: stage.confirmedAt?.toISOString?.() ?? null,
      finishedAt: stage.finishedAt?.toISOString?.() ?? null,
      slots: (stage.slots ?? []).map((slot: any) => ({
        slot: slot.slot,
        playerId: slot.entrantId,
        playerName: slot.entrantId ? displayName(slot.entrantId, slot.entrantNameSnapshot, null) : '轮空',
        playerMembers: membersOf(slot.entrantId),
      })),
      matches: (stage.matches ?? []).map((match: any) => ({
        id: match.id,
        matchNo: match.matchNo,
        stageName: '第二阶段：小组赛排位赛',
        roundName: match.roundName,
        area: match.area,
        slotInfo: match.slotInfo,
        source1: match.side1Source,
        source2: match.side2Source,
        player1Id: match.side1Id,
        player2Id: match.side2Id,
        player1Name: displayName(match.side1Id, match.side1NameSnapshot, match.side1Source),
        player2Name: displayName(match.side2Id, match.side2NameSnapshot, match.side2Source),
        player1Members: membersOf(match.side1Id),
        player2Members: membersOf(match.side2Id),
        score: match.score,
        winnerSide: match.winnerSide,
        winnerId: match.winnerId,
        winnerName: match.winnerNameSnapshot,
        status: match.status === MatchStatus.COMPLETED ? 'FINISHED' : match.status,
      })),
      rankings: (stage.rankings ?? []).map((ranking: any) => ({
        rank: ranking.rank,
        playerId: ranking.entrantId,
        playerName: ranking.entrantNameSnapshot ?? '待定',
      })),
    };
  }

  private publicMatchEventView(event: any, match: any, registrationMap: Map<string, any>) {
    const typeLabel = this.decodePublicMatchPauseNote(event.note) === 'START'
      ? '比赛暂停'
      : this.matchEventTypeLabel(event.type);
    const sideLabel =
      event.side === 1
        ? this.sideName(match.side1Id, registrationMap)
        : event.side === 2
          ? this.sideName(match.side2Id, registrationMap)
          : null;
    return {
      id: event.id,
      type: event.type,
      typeLabel,
      side: event.side ?? null,
      sideLabel,
      note: event.note ?? null,
      createdAt: event.createdAt?.toISOString?.() ?? null,
      text: sideLabel ? `${sideLabel} · ${typeLabel}` : typeLabel,
    };
  }

  private matchEventTypeLabel(type: string) {
    const labels: Record<string, string> = {
      TIMEOUT: '普通暂停',
      MEDICAL_TIMEOUT: '医疗暂停',
      WARNING: '警告',
      YELLOW_CARD: '黄牌',
      FORFEIT: '弃权',
    };
    return labels[type] ?? type;
  }

  private computePublicPauseState(events: Array<{ note: string | null; createdAt: Date }>, finishedAt?: Date | null) {
    let pauseStartedAt: Date | null = null;
    let pausedDurationMs = 0;
    const endLimit = finishedAt?.getTime() ?? null;
    for (const event of [...events].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
      if (endLimit !== null && event.createdAt.getTime() > endLimit) continue;
      const action = this.decodePublicMatchPauseNote(event.note);
      if (action === 'START' && !pauseStartedAt) pauseStartedAt = event.createdAt;
      else if (action === 'END' && pauseStartedAt) {
        pausedDurationMs += Math.max(0, event.createdAt.getTime() - pauseStartedAt.getTime());
        pauseStartedAt = null;
      }
    }
    const paused = Boolean(pauseStartedAt && !finishedAt);
    return {
      paused,
      pausedAt: paused ? pauseStartedAt : null,
      pauseStartedAt: paused ? pauseStartedAt : null,
      pausedDurationMs,
    };
  }

  private computePublicCourtDisplayState(events: Array<{ note: string | null; createdAt: Date }>): {
    side1CourtSide: CourtSide;
    side2CourtSide: CourtSide;
    swapCount: number;
  } {
    const swapCount = [...events]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .filter((event) => this.decodePublicCourtSwapNote(event.note) !== null)
      .length;
    const swapped = swapCount % 2 === 1;
    return {
      side1CourtSide: swapped ? 'right' : 'left',
      side2CourtSide: swapped ? 'left' : 'right',
      swapCount,
    };
  }

  private isPublicCourtEvent(event: { note?: string | null }) {
    return this.decodePublicCourtSwapNote(event.note) !== null || this.decodePublicCourtSwapRequiredNote(event.note) !== null;
  }

  private decodePublicCourtSwapNote(note?: string | null) {
    if (!note?.startsWith(COURT_SWAP_NOTE_PREFIX)) return null;
    const gameNo = Number(note.slice(COURT_SWAP_NOTE_PREFIX.length));
    return Number.isFinite(gameNo) ? gameNo : null;
  }

  private decodePublicCourtSwapRequiredNote(note?: string | null) {
    if (!note?.startsWith(COURT_SWAP_REQUIRED_NOTE_PREFIX)) return null;
    const gameNo = Number(note.slice(COURT_SWAP_REQUIRED_NOTE_PREFIX.length));
    return Number.isFinite(gameNo) ? gameNo : null;
  }

  // Classify how a match ended so the bracket / live screen can distinguish
  // 退赛 / 黑牌取消资格 / 普通弃权. The prefix lives in match.forfeitReason
  // and is set by the scoring service when forfeitMatch is invoked.
  private decodeForfeit(reason?: string | null): ForfeitDecode {
    if (reason?.startsWith(BLACK_CARD_NOTE_PREFIX)) {
      return {
        kind: 'black_card',
        reason: reason.slice(BLACK_CARD_NOTE_PREFIX.length).trim() || '黑牌取消资格',
        label: '黑牌取消资格',
      };
    }
    if (reason?.startsWith(RETIRE_NOTE_PREFIX)) {
      return {
        kind: 'retire',
        reason: reason.slice(RETIRE_NOTE_PREFIX.length).trim() || '伤退/退赛',
        label: '退赛',
      };
    }
    return { kind: 'normal', reason: reason ?? null, label: '弃权' };
  }

  private publicActualDurationSeconds(
    startedAt: Date | null,
    finishedAt: Date | null,
    status: MatchStatus,
    pauseState: { pauseStartedAt: Date | null; pausedDurationMs: number },
  ) {
    if (!startedAt) return null;
    const endAt = finishedAt ?? pauseState.pauseStartedAt ?? (status === MatchStatus.LIVE ? new Date() : null);
    if (!endAt) return null;
    return Math.max(0, Math.floor((endAt.getTime() - startedAt.getTime() - pauseState.pausedDurationMs) / 1000));
  }

  private decodePublicMatchPauseNote(note?: string | null): 'START' | 'END' | null {
    if (
      note?.startsWith('MATCH_PAUSE:START') ||
      note?.startsWith('TECHNICAL_PAUSE:START') ||
      note?.startsWith(`${INTERVAL_REST_NOTE_PREFIX}START`)
    ) return 'START';
    if (
      note?.startsWith('MATCH_PAUSE:END') ||
      note?.startsWith('TECHNICAL_PAUSE:END') ||
      note?.startsWith(`${INTERVAL_REST_NOTE_PREFIX}END`)
    ) return 'END';
    return null;
  }

  private publicRoundLabel(round: string) {
    const labels: Record<string, string> = {
      F: '决赛',
      SF: '半决赛',
      QF: '1/4 决赛',
      R1: '1/8 决赛',
      R2: '1/16 决赛',
      R3: '1/32 决赛',
      BRONZE: '季军赛',
    };
    // 交叉排位赛：round = `P{高位名次}`，例如 P1 = 1-2 名决赛、P3 = 3-4 名决赛。
    const playoff = /^P(\d+)$/.exec(round);
    if (playoff) {
      const hi = Number(playoff[1]);
      return `${hi}-${hi + 1} 名决赛`;
    }
    if (/^[A-Z]$/.test(round)) return this.publicGroupLabel(round);
    return labels[round] ?? round;
  }

  private publicBracketMatchCompare(
    a: { round: string; roundNo: number; matchNo: number; id: string },
    b: { round: string; roundNo: number; matchNo: number; id: string },
  ) {
    if (a.roundNo === 0 || b.roundNo === 0) {
      return a.roundNo - b.roundNo
        || this.publicGroupNameCompare(a.round, b.round)
        || a.matchNo - b.matchNo
        || a.id.localeCompare(b.id);
    }
    return a.roundNo - b.roundNo
      || a.matchNo - b.matchNo
      || a.id.localeCompare(b.id);
  }

  private publicGroupNameCompare(a: string, b: string) {
    return this.publicGroupNameSortValue(a) - this.publicGroupNameSortValue(b)
      || a.localeCompare(b, 'zh-CN', { numeric: true });
  }

  private publicGroupNameSortValue(value: string) {
    const letters = /^[A-Z]+/.exec(value.trim().toUpperCase())?.[0];
    if (!letters) return Number.MAX_SAFE_INTEGER;
    return [...letters].reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0);
  }

  private publicGroupLabel(groupName: string) {
    return groupName.endsWith('组') ? groupName : `${groupName}组`;
  }

  private publicGroupsView(registrations: any[]) {
    const groupMap = new Map<string, any[]>();
    for (const registration of registrations) {
      const groupName = String(registration.groupName ?? '').trim();
      if (!groupName) continue;
      const members = groupMap.get(groupName) ?? [];
      members.push(registration);
      groupMap.set(groupName, members);
    }

    return [...groupMap.entries()]
      .sort(([a], [b]) => this.publicGroupNameCompare(a, b))
      .map(([groupName, members]) => ({
        code: groupName,
        label: this.publicGroupLabel(groupName),
        members: members.map((registration, index) => {
          const teamName = registration.teamName?.trim() || null;
          const playerNames = [registration.player1?.name, registration.player2?.name].filter(Boolean) as string[];
          return {
            id: registration.id,
            position: index + 1,
            name: teamName || this.registrationName(registration),
            teamName,
            members: playerNames,
            seed: registration.seedRank,
            isBye: false,
          };
        }),
      }));
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
    const teamName = registration?.teamName?.trim() || null;
    const members = registration
      ? ([registration.player1?.name, registration.player2?.name].filter(Boolean) as string[])
      : [];
    const displayName = registration
      ? teamName || this.registrationName(registration)
      : '待定';
    return {
      id: registrationId,
      position,
      name: displayName,
      teamName,
      members,
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
    const pauseState = this.computePublicPauseState(match.events ?? [], match.finishedAt);
    const matchPaused = pauseState.paused;
    const courtDisplayState = this.computePublicCourtDisplayState(match.events ?? []);
    const forfeit = this.decodeForfeit(match.forfeitReason);

    return {
      id: match.id,
      eventId: match.eventId,
      eventType: match.event.type,
      eventTypeLabel: EVENT_TYPE_LABELS[match.event.type] ?? match.event.type,
      round: match.round,
      roundNo: match.roundNo,
      matchNo: match.matchNo,
      status: match.status,
      statusLabel: matchPaused ? '比赛暂停' : STATUS_LABELS[match.status as MatchStatus],
      scheduledAt: match.scheduledAt?.toISOString?.() ?? null,
      startedAt: match.startedAt?.toISOString?.() ?? null,
      finishedAt: match.finishedAt?.toISOString?.() ?? null,
      matchPaused,
      pausedAt: pauseState.pausedAt?.toISOString?.() ?? null,
      courtDisplayState,
      actualDurationSeconds: this.publicActualDurationSeconds(match.startedAt, match.finishedAt, match.status, pauseState),
      venueName: match.venue?.name ?? '待排场地',
      refereeName: match.referee?.username ?? null,
      side1: this.sideName(match.side1Id, registrationMap),
      side2: this.sideName(match.side2Id, registrationMap),
      score: match.forfeitedSide
        ? forfeit.label
        : currentGame ? `${currentGame.side1Score}:${currentGame.side2Score}` : '0:0',
      games: games.map((game: { gameNo: number; side1Score: number; side2Score: number; winnerSide: number | null }) => ({
        gameNo: game.gameNo,
        score: `${game.side1Score}:${game.side2Score}`,
        winnerSide: game.winnerSide,
      })),
      gamesText: match.forfeitedSide
        ? `${this.sideName(match.forfeitedSide === 1 ? match.side1Id : match.side2Id, registrationMap)} ${forfeit.label}`
        : games.length
        ? games.map((game: { side1Score: number; side2Score: number }) => `${game.side1Score}:${game.side2Score}`).join(' / ')
        : '-',
      winnerSide: match.winnerSide,
      winnerName: match.winnerSide
        ? this.sideName(match.winnerSide === 1 ? match.side1Id : match.side2Id, registrationMap)
        : null,
      forfeitedSide: match.forfeitedSide ?? null,
      forfeitKind: match.forfeitedSide ? forfeit.kind : null,
      forfeitLabel: match.forfeitedSide ? forfeit.label : null,
      forfeitReason: match.forfeitedSide ? forfeit.reason : null,
      updatedAt: match.updatedAt?.toISOString?.() ?? null,
    };
  }

  private eventStandings(event: any, registrationMap: Map<string, any>) {
    if (event.format === Format.SINGLE_ELIMINATION_PLUS_GROUP_RANKING) {
      return this.singleEliminationPlusGroupRankingStandings(event, registrationMap);
    }
    if (event.format === Format.SINGLE_ELIMINATION) {
      return this.singleEliminationStandings(event, registrationMap);
    }
    if (event.format === Format.GROUP_PLUS_PLAYOFF) {
      return this.groupPlusPlayoffStandings(event, registrationMap);
    }
    if (event.format === Format.GROUP_PLUS_KNOCKOUT_STD) {
      return this.groupPlusKnockoutStdStandings(event, registrationMap);
    }
    // ROUND_ROBIN（单组循环）与 GROUP_PLUS_KNOCKOUT 都按组内循环战绩排名。
    return this.groupStageStandings(event, registrationMap);
  }

  /**
   * 标准小组循环+淘汰(GROUP_PLUS_KNOCKOUT_STD)的最终名次：
   * - 淘汰赛尚未生成(仍在小组阶段)时，回退到小组循环战绩排名；
   * - 淘汰赛已生成后：出线选手按淘汰赛成绩排在前(决赛定冠亚军、季军赛定三四名，
   *   其余按被淘汰轮次越晚越靠前)，未出线选手按小组循环战绩接在其后。
   */
  private groupPlusKnockoutStdStandings(
    event: any,
    registrationMap: Map<string, any>,
  ): RankedStandingRow[] {
    const knockoutMatches = (event.matches as any[]).filter((m) => m.roundNo >= 1);
    if (!knockoutMatches.length) {
      return this.groupStageStandings(event, registrationMap);
    }

    const rows = this.baseStandingRows(event);
    const rowMap = new Map<string, StandingRow>(rows.map((row) => [row.id, row]));

    // 累计全部场次(小组循环 + 淘汰赛)的战绩，用于展示与同档并列时的细分。
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

    // 淘汰赛参赛者与被淘汰轮次（轮次越大=越晚被淘汰=名次越前）。
    const knockoutIds = new Set<string>();
    const eliminatedRound = new Map<string, number>();
    for (const m of knockoutMatches) {
      if (m.side1Id) knockoutIds.add(m.side1Id);
      if (m.side2Id) knockoutIds.add(m.side2Id);
      if (m.status === MatchStatus.COMPLETED && m.winnerSide && m.side1Id && m.side2Id) {
        const loserId = m.winnerSide === 1 ? m.side2Id : m.side1Id;
        eliminatedRound.set(loserId, m.roundNo);
      }
    }

    // 决赛定冠亚军、季军赛定三四名。
    const rankMap = new Map<string, number>();
    const finalMatch = knockoutMatches.find(
      (m) => m.round === 'F' && m.status === MatchStatus.COMPLETED && m.winnerSide,
    );
    if (finalMatch) {
      const champ = finalMatch.winnerSide === 1 ? finalMatch.side1Id : finalMatch.side2Id;
      const runner = finalMatch.winnerSide === 1 ? finalMatch.side2Id : finalMatch.side1Id;
      if (champ) rankMap.set(champ, 1);
      if (runner) rankMap.set(runner, 2);
    }
    const bronzeMatch = knockoutMatches.find(
      (m) => m.round === 'BRONZE' && m.status === MatchStatus.COMPLETED && m.winnerSide,
    );
    if (bronzeMatch) {
      const third = bronzeMatch.winnerSide === 1 ? bronzeMatch.side1Id : bronzeMatch.side2Id;
      const fourth = bronzeMatch.winnerSide === 1 ? bronzeMatch.side2Id : bronzeMatch.side1Id;
      if (third) rankMap.set(third, 3);
      if (fourth) rankMap.set(fourth, 4);
    }

    const sorted = [...rows].sort((a, b) => {
      const aIn = knockoutIds.has(a.id);
      const bIn = knockoutIds.has(b.id);
      if (aIn !== bIn) return aIn ? -1 : 1; // 出线(淘汰赛)选手整体排在未出线之前
      if (aIn && bIn) {
        const ra = rankMap.get(a.id) ?? Number.MAX_SAFE_INTEGER;
        const rb = rankMap.get(b.id) ?? Number.MAX_SAFE_INTEGER;
        if (ra !== rb) return ra - rb;
        const ea = eliminatedRound.get(a.id) ?? 0;
        const eb = eliminatedRound.get(b.id) ?? 0;
        if (eb !== ea) return eb - ea;
      }
      return (
        b.wins - a.wins ||
        b.gameDiff - a.gameDiff ||
        a.losses - b.losses ||
        a.name.localeCompare(b.name, 'zh-CN')
      );
    });

    // 决出名次（决赛定冠亚、季军赛定三四）之外的选手不再依次排序，而是并列：
    // 进了淘汰赛但未决出名次的并列同一档（如并列第 5），未出线的再并列到其后一档。
    const fixedRanks = [...rankMap.values()];
    const tiedKnockoutPlace = fixedRanks.length ? Math.max(...fixedRanks) + 1 : 1;
    const tiedKnockoutCount = sorted.filter(
      (row) => knockoutIds.has(row.id) && !rankMap.has(row.id),
    ).length;
    const tiedNonQualifierPlace = tiedKnockoutPlace + tiedKnockoutCount;
    return sorted.map((row) => {
      const fixedRank = rankMap.get(row.id);
      const rank =
        fixedRank ?? (knockoutIds.has(row.id) ? tiedKnockoutPlace : tiedNonQualifierPlace);
      return {
        rank,
        ...row,
        displayName: registrationMap.has(row.id) ? row.name : row.name,
      };
    });
  }

  private singleEliminationPlusGroupRankingStandings(
    event: any,
    registrationMap: Map<string, any>,
  ): RankedStandingRow[] {
    const secondStage = event.secondStage;
    if (!secondStage) return this.singleEliminationStandings(event, registrationMap);

    const rows = this.baseStandingRows(event);
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

    const rankLimit = secondStage.rankingMode === 'TOP_6' ? 6 : 8;
    const slotIds = new Set(
      (secondStage.slots ?? [])
        .map((slot: any) => slot.entrantId)
        .filter((id: string | null | undefined): id is string => Boolean(id)),
    );
    const rankMap = new Map<string, number>();
    for (const ranking of secondStage.rankings ?? []) {
      if (ranking.entrantId && ranking.rank <= rankLimit) {
        rankMap.set(ranking.entrantId, ranking.rank);
      }
    }

    const eligibleRows = rows.filter((row) => !slotIds.size || slotIds.has(row.id));
    const usedRanks = new Set(rankMap.values());
    let fallbackRank = 1;
    const nextFallbackRank = () => {
      while (usedRanks.has(fallbackRank) && fallbackRank <= rankLimit) fallbackRank += 1;
      const rank = fallbackRank;
      usedRanks.add(rank);
      fallbackRank += 1;
      return rank;
    };

    return eligibleRows
      .sort((a, b) => {
        const rankA = rankMap.get(a.id) ?? Number.MAX_SAFE_INTEGER;
        const rankB = rankMap.get(b.id) ?? Number.MAX_SAFE_INTEGER;
        return (
          rankA - rankB ||
          b.wins - a.wins ||
          b.gameDiff - a.gameDiff ||
          a.losses - b.losses ||
          a.name.localeCompare(b.name, 'zh-CN')
        );
      })
      .map((row) => {
        const rank = rankMap.get(row.id) ?? nextFallbackRank();
        return {
          rank,
          ...row,
          displayName: registrationMap.has(row.id) ? row.name : row.name,
        };
      })
      .filter((row) => row.rank <= rankLimit)
      .sort((a, b) => a.rank - b.rank);
  }

  /**
   * 小组循环 + 交叉排位赛的最终名次：
   * 每场排位赛 P{2k-1}（matchNo = k）决出第 (2k-1) 名（胜者）与第 2k 名（负者）；
   * 排位赛尚未打完时，未定名次的选手按小组赛战绩接在已定名次之后展示。
   */
  private groupPlusPlayoffStandings(event: any, registrationMap: Map<string, any>): RankedStandingRow[] {
    const rows = this.baseStandingRows(event);
    const rowMap = new Map<string, StandingRow>(rows.map((row) => [row.id, row]));

    // 个人战绩（含小组赛与排位赛的真实对局）用于表格展示；轮空场不计入。
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

    const rankMap = new Map<string, number>();
    for (const match of event.matches) {
      if (match.roundNo !== 1 || !String(match.round ?? '').startsWith('P')) continue;
      if (match.status !== MatchStatus.COMPLETED || !match.winnerSide) continue;
      const hi = match.matchNo * 2 - 1;
      const winnerId = match.winnerSide === 1 ? match.side1Id : match.side2Id;
      const loserId = match.winnerSide === 1 ? match.side2Id : match.side1Id;
      if (winnerId) rankMap.set(winnerId, hi);
      if (loserId) rankMap.set(loserId, hi + 1);
    }

    const ranked = [...rows].sort((a, b) => {
      const rankA = rankMap.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const rankB = rankMap.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      return (
        rankA - rankB ||
        b.wins - a.wins ||
        b.gameDiff - a.gameDiff ||
        a.losses - b.losses ||
        a.name.localeCompare(b.name, 'zh-CN')
      );
    });

    const fixedRanks = [...rankMap.values()];
    let fallbackRank = fixedRanks.length ? Math.max(...fixedRanks) + 1 : 1;
    return ranked.map((row) => {
      const fixedRank = rankMap.get(row.id);
      const rank = fixedRank ?? fallbackRank++;
      return {
        rank,
        ...row,
        displayName: registrationMap.has(row.id) ? row.name : row.name,
      };
    });
  }

  private baseStandingRows(event: any) {
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
    return rows;
  }

  private groupStageStandings(event: any, registrationMap: Map<string, any>) {
    const rows = this.baseStandingRows(event);
    const rowMap = new Map<string, StandingRow>(rows.map((row) => [row.id, row]));

    for (const match of event.matches.filter((item: any) => item.roundNo === 0)) {
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

  private singleEliminationStandings(event: any, registrationMap: Map<string, any>): RankedStandingRow[] {
    const rows = this.baseStandingRows(event);
    const rowMap = new Map<string, StandingRow>(rows.map((row) => [row.id, row]));
    const rankMap = new Map<string, number>();
    const eliminatedRound = new Map<string, number>();

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
        eliminatedRound.set(side2.id, match.roundNo);
      } else {
        side2.wins += 1;
        side1.losses += 1;
        eliminatedRound.set(side1.id, match.roundNo);
      }
      for (const game of match.games ?? []) {
        side1.gameDiff += game.side1Score - game.side2Score;
        side2.gameDiff += game.side2Score - game.side1Score;
      }
    }

    const finalMatch = event.matches.find(
      (match: any) => match.round === 'F' && match.status === MatchStatus.COMPLETED && match.winnerSide,
    );
    if (finalMatch) {
      const championId = finalMatch.winnerSide === 1 ? finalMatch.side1Id : finalMatch.side2Id;
      const runnerUpId = finalMatch.winnerSide === 1 ? finalMatch.side2Id : finalMatch.side1Id;
      if (championId) rankMap.set(championId, 1);
      if (runnerUpId) rankMap.set(runnerUpId, 2);
    }

    const bronzeMatch = event.matches.find(
      (match: any) => match.round === 'BRONZE' && match.status === MatchStatus.COMPLETED && match.winnerSide,
    );
    if (bronzeMatch) {
      const thirdId = bronzeMatch.winnerSide === 1 ? bronzeMatch.side1Id : bronzeMatch.side2Id;
      const fourthId = bronzeMatch.winnerSide === 1 ? bronzeMatch.side2Id : bronzeMatch.side1Id;
      if (thirdId) rankMap.set(thirdId, 3);
      if (fourthId) rankMap.set(fourthId, 4);
    }

    const ranked = rows
      .sort((a, b) => {
        const rankA = rankMap.get(a.id) ?? Number.MAX_SAFE_INTEGER;
        const rankB = rankMap.get(b.id) ?? Number.MAX_SAFE_INTEGER;
        return (
          rankA - rankB ||
          (eliminatedRound.get(b.id) ?? 0) - (eliminatedRound.get(a.id) ?? 0) ||
          b.wins - a.wins ||
          a.losses - b.losses ||
          a.name.localeCompare(b.name, 'zh-CN')
        );
      });

    const fixedRanks = [...rankMap.values()];
    let fallbackRank = fixedRanks.length ? Math.max(...fixedRanks) + 1 : 1;
    return ranked.map((row) => {
      const fixedRank = rankMap.get(row.id);
      const rank = fixedRank ?? fallbackRank++;
      return {
        rank,
        ...row,
        displayName: registrationMap.has(row.id) ? row.name : row.name,
      };
    });
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

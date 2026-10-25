import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MatchStatus, Prisma, Role } from '@prisma/client';
import { isSecondStageFormalRoundNo } from '../common/second-stage-bracket';
import { PrismaService } from '../prisma/prisma.service';
import { SchedulingService } from '../scheduling/scheduling.service';
import { ScoringGateway } from '../scoring/scoring.gateway';
import { MatchSideView, ScoringService } from '../scoring/scoring.service';
import { UpdateManagedMatchDto } from './dto/match-management.dto';

const EVENT_TYPE_LABELS: Record<string, string> = {
  MENS_SINGLES: '男子单打',
  WOMENS_SINGLES: '女子单打',
  MENS_DOUBLES: '男子双打',
  WOMENS_DOUBLES: '女子双打',
  MIXED_DOUBLES: '混合双打',
  TEAM_COMPETITION: '团体赛',
};

const EVENT_TYPE_ORDER = [
  'MENS_SINGLES',
  'WOMENS_SINGLES',
  'MENS_DOUBLES',
  'WOMENS_DOUBLES',
  'MIXED_DOUBLES',
];

const FORMAT_LABELS: Record<string, string> = {
  SINGLE_ELIMINATION: '单淘汰赛',
  GROUP_PLUS_KNOCKOUT: '小组循环 + 淘汰赛',
  GROUP_PLUS_KNOCKOUT_STD: '小组循环 + 淘汰赛（标准）',
  ROUND_ROBIN: '单循环排名赛',
  GROUP_PLUS_PLAYOFF: '小组循环 + 交叉排位',
  SINGLE_ELIMINATION_PLUS_GROUP_RANKING: '单淘汰 + 小组排位赛',
};

const TEAM_FORMAT_LABELS: Record<string, string> = {
  SINGLE_ELIMINATION: '单淘汰赛',
  ROUND_ROBIN: '单组循环赛',
  GROUP_ROUND_ROBIN: '多组循环赛',
  GROUP_PLUS_KNOCKOUT: '小组循环 + 淘汰赛',
};

type VenueView = {
  id: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
};

export type MatchGameView = {
  gameNo: number;
  side1Score: number;
  side2Score: number;
  winnerSide: number | null;
};

export type MatchView = {
  id: string;
  eventId: string | null;
  teamMatchId: string | null;
  teamCompetitionId: string | null;
  eventType: string;
  eventTypeLabel: string;
  itemTypeLabel: string | null;
  round: string;
  roundNo: number;
  matchNo: number;
  stageKey: string;
  stageLabel: string;
  stageOrder: number;
  scheduledAt: string | null;
  durationMinutes: number;
  status: MatchStatus;
  winnerSide: number | null;
  forfeitedSide: number | null;
  forfeitReason: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  venue: VenueView | null;
  referee: { id: string; username: string } | null;
  side1: MatchSideView | null;
  side2: MatchSideView | null;
  team1Name: string | null;
  team2Name: string | null;
  team1Wins: number | null;
  team2Wins: number | null;
  teamMatchStatus: MatchStatus | null;
  games: MatchGameView[];
  scoreText: string;
  hasBothSides: boolean;
  isSecondStage: boolean;
};

const matchInclude = {
  games: { orderBy: { gameNo: 'asc' } },
  venue: { select: { id: true, name: true, isActive: true, sortOrder: true } },
  referee: { select: { id: true, username: true } },
  event: { select: { id: true, type: true, format: true } },
  teamCompetitionItem: {
    select: { id: true, eventType: true, sortOrder: true },
  },
  teamMatch: {
    select: {
      id: true,
      teamCompetitionId: true,
      round: true,
      roundNo: true,
      matchNo: true,
      status: true,
      team1Wins: true,
      team2Wins: true,
      winnerTeamId: true,
      team1: { select: { id: true, name: true } },
      team2: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.MatchInclude;

type MatchWithRelations = Prisma.MatchGetPayload<{
  include: typeof matchInclude;
}>;

function roundLabel(round: string) {
  const value = round?.trim();
  if (!value) return '—';
  const fixed: Record<string, string> = {
    F: '决赛',
    SF: '半决赛',
    QF: '1/4 决赛',
    R1: '1/8 决赛',
    R2: '1/16 决赛',
    R3: '1/32 决赛',
    BRONZE: '季军赛',
  };
  if (fixed[value]) return fixed[value];
  const knockout = /^R(\d+)$/.exec(value);
  if (knockout) {
    const slots = Number(knockout[1]);
    return slots >= 4 ? `1/${slots / 2} 决赛` : value;
  }
  return value;
}

@Injectable()
export class MatchManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scoring: ScoringService,
    private readonly scheduling: SchedulingService,
    private readonly gateway: ScoringGateway,
  ) {}

  async getOverview(tournamentId: string) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: {
        id: true,
        name: true,
        edition: true,
        subtitle: true,
        status: true,
        location: true,
        startDate: true,
        endDate: true,
        isPublished: true,
        isArchived: true,
        approvalStatus: true,
      },
    });
    if (!tournament) throw new NotFoundException('赛事不存在');

    const [events, teamCompetitions, teamMatches, venues, referees, matches] =
      await Promise.all([
        this.prisma.event.findMany({
          where: { tournamentId },
          select: {
            id: true,
            type: true,
            format: true,
            scoringRule: true,
            scoringMode: true,
            customGamesToWin: true,
            groupCount: true,
            qualifiersPerGroup: true,
            drawPublished: true,
            _count: { select: { matches: true, registrations: true } },
          },
          orderBy: { createdAt: 'asc' },
        }),
        this.prisma.teamCompetition.findMany({
          where: { tournamentId },
          select: {
            id: true,
            name: true,
            format: true,
            winThreshold: true,
            scoringRule: true,
            scoringMode: true,
            customGamesToWin: true,
            isPublished: true,
            items: {
              select: { id: true, eventType: true, sortOrder: true },
              orderBy: { sortOrder: 'asc' },
            },
            teams: {
              select: { id: true, name: true },
              orderBy: { createdAt: 'asc' },
            },
          },
          orderBy: { createdAt: 'asc' },
        }),
        this.prisma.teamMatch.findMany({
          where: { teamCompetition: { tournamentId } },
          select: {
            id: true,
            teamCompetitionId: true,
            round: true,
            roundNo: true,
            matchNo: true,
            stage: true,
            status: true,
            team1Wins: true,
            team2Wins: true,
            winnerTeamId: true,
            team1: { select: { id: true, name: true } },
            team2: { select: { id: true, name: true } },
            group: { select: { id: true, groupName: true } },
          },
          orderBy: [{ roundNo: 'asc' }, { matchNo: 'asc' }],
        }),
        this.prisma.venue.findMany({
          where: { tournamentId },
          select: { id: true, name: true, isActive: true, sortOrder: true },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        }),
        this.prisma.user.findMany({
          where: { role: Role.REFEREE, status: 'ACTIVE' },
          select: {
            id: true,
            username: true,
            _count: { select: { matches: true } },
          },
          orderBy: { username: 'asc' },
        }),
        this.prisma.match.findMany({
          where: {
            OR: [
              { event: { tournamentId } },
              { teamMatch: { teamCompetition: { tournamentId } } },
            ],
          },
          include: matchInclude,
          orderBy: [
            { scheduledAt: 'asc' },
            { roundNo: 'asc' },
            { matchNo: 'asc' },
          ],
        }),
      ]);

    const sideViews = await this.scoring.resolveSideViews(
      matches.flatMap((match) => [match.side1Id, match.side2Id]),
    );
    const matchViews = matches.map((match) =>
      this.toMatchView(match, sideViews),
    );

    const matchIdsByTeamMatch = new Map<string, string[]>();
    for (const match of matchViews) {
      if (!match.teamMatchId) continue;
      const ids = matchIdsByTeamMatch.get(match.teamMatchId) ?? [];
      ids.push(match.id);
      matchIdsByTeamMatch.set(match.teamMatchId, ids);
    }

    const eventSummaries = [...events]
      .sort((a, b) => {
        const ai = EVENT_TYPE_ORDER.indexOf(a.type);
        const bi = EVENT_TYPE_ORDER.indexOf(b.type);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      })
      .map((event) => {
        const eventMatches = matchViews.filter(
          (match) => match.eventId === event.id,
        );
        return {
          id: event.id,
          type: event.type,
          typeLabel: EVENT_TYPE_LABELS[event.type] ?? event.type,
          format: event.format,
          formatLabel: FORMAT_LABELS[event.format] ?? event.format,
          scoringRule: event.scoringRule,
          scoringMode: event.scoringMode,
          customGamesToWin: event.customGamesToWin,
          groupCount: event.groupCount,
          qualifiersPerGroup: event.qualifiersPerGroup,
          drawPublished: event.drawPublished,
          registrationCount: event._count.registrations,
          matchCount: eventMatches.length,
          completedCount: eventMatches.filter(
            (match) => match.status === MatchStatus.COMPLETED,
          ).length,
        };
      });

    const teamCompetitionSummaries = teamCompetitions.map((competition) => {
      const competitionMatches = matchViews.filter(
        (match) => match.teamCompetitionId === competition.id,
      );
      const competitionTeamMatches = teamMatches
        .filter((teamMatch) => teamMatch.teamCompetitionId === competition.id)
        .map((teamMatch) => ({
          id: teamMatch.id,
          teamCompetitionId: teamMatch.teamCompetitionId,
          round: teamMatch.round,
          roundNo: teamMatch.roundNo,
          matchNo: teamMatch.matchNo,
          stage: teamMatch.stage,
          status: teamMatch.status,
          team1Wins: teamMatch.team1Wins,
          team2Wins: teamMatch.team2Wins,
          winnerTeamId: teamMatch.winnerTeamId,
          team1: teamMatch.team1,
          team2: teamMatch.team2,
          groupName: teamMatch.group?.groupName ?? null,
          matchIds: matchIdsByTeamMatch.get(teamMatch.id) ?? [],
        }));
      return {
        id: competition.id,
        name: competition.name,
        format: competition.format,
        formatLabel:
          TEAM_FORMAT_LABELS[competition.format] ?? competition.format,
        winThreshold: competition.winThreshold,
        scoringRule: competition.scoringRule,
        scoringMode: competition.scoringMode,
        customGamesToWin: competition.customGamesToWin,
        isPublished: competition.isPublished,
        items: competition.items.map((item) => ({
          id: item.id,
          eventType: item.eventType,
          eventTypeLabel: EVENT_TYPE_LABELS[item.eventType] ?? item.eventType,
          sortOrder: item.sortOrder,
        })),
        teams: competition.teams,
        matchCount: competitionMatches.length,
        completedCount: competitionMatches.filter(
          (match) => match.status === MatchStatus.COMPLETED,
        ).length,
        teamMatches: competitionTeamMatches,
      };
    });

    const summary = {
      total: matchViews.length,
      completed: matchViews.filter(
        (match) => match.status === MatchStatus.COMPLETED,
      ).length,
      live: matchViews.filter((match) => match.status === MatchStatus.LIVE)
        .length,
      pending: matchViews.filter(
        (match) => match.status === MatchStatus.PENDING,
      ).length,
      cancelled: matchViews.filter(
        (match) => match.status === MatchStatus.CANCELLED,
      ).length,
      unscheduled: matchViews.filter(
        (match) => match.status === MatchStatus.PENDING && !match.scheduledAt,
      ).length,
    };

    return {
      tournament: {
        ...tournament,
        startDate: tournament.startDate.toISOString(),
        endDate: tournament.endDate.toISOString(),
      },
      events: eventSummaries,
      teamCompetitions: teamCompetitionSummaries,
      matches: matchViews,
      venues,
      referees: referees.map(({ _count, ...referee }) => ({
        ...referee,
        refereedMatchesCount: _count.matches,
      })),
      summary,
    };
  }

  async updateMatch(matchId: string, dto: UpdateManagedMatchDto) {
    const target = await this.requireMatchRef(matchId);
    const hasScheduleChange =
      dto.scheduledAt !== undefined ||
      dto.venueId !== undefined ||
      dto.durationMinutes !== undefined;

    if (hasScheduleChange) {
      await this.scheduling.updateMatchSchedule(matchId, {
        ...(dto.scheduledAt !== undefined
          ? { scheduledAt: dto.scheduledAt }
          : {}),
        ...(dto.venueId !== undefined ? { venueId: dto.venueId } : {}),
        ...(dto.durationMinutes !== undefined
          ? { durationMinutes: dto.durationMinutes }
          : {}),
      });
    }

    if (dto.refereeId !== undefined) {
      if (dto.refereeId) {
        await this.scoring.assignReferee(matchId, dto.refereeId);
      } else {
        await this.prisma.match.update({
          where: { id: matchId },
          data: { refereeId: null },
        });
      }
    }

    this.emitUpdate(target);
    return { ok: true };
  }

  async correctScore(
    matchId: string,
    games: Array<{ side1Score: number; side2Score: number }>,
  ) {
    const target = await this.requireMatchRef(matchId);
    const state = await this.scoring.correctMatchScore(matchId, games);
    this.emitUpdate(target);
    return state;
  }

  async completeMatch(matchId: string) {
    const target = await this.requireMatchRef(matchId);
    const state = await this.scoring.completeMatchForAdmin(matchId);
    this.emitUpdate(target);
    return state;
  }

  async reopenMatch(matchId: string) {
    const target = await this.requireMatchRef(matchId);
    const state = await this.scoring.reopenMatchForAdmin(matchId);
    this.emitUpdate(target);
    return state;
  }

  private emitUpdate(target: {
    tournamentId: string;
    eventId: string | null;
    id: string;
  }) {
    this.gateway.emitBracketUpdate({
      tournamentId: target.tournamentId,
      eventId: target.eventId,
      matchId: target.id,
    });
  }

  private async requireMatchRef(matchId: string) {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: {
        id: true,
        eventId: true,
        event: { select: { tournamentId: true } },
        teamMatch: {
          select: { teamCompetition: { select: { tournamentId: true } } },
        },
      },
    });
    if (!match) throw new NotFoundException('场次不存在');
    const tournamentId =
      match.event?.tournamentId ??
      match.teamMatch?.teamCompetition.tournamentId ??
      null;
    if (!tournamentId) throw new BadRequestException('场次未关联赛事');
    return { id: match.id, eventId: match.eventId, tournamentId };
  }

  private toMatchView(
    match: MatchWithRelations,
    sideViews: Map<string, MatchSideView>,
  ): MatchView {
    const eventType =
      match.event?.type ??
      match.teamCompetitionItem?.eventType ??
      'TEAM_COMPETITION';
    const teamMatch = match.teamMatch;
    const side1 = match.side1Id ? (sideViews.get(match.side1Id) ?? null) : null;
    const side2 = match.side2Id ? (sideViews.get(match.side2Id) ?? null) : null;
    const isSecondStage = Boolean(
      match.eventId && isSecondStageFormalRoundNo(match.roundNo),
    );
    const stageKey = teamMatch
      ? `T:${teamMatch.roundNo}:${teamMatch.round}`
      : match.roundNo === 0
        ? `G:${match.round}`
        : isSecondStage
          ? `S:${match.roundNo}:${match.round}`
          : `R:${match.roundNo}`;
    const stageLabel = teamMatch
      ? roundLabel(teamMatch.round)
      : match.roundNo === 0
        ? match.round.endsWith('组')
          ? match.round
          : `${match.round}组`
        : isSecondStage
          ? `第二阶段 · ${roundLabel(match.round)}`
          : roundLabel(match.round);

    return {
      id: match.id,
      eventId: match.eventId,
      teamMatchId: match.teamMatchId,
      teamCompetitionId: teamMatch?.teamCompetitionId ?? null,
      eventType,
      eventTypeLabel: EVENT_TYPE_LABELS[eventType] ?? eventType,
      itemTypeLabel: match.teamCompetitionItem
        ? (EVENT_TYPE_LABELS[match.teamCompetitionItem.eventType] ??
          match.teamCompetitionItem.eventType)
        : null,
      round: match.round,
      roundNo: match.roundNo,
      matchNo: match.matchNo,
      stageKey,
      stageLabel,
      stageOrder: teamMatch ? teamMatch.roundNo : match.roundNo,
      scheduledAt: match.scheduledAt?.toISOString() ?? null,
      durationMinutes: match.durationMinutes,
      status: match.status,
      winnerSide: match.winnerSide,
      forfeitedSide: match.forfeitedSide,
      forfeitReason: match.forfeitReason,
      startedAt: match.startedAt?.toISOString() ?? null,
      finishedAt: match.finishedAt?.toISOString() ?? null,
      venue: match.venue,
      referee: match.referee,
      side1,
      side2,
      team1Name: teamMatch?.team1?.name ?? null,
      team2Name: teamMatch?.team2?.name ?? null,
      team1Wins: teamMatch?.team1Wins ?? null,
      team2Wins: teamMatch?.team2Wins ?? null,
      teamMatchStatus: teamMatch?.status ?? null,
      games: match.games.map((game) => ({
        gameNo: game.gameNo,
        side1Score: game.side1Score,
        side2Score: game.side2Score,
        winnerSide: game.winnerSide,
      })),
      scoreText: match.games
        .map((game) => `${game.side1Score}:${game.side2Score}`)
        .join(' / '),
      hasBothSides: Boolean(match.side1Id && match.side2Id),
      isSecondStage,
    };
  }
}

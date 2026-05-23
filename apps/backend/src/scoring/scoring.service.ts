import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MatchEventType,
  MatchStatus,
  Prisma,
  Role,
  ScoringMode,
  ScoringRule,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TeamCompetitionsService } from '../team-competitions/team-competitions.service';

type AuthUser = {
  id: string;
  role: Role;
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  MENS_SINGLES: '男子单打',
  WOMENS_SINGLES: '女子单打',
  MENS_DOUBLES: '男子双打',
  WOMENS_DOUBLES: '女子双打',
  MIXED_DOUBLES: '混合双打',
};

@Injectable()
export class ScoringService {
  constructor(
    private prisma: PrismaService,
    private teamCompetitionsService: TeamCompetitionsService,
  ) {}

  async listRefereeMatches(user: AuthUser) {
    const matches = await this.prisma.match.findMany({
      where: { refereeId: user.id },
      include: {
        event: { include: { tournament: true } },
        teamCompetitionItem: true,
        teamMatch: {
          include: {
            teamCompetition: { include: { tournament: true } },
          },
        },
        venue: true,
        games: { orderBy: { gameNo: 'asc' } },
      },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    });

    return Promise.all(matches.map((match) => this.hydrateMatchSummary(match)));
  }

  async getMatchState(matchId: string, user?: AuthUser) {
    if (user) await this.ensureMatchAccess(matchId, user);
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      include: {
        event: { include: { tournament: true } },
        teamCompetitionItem: true,
        teamMatch: {
          include: {
            teamCompetition: { include: { tournament: true } },
          },
        },
        venue: true,
        referee: { select: { id: true, username: true, role: true } },
        games: { orderBy: { gameNo: 'asc' } },
        events: { orderBy: { createdAt: 'desc' }, take: 14 },
      },
    });
    if (!match) throw new NotFoundException('场次不存在');

    const sideMap = await this.resolveSideMap([match.side1Id, match.side2Id]);
    const side1 = match.side1Id ? sideMap.get(match.side1Id) ?? null : null;
    const side2 = match.side2Id ? sideMap.get(match.side2Id) ?? null : null;
    const side1Games = match.games.filter((game) => game.winnerSide === 1).length;
    const side2Games = match.games.filter((game) => game.winnerSide === 2).length;
    const eventType = match.event?.type ?? match.teamCompetitionItem?.eventType ?? 'TEAM_COMPETITION';
    const scoringRule = match.event?.scoringRule ?? ScoringRule.TWENTYONE_BO3;
    const scoringMode = match.event?.scoringMode ?? ScoringMode.CAPPED_30;
    const tournament = match.event?.tournament ?? match.teamMatch?.teamCompetition.tournament;

    return {
      id: match.id,
      status: match.status,
      winnerSide: match.winnerSide,
      forfeitedSide: match.forfeitedSide,
      forfeitReason: match.forfeitReason,
      round: match.round,
      roundNo: match.roundNo,
      matchNo: match.matchNo,
      event: {
        id: match.event?.id ?? match.teamCompetitionItem?.id ?? match.id,
        type: eventType,
        typeLabel: EVENT_TYPE_LABELS[eventType] ?? '团体赛',
        scoringRule,
        scoringMode,
        tournament: tournament
          ? {
              id: tournament.id,
              name: tournament.name,
              edition: tournament.edition,
            }
          : null,
      },
      referee: match.referee,
      venue: match.venue ? { id: match.venue.id, name: match.venue.name } : null,
      scheduledAt: match.scheduledAt,
      durationMinutes: match.durationMinutes,
      side1: side1 ? this.registrationView(side1) : null,
      side2: side2 ? this.registrationView(side2) : null,
      side1Games,
      side2Games,
      games: match.games,
      currentGame: match.games.find((game) => !game.winnerSide) ?? match.games.at(-1) ?? null,
      events: match.events,
      updatedAt: match.updatedAt,
    };
  }

  async startMatch(matchId: string, user: AuthUser) {
    await this.ensureMatchAccess(matchId, user);
    const match = await this.ensurePlayableMatch(matchId);
    if (match.status === MatchStatus.COMPLETED || match.status === MatchStatus.CANCELLED) {
      throw new BadRequestException('已结束的场次不能重新开始');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.game.upsert({
        where: { matchId_gameNo: { matchId, gameNo: 1 } },
        update: {},
        create: { matchId, gameNo: 1 },
      });
      await tx.match.update({
        where: { id: matchId },
        data: { status: MatchStatus.LIVE },
      });
    });

    return this.getMatchState(matchId, user);
  }

  async addPoint(matchId: string, side: 1 | 2, user: AuthUser) {
    await this.ensureMatchAccess(matchId, user);
    const match = await this.ensurePlayableMatch(matchId);
    if (match.status === MatchStatus.COMPLETED || match.status === MatchStatus.CANCELLED) {
      throw new BadRequestException('场次已结束，不能继续记分');
    }

    await this.prisma.$transaction(async (tx) => {
      const currentGame = await this.ensureCurrentGame(tx, matchId);
      const updatedGame = await tx.game.update({
        where: { id: currentGame.id },
        data:
          side === 1
            ? { side1Score: { increment: 1 } }
            : { side2Score: { increment: 1 } },
      });
      let game = updatedGame;
      const gameWinner = this.resolveGameWinner(
        game.side1Score,
        game.side2Score,
        match.event?.scoringRule ?? ScoringRule.TWENTYONE_BO3,
        match.event?.scoringMode ?? ScoringMode.CAPPED_30,
      );

      if (gameWinner) {
        game = await tx.game.update({
          where: { id: game.id },
          data: { winnerSide: gameWinner, completedAt: new Date() },
        });
      }

      await tx.matchEvent.create({
        data: {
          matchId,
          type: MatchEventType.POINT,
          side,
          gameNo: game.gameNo,
          side1Score: game.side1Score,
          side2Score: game.side2Score,
        },
      });

      const games = await tx.game.findMany({ where: { matchId }, orderBy: { gameNo: 'asc' } });
      const matchWinner = this.resolveMatchWinner(
        games,
        match.event?.scoringRule ?? ScoringRule.TWENTYONE_BO3,
      );
      if (matchWinner) {
        await tx.match.update({
          where: { id: matchId },
          data: { status: MatchStatus.COMPLETED, winnerSide: matchWinner },
        });
        await this.advanceSingleEliminationWinner(tx, match, matchWinner);
        await this.teamCompetitionsService.updateTeamMatchAggregate(tx, matchId);
        return;
      }

      await tx.match.update({
        where: { id: matchId },
        data: { status: MatchStatus.LIVE, winnerSide: null },
      });
      await this.teamCompetitionsService.updateTeamMatchAggregate(tx, matchId);

      if (gameWinner) {
        await tx.game.upsert({
          where: { matchId_gameNo: { matchId, gameNo: game.gameNo + 1 } },
          update: {},
          create: { matchId, gameNo: game.gameNo + 1 },
        });
      }
    });

    return this.getMatchState(matchId, user);
  }

  async undoLastPoint(matchId: string, user: AuthUser) {
    await this.ensureMatchAccess(matchId, user);
    await this.prisma.$transaction(async (tx) => {
      const lastPoint = await tx.matchEvent.findFirst({
        where: { matchId, type: MatchEventType.POINT, undoneAt: null },
        orderBy: { createdAt: 'desc' },
      });
      if (!lastPoint?.gameNo || !lastPoint.side) {
        throw new BadRequestException('暂无可撤销的得分');
      }

      await tx.game.deleteMany({
        where: {
          matchId,
          gameNo: { gt: lastPoint.gameNo },
          side1Score: 0,
          side2Score: 0,
        },
      });

      const game = await tx.game.findUnique({
        where: { matchId_gameNo: { matchId, gameNo: lastPoint.gameNo } },
      });
      if (!game) throw new NotFoundException('比分局不存在');

      const nextSide1Score = Math.max(0, game.side1Score - (lastPoint.side === 1 ? 1 : 0));
      const nextSide2Score = Math.max(0, game.side2Score - (lastPoint.side === 2 ? 1 : 0));

      const updatedGame = await tx.game.update({
        where: { id: game.id },
        data: {
          side1Score: nextSide1Score,
          side2Score: nextSide2Score,
          winnerSide: null,
          completedAt: null,
        },
      });

      await tx.match.update({
        where: { id: matchId },
        data: { status: MatchStatus.LIVE, winnerSide: null },
      });
      await this.teamCompetitionsService.updateTeamMatchAggregate(tx, matchId);
      await tx.matchEvent.update({
        where: { id: lastPoint.id },
        data: { undoneAt: new Date() },
      });
      await tx.matchEvent.create({
        data: {
          matchId,
          type: MatchEventType.UNDO,
          side: lastPoint.side,
          gameNo: updatedGame.gameNo,
          side1Score: updatedGame.side1Score,
          side2Score: updatedGame.side2Score,
        },
      });
    });

    return this.getMatchState(matchId, user);
  }

  async logMatchEvent(
    matchId: string,
    type: Exclude<MatchEventType, 'POINT' | 'UNDO'>,
    user: AuthUser,
    side?: 1 | 2,
    note?: string,
  ) {
    await this.ensureMatchAccess(matchId, user);
    await this.ensurePlayableMatch(matchId);
    await this.prisma.matchEvent.create({
      data: { matchId, type, side, note },
    });
    return this.getMatchState(matchId, user);
  }

  async forfeitMatch(matchId: string, forfeitedSide: 1 | 2, user: AuthUser, reason?: string) {
    await this.ensureMatchAccess(matchId, user);
    const match = await this.ensurePlayableMatch(matchId);
    if (match.status === MatchStatus.COMPLETED || match.status === MatchStatus.CANCELLED) {
      throw new BadRequestException('场次已结束,无法再判定弃权');
    }

    const winnerSide: 1 | 2 = forfeitedSide === 1 ? 2 : 1;

    await this.prisma.$transaction(async (tx) => {
      await tx.match.update({
        where: { id: matchId },
        data: {
          status: MatchStatus.COMPLETED,
          winnerSide,
          forfeitedSide,
          forfeitReason: reason?.trim() || '选手未到场弃权',
        },
      });

      await tx.matchEvent.create({
        data: {
          matchId,
          type: MatchEventType.FORFEIT,
          side: forfeitedSide,
          note: reason?.trim() || '选手未到场弃权',
        },
      });

      await this.advanceSingleEliminationWinner(tx, match, winnerSide);
      await this.teamCompetitionsService.updateTeamMatchAggregate(tx, matchId);
    });

    return this.getMatchState(matchId, user);
  }

  async forfeitBothSides(matchId: string, user: AuthUser, reason?: string) {
    await this.ensureMatchAccess(matchId, user);
    const match = await this.ensurePlayableMatch(matchId);
    if (match.status === MatchStatus.COMPLETED || match.status === MatchStatus.CANCELLED) {
      throw new BadRequestException('场次已结束,无法再判定弃权');
    }

    await this.prisma.$transaction(async (tx) => {
      // Mark this match as cancelled. forfeitedSide = 0 sentinel = "both sides forfeited"
      await tx.match.update({
        where: { id: matchId },
        data: {
          status: MatchStatus.CANCELLED,
          winnerSide: null,
          forfeitedSide: 0,
          forfeitReason: reason?.trim() || '双方均未到场,本场作废',
        },
      });

      await tx.matchEvent.create({
        data: {
          matchId,
          type: MatchEventType.FORFEIT,
          side: null,
          note: reason?.trim() || '双方均弃权,本场作废',
        },
      });

      // Propagate the "bye" to the next round: clear the corresponding slot
      // on the next match so the bracket renders it as a 轮空.
      if (match.eventId) {
        const nextMatch = await tx.match.findFirst({
          where: {
            eventId: match.eventId,
            roundNo: match.roundNo + 1,
            matchNo: Math.ceil(match.matchNo / 2),
          },
        });
        if (nextMatch) {
          const targetSide = match.matchNo % 2 === 1 ? 'side1Id' : 'side2Id';
          await tx.match.update({
            where: { id: nextMatch.id },
            data: { [targetSide]: null },
          });
        }
      }

      await this.teamCompetitionsService.updateTeamMatchAggregate(tx, matchId);
    });

    return this.getMatchState(matchId, user);
  }

  async assignReferee(matchId: string, refereeId: string) {
    const referee = await this.prisma.user.findUnique({ where: { id: refereeId } });
    if (!referee || referee.role !== Role.REFEREE) {
      throw new BadRequestException('请选择有效的裁判账号');
    }
    const match = await this.prisma.match.update({
      where: { id: matchId },
      data: { refereeId },
      select: { id: true },
    });
    return this.getMatchState(match.id);
  }

  private async ensureMatchAccess(matchId: string, user: AuthUser) {
    const match = await this.prisma.match.findUnique({ where: { id: matchId } });
    if (!match) throw new NotFoundException('场次不存在');
    if (user.role === Role.REFEREE && match.refereeId !== user.id) {
      throw new ForbiddenException('无权操作未分配给你的场次');
    }
  }

  private async ensurePlayableMatch(matchId: string) {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      include: { event: true, teamCompetitionItem: true },
    });
    if (!match) throw new NotFoundException('场次不存在');
    if (!match.side1Id || !match.side2Id) throw new BadRequestException('轮空场次不需要记分');
    return match;
  }

  private async ensureCurrentGame(tx: Prisma.TransactionClient, matchId: string) {
    const current = await tx.game.findFirst({
      where: { matchId, winnerSide: null },
      orderBy: { gameNo: 'asc' },
    });
    if (current) return current;

    const last = await tx.game.findFirst({
      where: { matchId },
      orderBy: { gameNo: 'desc' },
    });
    return tx.game.create({
      data: { matchId, gameNo: (last?.gameNo ?? 0) + 1 },
    });
  }

  private resolveGameWinner(
    side1Score: number,
    side2Score: number,
    rule: ScoringRule,
    mode: ScoringMode,
  ) {
    const { target, cap } = this.ruleConfig(rule);
    if (this.sideWinsGame(side1Score, side2Score, target, cap, mode)) return 1;
    if (this.sideWinsGame(side2Score, side1Score, target, cap, mode)) return 2;
    return null;
  }

  private sideWinsGame(
    score: number,
    opponentScore: number,
    target: number,
    cap: number,
    mode: ScoringMode,
  ) {
    if (mode === ScoringMode.STANDARD_GOLDEN) return score >= target;
    return score >= target && (score - opponentScore >= 2 || score >= cap);
  }

  private resolveMatchWinner(
    games: Array<{ winnerSide: number | null }>,
    rule: ScoringRule,
  ) {
    const { gamesToWin } = this.ruleConfig(rule);
    const side1Wins = games.filter((game) => game.winnerSide === 1).length;
    const side2Wins = games.filter((game) => game.winnerSide === 2).length;
    if (side1Wins >= gamesToWin) return 1;
    if (side2Wins >= gamesToWin) return 2;
    return null;
  }

  private async advanceSingleEliminationWinner(
    tx: Prisma.TransactionClient,
    match: {
      eventId: string | null;
      roundNo: number;
      matchNo: number;
      side1Id: string | null;
      side2Id: string | null;
    },
    winnerSide: 1 | 2,
  ) {
    if (!match.eventId || match.roundNo < 1) return;

    const winnerId = winnerSide === 1 ? match.side1Id : match.side2Id;
    if (!winnerId) return;

    const nextMatch = await tx.match.findFirst({
      where: {
        eventId: match.eventId,
        roundNo: match.roundNo + 1,
        matchNo: Math.ceil(match.matchNo / 2),
      },
    });
    if (!nextMatch) return;

    const targetSide = match.matchNo % 2 === 1 ? 'side1Id' : 'side2Id';
    const data: Prisma.MatchUncheckedUpdateInput = {
      [targetSide]: winnerId,
    };
    if (nextMatch.status === MatchStatus.PENDING) {
      data.venueId = null;
      data.scheduledAt = null;
    }

    await tx.match.update({
      where: { id: nextMatch.id },
      data,
    });
  }

  private ruleConfig(rule: ScoringRule) {
    if (rule === ScoringRule.FIFTEEN_ONE) return { target: 15, cap: 20, gamesToWin: 1 };
    if (rule === ScoringRule.FIFTEEN_BO3) return { target: 15, cap: 20, gamesToWin: 2 };
    if (rule === ScoringRule.TWENTYONE_BO3) return { target: 21, cap: 30, gamesToWin: 2 };
    return { target: 31, cap: 31, gamesToWin: 2 };
  }

  private async hydrateMatchSummary(match: {
    id: string;
    status: MatchStatus;
    winnerSide: number | null;
    round: string;
    matchNo: number;
    side1Id: string | null;
    side2Id: string | null;
    event: {
      type: string;
      scoringRule: ScoringRule;
      tournament: { id: string; name: string; edition: number };
    } | null;
    teamCompetitionItem?: { id: string; eventType: string } | null;
    teamMatch?: {
      teamCompetition: {
        tournament: { id: string; name: string; edition: number };
      };
    } | null;
    venue: { id: string; name: string } | null;
    scheduledAt: Date | null;
    durationMinutes: number;
    games: Array<{ side1Score: number; side2Score: number; winnerSide: number | null; gameNo: number }>;
  }) {
    const sideMap = await this.resolveSideMap([match.side1Id, match.side2Id]);
    const side1 = match.side1Id ? sideMap.get(match.side1Id) ?? null : null;
    const side2 = match.side2Id ? sideMap.get(match.side2Id) ?? null : null;
    const eventType = match.event?.type ?? match.teamCompetitionItem?.eventType ?? 'TEAM_COMPETITION';
    const tournament = match.event?.tournament ?? match.teamMatch?.teamCompetition.tournament ?? null;

    return {
      id: match.id,
      status: match.status,
      winnerSide: match.winnerSide,
      round: match.round,
      matchNo: match.matchNo,
      eventType,
      eventTypeLabel: EVENT_TYPE_LABELS[eventType] ?? '团体赛',
      tournament,
      venue: match.venue ? { id: match.venue.id, name: match.venue.name } : null,
      scheduledAt: match.scheduledAt,
      durationMinutes: match.durationMinutes,
      side1: side1 ? this.registrationView(side1) : null,
      side2: side2 ? this.registrationView(side2) : null,
      games: match.games,
    };
  }

  private async resolveSideMap(ids: Array<string | null>) {
    const regularIds = ids.filter((id): id is string => typeof id === 'string' && !id.startsWith('lineup:'));
    const lineupIds = ids.filter((id): id is string => typeof id === 'string' && id.startsWith('lineup:'));
    const regularMap = await this.registrationMap(regularIds);
    const lineupMap = await this.teamCompetitionsService.buildLineupRegistrationMap(lineupIds);
    return new Map<string, any>([...regularMap.entries(), ...lineupMap.entries()]);
  }

  private async registrationMap(ids: string[]) {
    const compactIds = [...new Set(ids)];
    if (!compactIds.length) return new Map<string, any>();
    const registrations = await this.prisma.registration.findMany({
      where: { id: { in: compactIds } },
      include: { player1: true, player2: true },
    });
    return new Map(registrations.map((registration) => [registration.id, registration]));
  }

  private registrationView(registration: any) {
    return {
      id: registration.id,
      name: registration.name ?? (registration.player2
        ? `${registration.player1.name} / ${registration.player2.name}`
        : registration.player1.name),
      affiliation: registration.affiliation ?? (registration.player2
        ? `${registration.player1.affiliation} / ${registration.player2.affiliation}`
        : registration.player1.affiliation),
    };
  }
}

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

type PlayerIndex = 1 | 2;
type CourtSide = 'left' | 'right';

type ServingState = {
  gameNo: number;
  servingSide: 1 | 2 | null;
  serverPlayerIndex: PlayerIndex | null;
  serverCourtSide: CourtSide | null;
  receivingSide: 1 | 2 | null;
  receiverPlayerIndex: PlayerIndex | null;
  receiverCourtSide: CourtSide | null;
  side1Positions: Record<CourtSide, PlayerIndex | null>;
  side2Positions: Record<CourtSide, PlayerIndex | null>;
};

type StartMatchOptions = {
  servingSide: 1 | 2;
  serverPlayerIndex: PlayerIndex;
  receiverPlayerIndex: PlayerIndex;
  side1LeftPlayerIndex?: PlayerIndex;
  side1RightPlayerIndex?: PlayerIndex;
  side2LeftPlayerIndex?: PlayerIndex;
  side2RightPlayerIndex?: PlayerIndex;
};

type MatchPauseState = {
  paused: boolean;
  pausedAt: Date | null;
  pauseStartedAt: Date | null;
  pausedDurationMs: number;
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  MENS_SINGLES: '男子单打',
  WOMENS_SINGLES: '女子单打',
  MENS_DOUBLES: '男子双打',
  WOMENS_DOUBLES: '女子双打',
  MIXED_DOUBLES: '混合双打',
};

const SIDE_REQUIRED_EVENT_TYPES = new Set<MatchEventType>([
  MatchEventType.TIMEOUT,
  MatchEventType.MEDICAL_TIMEOUT,
  MatchEventType.WARNING,
  MatchEventType.YELLOW_CARD,
]);

const MATCH_PAUSE_NOTE_PREFIX = 'MATCH_PAUSE:';

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
      orderBy: [{ scheduledAt: 'asc' }, { roundNo: 'asc' }, { matchNo: 'asc' }],
    });

    const orderedMatches = matches.sort((a, b) => this.compareRefereeMatchOrder(a, b));
    return Promise.all(orderedMatches.map((match) => this.hydrateMatchSummary(match)));
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
    const side1View = side1 ? this.registrationView(side1) : null;
    const side2View = side2 ? this.registrationView(side2) : null;
    const side1Games = match.games.filter((game) => game.winnerSide === 1).length;
    const side2Games = match.games.filter((game) => game.winnerSide === 2).length;
    const eventType = match.event?.type ?? match.teamCompetitionItem?.eventType ?? 'TEAM_COMPETITION';
    const scoringRule = match.event?.scoringRule ?? ScoringRule.TWENTYONE_BO3;
    const scoringMode = match.event?.scoringMode ?? ScoringMode.CAPPED_30;
    const customGamePoint = match.event?.customGamePoint ?? null;
    const customGameCap = match.event?.customGameCap ?? null;
    const customGamesToWin = match.event?.customGamesToWin ?? null;
    const tournament = match.event?.tournament ?? match.teamMatch?.teamCompetition.tournament;
    const servingEvents = await this.prisma.matchEvent.findMany({
      where: {
        matchId,
        type: { in: [MatchEventType.SERVE_CHANGE, MatchEventType.POINT] },
      },
      orderBy: { createdAt: 'asc' },
    });
    const pauseEvents = await this.prisma.matchEvent.findMany({
      where: { matchId, type: MatchEventType.TIMEOUT },
      orderBy: { createdAt: 'asc' },
    });
    const pauseState = this.computePauseState(pauseEvents, match.finishedAt);
    const currentGame = match.games.find((game) => !game.winnerSide) ?? match.games.at(-1) ?? null;
    const servingState = this.buildServingState(
      match.games,
      servingEvents,
      currentGame?.gameNo ?? 1,
      this.sidePlayerCount(side1View),
      this.sidePlayerCount(side2View),
    );

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
        customGamePoint,
        customGameCap,
        customGamesToWin,
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
      startedAt: match.startedAt,
      finishedAt: match.finishedAt,
      matchPaused: pauseState.paused,
      pausedAt: pauseState.pausedAt,
      actualDurationSeconds: this.computeActualDurationSeconds(match.startedAt, match.finishedAt, match.status, pauseState),
      side1: side1View,
      side2: side2View,
      side1Games,
      side2Games,
      games: match.games,
      currentGame,
      servingState,
      events: match.events,
      updatedAt: match.updatedAt,
    };
  }

  async startMatch(matchId: string, user: AuthUser, options: StartMatchOptions) {
    await this.ensureMatchAccess(matchId, user);
    const match = await this.ensurePlayableMatch(matchId);
    if (match.status === MatchStatus.COMPLETED || match.status === MatchStatus.CANCELLED) {
      throw new BadRequestException('已结束的场次不能重新开始');
    }
    if (match.status !== MatchStatus.PENDING) {
      throw new BadRequestException('比赛已开始');
    }
    if (
      ![1, 2].includes(options.servingSide) ||
      ![1, 2].includes(options.serverPlayerIndex) ||
      ![1, 2].includes(options.receiverPlayerIndex)
    ) {
      throw new BadRequestException('请选择首发方、首位发球员和接发球员');
    }

    const servingState = this.initialServingState(
      1,
      options.servingSide,
      options.serverPlayerIndex,
      null,
      {
        side1Positions: this.startPositionsFromOptions(1, options),
        side2Positions: this.startPositionsFromOptions(2, options),
        receiverPlayerIndex: options.receiverPlayerIndex,
      },
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.game.upsert({
        where: { matchId_gameNo: { matchId, gameNo: 1 } },
        update: { server: options.servingSide },
        create: { matchId, gameNo: 1, server: options.servingSide },
      });
      await tx.matchEvent.create({
        data: {
          matchId,
          type: MatchEventType.SERVE_CHANGE,
          side: options.servingSide,
          gameNo: 1,
          note: this.encodeServingState(servingState),
        },
      });
      await tx.match.update({
        where: { id: matchId },
        data: {
          status: MatchStatus.LIVE,
          startedAt: match.startedAt ?? new Date(),
          finishedAt: null,
        },
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
    if (match.status !== MatchStatus.LIVE) {
      throw new BadRequestException('请先开始比赛再记分');
    }
    if (await this.isMatchPaused(matchId)) {
      throw new BadRequestException('比赛暂停中，不能继续记分');
    }

    await this.prisma.$transaction(async (tx) => {
      const currentGame = await this.ensureCurrentGame(tx, matchId);
      const [gamesBeforePoint, servingEventsBeforePoint] = await Promise.all([
        tx.game.findMany({ where: { matchId }, orderBy: { gameNo: 'asc' } }),
        tx.matchEvent.findMany({
          where: {
            matchId,
            type: { in: [MatchEventType.SERVE_CHANGE, MatchEventType.POINT] },
          },
          orderBy: { createdAt: 'asc' },
        }),
      ]);
      const servingStateBeforePoint = this.buildServingState(
        gamesBeforePoint,
        servingEventsBeforePoint,
        currentGame.gameNo,
        2,
        2,
      );
      const updatedGame = await tx.game.update({
        where: { id: currentGame.id },
        data:
          side === 1
            ? { side1Score: { increment: 1 }, server: side }
            : { side2Score: { increment: 1 }, server: side },
      });
      let game = updatedGame;
      const servingStateAfterPoint = this.nextServingState(
        servingStateBeforePoint,
        side,
        game.side1Score,
        game.side2Score,
      );
      const gameWinner = this.resolveGameWinner(
        game.side1Score,
        game.side2Score,
        match.event?.scoringRule ?? ScoringRule.TWENTYONE_BO3,
        match.event?.scoringMode ?? ScoringMode.CAPPED_30,
        match.event ?? null,
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
          note: this.encodeServingState(servingStateAfterPoint),
        },
      });

      const games = await tx.game.findMany({ where: { matchId }, orderBy: { gameNo: 'asc' } });
      const matchWinner = this.resolveMatchWinner(
        games,
        match.event?.scoringRule ?? ScoringRule.TWENTYONE_BO3,
        match.event ?? null,
      );
      if (matchWinner) {
        await tx.match.update({
          where: { id: matchId },
          data: {
            status: MatchStatus.COMPLETED,
            winnerSide: matchWinner,
            finishedAt: new Date(),
          },
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
        const nextGameNo = game.gameNo + 1;
        const nextGameServer = gameWinner === 1 ? 2 : 1;
        const nextServerPlayer = this.playerOnCourtSide(servingStateAfterPoint, nextGameServer, 'right') ?? 1;
        const nextGameServingState = this.initialServingState(
          nextGameNo,
          nextGameServer,
          nextServerPlayer,
          servingStateAfterPoint,
        );
        // 项目规则：上一局输方在新一局先发球
        await tx.game.upsert({
          where: { matchId_gameNo: { matchId, gameNo: nextGameNo } },
          update: { server: nextGameServer },
          create: { matchId, gameNo: nextGameNo, server: nextGameServer },
        });
        await tx.matchEvent.create({
          data: {
            matchId,
            type: MatchEventType.SERVE_CHANGE,
            side: nextGameServer,
            gameNo: nextGameNo,
            note: this.encodeServingState(nextGameServingState),
          },
        });
      }
    });

    return this.getMatchState(matchId, user);
  }

  async pauseMatch(matchId: string, user: AuthUser) {
    await this.ensureMatchAccess(matchId, user);
    const match = await this.ensurePlayableMatch(matchId);
    if (match.status !== MatchStatus.LIVE) {
      throw new BadRequestException('只有进行中的比赛可以暂停');
    }
    if (await this.isMatchPaused(matchId)) {
      return this.getMatchState(matchId, user);
    }

    await this.prisma.matchEvent.create({
      data: {
        matchId,
        type: MatchEventType.TIMEOUT,
        note: this.encodeMatchPauseNote('START'),
      },
    });
    return this.getMatchState(matchId, user);
  }

  async resumeMatch(matchId: string, user: AuthUser) {
    await this.ensureMatchAccess(matchId, user);
    const match = await this.ensurePlayableMatch(matchId);
    if (match.status !== MatchStatus.LIVE) {
      throw new BadRequestException('只有进行中的比赛可以恢复');
    }
    if (!(await this.isMatchPaused(matchId))) {
      return this.getMatchState(matchId, user);
    }

    await this.prisma.matchEvent.create({
      data: {
        matchId,
        type: MatchEventType.TIMEOUT,
        note: this.encodeMatchPauseNote('END'),
      },
    });
    return this.getMatchState(matchId, user);
  }

  async undoLastPoint(matchId: string, user: AuthUser) {
    await this.ensureMatchAccess(matchId, user);
    const match = await this.ensurePlayableMatch(matchId);
    if (match.status === MatchStatus.COMPLETED || match.status === MatchStatus.CANCELLED) {
      throw new BadRequestException('场次已结束，不能撤销比分');
    }
    if (match.status !== MatchStatus.LIVE) {
      throw new BadRequestException('比赛尚未开始，不能撤销比分');
    }

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

      // 回滚发球方：本局上一分的得分方就是当时的发球方；
      // 若没有更早的得分（即撤销的是本局第一分），则恢复为本局初始发球方
      // （第 1 局无初始发球方，第 N 局为第 N-1 局胜方）。
      const previousPoint = await tx.matchEvent.findFirst({
        where: {
          matchId,
          type: MatchEventType.POINT,
          undoneAt: null,
          gameNo: lastPoint.gameNo,
          id: { not: lastPoint.id },
        },
        orderBy: { createdAt: 'desc' },
      });
      let restoredServer: number | null = null;
      if (previousPoint?.side) {
        restoredServer = previousPoint.side;
      } else if (lastPoint.gameNo > 1) {
        const prevGame = await tx.game.findUnique({
          where: { matchId_gameNo: { matchId, gameNo: lastPoint.gameNo - 1 } },
        });
        restoredServer = prevGame?.winnerSide ?? null;
      }

      const updatedGame = await tx.game.update({
        where: { id: game.id },
        data: {
          side1Score: nextSide1Score,
          side2Score: nextSide2Score,
          winnerSide: null,
          completedAt: null,
          server: restoredServer,
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
    const match = await this.ensurePlayableMatch(matchId);
    if (match.status === MatchStatus.COMPLETED || match.status === MatchStatus.CANCELLED) {
      throw new BadRequestException('场次已结束，不能继续记录裁判操作');
    }
    if (SIDE_REQUIRED_EVENT_TYPES.has(type) && !side) {
      throw new BadRequestException('请选择该裁判操作对应的选手');
    }

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
          finishedAt: new Date(),
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
          finishedAt: new Date(),
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
        await this.clearSingleEliminationAdvancement(tx, match);
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

  private computeActualDurationSeconds(
    startedAt: Date | null,
    finishedAt: Date | null,
    status: MatchStatus,
    pauseState?: MatchPauseState,
  ): number | null {
    if (!startedAt) return null;
    const endAt =
      finishedAt ??
      pauseState?.pauseStartedAt ??
      (status === MatchStatus.LIVE ? new Date() : null);
    if (!endAt) return null;
    const ms = endAt.getTime() - startedAt.getTime() - (pauseState?.pausedDurationMs ?? 0);
    if (ms < 0) return 0;
    return Math.floor(ms / 1000);
  }

  private computePauseState(
    events: Array<{ note: string | null; createdAt: Date }>,
    finishedAt?: Date | null,
  ): MatchPauseState {
    let pauseStartedAt: Date | null = null;
    let pausedDurationMs = 0;
    const endLimit = finishedAt?.getTime() ?? null;

    for (const event of events) {
      if (endLimit !== null && event.createdAt.getTime() > endLimit) continue;
      const action = this.decodeMatchPauseNote(event.note);
      if (action === 'START' && !pauseStartedAt) {
        pauseStartedAt = event.createdAt;
      } else if (action === 'END' && pauseStartedAt) {
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

  private async isMatchPaused(matchId: string) {
    const events = await this.prisma.matchEvent.findMany({
      where: { matchId, type: MatchEventType.TIMEOUT },
      orderBy: { createdAt: 'asc' },
      select: { note: true, createdAt: true },
    });
    return this.computePauseState(events).paused;
  }

  private encodeMatchPauseNote(action: 'START' | 'END') {
    return `${MATCH_PAUSE_NOTE_PREFIX}${action}`;
  }

  private decodeMatchPauseNote(note?: string | null): 'START' | 'END' | null {
    if (note === `${MATCH_PAUSE_NOTE_PREFIX}START`) return 'START';
    if (note === `${MATCH_PAUSE_NOTE_PREFIX}END`) return 'END';
    return null;
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

  private buildServingState(
    games: Array<{ gameNo: number; server: number | null }>,
    events: Array<{
      type: MatchEventType;
      side: number | null;
      gameNo: number | null;
      side1Score: number | null;
      side2Score: number | null;
      note: string | null;
      undoneAt?: Date | null;
    }>,
    currentGameNo: number,
    side1PlayerCount: number,
    side2PlayerCount: number,
  ): ServingState {
    const firstGame = games.find((game) => game.gameNo === 1);
    let state: ServingState | null = null;

    for (const event of events) {
      if (event.type === MatchEventType.SERVE_CHANGE) {
        const parsed = this.decodeServingState(event.note);
        if (parsed) state = parsed;
        continue;
      }
      if (event.type !== MatchEventType.POINT || event.undoneAt || !event.side) continue;
      const gameNo = event.gameNo ?? state?.gameNo ?? 1;
      state = this.ensureServingStateForGame(
        state ??
          this.initialServingState(
            gameNo,
            this.validSide(games.find((game) => game.gameNo === gameNo)?.server) ??
              this.validSide(firstGame?.server) ??
              1,
            1,
          ),
        games,
        gameNo,
      );
      const parsed = this.decodeServingState(event.note);
      if (parsed && parsed.gameNo === gameNo) {
        state = parsed;
      } else if (typeof event.side1Score === 'number' && typeof event.side2Score === 'number') {
        state = this.nextServingState(
          state,
          event.side as 1 | 2,
          event.side1Score,
          event.side2Score,
        );
      }
    }

    const fallbackServer = this.validSide(games.find((game) => game.gameNo === currentGameNo)?.server) ??
      this.validSide(firstGame?.server) ??
      1;
    const currentState = this.ensureServingStateForGame(
      state ?? this.initialServingState(currentGameNo, fallbackServer, 1),
      games,
      currentGameNo,
    );
    return this.sanitizeServingState(currentState, side1PlayerCount, side2PlayerCount);
  }

  private initialServingState(
    gameNo: number,
    servingSide: 1 | 2,
    serverPlayerIndex: PlayerIndex,
    previous?: ServingState | null,
    options?: {
      side1Positions?: Record<CourtSide, PlayerIndex | null>;
      side2Positions?: Record<CourtSide, PlayerIndex | null>;
      receiverPlayerIndex?: PlayerIndex;
    },
  ): ServingState {
    const side1Positions = options?.side1Positions
      ? { ...options.side1Positions }
      : previous
      ? { ...previous.side1Positions }
      : ({ left: 2, right: 1 } as Record<CourtSide, PlayerIndex | null>);
    const side2Positions = options?.side2Positions
      ? { ...options.side2Positions }
      : previous
      ? { ...previous.side2Positions }
      : ({ left: 2, right: 1 } as Record<CourtSide, PlayerIndex | null>);
    const positions = servingSide === 1 ? side1Positions : side2Positions;
    if (this.courtSideOfPlayer(positions, serverPlayerIndex) === null) {
      positions.right = serverPlayerIndex;
      positions.left = serverPlayerIndex === 1 ? 2 : 1;
    }
    const serverCourtSide = this.courtSideOfPlayer(positions, serverPlayerIndex) ?? 'right';
    const receivingSide: 1 | 2 = servingSide === 1 ? 2 : 1;
    const receivingPositions = receivingSide === 1 ? side1Positions : side2Positions;
    const receiverPlayerIndex =
      options?.receiverPlayerIndex ??
      this.playerOnCourtSide(
        {
          gameNo,
          servingSide,
          serverPlayerIndex,
          serverCourtSide,
          receivingSide,
          receiverPlayerIndex: null,
          receiverCourtSide: null,
          side1Positions,
          side2Positions,
        },
        receivingSide,
        this.oppositeCourtSide(serverCourtSide),
      ) ??
      1;
    const receiverCourtSide =
      this.courtSideOfPlayer(receivingPositions, receiverPlayerIndex) ??
      this.oppositeCourtSide(serverCourtSide);
    return {
      gameNo,
      servingSide,
      serverPlayerIndex,
      serverCourtSide,
      receivingSide,
      receiverPlayerIndex,
      receiverCourtSide,
      side1Positions,
      side2Positions,
    };
  }

  private ensureServingStateForGame(
    state: ServingState,
    games: Array<{ gameNo: number; server: number | null }>,
    gameNo: number,
  ) {
    if (state.gameNo === gameNo) return state;
    const serverSide = this.validSide(games.find((game) => game.gameNo === gameNo)?.server) ??
      state.servingSide ??
      1;
    const serverPlayerIndex = this.playerOnCourtSide(state, serverSide, 'right') ?? 1;
    return this.initialServingState(gameNo, serverSide, serverPlayerIndex, state);
  }

  private nextServingState(
    state: ServingState,
    scoringSide: 1 | 2,
    side1Score: number,
    side2Score: number,
  ): ServingState {
    const next: ServingState = {
      ...state,
      side1Positions: { ...state.side1Positions },
      side2Positions: { ...state.side2Positions },
    };
    const scoringScore = scoringSide === 1 ? side1Score : side2Score;
    const serverCourtSide: CourtSide = scoringScore % 2 === 0 ? 'right' : 'left';

    if (state.servingSide === scoringSide) {
      const positions = scoringSide === 1 ? next.side1Positions : next.side2Positions;
      [positions.left, positions.right] = [positions.right, positions.left];
      next.serverPlayerIndex = state.serverPlayerIndex;
    } else {
      next.servingSide = scoringSide;
      next.serverPlayerIndex = this.playerOnCourtSide(next, scoringSide, serverCourtSide) ?? 1;
    }

    next.serverCourtSide = serverCourtSide;
    next.receivingSide = next.servingSide === 1 ? 2 : 1;
    next.receiverCourtSide = this.oppositeCourtSide(serverCourtSide);
    next.receiverPlayerIndex =
      this.playerOnCourtSide(next, next.receivingSide, next.receiverCourtSide) ?? 1;
    return next;
  }

  private playerOnCourtSide(state: ServingState, side: 1 | 2, courtSide: CourtSide) {
    const positions = side === 1 ? state.side1Positions : state.side2Positions;
    return positions[courtSide] ?? null;
  }

  private courtSideOfPlayer(positions: Record<CourtSide, PlayerIndex | null>, playerIndex: PlayerIndex) {
    if (positions.left === playerIndex) return 'left';
    if (positions.right === playerIndex) return 'right';
    return null;
  }

  private oppositeCourtSide(courtSide: CourtSide): CourtSide {
    return courtSide === 'left' ? 'right' : 'left';
  }

  private sanitizeServingState(state: ServingState, side1PlayerCount: number, side2PlayerCount: number) {
    const side1Positions = this.sanitizePositions(state.side1Positions, side1PlayerCount);
    const side2Positions = this.sanitizePositions(state.side2Positions, side2PlayerCount);
    return {
      ...state,
      serverPlayerIndex: state.serverPlayerIndex === 2 && this.sidePlayerCountForSide(state.servingSide, side1PlayerCount, side2PlayerCount) < 2
        ? 1
        : state.serverPlayerIndex,
      receiverPlayerIndex: state.receiverPlayerIndex === 2 && this.sidePlayerCountForSide(state.receivingSide, side1PlayerCount, side2PlayerCount) < 2
        ? 1
        : state.receiverPlayerIndex,
      side1Positions,
      side2Positions,
    };
  }

  private sanitizePositions(positions: Record<CourtSide, PlayerIndex | null>, playerCount: number) {
    const hasSecondPlayer = playerCount > 1;
    return {
      left: positions.left === 2 && !hasSecondPlayer ? null : positions.left,
      right: positions.right === 2 && !hasSecondPlayer ? null : positions.right,
    };
  }

  private sidePlayerCount(side?: { players?: unknown[] } | null) {
    return Math.max(1, side?.players?.length ?? 1);
  }

  private sidePlayerCountForSide(side: 1 | 2 | null, side1PlayerCount: number, side2PlayerCount: number) {
    if (side === 1) return side1PlayerCount;
    if (side === 2) return side2PlayerCount;
    return 0;
  }

  private startPositionsFromOptions(side: 1 | 2, options: StartMatchOptions) {
    const left = side === 1 ? options.side1LeftPlayerIndex : options.side2LeftPlayerIndex;
    const right = side === 1 ? options.side1RightPlayerIndex : options.side2RightPlayerIndex;
    if ((left === 1 || left === 2) && (right === 1 || right === 2) && left !== right) {
      return { left, right } as Record<CourtSide, PlayerIndex>;
    }
    return { left: 2, right: 1 } as Record<CourtSide, PlayerIndex>;
  }

  private validSide(value?: number | null): 1 | 2 | null {
    return value === 1 || value === 2 ? value : null;
  }

  private encodeServingState(state: ServingState) {
    return JSON.stringify({ refereeServingState: state });
  }

  private decodeServingState(note?: string | null): ServingState | null {
    if (!note) return null;
    try {
      const parsed = JSON.parse(note) as { refereeServingState?: Partial<ServingState> };
      const state = parsed.refereeServingState;
      if (!state) return null;
      const servingSide = this.validSide(state.servingSide);
      const serverPlayerIndex = state.serverPlayerIndex === 1 || state.serverPlayerIndex === 2
        ? state.serverPlayerIndex
        : null;
      const serverCourtSide = state.serverCourtSide === 'left' || state.serverCourtSide === 'right'
        ? state.serverCourtSide
        : null;
      const receivingSide = this.validSide(state.receivingSide);
      const receiverPlayerIndex = state.receiverPlayerIndex === 1 || state.receiverPlayerIndex === 2
        ? state.receiverPlayerIndex
        : null;
      const receiverCourtSide = state.receiverCourtSide === 'left' || state.receiverCourtSide === 'right'
        ? state.receiverCourtSide
        : null;
      return {
        gameNo: typeof state.gameNo === 'number' ? state.gameNo : 1,
        servingSide,
        serverPlayerIndex,
        serverCourtSide,
        receivingSide,
        receiverPlayerIndex,
        receiverCourtSide,
        side1Positions: this.normalizePositions(state.side1Positions),
        side2Positions: this.normalizePositions(state.side2Positions),
      };
    } catch {
      return null;
    }
  }

  private normalizePositions(value?: Partial<Record<CourtSide, unknown>>) {
    const left = value?.left === 1 || value?.left === 2 ? value.left : 2;
    const right = value?.right === 1 || value?.right === 2 ? value.right : 1;
    return { left, right } as Record<CourtSide, PlayerIndex | null>;
  }

  private resolveGameWinner(
    side1Score: number,
    side2Score: number,
    rule: ScoringRule,
    mode: ScoringMode,
    eventOverrides?: {
      customGamePoint?: number | null;
      customGameCap?: number | null;
      customGamesToWin?: number | null;
    } | null,
  ) {
    const { target, cap } = this.ruleConfig(rule, eventOverrides);
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
    eventOverrides?: {
      customGamePoint?: number | null;
      customGameCap?: number | null;
      customGamesToWin?: number | null;
    } | null,
  ) {
    const { gamesToWin } = this.ruleConfig(rule, eventOverrides);
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
      round: string;
      roundNo: number;
      matchNo: number;
      side1Id: string | null;
      side2Id: string | null;
    },
    winnerSide: 1 | 2,
  ) {
    if (!match.eventId || match.roundNo < 1) return;

    const winnerId = winnerSide === 1 ? match.side1Id : match.side2Id;
    const loserId = winnerSide === 1 ? match.side2Id : match.side1Id;
    if (!winnerId) return;

    const nextMatch = await tx.match.findFirst({
      where: {
        eventId: match.eventId,
        roundNo: match.roundNo + 1,
        matchNo: Math.ceil(match.matchNo / 2),
        round: { not: 'BRONZE' },
      },
    });
    if (nextMatch) {
      await this.updatePendingDependentMatch(
        tx,
        nextMatch,
        match.matchNo % 2 === 1 ? 'side1Id' : 'side2Id',
        winnerId,
      );
    }

    if (nextMatch?.round === 'F' && loserId) {
      const bronzeMatch = await tx.match.findFirst({
        where: {
          eventId: match.eventId,
          roundNo: match.roundNo + 1,
          round: 'BRONZE',
        },
      });
      if (bronzeMatch) {
        await this.updatePendingDependentMatch(
          tx,
          bronzeMatch,
          match.matchNo % 2 === 1 ? 'side1Id' : 'side2Id',
          loserId,
        );
      }
    }
  }

  private async clearSingleEliminationAdvancement(
    tx: Prisma.TransactionClient,
    match: {
      eventId: string | null;
      roundNo: number;
      matchNo: number;
    },
  ) {
    if (!match.eventId || match.roundNo < 1) return;

    const targetSide = match.matchNo % 2 === 1 ? 'side1Id' : 'side2Id';
    const nextMatches = await tx.match.findMany({
      where: {
        eventId: match.eventId,
        roundNo: match.roundNo + 1,
        OR: [
          { matchNo: Math.ceil(match.matchNo / 2), round: { not: 'BRONZE' } },
          { round: 'BRONZE' },
        ],
      },
    });

    for (const nextMatch of nextMatches) {
      await this.updatePendingDependentMatch(tx, nextMatch, targetSide, null);
    }
  }

  private async updatePendingDependentMatch(
    tx: Prisma.TransactionClient,
    match: { id: string; status: MatchStatus },
    side: 'side1Id' | 'side2Id',
    value: string | null,
  ) {
    const data: Prisma.MatchUncheckedUpdateInput = { [side]: value };
    if (match.status === MatchStatus.PENDING) {
      data.venueId = null;
      data.scheduledAt = null;
    }
    await tx.match.update({
      where: { id: match.id },
      data,
    });
  }

  private ruleConfig(
    rule: ScoringRule,
    overrides?: {
      customGamePoint?: number | null;
      customGameCap?: number | null;
      customGamesToWin?: number | null;
    } | null,
  ) {
    let base: { target: number; cap: number; gamesToWin: number };
    if (rule === ScoringRule.FIFTEEN_ONE) base = { target: 15, cap: 20, gamesToWin: 1 };
    else if (rule === ScoringRule.FIFTEEN_BO3) base = { target: 15, cap: 20, gamesToWin: 2 };
    else if (rule === ScoringRule.TWENTYONE_BO3) base = { target: 21, cap: 30, gamesToWin: 2 };
    else base = { target: 31, cap: 31, gamesToWin: 2 };

    if (overrides?.customGamePoint && overrides.customGamePoint > 0) {
      base.target = overrides.customGamePoint;
      base.cap = overrides.customGameCap && overrides.customGameCap >= overrides.customGamePoint
        ? overrides.customGameCap
        : overrides.customGamePoint;
    } else if (overrides?.customGameCap && overrides.customGameCap > 0) {
      base.cap = overrides.customGameCap;
    }
    if (overrides?.customGamesToWin && overrides.customGamesToWin > 0) {
      base.gamesToWin = overrides.customGamesToWin;
    }
    return base;
  }

  private async hydrateMatchSummary(match: {
    id: string;
    status: MatchStatus;
    winnerSide: number | null;
    round: string;
    roundNo: number;
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
      roundNo: match.roundNo,
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

  private compareRefereeMatchOrder(
    a: {
      scheduledAt: Date | null;
      venue: { sortOrder?: number | null; name: string } | null;
      roundNo: number;
      matchNo: number;
      event: { tournament: { edition: number }; type: string } | null;
      teamCompetitionItem?: { eventType: string } | null;
      teamMatch?: { roundNo: number; matchNo: number } | null;
      createdAt: Date;
    },
    b: {
      scheduledAt: Date | null;
      venue: { sortOrder?: number | null; name: string } | null;
      roundNo: number;
      matchNo: number;
      event: { tournament: { edition: number }; type: string } | null;
      teamCompetitionItem?: { eventType: string } | null;
      teamMatch?: { roundNo: number; matchNo: number } | null;
      createdAt: Date;
    },
  ) {
    const aScheduled = a.scheduledAt ? 0 : 1;
    const bScheduled = b.scheduledAt ? 0 : 1;
    if (aScheduled !== bScheduled) return aScheduled - bScheduled;

    const aTime = a.scheduledAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bTime = b.scheduledAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (aTime !== bTime) return aTime - bTime;

    const aVenueOrder = a.venue?.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const bVenueOrder = b.venue?.sortOrder ?? Number.MAX_SAFE_INTEGER;
    if (aVenueOrder !== bVenueOrder) return aVenueOrder - bVenueOrder;

    const venueNameCompare = (a.venue?.name ?? '').localeCompare(b.venue?.name ?? '', 'zh-CN');
    if (venueNameCompare !== 0) return venueNameCompare;

    const aEdition = a.event?.tournament.edition ?? 0;
    const bEdition = b.event?.tournament.edition ?? 0;
    if (aEdition !== bEdition) return bEdition - aEdition;

    const aEventType = a.event?.type ?? a.teamCompetitionItem?.eventType ?? '';
    const bEventType = b.event?.type ?? b.teamCompetitionItem?.eventType ?? '';
    const eventTypeCompare = aEventType.localeCompare(bEventType);
    if (eventTypeCompare !== 0) return eventTypeCompare;

    const aTeamRoundNo = a.teamMatch?.roundNo ?? 0;
    const bTeamRoundNo = b.teamMatch?.roundNo ?? 0;
    if (aTeamRoundNo !== bTeamRoundNo) return aTeamRoundNo - bTeamRoundNo;

    const aTeamMatchNo = a.teamMatch?.matchNo ?? 0;
    const bTeamMatchNo = b.teamMatch?.matchNo ?? 0;
    if (aTeamMatchNo !== bTeamMatchNo) return aTeamMatchNo - bTeamMatchNo;

    if (a.roundNo !== b.roundNo) return a.roundNo - b.roundNo;
    if (a.matchNo !== b.matchNo) return a.matchNo - b.matchNo;
    return a.createdAt.getTime() - b.createdAt.getTime();
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
    const players = registration.players?.length
      ? registration.players
      : [
          registration.player1
            ? {
                id: registration.player1.id,
                name: registration.player1.name,
                affiliation: registration.player1.affiliation,
              }
            : null,
          registration.player2
            ? {
                id: registration.player2.id,
                name: registration.player2.name,
                affiliation: registration.player2.affiliation,
              }
            : null,
        ].filter(Boolean);
    const name = registration.name ?? (registration.player2
      ? `${registration.player1.name} / ${registration.player2.name}`
      : registration.player1?.name ?? registration.name);
    const teamName = registration.teamName?.trim?.() || (players.length > 1 ? registration.name : null);
    const affiliation = registration.affiliation ?? (registration.player2
      ? `${registration.player1.affiliation} / ${registration.player2.affiliation}`
      : registration.player1?.affiliation ?? players[0]?.affiliation ?? null);
    return {
      id: registration.id,
      name,
      teamName,
      players: players.map((player: any, index: number) => ({
        id: player.id ?? `${registration.id}:player-${index + 1}`,
        index: index + 1,
        name: player.name,
          affiliation: player.affiliation ?? null,
      })),
      affiliation,
    };
  }
}

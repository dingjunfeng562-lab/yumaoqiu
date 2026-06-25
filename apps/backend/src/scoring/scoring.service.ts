import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Format,
  MatchEventType,
  MatchStatus,
  Prisma,
  Role,
  ScoringMode,
  ScoringRule,
  SecondStageRankingMode,
  SecondStageStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TeamCompetitionsService } from '../team-competitions/team-competitions.service';
import { ScoringGateway } from './scoring.gateway';
import { isSecondStageFormalRoundNo } from '../common/second-stage-bracket';
import { SecondStageProgressService } from '../common/second-stage-progress.service';

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

type CourtDisplayState = {
  side1CourtSide: CourtSide;
  side2CourtSide: CourtSide;
  swapCount: number;
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
  pauseKind: 'manual' | 'technical' | 'interval' | null;
  pauseReason: string | null;
};

type SecondStageEntrant = {
  id: string | null;
  name: string | null;
};

type MatchScoringConfig = {
  scoringRule: ScoringRule;
  scoringMode: ScoringMode;
  customGamePoint: number | null;
  customGameCap: number | null;
  customGamesToWin: number | null;
  appliedStage: string | null;
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
const TECHNICAL_PAUSE_NOTE_PREFIX = 'TECHNICAL_PAUSE:';
const INTERVAL_REST_NOTE_PREFIX = 'INTERVAL_REST:';
const FAULT_NOTE_PREFIX = 'BADMINTON_FAULT:';
const CARD_NOTE_PREFIX = 'BADMINTON_CARD:';
const COURT_SWAP_NOTE_PREFIX = 'COURT_SWAP:';
const COURT_SWAP_REQUIRED_NOTE_PREFIX = 'COURT_SWAP_REQUIRED:';
const RETIRE_NOTE_PREFIX = 'RETIRE:';
const BLACK_CARD_NOTE_PREFIX = 'BLACK_CARD:';
const SERVING_STATE_NOTE_PREFIX = 'RS:';

@Injectable()
export class ScoringService {
  constructor(
    private prisma: PrismaService,
    private teamCompetitionsService: TeamCompetitionsService,
    private gateway: ScoringGateway,
    private secondStageProgress: SecondStageProgressService,
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
    // 按比赛阶段解析实际生效规则，裁判端与大屏直接显示该场规则
    const effectiveScoring = this.resolveMatchScoring(match);
    const scoringRule = effectiveScoring.scoringRule;
    const scoringMode = effectiveScoring.scoringMode;
    const customGamePoint = effectiveScoring.customGamePoint;
    const customGameCap = effectiveScoring.customGameCap;
    const customGamesToWin = effectiveScoring.customGamesToWin;
    const tournament = match.event?.tournament ?? match.teamMatch?.teamCompetition.tournament;
    const servingEvents = await this.prisma.matchEvent.findMany({
      where: {
        matchId,
        type: { in: [MatchEventType.SERVE_CHANGE, MatchEventType.POINT] },
      },
      orderBy: { createdAt: 'asc' },
    });
    const courtEvents = await this.prisma.matchEvent.findMany({
      where: {
        matchId,
        type: MatchEventType.SERVE_CHANGE,
        OR: [
          { note: { startsWith: COURT_SWAP_NOTE_PREFIX } },
          { note: { startsWith: COURT_SWAP_REQUIRED_NOTE_PREFIX } },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });
    const pauseEvents = await this.prisma.matchEvent.findMany({
      where: { matchId, type: MatchEventType.TIMEOUT },
      orderBy: { createdAt: 'asc' },
    });
    const isTechnicalPauseGame = (gameNo: number) =>
      this.shouldUseTechnicalPauseInGame(gameNo, scoringRule, effectiveScoring);
    const pauseState = this.computePauseState(pauseEvents, match.finishedAt, isTechnicalPauseGame);
    const courtDisplayState = this.computeCourtDisplayState(courtEvents);
    const courtSwapRequired = this.computeCourtSwapRequired(courtEvents, (gameNo) =>
      this.shouldRequireCourtSwapInGame(gameNo, scoringRule, effectiveScoring),
    );
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
      pendingFinish: match.status === MatchStatus.LIVE && match.winnerSide !== null,
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
        appliedStage: effectiveScoring.appliedStage,
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
      pauseKind: pauseState.pauseKind,
      pauseReason: pauseState.pauseReason,
      actualDurationSeconds: this.computeActualDurationSeconds(match.startedAt, match.finishedAt, match.status, pauseState),
      side1: side1View,
      side2: side2View,
      courtDisplayState,
      courtSwapRequired,
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
    if (match.winnerSide !== null && match.winnerSide !== undefined) {
      throw new BadRequestException('比赛已决出胜方，请先在「确认结束比赛」中确认或撤销上一分');
    }
    if (await this.isMatchPaused(matchId)) {
      throw new BadRequestException('比赛暂停中，不能继续记分');
    }
    if (await this.isCourtSwapRequired(matchId)) {
      throw new BadRequestException('请先完成交换场地，再继续记分');
    }

    await this.prisma.$transaction(async (tx) => {
      const currentGame = await this.ensureCurrentGame(tx, matchId);
      const [gamesBeforePoint, servingEventsBeforePoint, pauseEventsBeforePoint, courtEventsBeforePoint] = await Promise.all([
        tx.game.findMany({ where: { matchId }, orderBy: { gameNo: 'asc' } }),
        tx.matchEvent.findMany({
          where: {
            matchId,
            type: { in: [MatchEventType.SERVE_CHANGE, MatchEventType.POINT] },
          },
          orderBy: { createdAt: 'asc' },
        }),
        tx.matchEvent.findMany({
          where: { matchId, type: MatchEventType.TIMEOUT },
          orderBy: { createdAt: 'asc' },
        }),
        tx.matchEvent.findMany({
          where: {
            matchId,
            type: MatchEventType.SERVE_CHANGE,
            OR: [
              { note: { startsWith: COURT_SWAP_NOTE_PREFIX } },
              { note: { startsWith: COURT_SWAP_REQUIRED_NOTE_PREFIX } },
            ],
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
      const matchScoring = this.resolveMatchScoring(match);
      const gameWinner = this.resolveGameWinner(
        game.side1Score,
        game.side2Score,
        matchScoring.scoringRule,
        matchScoring.scoringMode,
        matchScoring,
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

      const reachedMidGameEleven = game.side1Score === 11 || game.side2Score === 11;
      if (!gameWinner && reachedMidGameEleven) {
        const requiresCourtSwap = this.shouldRequireCourtSwapInGame(
          game.gameNo,
          matchScoring.scoringRule,
          matchScoring,
        );
        if (requiresCourtSwap && !this.hasCourtSwapForGame(courtEventsBeforePoint, game.gameNo)) {
          if (!this.hasCourtSwapRequiredForGame(courtEventsBeforePoint, game.gameNo)) {
            await tx.matchEvent.create({
              data: {
                matchId,
                type: MatchEventType.SERVE_CHANGE,
                side,
                gameNo: game.gameNo,
                side1Score: game.side1Score,
                side2Score: game.side2Score,
                note: this.encodeCourtSwapRequiredNote(game.gameNo),
              },
            });
          }
        } else if (
          this.shouldTriggerTechnicalPause(
            game.gameNo,
            game.side1Score,
            game.side2Score,
            matchScoring.scoringRule,
            matchScoring,
          ) &&
          !this.hasTechnicalPauseForGame(pauseEventsBeforePoint, game.gameNo)
        ) {
          await tx.matchEvent.create({
            data: {
              matchId,
              type: MatchEventType.TIMEOUT,
              side,
              gameNo: game.gameNo,
              side1Score: game.side1Score,
              side2Score: game.side2Score,
              note: this.encodeTechnicalPauseNote('START', game.gameNo),
            },
          });
        }
      }

      const games = await tx.game.findMany({ where: { matchId }, orderBy: { gameNo: 'asc' } });
      const matchWinner = this.resolveMatchWinner(
        games,
        matchScoring.scoringRule,
        matchScoring,
      );
      if (matchWinner) {
        // Pending finish: stamp the deciding winner so the UI can prompt the
        // referee to confirm, but keep status=LIVE and finishedAt=null. The
        // match only flips to COMPLETED — and advances brackets / team
        // aggregates — once the referee explicitly confirms via finishMatch().
        await tx.match.update({
          where: { id: matchId },
          data: {
            status: MatchStatus.LIVE,
            winnerSide: matchWinner,
          },
        });
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
        const nextGameServer = gameWinner;
        const nextServerPlayer =
          servingStateAfterPoint.servingSide === nextGameServer
            ? servingStateAfterPoint.serverPlayerIndex ?? 1
            : this.playerOnCourtSide(servingStateAfterPoint, nextGameServer, 'right') ?? 1;
        const nextGameServingState = this.initialServingState(
          nextGameNo,
          nextGameServer,
          nextServerPlayer,
          servingStateAfterPoint,
          { forceServerRight: true },
        );
        // BWF flow: the previous game winner serves first in the next game.
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
        await tx.matchEvent.create({
          data: {
            matchId,
            type: MatchEventType.TIMEOUT,
            side: nextGameServer,
            gameNo: nextGameNo,
            note: this.encodeIntervalRestNote('START', nextGameNo),
          },
        });
      }
    });

    return this.getMatchState(matchId, user);
  }

  async pauseMatch(matchId: string, user: AuthUser, reason?: string) {
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
        note: this.encodeMatchPauseNote('START', reason),
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

  async swapCourt(matchId: string, user: AuthUser) {
    await this.ensureMatchAccess(matchId, user);
    const match = await this.ensurePlayableMatch(matchId);
    if (match.status === MatchStatus.COMPLETED || match.status === MatchStatus.CANCELLED) {
      throw new BadRequestException('场次已结束，不能交换场地');
    }

    await this.prisma.$transaction(async (tx) => {
      const games = await tx.game.findMany({ where: { matchId }, orderBy: { gameNo: 'asc' } });
      const servingEvents = await tx.matchEvent.findMany({
        where: {
          matchId,
          type: { in: [MatchEventType.SERVE_CHANGE, MatchEventType.POINT] },
        },
        orderBy: { createdAt: 'asc' },
      });
      const courtEvents = await tx.matchEvent.findMany({
        where: {
          matchId,
          type: MatchEventType.SERVE_CHANGE,
          OR: [
            { note: { startsWith: COURT_SWAP_NOTE_PREFIX } },
            { note: { startsWith: COURT_SWAP_REQUIRED_NOTE_PREFIX } },
          ],
        },
        orderBy: { createdAt: 'asc' },
      });
      const pauseEvents = await tx.matchEvent.findMany({
        where: { matchId, type: MatchEventType.TIMEOUT },
        orderBy: { createdAt: 'asc' },
      });
      const currentGame = games.find((game) => !game.winnerSide) ?? games.at(-1);
      if (!currentGame) throw new BadRequestException('暂无可交换场地的比赛局');
      const servingState = this.buildServingState(games, servingEvents, currentGame.gameNo, 2, 2);
      const swappedServingState = this.swapServingStateCourtSides(servingState);

      await tx.matchEvent.create({
        data: {
          matchId,
          type: MatchEventType.SERVE_CHANGE,
          side: swappedServingState.servingSide,
          gameNo: currentGame.gameNo,
          side1Score: currentGame.side1Score,
          side2Score: currentGame.side2Score,
          note: this.encodeServingState(swappedServingState),
        },
      });
      await tx.matchEvent.create({
        data: {
          matchId,
          type: MatchEventType.SERVE_CHANGE,
          side: swappedServingState.servingSide,
          gameNo: currentGame.gameNo,
          side1Score: currentGame.side1Score,
          side2Score: currentGame.side2Score,
          note: this.encodeCourtSwapNote(currentGame.gameNo),
        },
      });

      const matchScoring = this.resolveMatchScoring(match);
      const required = this.computeCourtSwapRequired(courtEvents, (gameNo) =>
        this.shouldRequireCourtSwapInGame(gameNo, matchScoring.scoringRule, matchScoring),
      );
      if (
        required.required &&
        required.gameNo === currentGame.gameNo &&
        this.shouldUseTechnicalPauseInGame(currentGame.gameNo, matchScoring.scoringRule, matchScoring) &&
        !this.hasTechnicalPauseForGame(pauseEvents, currentGame.gameNo)
      ) {
        await tx.matchEvent.create({
          data: {
            matchId,
            type: MatchEventType.TIMEOUT,
            side: swappedServingState.servingSide,
            gameNo: currentGame.gameNo,
            side1Score: currentGame.side1Score,
            side2Score: currentGame.side2Score,
            note: this.encodeTechnicalPauseNote('START', currentGame.gameNo),
          },
        });
      }
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

  async finishMatch(matchId: string, user: AuthUser) {
    await this.ensureMatchAccess(matchId, user);
    const match = await this.ensurePlayableMatch(matchId);
    if (match.status === MatchStatus.COMPLETED) {
      // Idempotent: already confirmed; just return the state.
      return this.getMatchState(matchId, user);
    }
    if (match.status === MatchStatus.CANCELLED) {
      throw new BadRequestException('场次已取消，无法结束');
    }
    if (match.status !== MatchStatus.LIVE) {
      throw new BadRequestException('比赛尚未开始，无法结束');
    }
    const winner = match.winnerSide === 1 || match.winnerSide === 2 ? match.winnerSide : null;
    if (!winner) {
      throw new BadRequestException('比分尚未决出胜方，请先完成本场比赛');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.match.update({
        where: { id: matchId },
        data: {
          status: MatchStatus.COMPLETED,
          winnerSide: winner,
          finishedAt: new Date(),
        },
      });
      const secondStageSynced = await this.syncSecondStageFormalMatchResult(tx, match, winner);
      if (!secondStageSynced) {
        await this.advanceSingleEliminationWinner(tx, match, winner);
        await this.fillPlayoffMatchesIfReady(tx, match.eventId);
        await this.fillGroupKnockoutIfReady(tx, match.eventId);
      }
      await this.teamCompetitionsService.updateTeamMatchAggregate(tx, matchId);
    });

    this.gateway.emitBracketUpdate({
      tournamentId: match.event?.tournamentId ?? null,
      eventId: match.eventId,
      matchId,
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

  async recordFault(
    matchId: string,
    user: AuthUser,
    faultedSide: 1 | 2,
    faultType: string,
    playerIndex?: PlayerIndex,
  ) {
    await this.ensureMatchAccess(matchId, user);
    const match = await this.ensurePlayableMatch(matchId);
    if (match.status !== MatchStatus.LIVE) {
      throw new BadRequestException('只有进行中的比赛可以记录违例');
    }
    if (await this.isMatchPaused(matchId)) {
      throw new BadRequestException('比赛暂停中，不能记录违例得分');
    }

    const cleanFaultType = faultType.trim();
    if (!cleanFaultType) throw new BadRequestException('请选择违例类型');
    const opponentSide: 1 | 2 = faultedSide === 1 ? 2 : 1;
    await this.prisma.matchEvent.create({
      data: {
        matchId,
        type: MatchEventType.WARNING,
        side: faultedSide,
        note: this.encodeFaultNote(cleanFaultType, playerIndex),
      },
    });
    return this.addPoint(matchId, opponentSide, user);
  }

  async recordCard(
    matchId: string,
    user: AuthUser,
    penalizedSide: 1 | 2,
    cardType: 'yellow' | 'red' | 'black',
    reason?: string,
    playerIndex?: PlayerIndex,
  ) {
    await this.ensureMatchAccess(matchId, user);
    const match = await this.ensurePlayableMatch(matchId);
    if (match.status === MatchStatus.COMPLETED || match.status === MatchStatus.CANCELLED) {
      throw new BadRequestException('场次已结束，不能继续出示牌罚');
    }

    const cleanReason = reason?.trim() || null;
    if (cardType === 'black') {
      await this.prisma.matchEvent.create({
        data: {
          matchId,
          type: MatchEventType.YELLOW_CARD,
          side: penalizedSide,
          note: this.encodeCardNote(cardType, playerIndex, cleanReason),
        },
      });
      // Black card → opponent wins by forfeit. Tag the reason with a prefix so
      // the public bracket / live screens can render "黑牌取消资格" instead of
      // a plain "弃权" label (BWF rules treat the two distinctly).
      return this.forfeitMatch(
        matchId,
        penalizedSide,
        user,
        `${BLACK_CARD_NOTE_PREFIX}${cleanReason ?? '黑牌取消资格'}`,
      );
    }

    await this.prisma.matchEvent.create({
      data: {
        matchId,
        type: MatchEventType.YELLOW_CARD,
        side: penalizedSide,
        note: this.encodeCardNote(cardType, playerIndex, cleanReason),
      },
    });

    if (cardType === 'red') {
      if (match.status !== MatchStatus.LIVE) {
        throw new BadRequestException('红牌罚分只能在比赛进行中执行');
      }
      if (await this.isMatchPaused(matchId)) {
        throw new BadRequestException('比赛暂停中，不能执行红牌罚分');
      }
      const opponentSide: 1 | 2 = penalizedSide === 1 ? 2 : 1;
      return this.addPoint(matchId, opponentSide, user);
    }

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
      const existingGames = await tx.game.findMany({
        where: { matchId },
        orderBy: { gameNo: 'asc' },
      });
      const hasPlayedPoint = existingGames.some((game) => game.side1Score > 0 || game.side2Score > 0);
      if (!hasPlayedPoint) {
        const forfeitScoring = this.resolveMatchScoring(match);
        const { target, gamesToWin } = this.ruleConfig(
          forfeitScoring.scoringRule,
          forfeitScoring,
        );
        for (let gameNo = 1; gameNo <= gamesToWin; gameNo += 1) {
          await tx.game.upsert({
            where: { matchId_gameNo: { matchId, gameNo } },
            update: {
              side1Score: winnerSide === 1 ? target : 0,
              side2Score: winnerSide === 2 ? target : 0,
              winnerSide,
              completedAt: new Date(),
            },
            create: {
              matchId,
              gameNo,
              side1Score: winnerSide === 1 ? target : 0,
              side2Score: winnerSide === 2 ? target : 0,
              winnerSide,
              completedAt: new Date(),
            },
          });
        }
      }

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

      const secondStageSynced = await this.syncSecondStageFormalMatchResult(tx, match, winnerSide);
      if (!secondStageSynced) {
        await this.advanceSingleEliminationWinner(tx, match, winnerSide);
        await this.fillPlayoffMatchesIfReady(tx, match.eventId);
        await this.fillGroupKnockoutIfReady(tx, match.eventId);
      }
      await this.teamCompetitionsService.updateTeamMatchAggregate(tx, matchId);
    });

    this.gateway.emitBracketUpdate({
      tournamentId: match.event?.tournamentId ?? null,
      eventId: match.eventId,
      matchId,
    });

    return this.getMatchState(matchId, user);
  }

  async retireMatch(matchId: string, retiredSide: 1 | 2, user: AuthUser, reason?: string) {
    const cleanReason = reason?.trim() || '伤退/退赛';
    return this.forfeitMatch(matchId, retiredSide, user, `${RETIRE_NOTE_PREFIX}${cleanReason}`);
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
      const secondStageSynced = await this.syncSecondStageFormalMatchCancellation(tx, match);
      if (match.eventId && !secondStageSynced) {
        await this.clearSingleEliminationAdvancement(tx, match);
        await this.fillPlayoffMatchesIfReady(tx, match.eventId);
        await this.fillGroupKnockoutIfReady(tx, match.eventId);
      }

      await this.teamCompetitionsService.updateTeamMatchAggregate(tx, matchId);
    });

    this.gateway.emitBracketUpdate({
      tournamentId: match.event?.tournamentId ?? null,
      eventId: match.eventId,
      matchId,
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
    isTechnicalPauseGame: (gameNo: number) => boolean = () => true,
  ): MatchPauseState {
    let pauseStartedAt: Date | null = null;
    let pausedDurationMs = 0;
    let pauseKind: MatchPauseState['pauseKind'] = null;
    let pauseReason: string | null = null;
    const endLimit = finishedAt?.getTime() ?? null;

    for (const event of events) {
      if (endLimit !== null && event.createdAt.getTime() > endLimit) continue;
      const pauseNote = this.decodeMatchPauseNote(event.note);
      if (
        pauseNote?.kind === 'technical' &&
        (!pauseNote.gameNo || !isTechnicalPauseGame(pauseNote.gameNo))
      ) {
        continue;
      }
      if (pauseNote?.action === 'START' && !pauseStartedAt) {
        pauseStartedAt = event.createdAt;
        pauseKind = pauseNote.kind;
        pauseReason = pauseNote.reason;
      } else if (pauseNote?.action === 'END' && pauseStartedAt) {
        pausedDurationMs += Math.max(0, event.createdAt.getTime() - pauseStartedAt.getTime());
        pauseStartedAt = null;
        pauseKind = null;
        pauseReason = null;
      }
    }

    const paused = Boolean(pauseStartedAt && !finishedAt);
    return {
      paused,
      pausedAt: paused ? pauseStartedAt : null,
      pauseStartedAt: paused ? pauseStartedAt : null,
      pausedDurationMs,
      pauseKind: paused ? pauseKind : null,
      pauseReason: paused ? pauseReason : null,
    };
  }

  private async isMatchPaused(matchId: string) {
    const [match, events] = await Promise.all([
      this.prisma.match.findUnique({
        where: { id: matchId },
        include: {
          event: {
            select: {
              scoringRule: true,
              scoringMode: true,
              customGamePoint: true,
              customGameCap: true,
              customGamesToWin: true,
              stageScoringRules: true,
            },
          },
        },
      }),
      this.prisma.matchEvent.findMany({
        where: { matchId, type: MatchEventType.TIMEOUT },
        orderBy: { createdAt: 'asc' },
        select: { note: true, createdAt: true },
      }),
    ]);
    const matchScoring = this.resolveMatchScoring(match ?? {});
    return this.computePauseState(events, null, (gameNo) =>
      this.shouldUseTechnicalPauseInGame(gameNo, matchScoring.scoringRule, matchScoring),
    ).paused;
  }

  private encodeMatchPauseNote(action: 'START' | 'END', reason?: string) {
    const cleanReason = reason?.trim();
    return cleanReason ? `${MATCH_PAUSE_NOTE_PREFIX}${action}:${cleanReason}` : `${MATCH_PAUSE_NOTE_PREFIX}${action}`;
  }

  private encodeTechnicalPauseNote(action: 'START' | 'END', gameNo: number) {
    return `${TECHNICAL_PAUSE_NOTE_PREFIX}${action}:${gameNo}`;
  }

  private encodeIntervalRestNote(action: 'START' | 'END', gameNo: number) {
    return `${INTERVAL_REST_NOTE_PREFIX}${action}:${gameNo}`;
  }

  private decodeMatchPauseNote(note?: string | null): {
    action: 'START' | 'END';
    kind: 'manual' | 'technical' | 'interval';
    reason: string | null;
    gameNo?: number;
  } | null {
    if (note?.startsWith(MATCH_PAUSE_NOTE_PREFIX)) {
      const [, action, ...reasonParts] = note.split(':');
      if (action !== 'START' && action !== 'END') return null;
      return {
        action,
        kind: 'manual',
        reason: reasonParts.join(':') || null,
      };
    }
    if (note?.startsWith(TECHNICAL_PAUSE_NOTE_PREFIX)) {
      const [, action, gameNoText] = note.split(':');
      if (action !== 'START' && action !== 'END') return null;
      return {
        action,
        kind: 'technical',
        reason: '11 分技术暂停',
        gameNo: Number(gameNoText) || undefined,
      };
    }
    if (note?.startsWith(INTERVAL_REST_NOTE_PREFIX)) {
      const [, action, gameNoText] = note.split(':');
      if (action !== 'START' && action !== 'END') return null;
      return {
        action,
        kind: 'interval',
        reason: '局间休息 120 秒',
        gameNo: Number(gameNoText) || undefined,
      };
    }
    return null;
  }

  private shouldTriggerTechnicalPause(
    gameNo: number,
    side1Score: number,
    side2Score: number,
    rule: ScoringRule,
    eventOverrides?: {
      customGamePoint?: number | null;
      customGameCap?: number | null;
      customGamesToWin?: number | null;
    } | null,
  ) {
    if (side1Score !== 11 && side2Score !== 11) return false;
    return this.shouldUseTechnicalPauseInGame(gameNo, rule, eventOverrides);
  }

  private shouldUseTechnicalPauseInGame(
    gameNo: number,
    rule: ScoringRule,
    eventOverrides?: {
      customGamePoint?: number | null;
      customGameCap?: number | null;
      customGamesToWin?: number | null;
    } | null,
  ) {
    const { target, gamesToWin } = this.ruleConfig(rule, eventOverrides);
    return gamesToWin === 1 && target === 31 && gameNo === 1;
  }

  private hasTechnicalPauseForGame(events: Array<{ note: string | null }>, gameNo: number) {
    return events.some((event) => {
      const pauseNote = this.decodeMatchPauseNote(event.note);
      return pauseNote?.kind === 'technical' && pauseNote.gameNo === gameNo;
    });
  }

  private computeCourtDisplayState(events: Array<{ note: string | null }>): CourtDisplayState {
    const swapCount = events.filter((event) => this.decodeCourtSwapNote(event.note) !== null).length;
    const swapped = swapCount % 2 === 1;
    return {
      side1CourtSide: swapped ? 'right' : 'left',
      side2CourtSide: swapped ? 'left' : 'right',
      swapCount,
    };
  }

  private computeCourtSwapRequired(
    events: Array<{ note: string | null }>,
    isRequiredGame: (gameNo: number) => boolean = () => true,
  ) {
    const requiredGameNos = events
      .map((event) => this.decodeCourtSwapRequiredNote(event.note))
      .filter((gameNo): gameNo is number => typeof gameNo === 'number' && isRequiredGame(gameNo));
    if (!requiredGameNos.length) return { required: false, gameNo: null as number | null };
    const latestGameNo = requiredGameNos.at(-1)!;
    return {
      required: !this.hasCourtSwapForGame(events, latestGameNo),
      gameNo: latestGameNo,
    };
  }

  private async isCourtSwapRequired(matchId: string) {
    const [match, events] = await Promise.all([
      this.prisma.match.findUnique({
        where: { id: matchId },
        include: {
          event: {
            select: {
              scoringRule: true,
              scoringMode: true,
              customGamePoint: true,
              customGameCap: true,
              customGamesToWin: true,
              stageScoringRules: true,
            },
          },
        },
      }),
      this.prisma.matchEvent.findMany({
        where: {
          matchId,
          type: MatchEventType.SERVE_CHANGE,
          OR: [
            { note: { startsWith: COURT_SWAP_NOTE_PREFIX } },
            { note: { startsWith: COURT_SWAP_REQUIRED_NOTE_PREFIX } },
          ],
        },
        orderBy: { createdAt: 'asc' },
        select: { note: true },
      }),
    ]);
    const matchScoring = this.resolveMatchScoring(match ?? {});
    return this.computeCourtSwapRequired(events, (gameNo) =>
      this.shouldRequireCourtSwapInGame(gameNo, matchScoring.scoringRule, matchScoring),
    ).required;
  }

  private hasCourtSwapForGame(events: Array<{ note: string | null }>, gameNo: number) {
    return events.some((event) => this.decodeCourtSwapNote(event.note) === gameNo);
  }

  private hasCourtSwapRequiredForGame(events: Array<{ note: string | null }>, gameNo: number) {
    return events.some((event) => this.decodeCourtSwapRequiredNote(event.note) === gameNo);
  }

  private encodeCourtSwapRequiredNote(gameNo: number) {
    return `${COURT_SWAP_REQUIRED_NOTE_PREFIX}${gameNo}`;
  }

  private decodeCourtSwapRequiredNote(note?: string | null) {
    if (!note?.startsWith(COURT_SWAP_REQUIRED_NOTE_PREFIX)) return null;
    return Number(note.slice(COURT_SWAP_REQUIRED_NOTE_PREFIX.length)) || null;
  }

  private encodeCourtSwapNote(gameNo: number) {
    return `${COURT_SWAP_NOTE_PREFIX}${gameNo}`;
  }

  private decodeCourtSwapNote(note?: string | null) {
    if (!note?.startsWith(COURT_SWAP_NOTE_PREFIX)) return null;
    return Number(note.slice(COURT_SWAP_NOTE_PREFIX.length)) || null;
  }

  private shouldRequireCourtSwapInGame(
    gameNo: number,
    rule: ScoringRule,
    eventOverrides?: {
      customGamePoint?: number | null;
      customGameCap?: number | null;
      customGamesToWin?: number | null;
    } | null,
  ) {
    const { target, gamesToWin } = this.ruleConfig(rule, eventOverrides);
    if (gamesToWin === 1) return target === 31 && gameNo === 1;
    return gameNo === gamesToWin * 2 - 1;
  }

  private swapServingStateCourtSides(state: ServingState): ServingState {
    const side1Positions = this.flipPositions(state.side1Positions);
    const side2Positions = this.flipPositions(state.side2Positions);
    const serverCourtSide = state.serverCourtSide ? this.oppositeCourtSide(state.serverCourtSide) : null;
    const receiverCourtSide = state.receiverCourtSide ? this.oppositeCourtSide(state.receiverCourtSide) : null;
    return {
      ...state,
      serverCourtSide,
      receiverCourtSide,
      side1Positions,
      side2Positions,
    };
  }

  private flipPositions(positions: Record<CourtSide, PlayerIndex | null>) {
    return {
      left: positions.right,
      right: positions.left,
    } as Record<CourtSide, PlayerIndex | null>;
  }

  private encodeFaultNote(faultType: string, playerIndex?: PlayerIndex) {
    return JSON.stringify({
      kind: FAULT_NOTE_PREFIX,
      faultType,
      playerIndex: playerIndex ?? null,
    });
  }

  private encodeCardNote(cardType: 'yellow' | 'red' | 'black', playerIndex?: PlayerIndex, reason?: string | null) {
    return JSON.stringify({
      kind: CARD_NOTE_PREFIX,
      cardType,
      playerIndex: playerIndex ?? null,
      reason: reason ?? null,
    });
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
      forceServerRight?: boolean;
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
    if (options?.forceServerRight || this.courtSideOfPlayer(positions, serverPlayerIndex) === null) {
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
    return [
      SERVING_STATE_NOTE_PREFIX,
      state.gameNo,
      this.encodeSideValue(state.servingSide),
      this.encodePlayerValue(state.serverPlayerIndex),
      this.encodeCourtSideValue(state.serverCourtSide),
      this.encodeSideValue(state.receivingSide),
      this.encodePlayerValue(state.receiverPlayerIndex),
      this.encodeCourtSideValue(state.receiverCourtSide),
      this.encodePlayerValue(state.side1Positions.left),
      this.encodePlayerValue(state.side1Positions.right),
      this.encodePlayerValue(state.side2Positions.left),
      this.encodePlayerValue(state.side2Positions.right),
    ].join('|');
  }

  private decodeServingState(note?: string | null): ServingState | null {
    if (!note) return null;
    if (note.startsWith(SERVING_STATE_NOTE_PREFIX)) {
      const [
        ,
        gameNoText,
        servingSideText,
        serverPlayerText,
        serverCourtText,
        receivingSideText,
        receiverPlayerText,
        receiverCourtText,
        side1LeftText,
        side1RightText,
        side2LeftText,
        side2RightText,
      ] = note.split('|');
      return {
        gameNo: Number(gameNoText) || 1,
        servingSide: this.decodeSideValue(servingSideText),
        serverPlayerIndex: this.decodePlayerValue(serverPlayerText),
        serverCourtSide: this.decodeCourtSideValue(serverCourtText),
        receivingSide: this.decodeSideValue(receivingSideText),
        receiverPlayerIndex: this.decodePlayerValue(receiverPlayerText),
        receiverCourtSide: this.decodeCourtSideValue(receiverCourtText),
        side1Positions: {
          left: this.decodePlayerValue(side1LeftText),
          right: this.decodePlayerValue(side1RightText),
        },
        side2Positions: {
          left: this.decodePlayerValue(side2LeftText),
          right: this.decodePlayerValue(side2RightText),
        },
      };
    }
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

  private encodeSideValue(value: 1 | 2 | null) {
    return value === 1 || value === 2 ? String(value) : '0';
  }

  private decodeSideValue(value?: string): 1 | 2 | null {
    return value === '1' ? 1 : value === '2' ? 2 : null;
  }

  private encodePlayerValue(value: PlayerIndex | null) {
    return value === 1 || value === 2 ? String(value) : '0';
  }

  private decodePlayerValue(value?: string): PlayerIndex | null {
    return value === '1' ? 1 : value === '2' ? 2 : null;
  }

  private encodeCourtSideValue(value: CourtSide | null) {
    return value === 'left' ? 'l' : value === 'right' ? 'r' : '0';
  }

  private decodeCourtSideValue(value?: string): CourtSide | null {
    return value === 'l' ? 'left' : value === 'r' ? 'right' : null;
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

  /**
   * 小组循环 + 交叉排位赛专用：当某单项的全部小组赛（roundNo = 0）都结束后，
   * 按各组名次自动填充排位赛占位场——第 k 场 = A 组第 k 名 vs B 组第 k 名。
   * 仅填充尚未开打（PENDING）的排位赛；某组缺第 k 名时另一组轮空直接晋级。
   */
  private async fillPlayoffMatchesIfReady(
    tx: Prisma.TransactionClient,
    eventId: string | null,
  ) {
    if (!eventId) return;
    const event = await tx.event.findUnique({
      where: { id: eventId },
      select: { format: true },
    });
    if (event?.format !== Format.GROUP_PLUS_PLAYOFF) return;

    const groupMatches = await tx.match.findMany({
      where: { eventId, roundNo: 0 },
      include: { games: true },
    });
    if (!groupMatches.length) return;
    const allSettled = groupMatches.every(
      (m) => m.status === MatchStatus.COMPLETED || m.status === MatchStatus.CANCELLED,
    );
    if (!allSettled) return;

    const playoffMatches = await tx.match.findMany({
      where: { eventId, roundNo: 1, round: { startsWith: 'P' }, status: MatchStatus.PENDING },
      orderBy: { matchNo: 'asc' },
    });
    if (!playoffMatches.length) return;

    const rankedByGroup = this.computeGroupRanking(groupMatches);
    const codes = [...rankedByGroup.keys()].sort();
    const groupA = rankedByGroup.get(codes[0]) ?? [];
    const groupB = rankedByGroup.get(codes[1]) ?? [];

    for (const pm of playoffMatches) {
      const aId = groupA[pm.matchNo - 1] ?? null;
      const bId = groupB[pm.matchNo - 1] ?? null;
      // 某组缺第 k 名（两组人数不等）：另一组的第 k 名轮空，直接获得该名次段高位。
      const walkoverWinner = aId && !bId ? 1 : bId && !aId ? 2 : null;
      await tx.match.update({
        where: { id: pm.id },
        data: {
          side1Id: aId,
          side2Id: bId,
          ...(walkoverWinner
            ? { status: MatchStatus.COMPLETED, winnerSide: walkoverWinner, finishedAt: new Date() }
            : {}),
        },
      });
    }
  }

  /** 按组统计组内循环战绩（胜场→净小分→负场），返回每组按名次排序的选手 id 列表。 */
  private computeGroupRanking(
    groupMatches: Array<{
      round: string;
      side1Id: string | null;
      side2Id: string | null;
      status: MatchStatus;
      winnerSide: number | null;
      games: Array<{ side1Score: number; side2Score: number }>;
    }>,
  ): Map<string, string[]> {
    type Stat = { id: string; wins: number; losses: number; gameDiff: number };
    const groups = new Map<string, Map<string, Stat>>();
    const ensure = (code: string, id: string) => {
      let group = groups.get(code);
      if (!group) {
        group = new Map();
        groups.set(code, group);
      }
      let stat = group.get(id);
      if (!stat) {
        stat = { id, wins: 0, losses: 0, gameDiff: 0 };
        group.set(id, stat);
      }
      return stat;
    };

    for (const m of groupMatches) {
      if (!m.side1Id || !m.side2Id) continue;
      const a = ensure(m.round, m.side1Id);
      const b = ensure(m.round, m.side2Id);
      if (m.status === MatchStatus.COMPLETED && m.winnerSide) {
        if (m.winnerSide === 1) {
          a.wins += 1;
          b.losses += 1;
        } else {
          b.wins += 1;
          a.losses += 1;
        }
        for (const game of m.games) {
          a.gameDiff += game.side1Score - game.side2Score;
          b.gameDiff += game.side2Score - game.side1Score;
        }
      }
    }

    const ranked = new Map<string, string[]>();
    for (const [code, members] of groups) {
      const sorted = [...members.values()].sort(
        (x, y) => y.wins - x.wins || y.gameDiff - x.gameDiff || x.losses - y.losses,
      );
      ranked.set(
        code,
        sorted.map((stat) => stat.id),
      );
    }
    return ranked;
  }

  /**
   * 标准小组循环+淘汰(GROUP_PLUS_KNOCKOUT_STD)专用：小组赛(roundNo=0)全部完赛后，
   * 按《羽毛球竞赛规则2023》官方名次规则取各组前 N 名，用标准种子交叉编入单淘汰签表
   * 并落库；之后的晋级推进沿用 advanceSingleEliminationWinner。
   * 幂等：已存在淘汰赛场次(roundNo>=1)时直接返回，避免重复生成。
   */
  private async fillGroupKnockoutIfReady(
    tx: Prisma.TransactionClient,
    eventId: string | null,
  ) {
    if (!eventId) return;
    const event = await tx.event.findUnique({
      where: { id: eventId },
      select: { format: true, qualifiersPerGroup: true },
    });
    if (event?.format !== Format.GROUP_PLUS_KNOCKOUT_STD) return;

    const existingKnockout = await tx.match.count({
      where: { eventId, roundNo: { gte: 1 } },
    });
    if (existingKnockout > 0) return;

    const groupMatches = await tx.match.findMany({
      where: { eventId, roundNo: 0 },
      include: { games: true },
    });
    if (!groupMatches.length) return;
    const allSettled = groupMatches.every(
      (m) => m.status === MatchStatus.COMPLETED || m.status === MatchStatus.CANCELLED,
    );
    if (!allSettled) return;

    const rankedByGroup = this.computeOfficialGroupRanking(groupMatches);
    const qualifiersPerGroup = Math.max(1, event.qualifiersPerGroup ?? 2);
    const groupCodes = [...rankedByGroup.keys()].sort();

    // 种子序：各组第 1 名(按组别 A,B,C… 顺序)在前，再各组第 2 名……
    // 配合标准种子位，保证组冠军被尽量分散、且第一轮不会出现同组重赛。
    const seedList: string[] = [];
    for (let rank = 0; rank < qualifiersPerGroup; rank += 1) {
      for (const code of groupCodes) {
        const id = rankedByGroup.get(code)?.[rank];
        if (id) seedList.push(id);
      }
    }
    if (seedList.length < 2) return;
    if (seedList.length <= 8) return;

    const slots = this.buildCanonicalKnockoutSlots(seedList);
    const drafts = this.buildEliminationDrafts(slots);
    await this.createKnockoutMatches(tx, eventId, drafts);
  }

  /**
   * 官方名次规则(《羽毛球竞赛规则2023》1.3)：
   * 胜场 → 相互胜负 → 净胜局 → 净胜分 → 抽签。
   * 采用「分桶递归」实现官方的级联逻辑：两人并列时先看相互胜负，三人及以上
   * 并列时先比净胜局/净胜分，缩小到两人再看相互胜负，最终仍相等以稳定序代替抽签。
   */
  private computeOfficialGroupRanking(
    groupMatches: Array<{
      round: string;
      side1Id: string | null;
      side2Id: string | null;
      status: MatchStatus;
      winnerSide: number | null;
      games: Array<{ side1Score: number; side2Score: number; winnerSide: number | null }>;
    }>,
  ): Map<string, string[]> {
    type Stat = { id: string; wins: number; netGames: number; netPoints: number };
    const groups = new Map<string, Map<string, Stat>>();
    // 每组的相互胜负：code -> winnerId -> loserId -> 胜场数
    const head = new Map<string, Map<string, Map<string, number>>>();

    const ensureStat = (code: string, id: string) => {
      let g = groups.get(code);
      if (!g) groups.set(code, (g = new Map()));
      let s = g.get(id);
      if (!s) g.set(id, (s = { id, wins: 0, netGames: 0, netPoints: 0 }));
      return s;
    };
    const addHead = (code: string, winnerId: string, loserId: string) => {
      let g = head.get(code);
      if (!g) head.set(code, (g = new Map()));
      let w = g.get(winnerId);
      if (!w) g.set(winnerId, (w = new Map()));
      w.set(loserId, (w.get(loserId) ?? 0) + 1);
    };

    for (const m of groupMatches) {
      if (!m.side1Id || !m.side2Id) continue;
      const a = ensureStat(m.round, m.side1Id);
      const b = ensureStat(m.round, m.side2Id);
      if (m.status !== MatchStatus.COMPLETED || !m.winnerSide) continue;
      let aGames = 0;
      let bGames = 0;
      for (const game of m.games) {
        if (game.winnerSide === 1) aGames += 1;
        else if (game.winnerSide === 2) bGames += 1;
        a.netPoints += game.side1Score - game.side2Score;
        b.netPoints += game.side2Score - game.side1Score;
      }
      a.netGames += aGames - bGames;
      b.netGames += bGames - aGames;
      if (m.winnerSide === 1) {
        a.wins += 1;
        addHead(m.round, m.side1Id, m.side2Id);
      } else {
        b.wins += 1;
        addHead(m.round, m.side2Id, m.side1Id);
      }
    }

    const headBetween = (code: string, x: string, y: string) => {
      const g = head.get(code);
      const xy = g?.get(x)?.get(y) ?? 0;
      const yx = g?.get(y)?.get(x) ?? 0;
      return xy - yx;
    };

    const order = (code: string, members: Stat[], stage: 'wins' | 'netGames' | 'netPoints'): Stat[] => {
      if (members.length <= 1) return members;
      const keyOf = (s: Stat) =>
        stage === 'wins' ? s.wins : stage === 'netGames' ? s.netGames : s.netPoints;
      const sorted = [...members].sort((a, b) => keyOf(b) - keyOf(a));
      const buckets: Stat[][] = [];
      for (const s of sorted) {
        const last = buckets[buckets.length - 1];
        if (last && keyOf(last[0]) === keyOf(s)) last.push(s);
        else buckets.push([s]);
      }
      const nextStage = (bucket: Stat[]): Stat[] =>
        stage === 'wins'
          ? order(code, bucket, 'netGames')
          : stage === 'netGames'
            ? order(code, bucket, 'netPoints')
            : bucket; // 净胜分仍相等：以稳定序代替抽签
      const result: Stat[] = [];
      for (const bucket of buckets) {
        if (bucket.length === 1) {
          result.push(bucket[0]);
        } else if (bucket.length === 2) {
          const h = headBetween(code, bucket[0].id, bucket[1].id);
          if (h > 0) result.push(bucket[0], bucket[1]);
          else if (h < 0) result.push(bucket[1], bucket[0]);
          else result.push(...nextStage(bucket));
        } else {
          result.push(...nextStage(bucket));
        }
      }
      return result;
    };

    const ranked = new Map<string, string[]>();
    for (const [code, members] of groups) {
      ranked.set(code, order(code, [...members.values()], 'wins').map((s) => s.id));
    }
    return ranked;
  }

  /** 单淘汰标准种子位序列(递归对折)：返回每个签位对应的种子号。 */
  private canonicalSeedOrder(bracketSize: number): number[] {
    let seeds = [1, 2];
    while (seeds.length < bracketSize) {
      const sum = seeds.length * 2 + 1;
      const next: number[] = [];
      for (const s of seeds) {
        next.push(s);
        next.push(sum - s);
      }
      seeds = next;
    }
    return seeds;
  }

  /** 按种子序把出线选手放进 2 的幂签表，空位为轮空(null)，轮空落在高种子侧。 */
  private buildCanonicalKnockoutSlots(seedList: string[]): Array<string | null> {
    const n = seedList.length;
    const bracketSize = 2 ** Math.ceil(Math.log2(Math.max(2, n)));
    return this.canonicalSeedOrder(bracketSize).map((seedNo) =>
      seedNo <= n ? seedList[seedNo - 1] : null,
    );
  }

  /** 由签位顺序生成整张单淘汰签表草稿(含轮空直接晋级、季军赛占位)。 */
  private buildEliminationDrafts(slots: Array<string | null>): Array<{
    round: string;
    roundNo: number;
    matchNo: number;
    side1Id: string | null;
    side2Id: string | null;
    status: MatchStatus;
    winnerSide: number | null;
  }> {
    const label = (slotCount: number) => {
      if (slotCount === 2) return 'F';
      if (slotCount === 4) return 'SF';
      if (slotCount === 8) return 'QF';
      return `R${Math.log2(slotCount) - 3}`;
    };
    const entrantCount = slots.filter((id) => id).length;
    const drafts: Array<{
      round: string;
      roundNo: number;
      matchNo: number;
      side1Id: string | null;
      side2Id: string | null;
      status: MatchStatus;
      winnerSide: number | null;
    }> = [];
    let roundNo = 1;
    let current = slots.map((id) => ({ entrantId: id, isPendingWinner: false }));
    while (current.length >= 2) {
      const roundLabel = label(current.length);
      const next: Array<{ entrantId: string | null; isPendingWinner: boolean }> = [];
      for (let i = 0; i < current.length; i += 2) {
        const s1 = current[i];
        const s2 = current[i + 1];
        const id1 = s1?.entrantId ?? null;
        const id2 = s2?.entrantId ?? null;
        const s1Bye = !id1 && !s1?.isPendingWinner;
        const s2Bye = !id2 && !s2?.isPendingWinner;
        const bothByes = s1Bye && s2Bye;
        const hasBye = (Boolean(id1) && s2Bye) || (Boolean(id2) && s1Bye);
        drafts.push({
          round: roundLabel,
          roundNo,
          matchNo: i / 2 + 1,
          side1Id: id1,
          side2Id: id2,
          status: hasBye || bothByes ? MatchStatus.COMPLETED : MatchStatus.PENDING,
          winnerSide: hasBye ? (id1 ? 1 : 2) : null,
        });
        next.push({
          entrantId: hasBye ? (id1 ?? id2) : null,
          isPendingWinner: !hasBye && !bothByes,
        });
      }
      current = next;
      roundNo += 1;
    }
    const finalRoundNo = roundNo - 1;
    if (entrantCount >= 4 && finalRoundNo > 1) {
      drafts.push({
        round: 'BRONZE',
        roundNo: finalRoundNo,
        matchNo: 2,
        side1Id: null,
        side2Id: null,
        status: MatchStatus.PENDING,
        winnerSide: null,
      });
    }
    return drafts;
  }

  private async createKnockoutMatches(
    tx: Prisma.TransactionClient,
    eventId: string,
    drafts: Array<{
      round: string;
      roundNo: number;
      matchNo: number;
      side1Id: string | null;
      side2Id: string | null;
      status: MatchStatus;
      winnerSide: number | null;
    }>,
  ) {
    const event = await tx.event.findUnique({
      where: { id: eventId },
      select: { defaultMatchMinutes: true, tournament: { select: { defaultMatchMinutes: true } } },
    });
    const minutes = event?.defaultMatchMinutes ?? event?.tournament?.defaultMatchMinutes ?? 45;
    for (const draft of drafts) {
      await tx.match.create({
        data: {
          eventId,
          round: draft.round,
          roundNo: draft.roundNo,
          matchNo: draft.matchNo,
          side1Id: draft.side1Id,
          side2Id: draft.side2Id,
          status: draft.status,
          winnerSide: draft.winnerSide,
          durationMinutes: minutes,
        },
      });
    }
  }

  private async syncSecondStageFormalMatchResult(
    tx: Prisma.TransactionClient,
    match: {
      id: string;
      eventId: string | null;
      roundNo: number;
      matchNo: number;
      side1Id: string | null;
      side2Id: string | null;
    },
    winnerSide: 1 | 2,
  ) {
    if (!match.eventId || !isSecondStageFormalRoundNo(match.roundNo)) return false;

    const stage = await tx.secondStage.findUnique({
      where: { eventId: match.eventId },
      include: { matches: { orderBy: { matchNo: 'asc' } } },
    });
    if (!stage) return true;

    const stageMatch = stage.matches.find((item) => item.matchNo === match.matchNo);
    if (!stageMatch) return true;

    const games = await tx.game.findMany({
      where: { matchId: match.id },
      orderBy: { gameNo: 'asc' },
    });
    const winnerId = winnerSide === 1 ? match.side1Id : match.side2Id;
    const winnerName =
      winnerSide === 1 ? stageMatch.side1NameSnapshot : stageMatch.side2NameSnapshot;

    await tx.secondStageMatch.update({
      where: { id: stageMatch.id },
      data: {
        score: this.scoreTextFromGames(games),
        status: MatchStatus.COMPLETED,
        winnerSide,
        winnerId,
        winnerNameSnapshot: winnerName,
      },
    });

    await this.secondStageProgress.progress(tx, {
      secondStageId: stage.id,
      eventId: match.eventId,
      rankingMode: stage.rankingMode,
    });
    await tx.secondStage.update({
      where: { id: stage.id },
      data: { updatedBy: 'system' },
    });
    return true;
  }

  private async syncSecondStageFormalMatchCancellation(
    tx: Prisma.TransactionClient,
    match: {
      eventId: string | null;
      roundNo: number;
      matchNo: number;
    },
  ) {
    if (!match.eventId || !isSecondStageFormalRoundNo(match.roundNo)) return false;

    const stage = await tx.secondStage.findUnique({
      where: { eventId: match.eventId },
      include: { matches: { where: { matchNo: match.matchNo } } },
    });
    if (!stage) return true;
    const stageMatch = stage.matches[0];
    if (!stageMatch) return true;

    await tx.secondStageMatch.update({
      where: { id: stageMatch.id },
      data: {
        score: null,
        status: MatchStatus.CANCELLED,
        winnerSide: null,
        winnerId: null,
        winnerNameSnapshot: null,
      },
    });
    await tx.secondStage.update({
      where: { id: stage.id },
      data: { status: SecondStageStatus.CONFIRMED, finishedAt: null, updatedBy: 'system' },
    });
    return true;
  }

  private scoreTextFromGames(games: Array<{ side1Score: number; side2Score: number }>) {
    return games.length
      ? games.map((game) => `${game.side1Score}:${game.side2Score}`).join(' / ')
      : '';
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
    if (!match.eventId || match.roundNo < 1 || isSecondStageFormalRoundNo(match.roundNo)) return;

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
    if (!match.eventId || match.roundNo < 1 || isSecondStageFormalRoundNo(match.roundNo)) return;

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

  /**
   * 解析某场比赛实际生效的计分规则。
   * 生效顺序：具体阶段（半决赛/季军赛/决赛）→ 四强 → 八强/默认。
   * BEFORE_TOP4 是旧两段配置的兼容键。
   */
  private resolveMatchScoring(match: {
    round?: string | null;
    roundNo?: number | null;
    matchNo?: number | null;
    event?: {
      scoringRule: ScoringRule;
      scoringMode: ScoringMode;
      customGamePoint: number | null;
      customGameCap: number | null;
      customGamesToWin: number | null;
      stageScoringRules?: Prisma.JsonValue | null;
    } | null;
  }): MatchScoringConfig {
    const base: MatchScoringConfig = {
      scoringRule: match.event?.scoringRule ?? ScoringRule.TWENTYONE_BO3,
      scoringMode: match.event?.scoringMode ?? ScoringMode.CAPPED_30,
      customGamePoint: match.event?.customGamePoint ?? null,
      customGameCap: match.event?.customGameCap ?? null,
      customGamesToWin: match.event?.customGamesToWin ?? null,
      appliedStage: null as string | null,
    };

    const raw = match.event?.stageScoringRules;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;

    const rules = raw as Record<string, unknown>;
    for (const key of this.stageRuleLookupKeys(match)) {
      const resolved = this.resolveStageScoringRule(rules[key], base, key);
      if (resolved) return resolved;
    }

    return base;
  }

  private stageRuleLookupKeys(match: {
    round?: string | null;
    roundNo?: number | null;
    matchNo?: number | null;
  }) {
    const keys: string[] = [];
    const exactStage = this.exactScoringStageKey(match);
    if (exactStage) keys.push(exactStage);
    if (exactStage && ['SF', 'BRONZE', 'F'].includes(exactStage)) keys.push('TOP4');
    if (exactStage === 'QF') keys.push('BEFORE_TOP4');
    if (!exactStage && this.isTop4Match(match)) keys.push('TOP4');
    if (!exactStage && !this.isTop4Match(match)) keys.push('BEFORE_TOP4');
    return [...new Set(keys)];
  }

  private exactScoringStageKey(match: {
    round?: string | null;
    roundNo?: number | null;
    matchNo?: number | null;
  }) {
    if (
      typeof match.roundNo === 'number' &&
      isSecondStageFormalRoundNo(match.roundNo) &&
      typeof match.matchNo === 'number'
    ) {
      if ([5, 6].includes(match.matchNo)) return 'SF';
      if (match.matchNo === 7) return 'F';
      if (match.matchNo === 8) return 'BRONZE';
      return 'QF';
    }

    const round = match.round?.trim();
    if (!round || round === 'TOP4' || round === 'BEFORE_TOP4') return null;
    if (['QF', 'SF', 'BRONZE', 'F'].includes(round)) return round;
    if (round === '决赛') return 'F';
    if (round === '三四名决赛') return 'BRONZE';
    if (round.startsWith('1-4名')) return 'SF';
    if (round.startsWith('前8') || round.startsWith('5-8名') || round === '五六名决赛' || round === '七八名决赛') {
      return 'QF';
    }
    return null;
  }

  private isTop4Match(match: {
    round?: string | null;
    roundNo?: number | null;
    matchNo?: number | null;
  }) {
    if (
      typeof match.roundNo === 'number' &&
      isSecondStageFormalRoundNo(match.roundNo) &&
      typeof match.matchNo === 'number'
    ) {
      return [5, 6, 7, 8].includes(match.matchNo);
    }

    const round = match.round?.trim();
    if (!round) return false;
    if (['SF', 'BRONZE', 'F'].includes(round)) return true;
    return round === '决赛' || round === '三四名决赛' || round.startsWith('1-4名');
  }

  private resolveStageScoringRule(
    stageRaw: unknown,
    base: MatchScoringConfig,
    appliedStage: string,
  ): MatchScoringConfig | null {
    if (!stageRaw || typeof stageRaw !== 'object' || Array.isArray(stageRaw)) return null;
    const stage = stageRaw as Record<string, unknown>;

    const stageRule =
      typeof stage.scoringRule === 'string' &&
      (Object.values(ScoringRule) as string[]).includes(stage.scoringRule)
        ? (stage.scoringRule as ScoringRule)
        : null;
    const toPositiveInt = (value: unknown) =>
      typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
    const customGamePoint = toPositiveInt(stage.customGamePoint);
    const customGameCap = toPositiveInt(stage.customGameCap);
    const customGamesToWin = toPositiveInt(stage.customGamesToWin);

    if (!stageRule && !customGamePoint) return null;

    return {
      scoringRule: stageRule ?? base.scoringRule,
      // 计分模式（封顶/金球）全单项统一，不按阶段拆分
      scoringMode: base.scoringMode,
      customGamePoint,
      customGameCap,
      customGamesToWin,
      appliedStage,
    };
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

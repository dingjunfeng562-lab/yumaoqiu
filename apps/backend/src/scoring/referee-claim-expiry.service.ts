import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { MatchStatus, Prisma } from '@prisma/client';
import { clearMatchResults } from '../common/clear-match-results';
import { PrismaService } from '../prisma/prisma.service';
import { TeamCompetitionsService } from '../team-competitions/team-competitions.service';
import { ScoringGateway } from './scoring.gateway';
import { ScoringService } from './scoring.service';

const CHECK_INTERVAL_MS = 10_000;

@Injectable()
export class RefereeClaimExpiryService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RefereeClaimExpiryService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly teams: TeamCompetitionsService,
    private readonly scoring: ScoringService,
    private readonly gateway: ScoringGateway,
  ) {}

  onApplicationBootstrap() {
    void this.expireDueClaims();
    this.timer = setInterval(() => void this.expireDueClaims(), CHECK_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async expireDueClaims(now = new Date()) {
    if (this.running) return;
    this.running = true;
    const due: Prisma.MatchWhereInput = {
      refereeId: { not: null },
      status: { in: [MatchStatus.PENDING, MatchStatus.LIVE] },
      refereeClaimExpiresAt: { lte: now },
    };
    try {
      const matches = await this.prisma.match.findMany({
        where: due,
        select: { id: true },
        orderBy: { refereeClaimExpiresAt: 'asc' },
        take: 100,
      });
      for (const { id } of matches) {
        try {
          const changes = await this.expireMatch(id, due);
          if (!changes) continue;
          this.gateway.emitBracketUpdate(changes);
          this.gateway.emitMatchState(id, await this.scoring.getMatchState(id));
        } catch (error) {
          this.logger.error(`处理超时执裁场次 ${id} 失败`, error);
        }
      }
    } catch (error) {
      this.logger.error('扫描超时执裁场次失败', error);
    } finally {
      this.running = false;
    }
  }

  private expireMatch(id: string, due: Prisma.MatchWhereInput) {
    return this.prisma.$transaction(async tx => {
      await this.teams.lockScoringMatch(tx, id);
      // Scoring and the expiry job take the same locks. Check again after waiting
      // so a committed finish, reassignment or reset wins over this scan.
      const match = await tx.match.findFirst({
        where: { ...due, id },
        select: {
          status: true,
          winnerSide: true,
          eventId: true,
          event: { select: { tournamentId: true } },
          teamMatch: { select: { status: true, teamCompetition: { select: { tournamentId: true } } } },
          referee: { select: { username: true } },
          games: { orderBy: { gameNo: 'asc' }, select: { side1Score: true, side2Score: true } },
        },
      });
      if (!match) return null;

      await clearMatchResults(tx, { id }, '执裁超过3小时未完赛');
      if (match.teamMatch?.status === MatchStatus.LIVE) {
        await this.teams.updateTeamMatchAggregate(tx, id);
      }
      const tournamentId = match.event?.tournamentId ?? match.teamMatch?.teamCompetition.tournamentId;
      if (tournamentId) {
        await tx.matchOperationLog.create({
          data: {
            matchId: id,
            tournamentId,
            action: 'RELEASE_REFEREE',
            operatorName: '系统（执裁超时）',
            beforeData: {
              status: match.status,
              winnerSide: match.winnerSide,
              referee: match.referee?.username ?? null,
              score: match.games.map(game => `${game.side1Score}:${game.side2Score}`).join(' / '),
            },
            afterData: { status: MatchStatus.PENDING, winnerSide: null, referee: null, score: '' },
          },
        });
      }
      return { matchId: id, tournamentId, eventId: match.eventId };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }
}

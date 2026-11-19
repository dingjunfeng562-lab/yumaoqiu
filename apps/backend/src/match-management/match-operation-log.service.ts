import { Injectable, Logger } from '@nestjs/common';
import { MatchStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** 操作类型：改时间/场地/时长/裁判 · 改比分 · 结束 · 重开 · 解除裁判。 */
export type MatchOperationAction = 'UPDATE_INFO' | 'CORRECT_SCORE' | 'COMPLETE' | 'REOPEN' | 'RELEASE_REFEREE';

/** 记在操作记录里的场次快照：前后两份一比就知道改了什么。 */
export type MatchSnapshot = {
  status: MatchStatus;
  winnerSide: number | null;
  scheduledAt: string | null;
  durationMinutes: number;
  venue: string | null;
  referee: string | null;
  score: string;
};

export type MatchOperator = { id?: string | null; username?: string | null } | null | undefined;

const SNAPSHOT_KEYS: Array<keyof MatchSnapshot> = ['status', 'winnerSide', 'scheduledAt', 'durationMinutes', 'venue', 'referee', 'score'];

/**
 * 裁判员对局管理的操作记录。下放给管理员后，改判、重开这类操作必须留痕：
 * 谁、什么时候、改了哪一场、改前改后。只记成功的操作；记录本身失败不影响操作结果。
 */
@Injectable()
export class MatchOperationLogService {
  private readonly logger = new Logger(MatchOperationLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async snapshot(matchId: string): Promise<MatchSnapshot | null> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: {
        status: true,
        winnerSide: true,
        scheduledAt: true,
        durationMinutes: true,
        venue: { select: { name: true } },
        referee: { select: { username: true } },
        games: { orderBy: { gameNo: 'asc' }, select: { side1Score: true, side2Score: true } },
      },
    });
    if (!match) return null;
    return {
      status: match.status,
      winnerSide: match.winnerSide,
      scheduledAt: match.scheduledAt?.toISOString() ?? null,
      durationMinutes: match.durationMinutes,
      venue: match.venue?.name ?? null,
      referee: match.referee?.username ?? null,
      score: match.games.map((game) => `${game.side1Score}:${game.side2Score}`).join(' / '),
    };
  }

  /** 只记有变化的字段；什么都没变（比如重复保存）就不记。 */
  async record(params: {
    matchId: string;
    tournamentId: string;
    action: MatchOperationAction;
    operator: MatchOperator;
    before: MatchSnapshot | null;
    after: MatchSnapshot | null;
  }) {
    const { before, after } = params;
    const changed = SNAPSHOT_KEYS.filter((key) => (before?.[key] ?? null) !== (after?.[key] ?? null));
    if (!changed.length) return null;
    const pick = (snapshot: MatchSnapshot | null) =>
      snapshot ? (Object.fromEntries(changed.map((key) => [key, snapshot[key]])) as Prisma.InputJsonValue) : Prisma.DbNull;
    try {
      return await this.prisma.matchOperationLog.create({
        data: {
          matchId: params.matchId,
          tournamentId: params.tournamentId,
          action: params.action,
          operatorId: params.operator?.id ?? null,
          operatorName: params.operator?.username?.slice(0, 64) ?? null,
          beforeData: pick(before),
          afterData: pick(after),
        },
      });
    } catch (error) {
      this.logger.error(`记录对局操作失败 match=${params.matchId} action=${params.action}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /** 某一场的操作记录，最新的在前。 */
  async list(matchId: string) {
    const rows = await this.prisma.matchOperationLog.findMany({
      where: { matchId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      operatorName: row.operatorName,
      before: row.beforeData,
      after: row.afterData,
      createdAt: row.createdAt.toISOString(),
    }));
  }
}

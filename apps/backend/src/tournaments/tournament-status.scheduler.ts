import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { TournamentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { deriveTournamentStatusByTime, statusRank } from './tournament-status';

const TICK_MS = 60_000;
// 重启/部署期间错过的时间点在启动后补上。
const STARTUP_LOOKBACK_MS = 6 * 60 * 60 * 1000;

// 到了报名开始、报名截止、比赛开始、比赛结束的时间点时，把赛事状态往前推。
// 只在「刚跨过时间点」时推进且只前进不后退：超级管理员在两个时间点之间
// 手动设置的状态会保留，直到下一个时间点到来。
@Injectable()
export class TournamentStatusScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(TournamentStatusScheduler.name);
  private timer?: ReturnType<typeof setInterval>;
  private lastRun = new Date(Date.now() - STARTUP_LOOKBACK_MS);
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    const now = new Date();
    try {
      const crossed = { gt: this.lastRun, lte: now };
      const tournaments = await this.prisma.tournament.findMany({
        where: {
          isArchived: false,
          status: { not: TournamentStatus.FINISHED },
          OR: [
            { registrationStartDate: crossed },
            { registrationEndDate: crossed },
            { startDate: crossed },
            { endDate: crossed },
          ],
        },
        select: {
          id: true,
          name: true,
          status: true,
          registrationStartDate: true,
          registrationEndDate: true,
          startDate: true,
          endDate: true,
        },
      });
      for (const tournament of tournaments) {
        const target = deriveTournamentStatusByTime(tournament, now);
        if (statusRank(target) <= statusRank(tournament.status)) continue;
        // 条件更新：期间若有人改了状态，以人工设置为准。
        const updated = await this.prisma.tournament.updateMany({
          where: { id: tournament.id, status: tournament.status },
          data: { status: target },
        });
        if (updated.count)
          this.logger.log(
            `${tournament.name}: ${tournament.status} -> ${target}`,
          );
      }
      this.lastRun = now;
    } catch (error) {
      // 不推进 lastRun，下次重试同一时间段。
      this.logger.error(
        '赛事状态自动推进失败',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.running = false;
    }
  }
}

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from './email.service';

const SCAN_INTERVAL_MS = 60_000;
const DEFAULT_REMIND_BEFORE_MINUTES = 1440;

/**
 * 赛前提醒定时任务：每分钟扫描一次 event_email_settings 中
 * 已开启、未自动发送且到达预定时间的 match_reminder 记录。
 */
@Injectable()
export class EmailReminderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailReminderService.name);
  private timer: NodeJS.Timeout | null = null;
  private scanning = false;

  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.scan();
    }, SCAN_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async scan() {
    if (this.scanning) return;
    this.scanning = true;
    try {
      const settings = await this.prisma.eventEmailSetting.findMany({
        where: { templateKey: 'match_reminder', enabled: true, autoSent: false },
        include: {
          tournament: {
            select: { id: true, name: true, startDate: true, endDate: true },
          },
        },
      });

      const now = Date.now();
      for (const setting of settings) {
        const remindBeforeMinutes = setting.remindBeforeMinutes ?? DEFAULT_REMIND_BEFORE_MINUTES;
        const expected = new Date(
          setting.tournament.startDate.getTime() - remindBeforeMinutes * 60_000,
        );

        // 赛事开始时间或提醒时间被修改后，重新计算预定发送时间
        if (!setting.scheduledSendTime || setting.scheduledSendTime.getTime() !== expected.getTime()) {
          await this.prisma.eventEmailSetting.update({
            where: { id: setting.id },
            data: { scheduledSendTime: expected },
          });
        }

        if (expected.getTime() > now) continue;
        // 赛事已结束的不再自动发送（避免给历史赛事补发提醒）
        if (setting.tournament.endDate.getTime() < now) continue;

        // 先原子占位再发送，确保自动提醒只发一次（多实例/重启场景下也安全）
        const claimed = await this.prisma.eventEmailSetting.updateMany({
          where: { id: setting.id, autoSent: false },
          data: { autoSent: true },
        });
        if (claimed.count === 0) continue;

        try {
          const stats = await this.emailService.sendReminderForTournament(setting.tournamentId, 'auto');
          this.logger.log(
            `赛事「${setting.tournament.name}」赛前提醒已自动发送：成功 ${stats.success}，失败 ${stats.failed}，跳过 ${stats.skipped}`,
          );
        } catch (error) {
          this.logger.error(
            `赛事「${setting.tournament.name}」赛前提醒自动发送失败：${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(`赛前提醒扫描失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.scanning = false;
    }
  }
}

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export const USAGE_METRIC_KEYS = {
  HAWKEYE: 'hawkeye',
  AI_CHAT: 'ai_chat',
} as const;

type UsageMetricKey = (typeof USAGE_METRIC_KEYS)[keyof typeof USAGE_METRIC_KEYS];

type UsageMetricRow = {
  metric_key: string;
  usage_count: number | bigint;
};

@Injectable()
export class UsageMetricsService {
  constructor(private readonly prisma: PrismaService) {}

  async increment(key: UsageMetricKey) {
    await this.prisma.$executeRaw`
      INSERT INTO usage_metrics (metric_key, usage_count)
      VALUES (${key}, 1)
      ON DUPLICATE KEY UPDATE
        usage_count = usage_count + 1,
        updated_at = CURRENT_TIMESTAMP(3)
    `;
  }

  async getSummary() {
    const rows = await this.prisma.$queryRaw<UsageMetricRow[]>`
      SELECT metric_key, usage_count
      FROM usage_metrics
      WHERE metric_key IN (${USAGE_METRIC_KEYS.HAWKEYE}, ${USAGE_METRIC_KEYS.AI_CHAT})
    `;

    const counts = new Map(rows.map((row) => [row.metric_key, Number(row.usage_count)]));

    return {
      hawkeye: counts.get(USAGE_METRIC_KEYS.HAWKEYE) ?? 0,
      aiChat: counts.get(USAGE_METRIC_KEYS.AI_CHAT) ?? 0,
    };
  }

  trackHawkeye() {
    return this.increment(USAGE_METRIC_KEYS.HAWKEYE);
  }

  trackAiChat() {
    return this.increment(USAGE_METRIC_KEYS.AI_CHAT);
  }
}

import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { UsageMetricsController } from './usage-metrics.controller';
import { UsageMetricsService } from './usage-metrics.service';

@Module({
  imports: [PrismaModule],
  controllers: [UsageMetricsController],
  providers: [UsageMetricsService],
  exports: [UsageMetricsService],
})
export class UsageMetricsModule {}

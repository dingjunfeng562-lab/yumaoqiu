import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminStatisticsController } from './statistics.controller';
import { StatisticsService } from './statistics.service';

@Module({
  imports: [PrismaModule],
  controllers: [AdminStatisticsController],
  providers: [StatisticsService],
})
export class StatisticsModule {}

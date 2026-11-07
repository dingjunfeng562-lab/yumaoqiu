import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SchedulingController } from './scheduling.controller';
import { SchedulingService } from './scheduling.service';
import { TeamCompetitionsModule } from '../team-competitions/team-competitions.module';
import { ScoringModule } from '../scoring/scoring.module';

@Module({
  imports: [PrismaModule, TeamCompetitionsModule, ScoringModule],
  controllers: [SchedulingController],
  providers: [SchedulingService],
  exports: [SchedulingService],
})
export class SchedulingModule {}

import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { ScoringModule } from '../scoring/scoring.module';
import { MatchManagementController } from './match-management.controller';
import { MatchManagementService } from './match-management.service';

@Module({
  imports: [PrismaModule, ScoringModule, SchedulingModule],
  controllers: [MatchManagementController],
  providers: [MatchManagementService],
})
export class MatchManagementModule {}

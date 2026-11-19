import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { ScoringModule } from '../scoring/scoring.module';
import { AllMatchesService } from './all-matches.service';
import { MatchDirectoryService } from './match-directory.service';
import { MatchManagementController } from './match-management.controller';
import { MatchManagementService } from './match-management.service';
import { MatchOperationLogService } from './match-operation-log.service';

@Module({
  imports: [PrismaModule, ScoringModule, SchedulingModule],
  controllers: [MatchManagementController],
  providers: [
    MatchManagementService,
    MatchDirectoryService,
    MatchOperationLogService,
    AllMatchesService,
  ],
})
export class MatchManagementModule {}

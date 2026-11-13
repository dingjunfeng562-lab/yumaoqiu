import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SecondStageProgressModule } from '../common/second-stage-progress.module';
import { ScoringController } from './scoring.controller';
import { ScoringGateway } from './scoring.gateway';
import { ScoringService } from './scoring.service';
import { MatchScoreSheetService } from './match-score-sheet.service';
import { TeamCompetitionsModule } from '../team-competitions/team-competitions.module';

@Module({
  imports: [PrismaModule, TeamCompetitionsModule, SecondStageProgressModule],
  controllers: [ScoringController],
  providers: [ScoringService, ScoringGateway, MatchScoreSheetService],
  exports: [ScoringService, ScoringGateway, MatchScoreSheetService],
})
export class ScoringModule {}

import { Module } from '@nestjs/common';
import { ScoringModule } from '../scoring/scoring.module';
import { TournamentsService } from './tournaments.service';
import { TournamentStatusScheduler } from './tournament-status.scheduler';
import { TournamentsController } from './tournaments.controller';
import { ImageModerationModule } from '../image-moderation/image-moderation.module';
import { TeamCompetitionsModule } from '../team-competitions/team-competitions.module';

@Module({
  imports: [ImageModerationModule, TeamCompetitionsModule, ScoringModule],
  providers: [TournamentsService, TournamentStatusScheduler],
  controllers: [TournamentsController],
})
export class TournamentsModule {}

import { Module } from '@nestjs/common';
import { TournamentsService } from './tournaments.service';
import { TournamentsController } from './tournaments.controller';
import { ImageModerationModule } from '../image-moderation/image-moderation.module';
import { TeamCompetitionsModule } from '../team-competitions/team-competitions.module';

@Module({
  imports: [ImageModerationModule, TeamCompetitionsModule],
  providers: [TournamentsService],
  controllers: [TournamentsController],
})
export class TournamentsModule {}

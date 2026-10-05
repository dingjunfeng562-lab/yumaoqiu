import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ScoringModule } from '../scoring/scoring.module';
import { TeamCompetitionsModule } from '../team-competitions/team-competitions.module';
import { BroadcastScoreService } from './broadcast-score.service';
import { BroadcastOverlaysController, BroadcastsController, CameraController, PublicBroadcastsController } from './broadcasts.controller';
import { BroadcastsGateway } from './broadcasts.gateway';
import { BroadcastsService } from './broadcasts.service';
import { AdminMediaController, MediaAssetsController, MediaAuthController } from './media.controller';
import { LivekitMediaService } from './livekit-media.service';
import { MulticameraService } from './multicamera.service';
import { LiveCameraController, LiveViewerController, MulticameraController } from './multicamera.controller';

@Module({
  imports: [PrismaModule, ScoringModule, TeamCompetitionsModule],
  controllers: [BroadcastsController, BroadcastOverlaysController, PublicBroadcastsController, CameraController, AdminMediaController, MediaAssetsController, MediaAuthController, MulticameraController, LiveCameraController, LiveViewerController],
  providers: [BroadcastsService, BroadcastScoreService, BroadcastsGateway, LivekitMediaService, MulticameraService],
})
export class BroadcastsModule {}

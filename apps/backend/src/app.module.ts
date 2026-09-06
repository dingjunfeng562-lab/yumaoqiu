import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { PlayersModule } from './players/players.module';
import { TournamentsModule } from './tournaments/tournaments.module';
import { EventsModule } from './events/events.module';
import { DrawsModule } from './draws/draws.module';
import { PublicModule } from './public/public.module';
import { UploadsModule } from './uploads/uploads.module';
import { ScoringModule } from './scoring/scoring.module';
import { SchedulingModule } from './scheduling/scheduling.module';
import { ExportsModule } from './exports/exports.module';
import { TeamCompetitionsModule } from './team-competitions/team-competitions.module';
import { CompetitionsModule } from './competitions/competitions.module';
import { AnnouncementsModule } from './announcements/announcements.module';
import { PhotosModule } from './photos/photos.module';
import { MailModule } from './mail/mail.module';
import { AiConfigModule } from './ai-config/ai-config.module';
import { AiChatModule } from './ai-chat/ai-chat.module';
import { UsageMetricsModule } from './usage-metrics/usage-metrics.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    PlayersModule,
    TournamentsModule,
    EventsModule,
    DrawsModule,
    PublicModule,
    UploadsModule,
    ScoringModule,
    SchedulingModule,
    ExportsModule,
    TeamCompetitionsModule,
    CompetitionsModule,
    AnnouncementsModule,
    PhotosModule,
    MailModule,
    AiConfigModule,
    UsageMetricsModule,
    AiChatModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

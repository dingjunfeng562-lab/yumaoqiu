import { Module } from '@nestjs/common';
import { AdminAnnouncementsController, PublicAnnouncementsController } from './announcements.controller';
import { AnnouncementsService } from './announcements.service';

@Module({
  controllers: [AdminAnnouncementsController, PublicAnnouncementsController],
  providers: [AnnouncementsService],
  exports: [AnnouncementsService],
})
export class AnnouncementsModule {}

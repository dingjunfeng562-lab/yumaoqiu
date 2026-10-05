import { Module } from '@nestjs/common';
import { PhotosModule } from '../photos/photos.module';
import { ImageModerationModule } from '../image-moderation/image-moderation.module';
import { PhotoActivitiesController } from './photo-activities.controller';
import { PhotoActivitiesService } from './photo-activities.service';

@Module({
  imports: [PhotosModule, ImageModerationModule],
  controllers: [PhotoActivitiesController],
  providers: [PhotoActivitiesService],
})
export class PhotoActivitiesModule {}

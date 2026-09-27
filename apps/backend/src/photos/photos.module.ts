import { Module } from '@nestjs/common';
import { PhotosService } from './photos.service';
import { WatermarkService } from './watermark.service';
import { PhotosController } from './photos.controller';
import { AdminPhotosController } from './admin-photos.controller';
import { ImageModerationModule } from '../image-moderation/image-moderation.module';

@Module({
  imports: [ImageModerationModule],
  controllers: [PhotosController, AdminPhotosController],
  providers: [PhotosService, WatermarkService],
})
export class PhotosModule {}

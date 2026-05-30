import { Module } from '@nestjs/common';
import { PhotosService } from './photos.service';
import { WatermarkService } from './watermark.service';
import { PhotosController } from './photos.controller';
import { AdminPhotosController } from './admin-photos.controller';

@Module({
  controllers: [PhotosController, AdminPhotosController],
  providers: [PhotosService, WatermarkService],
})
export class PhotosModule {}

import { Module } from '@nestjs/common';
import { ImageModerationController } from './image-moderation.controller';
import { ImageModerationService } from './image-moderation.service';

@Module({
  controllers: [ImageModerationController],
  providers: [ImageModerationService],
  exports: [ImageModerationService],
})
export class ImageModerationModule {}

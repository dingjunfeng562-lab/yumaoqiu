import { Body, Controller, Get, Header, Patch, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UpdateImageModerationDto } from './image-moderation.dto';
import { ImageModerationService } from './image-moderation.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ROOT)
@Controller('admin/image-moderation')
export class ImageModerationController {
  constructor(private readonly moderation: ImageModerationService) {}

  @Roles(Role.ROOT)
  @Get()
  @Header('Cache-Control', 'no-store')
  getConfig() {
    return this.moderation.getConfig();
  }

  @Patch()
  updateConfig(@Body() dto: UpdateImageModerationDto) {
    return this.moderation.updateConfig(dto);
  }

  @Post('test')
  testConnection(@Body() dto: UpdateImageModerationDto) {
    return this.moderation.testConnection(dto);
  }
}

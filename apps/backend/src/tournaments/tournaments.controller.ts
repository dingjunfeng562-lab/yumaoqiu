import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import sharp from 'sharp';
import { TournamentsService } from './tournaments.service';
import { ImageModerationService } from '../image-moderation/image-moderation.service';
import { CreateTournamentDto, UpdateTournamentDto } from './dto/tournament.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';
import { ScreenSettingsDto } from './dto/screen-settings.dto';

type AuthedRequest = {
  user: { id: string; username?: string | null; role: Role };
};

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.ROOT)
@Controller('tournaments')
export class TournamentsController {
  constructor(
    private tournamentsService: TournamentsService,
    private moderation: ImageModerationService,
  ) {}

  @Post('upload-cover')
  @UseInterceptors(
    FileInterceptor('file', {
      fileFilter: (_req: unknown, file: any, cb: (error: Error | null, acceptFile: boolean) => void) => {
        cb(null, /^image\/(png|jpe?g)$/.test(file.mimetype));
      },
      limits: { fileSize: 2 * 1024 * 1024 },
    }),
  )
  async uploadCover(@UploadedFile() file: any) {
    if (!file?.buffer) throw new BadRequestException('请上传有效的图片文件');
    await this.moderation.assertAllowed(file.buffer);
    const dir = join(process.cwd(), 'uploads', 'covers');
    mkdirSync(dir, { recursive: true });
    // 封面只作展示用,统一压成 ≤1600px 宽的 WebP,2MB 级原图会缩到约 100-300KB
    const filename = `${Date.now()}-${Math.random().toString(16).slice(2)}.webp`;
    await sharp(file.buffer)
      .rotate()
      .resize({ width: 1600, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(join(dir, filename));
    return {
      url: `/api/uploads/covers/${filename}`,
      filename,
    };
  }

  @Post()
  create(@Body() dto: CreateTournamentDto, @Req() req: AuthedRequest) {
    return this.tournamentsService.create(dto, req.user);
  }

  @Post(':id/approve')
  approve(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.tournamentsService.approve(id, req.user);
  }

  @Post(':id/reject')
  reject(
    @Param('id') id: string,
    @Body() body: { reason?: string },
    @Req() req: AuthedRequest,
  ) {
    return this.tournamentsService.reject(id, req.user, body?.reason);
  }

  @Get()
  findAll(@Req() req: AuthedRequest) {
    return this.tournamentsService.findAll(req.user);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.tournamentsService.findOne(id);
  }

  @Get(':id/screen-settings')
  getScreenSettings(@Param('id') id: string) {
    return this.tournamentsService.getScreenSettings(id);
  }

  @Patch(':id/screen-settings')
  updateScreenSettings(@Param('id') id: string, @Body() dto: ScreenSettingsDto) {
    return this.tournamentsService.updateScreenSettings(id, dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTournamentDto, @Req() req: AuthedRequest) {
    return this.tournamentsService.update(id, dto, req.user);
  }

  @Patch(':id/archive')
  archive(@Param('id') id: string) {
    return this.tournamentsService.archive(id);
  }

  @Patch(':id/restore')
  @Roles(Role.ROOT)
  restore(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.tournamentsService.restore(id, req.user);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.tournamentsService.remove(id);
  }
}

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { extname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { TournamentsService } from './tournaments.service';
import { CreateTournamentDto, UpdateTournamentDto } from './dto/tournament.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('tournaments')
export class TournamentsController {
  constructor(private tournamentsService: TournamentsService) {}

  @Post('upload-cover')
  @UseInterceptors(
    FileInterceptor('file', {
      fileFilter: (_req: unknown, file: any, cb: (error: Error | null, acceptFile: boolean) => void) => {
        cb(null, /^image\/(png|jpe?g)$/.test(file.mimetype));
      },
      limits: { fileSize: 2 * 1024 * 1024 },
    }),
  )
  uploadCover(@UploadedFile() file: any) {
    if (!file?.buffer) throw new BadRequestException('请上传有效的图片文件');
    const dir = join(process.cwd(), 'uploads', 'covers');
    mkdirSync(dir, { recursive: true });
    const safeExt = extname(file.originalname || '').toLowerCase() || '.png';
    const filename = `${Date.now()}-${Math.random().toString(16).slice(2)}${safeExt}`;
    writeFileSync(join(dir, filename), file.buffer);
    return {
      url: `/api/uploads/covers/${filename}`,
      filename,
    };
  }

  @Post()
  create(@Body() dto: CreateTournamentDto) {
    return this.tournamentsService.create(dto);
  }

  @Get()
  findAll() {
    return this.tournamentsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.tournamentsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTournamentDto) {
    return this.tournamentsService.update(id, dto);
  }

  @Patch(':id/archive')
  archive(@Param('id') id: string) {
    return this.tournamentsService.archive(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.tournamentsService.remove(id);
  }
}

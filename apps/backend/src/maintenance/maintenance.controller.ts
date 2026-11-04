import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Post,
  Put,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UpdateMaintenanceDto } from './dto/maintenance.dto';
import { MaintenanceService } from './maintenance.service';

type AuthRequest = { user?: { id?: string; username?: string | null } };

// 维护页、前端 proxy、后台横幅都读这个公开接口。
@Controller('maintenance')
export class MaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @Get('status')
  @Header('Cache-Control', 'no-store')
  status() {
    return this.maintenance.getPublicStatus();
  }
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ROOT)
@Controller('admin/maintenance')
export class AdminMaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  getConfig() {
    return this.maintenance.getAdminConfig();
  }

  @Put()
  update(@Body() dto: UpdateMaintenanceDto, @Req() req: AuthRequest) {
    return this.maintenance.update(
      dto,
      req.user?.username ?? req.user?.id ?? null,
    );
  }

  // 维护说明里的配图。公开读取：/api/uploads/maintenance/:filename
  @Post('upload-image')
  @UseInterceptors(
    FileInterceptor('file', {
      fileFilter: (
        _req: unknown,
        file: { mimetype: string },
        cb: (error: Error | null, accept: boolean) => void,
      ) => {
        cb(null, /^image\/(png|jpe?g)$/.test(file.mimetype));
      },
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  async uploadImage(@UploadedFile() file?: { buffer?: Buffer }) {
    if (!file?.buffer) throw new BadRequestException('请上传 jpg / png 图片');
    const dir = join(process.cwd(), 'uploads', 'maintenance');
    mkdirSync(dir, { recursive: true });
    const filename = `${Date.now()}-${Math.random().toString(16).slice(2)}.webp`;
    await sharp(file.buffer)
      .rotate()
      .resize({ width: 1600, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(join(dir, filename));
    return { url: `/api/uploads/maintenance/${filename}`, filename };
  }
}

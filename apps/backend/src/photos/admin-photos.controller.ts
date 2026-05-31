import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createReadStream } from 'node:fs';
import { extname } from 'node:path';
import { Role } from '@prisma/client';
import { PhotosService } from './photos.service';
import {
  AdminPhotoQueryDto,
  BatchDeletePhotosDto,
  DeleteTournamentPhotosDto,
  UpdateWatermarkDto,
} from './dto/photo.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

type AuthedRequest = {
  user: { id: string; username?: string | null; role: Role };
};

const MAX_LOGO_SIZE = 5 * 1024 * 1024;

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPER_ADMIN)
@Controller('admin')
export class AdminPhotosController {
  constructor(private photosService: PhotosService) {}

  // ----- Watermark configuration -----

  @Get('tournaments/:id/watermark')
  getWatermark(@Param('id') id: string) {
    return this.photosService.getWatermark(id);
  }

  @Put('tournaments/:id/watermark')
  updateWatermark(@Param('id') id: string, @Body() dto: UpdateWatermarkDto) {
    return this.photosService.updateWatermark(id, dto);
  }

  @Post('tournaments/:id/watermark/logos')
  @UseInterceptors(
    FileInterceptor('file', {
      fileFilter: (
        _req: unknown,
        file: { mimetype: string },
        cb: (error: Error | null, acceptFile: boolean) => void,
      ) => {
        cb(null, file.mimetype === 'image/png');
      },
      limits: { fileSize: MAX_LOGO_SIZE },
    }),
  )
  addLogo(
    @Param('id') id: string,
    @UploadedFile() file: { originalname?: string; mimetype?: string; buffer?: Buffer },
  ) {
    return this.photosService.addWatermarkLogo(id, file);
  }

  @Delete('tournaments/:id/watermark/logos')
  deleteLogo(@Param('id') id: string, @Body('path') path: string) {
    return this.photosService.deleteWatermarkLogo(id, path);
  }

  // ----- Photo management -----

  @Get('photos')
  listPhotos(@Query() query: AdminPhotoQueryDto) {
    return this.photosService.adminListPhotos(query);
  }

  @Get('photos/:id/original')
  async getOriginal(@Param('id') id: string, @Req() req: AuthedRequest) {
    const { absolutePath, filename } = await this.photosService.getOriginal(id, req.user);
    const ext = extname(absolutePath).toLowerCase();
    const type = ext === '.png' ? 'image/png' : 'image/jpeg';
    const asciiFallback = filename.replace(/[^\x20-\x7e]/g, '_');
    return new StreamableFile(createReadStream(absolutePath), {
      type,
      disposition:
        `inline; filename="${asciiFallback}"; ` +
        `filename*=UTF-8''${encodeURIComponent(filename)}`,
    });
  }

  @Delete('photos/:id')
  deletePhoto(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.photosService.deletePhoto(id, req.user);
  }

  @Delete('photos')
  deletePhotos(@Body() dto: BatchDeletePhotosDto, @Req() req: AuthedRequest) {
    return this.photosService.deletePhotos(dto.ids, req.user);
  }

  @Delete('tournaments/:id/photos')
  deleteTournamentPhotos(
    @Param('id') id: string,
    @Body() dto: DeleteTournamentPhotosDto,
    @Req() req: AuthedRequest,
  ) {
    return this.photosService.deleteTournamentPhotos(id, dto.confirmName, req.user);
  }

  @Get('tournaments/:id/photo-logs')
  listLogs(@Param('id') id: string) {
    return this.photosService.listLogs(id);
  }
}

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  Req,
  StreamableFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { createReadStream } from 'node:fs';
import { extname } from 'node:path';
import { Role } from '@prisma/client';
import { PhotosService } from './photos.service';
import { PublicPhotoQueryDto, UploadPhotosDto } from './dto/photo.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

type AuthedRequest = {
  user: { id: string; username?: string | null; role: Role };
};

const MAX_FILES = 100;
const MAX_FILE_SIZE = 15 * 1024 * 1024;
const PHOTO_MIME_RE = /^image\/(?!svg\+xml$).+/;

@Controller()
export class PhotosController {
  constructor(private photosService: PhotosService) {}

  // ----- Public gallery -----

  @Get('photos')
  listPublic(@Query() query: PublicPhotoQueryDto) {
    return this.photosService.listPublicPhotos(query);
  }

  @Get('photos/tournaments')
  listTournaments() {
    return this.photosService.listTournamentsWithPhotos();
  }

  @Get('photos/:id/thumb')
  @Header('Cache-Control', 'no-store')
  async thumb(@Param('id') id: string) {
    const { absolutePath } = await this.photosService.getPublicThumb(id);
    return new StreamableFile(createReadStream(absolutePath), {
      type: 'image/jpeg',
      disposition: 'inline',
    });
  }

  @Get('photos/:id/view')
  @Header('Cache-Control', 'no-store')
  async view(@Param('id') id: string) {
    const { absolutePath } = await this.photosService.getPublicView(id);
    const ext = extname(absolutePath).toLowerCase();
    const type = ext === '.png' ? 'image/png' : 'image/jpeg';
    return new StreamableFile(createReadStream(absolutePath), {
      type,
      disposition: 'inline',
    });
  }

  // Download the high-res watermarked version as an attachment. Public, like the
  // gallery itself; goes through the API so the filename is server-controlled.
  @Get('photos/:id/download')
  async download(@Param('id') id: string) {
    const { absolutePath, filename } = await this.photosService.getDownload(id);
    const ext = extname(absolutePath).toLowerCase();
    const type = ext === '.png' ? 'image/png' : 'image/jpeg';
    const asciiFallback = filename.replace(/[^\x20-\x7e]/g, '_');
    return new StreamableFile(createReadStream(absolutePath), {
      type,
      disposition:
        `attachment; filename="${asciiFallback}"; ` +
        `filename*=UTF-8''${encodeURIComponent(filename)}`,
    });
  }

  // ----- Photographer -----

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.PHOTOGRAPHER)
  @Get('photographer/tournaments')
  listUploadable() {
    return this.photosService.listUploadableTournaments();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.PHOTOGRAPHER)
  @Post('photographer/upload')
  @UseInterceptors(
    FilesInterceptor('photos', MAX_FILES, {
      fileFilter: (
        _req: unknown,
        file: { mimetype: string },
        cb: (error: Error | null, acceptFile: boolean) => void,
      ) => {
        if (!PHOTO_MIME_RE.test(file.mimetype)) {
          cb(new BadRequestException('仅支持图片格式'), false);
          return;
        }
        cb(null, true);
      },
      limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES },
    }),
  )
  upload(
    @UploadedFiles() files: Array<{ originalname?: string; mimetype?: string; size?: number; buffer?: Buffer }>,
    @Body() dto: UploadPhotosDto,
    @Req() req: AuthedRequest,
  ) {
    if (!files?.length) throw new BadRequestException('请上传有效的图片文件');
    return this.photosService.uploadPhotos(dto.tournamentId, dto.category, files, req.user.id);
  }
}

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import { PhotosService } from './photos.service';
import { PublicPhotoQueryDto, UploadPhotosDto } from './dto/photo.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

type AuthedRequest = {
  user: { id: string; username?: string | null; role: Role };
};

const MAX_FILES = 20;
const MAX_FILE_SIZE = 10 * 1024 * 1024;

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
        cb(null, /^image\/(png|jpe?g)$/.test(file.mimetype));
      },
      limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES },
    }),
  )
  upload(
    @UploadedFiles() files: Array<{ originalname?: string; mimetype?: string; size?: number; buffer?: Buffer }>,
    @Body() dto: UploadPhotosDto,
    @Req() req: AuthedRequest,
  ) {
    if (!files?.length) throw new BadRequestException('请上传有效的图片(仅支持 JPG / PNG)');
    return this.photosService.uploadPhotos(dto.tournamentId, dto.category, files, req.user.id);
  }
}

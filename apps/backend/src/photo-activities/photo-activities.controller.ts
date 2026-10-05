import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Put, Req, UploadedFile, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { PhotoCategory, Role } from '@prisma/client';
import { AuthActor } from '../auth/admin-scope';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { DeleteTournamentPhotosDto, UpdateWatermarkDto } from '../photos/dto/photo.dto';
import { PhotosService } from '../photos/photos.service';
import { CreatePhotoActivityDto, RejectPhotoActivityDto } from './dto/photo-activity.dto';
import { PhotoActivitiesService } from './photo-activities.service';

const PHOTO_MIME_RE = /^image\/(?!svg\+xml$).+/;
const fileFilter = (_req: unknown, file: { mimetype: string }, cb: (error: Error | null, accept: boolean) => void) => {
  if (!PHOTO_MIME_RE.test(file.mimetype)) return cb(new BadRequestException('仅支持图片格式'), false);
  cb(null, true);
};

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.ROOT)
@Controller('admin/photo-activities')
export class PhotoActivitiesController {
  constructor(
    private readonly activities: PhotoActivitiesService,
    private readonly photos: PhotosService,
  ) {}

  @Get()
  list(@Req() req: { user: AuthActor }) { return this.activities.list(req.user); }

  @Get(':id')
  get(@Param('id') id: string, @Req() req: { user: AuthActor }) { return this.activities.get(id, req.user); }

  @Post()
  @UseInterceptors(FileInterceptor('cover', { fileFilter, limits: { fileSize: 15 * 1024 * 1024 } }))
  create(@Body() dto: CreatePhotoActivityDto, @UploadedFile() cover: { buffer?: Buffer; mimetype?: string; size?: number }, @Req() req: { user: AuthActor }) {
    return this.activities.create(dto, cover, req.user);
  }

  @Put(':id')
  @UseInterceptors(FileInterceptor('cover', { fileFilter, limits: { fileSize: 15 * 1024 * 1024 } }))
  update(@Param('id') id: string, @Body() dto: CreatePhotoActivityDto, @UploadedFile() cover: { buffer?: Buffer; mimetype?: string; size?: number }, @Req() req: { user: AuthActor }) {
    return this.activities.update(id, dto, cover, req.user);
  }

  @Patch(':id/approve')
  @Roles(Role.ROOT)
  approve(@Param('id') id: string, @Req() req: { user: AuthActor }) { return this.activities.approve(id, req.user); }

  @Patch(':id/reject')
  @Roles(Role.ROOT)
  reject(@Param('id') id: string, @Body() dto: RejectPhotoActivityDto, @Req() req: { user: AuthActor }) { return this.activities.reject(id, dto.reason, req.user); }

  @Post(':id/photo-access')
  photoAccess(@Param('id') id: string, @Req() req: { user: AuthActor }) { return this.activities.createPhotoAccess(id, req.user); }

  @Get(':id/watermark')
  async getWatermark(@Param('id') id: string, @Req() req: { user: AuthActor }) {
    await this.activities.requireManageable(id, req.user);
    return this.photos.getActivityWatermark(id);
  }

  @Put(':id/watermark')
  async updateWatermark(@Param('id') id: string, @Body() dto: UpdateWatermarkDto, @Req() req: { user: AuthActor }) {
    await this.activities.requireManageable(id, req.user);
    return this.photos.updateActivityWatermark(id, dto);
  }

  @Post(':id/watermark/logos')
  @UseInterceptors(FileInterceptor('file', { fileFilter, limits: { fileSize: 5 * 1024 * 1024 } }))
  async addLogo(@Param('id') id: string, @UploadedFile() file: { originalname?: string; mimetype?: string; buffer?: Buffer }, @Req() req: { user: AuthActor }) {
    await this.activities.requireManageable(id, req.user);
    return this.photos.addActivityWatermarkLogo(id, file);
  }

  @Delete(':id/watermark/logos')
  async deleteLogo(@Param('id') id: string, @Body('path') path: string, @Req() req: { user: AuthActor }) {
    await this.activities.requireManageable(id, req.user);
    return this.photos.deleteActivityWatermarkLogo(id, path);
  }

  @Post(':id/photos')
  @UseInterceptors(FilesInterceptor('photos', 100, { fileFilter, limits: { fileSize: 15 * 1024 * 1024, files: 100 } }))
  async upload(@Param('id') id: string, @Body('category') category: PhotoCategory, @UploadedFiles() files: Array<{ originalname?: string; mimetype?: string; size?: number; buffer?: Buffer }>, @Req() req: { user: AuthActor }) {
    await this.activities.requireManageable(id, req.user);
    if (!files?.length) throw new BadRequestException('请至少上传一张图片');
    if (!['PLAYER', 'MATCH', 'AWARD'].includes(category)) throw new BadRequestException('图片分类不正确');
    return this.photos.uploadActivityPhotos(id, category, files, req.user.id);
  }

  @Delete(':id/photos')
  async purge(@Param('id') id: string, @Body() dto: DeleteTournamentPhotosDto, @Req() req: { user: AuthActor }) {
    await this.activities.requireManageable(id, req.user);
    return this.photos.deleteActivityPhotos(id, dto.confirmName, req.user);
  }

  @Get(':id/photo-logs')
  async logs(@Param('id') id: string, @Req() req: { user: AuthActor }) {
    await this.activities.requireManageable(id, req.user);
    return this.photos.listActivityLogs(id);
  }
}

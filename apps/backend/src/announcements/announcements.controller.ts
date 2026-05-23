import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AnnouncementsService } from './announcements.service';
import { CreateAnnouncementDto, UpdateAnnouncementDto } from './dto/announcement.dto';

type AuthRequest = {
  user?: {
    id?: string;
    username?: string;
  };
};

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPER_ADMIN)
@Controller('announcements')
export class AnnouncementsController {
  constructor(private announcementsService: AnnouncementsService) {}

  @Get()
  findAll() {
    return this.announcementsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.announcementsService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateAnnouncementDto, @Req() req: AuthRequest) {
    return this.announcementsService.create(dto, req.user?.username ?? req.user?.id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAnnouncementDto, @Req() req: AuthRequest) {
    return this.announcementsService.update(id, dto, req.user?.username ?? req.user?.id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.announcementsService.remove(id);
  }
}

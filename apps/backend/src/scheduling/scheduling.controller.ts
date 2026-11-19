import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  AutoScheduleDto,
  ClearScheduleDto,
  CreateVenueDto,
  KnockoutPlaceholdersDto,
  UpdateMatchScheduleDto,
  UpdateVenueDto,
  SaveGroupVenuesDto,
} from './dto/scheduling.dto';
import { SchedulingService } from './scheduling.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.ROOT)
@Controller()
export class SchedulingController {
  constructor(private schedulingService: SchedulingService) {}

  @Get('tournaments/:tournamentId/group-venues')
  groupVenues(@Param('tournamentId') tournamentId: string) {
    return this.schedulingService.getGroupVenues(tournamentId);
  }

  @Patch('tournaments/:tournamentId/group-venues')
  saveGroupVenues(@Param('tournamentId') tournamentId: string, @Body() dto: SaveGroupVenuesDto, @Req() req: { user: { id: string } }) {
    return this.schedulingService.saveGroupVenues(tournamentId, dto, req.user.id);
  }

  @Get('tournaments/:tournamentId/schedule-logs')
  scheduleLogs(@Param('tournamentId') tournamentId: string) {
    return this.schedulingService.getScheduleLogs(tournamentId);
  }

  @Post('matches/:id/schedule-preview')
  previewMatchSchedule(@Param('id') id: string, @Body() dto: UpdateMatchScheduleDto) {
    return this.schedulingService.previewMatchSchedule(id, dto);
  }

  @Get('tournaments/:tournamentId/venues')
  listVenues(@Param('tournamentId') tournamentId: string) {
    return this.schedulingService.listVenues(tournamentId);
  }

  @Post('tournaments/:tournamentId/venues')
  createVenue(@Param('tournamentId') tournamentId: string, @Body() dto: CreateVenueDto) {
    return this.schedulingService.createVenue(tournamentId, dto);
  }

  @Patch('venues/:id')
  updateVenue(@Param('id') id: string, @Body() dto: UpdateVenueDto) {
    return this.schedulingService.updateVenue(id, dto);
  }

  @Delete('venues/:id')
  removeVenue(@Param('id') id: string) {
    return this.schedulingService.removeVenue(id);
  }

  @Get('scheduling')
  getSchedule(@Query('tournamentId') tournamentId: string, @Query('eventId') eventId?: string) {
    return this.schedulingService.getSchedule(tournamentId, eventId);
  }

  @Post('scheduling/auto')
  autoSchedule(@Body() dto: AutoScheduleDto, @Req() req: { user: { id: string } }) {
    return this.schedulingService.autoSchedule(dto, req.user.id);
  }

  @Post('scheduling/clear')
  clearSchedule(@Body() dto: ClearScheduleDto, @Req() req: { user: { id: string } }) {
    return this.schedulingService.clearSchedule(dto, req.user.id);
  }

  /** 预排淘汰赛空位：小组赛打完前先建出淘汰赛各轮非轮空的场次（双方待定），可以先排时间场地。 */
  @Post('scheduling/knockout-placeholders')
  createKnockoutPlaceholders(@Body() dto: KnockoutPlaceholdersDto, @Req() req: { user: { id: string } }) {
    return this.schedulingService.createKnockoutPlaceholders(dto, req.user.id);
  }

  /** 删除淘汰赛空位：只删双方都还空着、没开打的淘汰赛场次。 */
  @Post('scheduling/knockout-placeholders/remove')
  removeKnockoutPlaceholders(@Body() dto: KnockoutPlaceholdersDto, @Req() req: { user: { id: string } }) {
    return this.schedulingService.removeKnockoutPlaceholders(dto, req.user.id);
  }

  @Patch('matches/:id/schedule')
  updateMatchSchedule(@Param('id') id: string, @Body() dto: UpdateMatchScheduleDto, @Req() req: { user: { id: string } }) {
    return this.schedulingService.updateMatchSchedule(id, dto, req.user.id);
  }
}

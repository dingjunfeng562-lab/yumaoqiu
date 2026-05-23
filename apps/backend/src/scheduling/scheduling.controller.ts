import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  AutoScheduleDto,
  CreateVenueDto,
  UpdateMatchScheduleDto,
  UpdateVenueDto,
} from './dto/scheduling.dto';
import { SchedulingService } from './scheduling.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPER_ADMIN)
@Controller()
export class SchedulingController {
  constructor(private schedulingService: SchedulingService) {}

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
  autoSchedule(@Body() dto: AutoScheduleDto) {
    return this.schedulingService.autoSchedule(dto);
  }

  @Patch('matches/:id/schedule')
  updateMatchSchedule(@Param('id') id: string, @Body() dto: UpdateMatchScheduleDto) {
    return this.schedulingService.updateMatchSchedule(id, dto);
  }
}

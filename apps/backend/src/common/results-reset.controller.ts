import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Equals } from 'class-validator';
import { AuthActor } from '../auth/admin-scope';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ResultsResetService } from './results-reset.service';

class ConfirmResultsResetDto {
  @Equals(true, { message: '请确认丢弃全部比赛成绩' })
  confirm: boolean;
}

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ROOT)
export class ResultsResetController {
  constructor(private readonly results: ResultsResetService) {}

  @Post('events/:eventId/results/clear')
  resetEvent(@Param('eventId') eventId: string, @Body() _dto: ConfirmResultsResetDto, @Req() req: { user: AuthActor }) {
    return this.results.resetEvent(eventId, req.user);
  }

  @Post('team-competitions/:id/results/clear')
  resetTeam(@Param('id') id: string, @Body() _dto: ConfirmResultsResetDto, @Req() req: { user: AuthActor }) {
    return this.results.resetTeam(id, req.user);
  }
}

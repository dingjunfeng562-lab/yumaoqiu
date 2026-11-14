import { Body, Controller, Get, Header, Param, Put, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthActor } from '../auth/admin-scope';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { SetCheckInDto } from './check-in.dto';
import { CheckInService } from './check-in.service';

@Controller('check-in')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ROOT, Role.ADMIN)
export class CheckInController {
  constructor(private readonly service: CheckInService) {}

  @Get('tournaments')
  @Header('Cache-Control', 'no-store')
  list(@Req() req: { user: AuthActor }) {
    return this.service.list(req.user);
  }

  @Get('tournaments/:tournamentId')
  @Header('Cache-Control', 'no-store')
  board(@Param('tournamentId') id: string, @Req() req: { user: AuthActor }) {
    return this.service.board(id, req.user);
  }

  @Put('matches/:matchId')
  set(@Param('matchId') id: string, @Body() dto: SetCheckInDto, @Req() req: { user: AuthActor }) {
    return this.service.set(id, dto, req.user);
  }
}

@Controller('public/tournaments')
export class PublicCheckInController {
  constructor(private readonly service: CheckInService) {}

  @Get(':tournamentId/check-in')
  @Header('Cache-Control', 'no-store')
  board(@Param('tournamentId') id: string) {
    return this.service.publicBoard(id);
  }
}

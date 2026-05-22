import { Body, Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CompetitionsService } from './competitions.service';
import { RejectRegistrationDto } from './dto/competition-registration.dto';

type AuthRequest = {
  user?: {
    id?: string;
    username?: string | null;
    email?: string | null;
  };
};

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('admin')
export class AdminCompetitionsController {
  constructor(private competitionsService: CompetitionsService) {}

  @Get('competitions')
  listCompetitions() {
    return this.competitionsService.listAdminCompetitions();
  }

  @Patch('competitions/:id/publish')
  publishCompetition(@Param('id') id: string) {
    return this.competitionsService.publishCompetition(id);
  }

  @Patch('competitions/:id/unpublish')
  unpublishCompetition(@Param('id') id: string) {
    return this.competitionsService.unpublishCompetition(id);
  }

  @Get('competitions/:id/registrations')
  listRegistrations(@Param('id') id: string, @Query('status') status?: string) {
    return this.competitionsService.listAdminRegistrations(id, status);
  }

  @Get('competitions/:id/players')
  listPlayers(
    @Param('id') id: string,
    @Query('eventName') eventName?: string,
    @Query('search') search?: string,
  ) {
    return this.competitionsService.listAdminPlayers(id, eventName, search);
  }

  @Patch('competition-registrations/:registrationId/approve')
  approveRegistration(@Param('registrationId') registrationId: string, @Req() req: AuthRequest) {
    return this.competitionsService.approveRegistration(
      registrationId,
      req.user?.id,
    );
  }

  @Patch('competition-registrations/:registrationId/reject')
  rejectRegistration(
    @Param('registrationId') registrationId: string,
    @Req() req: AuthRequest,
    @Body() dto: RejectRegistrationDto,
  ) {
    return this.competitionsService.rejectRegistration(
      registrationId,
      req.user?.id,
      dto.rejectReason,
    );
  }

  @Patch('competition-registrations/:registrationId/remove')
  removeRegistration(@Param('registrationId') registrationId: string, @Req() req: AuthRequest) {
    return this.competitionsService.removeRegistration(
      registrationId,
      req.user?.id,
    );
  }
}

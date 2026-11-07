import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthActor } from '../auth/admin-scope';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CompetitionsService } from './competitions.service';
import { VerifyEligibilityDto } from '../registration-groups/registration-groups.dto';
import { UpdateCompetitionRankingsDto } from './dto/competition-rankings.dto';
import {
  AdminBatchCompetitionPlayersDto,
  AdminCompetitionLibraryPlayerDto,
  AdminCompetitionPlayerDto,
  DeleteAdminPlayersDto,
  RejectRegistrationDto,
} from './dto/competition-registration.dto';

type AuthRequest = {
  user?: {
    id?: string;
    username?: string | null;
    email?: string | null;
    role?: Role;
  };
};

/** JWT 校验后的当前用户，删除和修改报名时用于记录操作人并校验是否为管理员。 */
function changeActor(req: AuthRequest) {
  return req.user?.id && req.user.role
    ? { id: req.user.id, role: req.user.role, username: req.user.username ?? null }
    : undefined;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.ROOT)
@Controller('admin')
export class AdminCompetitionsController {
  constructor(private competitionsService: CompetitionsService) {}

  @Get('competitions')
  listCompetitions(@Req() req: { user: AuthActor }) {
    return this.competitionsService.listAdminCompetitions(req.user);
  }

  @Patch('competitions/:id/publish')
  publishCompetition(@Param('id') id: string) {
    return this.competitionsService.publishCompetition(id);
  }

  @Patch('competitions/:id/unpublish')
  unpublishCompetition(@Param('id') id: string) {
    return this.competitionsService.unpublishCompetition(id);
  }

  @Get('competitions/:id/rankings')
  getRankings(@Param('id') id: string) {
    return this.competitionsService.getRankings(id);
  }

  @Patch('competitions/:id/rankings')
  updateRankings(@Param('id') id: string, @Body() dto: UpdateCompetitionRankingsDto) {
    return this.competitionsService.updateRankings(id, dto);
  }

  @Post('competitions/:id/photo-access')
  createPhotoAccess(@Param('id') id: string) {
    return this.competitionsService.getOrCreatePhotoAccess(id);
  }

  @Get('competitions/:id/registrations')
  listRegistrations(
    @Param('id') id: string,
    @Query('status') status?: string,
    @Query('entrantType') entrantType?: string,
  ) {
    return this.competitionsService.listAdminRegistrations(id, status, entrantType);
  }

  @Get('competitions/:id/players')
  listPlayers(
    @Param('id') id: string,
    @Query('eventId') eventId?: string,
    @Query('entrantType') entrantType?: string,
    @Query('search') search?: string,
  ) {
    return this.competitionsService.listAdminPlayers(id, eventId, entrantType, search);
  }

  // 赛事报名码（一个赛事一个码）。旧客户端传的 entrantType 不再使用。
  @Post('competitions/:id/registration-code/regenerate')
  regenerateRegistrationCode(@Param('id') id: string) {
    return this.competitionsService.regenerateRegistrationCode(id);
  }

  @Patch('competitions/:id/registration-code')
  setRegistrationCodeEnabled(
    @Param('id') id: string,
    @Body() body: { enabled?: boolean },
  ) {
    return this.competitionsService.setRegistrationCodeEnabled(id, body?.enabled !== false);
  }

  @Roles(Role.ADMIN)
  @Post('competitions/:id/players/batch')
  batchAddPlayers(
    @Param('id') id: string,
    @Body() dto: AdminBatchCompetitionPlayersDto,
    @Req() req: AuthRequest,
  ) {
    return this.competitionsService.batchAddAdminPlayers(
      id,
      dto,
      req.user?.id,
    );
  }

  @Roles(Role.ADMIN)
  @Post('competitions/:id/players')
  createPlayer(
    @Param('id') id: string,
    @Body() dto: AdminCompetitionPlayerDto,
    @Req() req: AuthRequest,
  ) {
    return this.competitionsService.createAdminPlayer(
      id,
      dto,
      req.user?.id,
    );
  }

  @Roles(Role.ADMIN)
  @Post('competitions/:id/players/from-library')
  createPlayerFromLibrary(
    @Param('id') id: string,
    @Body() dto: AdminCompetitionLibraryPlayerDto,
    @Req() req: AuthRequest,
  ) {
    return this.competitionsService.createAdminPlayerFromLibrary(
      id,
      dto,
      req.user?.id,
    );
  }

  @Roles(Role.ADMIN)
  @Get('competitions/:competitionId/players/:registrationId')
  getPlayer(
    @Param('competitionId') competitionId: string,
    @Param('registrationId') registrationId: string,
  ) {
    return this.competitionsService.getAdminPlayer(competitionId, registrationId);
  }

  @Roles(Role.ADMIN)
  @Patch('competitions/:competitionId/players/:registrationId')
  updatePlayer(
    @Param('competitionId') competitionId: string,
    @Param('registrationId') registrationId: string,
    @Body() dto: AdminCompetitionPlayerDto,
    @Req() req: AuthRequest,
  ) {
    return this.competitionsService.updateAdminPlayer(
      competitionId,
      registrationId,
      dto,
      req.user,
    );
  }

  /** 删除单条报名（真删除，只删这一项）。 */
  @Roles(Role.ADMIN)
  @Patch('competitions/:competitionId/players/:registrationId/remove')
  removePlayerRegistration(
    @Param('competitionId') competitionId: string,
    @Param('registrationId') registrationId: string,
    @Req() req: AuthRequest,
  ) {
    return this.competitionsService.removeAdminPlayerRegistration(
      competitionId,
      registrationId,
      changeActor(req),
    );
  }

  /** 批量删除报名：有一条不能删（签表已冻结、已发布或已开赛）就整批不删。 */
  @Roles(Role.ADMIN)
  @Post('competitions/:competitionId/players/delete')
  deletePlayers(
    @Param('competitionId') competitionId: string,
    @Body() dto: DeleteAdminPlayersDto,
    @Req() req: AuthRequest,
  ) {
    return this.competitionsService.deleteAdminRegistrations(
      competitionId,
      dto.registrationIds,
      changeActor(req),
    );
  }

  @Roles(Role.ADMIN)
  @Patch('competition-registrations/:registrationId/approve')
  approveRegistration(@Param('registrationId') registrationId: string, @Req() req: AuthRequest) {
    return this.competitionsService.approveRegistration(
      registrationId,
      req.user?.id,
    );
  }

  @Roles(Role.ADMIN)
  @Patch('competition-registrations/:registrationId/verify-eligibility')
  verifyEligibility(@Param('registrationId') id: string, @Body() dto: VerifyEligibilityDto, @Req() req: AuthRequest) {
    return this.competitionsService.verifyEligibility(id, dto, req.user?.id ?? '');
  }

  @Roles(Role.ADMIN)
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

  @Roles(Role.ADMIN)
  @Patch('competition-registrations/:registrationId/remove')
  removeRegistration(@Param('registrationId') registrationId: string, @Req() req: AuthRequest) {
    return this.competitionsService.removeRegistration(
      registrationId,
      req.user?.id,
    );
  }
}

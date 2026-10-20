import { AuthActor } from '../auth/admin-scope';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  AddTeamPlayersDto,
  BatchImportTeamsDto,
  AssignTeamMatchRefereeDto,
  CreateTeamCompetitionDto,
  CreateTeamDto,
  GenerateTeamDrawDto,
  ImportTeamPlayersDto,
  ParseQuickTeamDto,
  ReplaceTeamMembersDto,
  SetTeamLineupsDto,
  UpdateTeamCompetitionDto,
  UpdateTeamDto,
  GenerateGroupDrawDto,
  AdjustGroupsDto,
  GenerateKnockoutFromGroupsDto,
} from './dto/team-competition.dto';
import { TeamCompetitionsService } from './team-competitions.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.ROOT)
@Controller('team-competitions')
export class TeamCompetitionsController {
  constructor(private readonly teamCompetitionsService: TeamCompetitionsService) {}

  @Post()
  create(@Body() dto: CreateTeamCompetitionDto) {
    return this.teamCompetitionsService.create(dto);
  }

  @Get()
  list(@Req() req: { user: AuthActor }, @Query('tournamentId') tournamentId?: string) {
    return this.teamCompetitionsService.list(tournamentId, req.user);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.teamCompetitionsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTeamCompetitionDto) {
    return this.teamCompetitionsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.teamCompetitionsService.remove(id);
  }

  @Get(':id/teams')
  listTeams(@Param('id') id: string) {
    return this.teamCompetitionsService.listTeams(id);
  }

  @Get(':id/available-players')
  availablePlayers(@Param('id') id: string, @Req() req: { user: AuthActor }) {
    return this.teamCompetitionsService.availablePlayers(id, req.user);
  }

  @Post(':id/teams')
  createTeam(@Param('id') id: string, @Body() dto: CreateTeamDto, @Req() req: { user: AuthActor }) {
    return this.teamCompetitionsService.createTeam(id, dto, req.user);
  }

  @Post(':id/teams/import')
  importTeam(@Param('id') id: string, @Body() dto: ImportTeamPlayersDto, @Req() req: { user: AuthActor }) {
    return this.teamCompetitionsService.importTeamPlayers(id, dto, req.user);
  }

  @Post(':id/teams/batch-import')
  batchImportTeams(@Param('id') id: string, @Body() dto: BatchImportTeamsDto, @Req() req: { user: AuthActor }) {
    return this.teamCompetitionsService.batchImportTeams(id, dto, req.user);
  }

  @Post(':id/teams/quick-preview')
  async previewQuickTeam(@Param('id') id: string, @Body() dto: ParseQuickTeamDto) {
    const competition = await this.teamCompetitionsService.findOne(id);
    return this.teamCompetitionsService.previewQuickTeam(
      dto.prompt,
      competition.items.map((item: { eventType: string }) => item.eventType as any),
    );
  }

  @Post(':id/teams/quick-create')
  createTeamFromQuickInput(@Param('id') id: string, @Body() dto: ParseQuickTeamDto, @Req() req: { user: AuthActor }) {
    return this.teamCompetitionsService.createTeamFromQuickInput(id, dto, req.user);
  }

  @Patch('teams/:teamId')
  updateTeam(@Param('teamId') teamId: string, @Body() dto: UpdateTeamDto) {
    return this.teamCompetitionsService.updateTeam(teamId, dto);
  }

  @Put('teams/:teamId/members')
  replaceTeamMembers(@Param('teamId') teamId: string, @Body() dto: ReplaceTeamMembersDto, @Req() req: { user: AuthActor }) {
    return this.teamCompetitionsService.replaceTeamMembers(teamId, dto, req.user);
  }

  @Delete('teams/:teamId')
  removeTeam(@Param('teamId') teamId: string) {
    return this.teamCompetitionsService.removeTeam(teamId);
  }

  @Post('teams/:teamId/players')
  addTeamPlayers(@Param('teamId') teamId: string, @Body() dto: AddTeamPlayersDto, @Req() req: { user: AuthActor }) {
    return this.teamCompetitionsService.addTeamPlayers(teamId, dto, req.user);
  }

  @Post(':id/draw')
  generateDraw(@Param('id') id: string, @Body() dto: GenerateTeamDrawDto) {
    return this.teamCompetitionsService.generateDraw(id, dto);
  }

  @Post(':id/draw/clear')
  clearDraw(@Param('id') id: string) {
    return this.teamCompetitionsService.clearDraw(id);
  }

  @Get('team-matches/:teamMatchId/lineups')
  getTeamMatchLineups(@Param('teamMatchId') teamMatchId: string) {
    return this.teamCompetitionsService.getTeamMatchLineups(teamMatchId);
  }

  @Put('team-matches/:teamMatchId/lineups')
  setTeamLineups(@Param('teamMatchId') teamMatchId: string, @Body() dto: SetTeamLineupsDto) {
    return this.teamCompetitionsService.setTeamLineups(teamMatchId, dto);
  }

  @Patch('matches/:matchId/referee')
  assignReferee(@Param('matchId') matchId: string, @Body() dto: AssignTeamMatchRefereeDto) {
    return this.teamCompetitionsService.assignTeamMatchReferee(matchId, dto);
  }

  // ==================== 小组赛API ====================

  @Post(':id/draw-groups')
  generateGroupDraw(@Param('id') id: string, @Body() dto: GenerateGroupDrawDto) {
    return this.teamCompetitionsService.generateGroupDraw(id, dto);
  }

  @Get(':id/groups')
  getGroups(@Param('id') id: string) {
    return this.teamCompetitionsService.getGroups(id);
  }

  @Get(':id/groups/:groupId/standings')
  getGroupStandings(@Param('id') id: string, @Param('groupId') groupId: string) {
    return this.teamCompetitionsService.getGroupStandings(id, groupId);
  }

  @Patch(':id/groups/adjust')
  adjustGroups(@Param('id') id: string, @Body() dto: AdjustGroupsDto) {
    return this.teamCompetitionsService.adjustGroups(id, dto);
  }

  @Post(':id/knockout')
  generateKnockout(@Param('id') id: string, @Body() dto: GenerateKnockoutFromGroupsDto) {
    return this.teamCompetitionsService.generateKnockoutFromGroups(id, dto);
  }
}

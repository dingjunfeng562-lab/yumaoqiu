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
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
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
} from './dto/team-competition.dto';
import { TeamCompetitionsService } from './team-competitions.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPER_ADMIN)
@Controller('team-competitions')
export class TeamCompetitionsController {
  constructor(private readonly teamCompetitionsService: TeamCompetitionsService) {}

  @Post()
  create(@Body() dto: CreateTeamCompetitionDto) {
    return this.teamCompetitionsService.create(dto);
  }

  @Get()
  list(@Query('tournamentId') tournamentId?: string) {
    return this.teamCompetitionsService.list(tournamentId);
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

  @Post(':id/teams')
  createTeam(@Param('id') id: string, @Body() dto: CreateTeamDto) {
    return this.teamCompetitionsService.createTeam(id, dto);
  }

  @Post(':id/teams/import')
  importTeam(@Param('id') id: string, @Body() dto: ImportTeamPlayersDto) {
    return this.teamCompetitionsService.importTeamPlayers(id, dto);
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
  createTeamFromQuickInput(@Param('id') id: string, @Body() dto: ParseQuickTeamDto) {
    return this.teamCompetitionsService.createTeamFromQuickInput(id, dto);
  }

  @Patch('teams/:teamId')
  updateTeam(@Param('teamId') teamId: string, @Body() dto: UpdateTeamDto) {
    return this.teamCompetitionsService.updateTeam(teamId, dto);
  }

  @Put('teams/:teamId/members')
  replaceTeamMembers(@Param('teamId') teamId: string, @Body() dto: ReplaceTeamMembersDto) {
    return this.teamCompetitionsService.replaceTeamMembers(teamId, dto);
  }

  @Delete('teams/:teamId')
  removeTeam(@Param('teamId') teamId: string) {
    return this.teamCompetitionsService.removeTeam(teamId);
  }

  @Post(':id/draw')
  generateDraw(@Param('id') id: string, @Body() dto: GenerateTeamDrawDto) {
    return this.teamCompetitionsService.generateDraw(id, dto);
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
}

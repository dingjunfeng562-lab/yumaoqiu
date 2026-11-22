import { AuthActor } from '../auth/admin-scope';
import {
  BadRequestException,
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
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { EntrantType, Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { RosterRecognitionService, type RosterUploadFile } from '../roster-recognition/roster-recognition.service';
import {
  AddTeamPlayersDto,
  BatchImportTeamsDto,
  AssignTeamMatchRefereeDto,
  CreateTeamCompetitionDto,
  CreateTeamDrawClearRequestDto,
  CreateTeamDto,
  GenerateTeamDrawDto,
  ImportTeamPlayersDto,
  ParseQuickTeamDto,
  RejectTeamDrawClearRequestDto,
  ReplaceTeamMembersDto,
  SetTeamLineupsDto,
  UpdateTeamCompetitionDto,
  UpdateTeamDto,
  GenerateGroupDrawDto,
  AdjustGroupsDto,
  GenerateKnockoutFromGroupsDto,
  SwapTeamDrawDto,
} from './dto/team-competition.dto';
import { TeamCompetitionsService } from './team-competitions.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.ROOT)
@Controller('team-competitions')
export class TeamCompetitionsController {
  constructor(
    private readonly teamCompetitionsService: TeamCompetitionsService,
    private readonly rosterRecognition: RosterRecognitionService,
  ) {}

  /** 建队页判断是否显示「上传照片/PDF 识别」：只返回开关状态，不暴露配置。 */
  @Get('ai-recognition/status')
  rosterRecognitionStatus() {
    return this.rosterRecognition.publicStatus();
  }

  @Patch('teams/:teamId/members/:memberPlayerId/verify-eligibility')
  verifyMemberEligibility(@Param('teamId') teamId: string, @Param('memberPlayerId') playerId: string, @Body() dto: { note: string; gender: 'MALE' | 'FEMALE' }, @Req() req: { user: AuthActor }) {
    return this.teamCompetitionsService.verifyMemberEligibility(teamId, playerId, dto.note, dto.gender, req.user.id);
  }

  @Post()
  create(@Body() dto: CreateTeamCompetitionDto) {
    return this.teamCompetitionsService.create(dto);
  }

  @Get()
  list(
    @Req() req: { user: AuthActor },
    @Query('tournamentId') tournamentId?: string,
    @Query('entrantType') entrantType?: EntrantType,
  ) {
    return this.teamCompetitionsService.list(tournamentId, req.user, entrantType);
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

  @Get(':id/unpaid-teams')
  listUnpaidTeams(@Param('id') id: string) {
    return this.teamCompetitionsService.listUnpaidTeams(id);
  }

  @Get(':id/available-players')
  availablePlayers(@Param('id') id: string, @Req() req: { user: AuthActor }) {
    return this.teamCompetitionsService.availablePlayers(id, req.user);
  }

  /** 本组报名字段（性别、身份证号必填 / 选填 / 不收集），导入预览按它校验。 */
  @Get(':id/roster-fields')
  rosterFields(@Param('id') id: string) {
    return this.teamCompetitionsService.rosterFieldRules(id);
  }

  /** 按本组报名字段生成的团体队员导入模板。 */
  @Get(':id/roster-template')
  async rosterTemplate(@Param('id') id: string) {
    const { buffer, filename } = await this.teamCompetitionsService.rosterTemplate(id);
    return new StreamableFile(buffer, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    });
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

  /**
   * 报名表照片 / PDF 识别成队员行。只做识别，不落库；前端预览、人工核对后再调 batch-import。
   */
  @Post(':id/teams/ai-parse')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024 } }))
  parseRosterFile(@Param('id') id: string, @UploadedFile() file: RosterUploadFile | undefined, @Req() req: { user: AuthActor }) {
    if (!file?.buffer?.length) throw new BadRequestException('请上传报名表照片或 PDF');
    return this.rosterRecognition.parse(id, file, req.user.id);
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
  removeTeam(@Param('teamId') teamId: string, @Req() req: { user: AuthActor & { username?: string | null } }) {
    return this.teamCompetitionsService.removeTeam(teamId, req.user);
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
  clearDraw(@Param('id') id: string, @Req() req: { user: AuthActor }) {
    return this.teamCompetitionsService.clearDraw(id, req.user);
  }

  @Post(':id/draw/clear-request')
  requestClearDraw(
    @Param('id') id: string,
    @Body() dto: CreateTeamDrawClearRequestDto,
    @Req() req: { user: AuthActor & { username?: string | null } },
  ) {
    return this.teamCompetitionsService.requestClearDraw(id, dto.reason, req.user);
  }

  @Get(':id/draw/clear-requests')
  listClearDrawRequests(@Param('id') id: string, @Req() req: { user: AuthActor }) {
    return this.teamCompetitionsService.listClearDrawRequests(id, req.user);
  }

  @Roles(Role.ROOT)
  @Post(':id/draw/clear-requests/:requestId/approve')
  approveClearDrawRequest(
    @Param('id') id: string,
    @Param('requestId') requestId: string,
    @Body() dto: RejectTeamDrawClearRequestDto,
    @Req() req: { user: AuthActor & { username?: string | null } },
  ) {
    return this.teamCompetitionsService.approveClearDrawRequest(id, requestId, req.user, dto.reason);
  }

  @Roles(Role.ROOT)
  @Post(':id/draw/clear-requests/:requestId/reject')
  rejectClearDrawRequest(
    @Param('id') id: string,
    @Param('requestId') requestId: string,
    @Body() dto: RejectTeamDrawClearRequestDto,
    @Req() req: { user: AuthActor & { username?: string | null } },
  ) {
    return this.teamCompetitionsService.rejectClearDrawRequest(id, requestId, dto.reason, req.user);
  }

  @Post(':id/draw/clear-requests/:requestId/cancel')
  cancelClearDrawRequest(
    @Param('id') id: string,
    @Param('requestId') requestId: string,
    @Req() req: { user: AuthActor & { username?: string | null } },
  ) {
    return this.teamCompetitionsService.cancelClearDrawRequest(id, requestId, req.user);
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

  @Get(':id/draw/swap-options')
  getSwapOptions(@Param('id') id: string) {
    return this.teamCompetitionsService.getSwapOptions(id);
  }

  @Post(':id/draw/swap')
  swapPositions(@Param('id') id: string, @Body() dto: SwapTeamDrawDto) {
    return this.teamCompetitionsService.swapTeamPositions(id, dto);
  }

  @Post(':id/knockout')
  generateKnockout(@Param('id') id: string, @Body() dto: GenerateKnockoutFromGroupsDto) {
    return this.teamCompetitionsService.generateKnockoutFromGroups(id, dto);
  }
}

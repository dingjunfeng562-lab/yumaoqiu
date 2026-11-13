import {
  Body,
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { createReadStream } from 'node:fs';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  AssignRefereeDto,
  AuthorizeRefereeTournamentDto,
  CardMatchDto,
  CorrectMatchScoreDto,
  FaultMatchDto,
  FinishMatchDto,
  ForfeitBothDto,
  ForfeitMatchDto,
  LogMatchEventDto,
  MatchSignatureSettingDto,
  PauseMatchDto,
  RetireMatchDto,
  ScorePointDto,
  SetGameServeDto,
  StartMatchDto,
  StartWarmupDto,
  UndoPointDto,
} from './dto/scoring.dto';
import { ScoringGateway } from './scoring.gateway';
import { ScoringService } from './scoring.service';
import { MatchScoreSheetService, type ScoreSheetFileKind } from './match-score-sheet.service';
import type { ScoreSheetRequestMeta } from './score-sheet.types';

type RequestWithUser = {
  user: {
    id: string;
    role: Role;
  };
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
};

const SCORE_SHEET_FILE_KINDS: ScoreSheetFileKind[] = ['sheet', 'winner', 'referee'];

/** 签字时记下提交端的 IP 和设备信息，作为比分单的附带证据。经 CDN/nginx 转发时取 X-Forwarded-For 的第一个。 */
function scoreSheetRequestMeta(req: RequestWithUser): ScoreSheetRequestMeta {
  const header = (name: string) => {
    const value = req.headers?.[name];
    return Array.isArray(value) ? value[0] : value;
  };
  const forwarded = header('x-forwarded-for')?.split(',')[0]?.trim();
  return { ip: forwarded || req.ip || null, userAgent: header('user-agent') ?? null };
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class ScoringController {
  constructor(
    private scoringService: ScoringService,
    private scoringGateway: ScoringGateway,
    private scoreSheets: MatchScoreSheetService,
  ) {}

  @Roles(Role.ADMIN, Role.ROOT)
  @Get('scoring/referees')
  listAssignableReferees(@Req() req: RequestWithUser) {
    return this.scoringService.listAssignableReferees(req.user);
  }

  /** 比赛结束签字开关（按赛事）。 */
  @Roles(Role.ADMIN, Role.ROOT)
  @Get('scoring/tournaments/:tournamentId/signature-setting')
  getSignatureSetting(@Param('tournamentId') tournamentId: string) {
    return this.scoreSheets.getSetting(tournamentId);
  }

  @Roles(Role.ADMIN, Role.ROOT)
  @Patch('scoring/tournaments/:tournamentId/signature-setting')
  updateSignatureSetting(
    @Param('tournamentId') tournamentId: string,
    @Body() dto: MatchSignatureSettingDto,
  ) {
    return this.scoreSheets.updateSetting(tournamentId, dto.enabled);
  }

  /** 本赛事全部电子比分单（含已作废），不含签名图片。 */
  @Roles(Role.ADMIN, Role.ROOT)
  @Get('scoring/tournaments/:tournamentId/score-sheets')
  listTournamentScoreSheets(@Param('tournamentId') tournamentId: string) {
    return this.scoreSheets.listForTournament(tournamentId);
  }

  /** 单场的电子比分单，逐份校验签名文件和指纹。 */
  @Roles(Role.ADMIN, Role.ROOT)
  @Get('scoring/matches/:id/score-sheets')
  listMatchScoreSheets(@Param('id') id: string) {
    return this.scoreSheets.listForMatch(id);
  }

  /** 下载比分单图片（sheet）或签名图片（winner / referee）。只走登录接口，不放到公开的 /uploads。 */
  @Roles(Role.ADMIN, Role.ROOT)
  @Get('scoring/matches/:id/score-sheets/:sheetId/:kind')
  @Header('Cache-Control', 'private, no-store')
  async downloadScoreSheetFile(
    @Param('id') id: string,
    @Param('sheetId') sheetId: string,
    @Param('kind') kind: string,
  ) {
    if (!SCORE_SHEET_FILE_KINDS.includes(kind as ScoreSheetFileKind)) throw new NotFoundException('文件不存在');
    const file = await this.scoreSheets.resolveFile(id, sheetId, kind as ScoreSheetFileKind);
    return new StreamableFile(createReadStream(file.path), {
      type: 'image/png',
      disposition: `inline; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
    });
  }

  @Roles(Role.ADMIN, Role.ROOT)
  @Post('tournaments/:tournamentId/referee-access-code')
  getRefereeAccessCode(@Param('tournamentId') tournamentId: string) {
    return this.scoringService.getRefereeAccessCode(tournamentId);
  }

  @Roles(Role.REFEREE)
  @Post('referee/authorize')
  authorizeTournament(@Body() dto: AuthorizeRefereeTournamentDto, @Req() req: RequestWithUser) {
    return this.scoringService.authorizeTournament(dto.accessCode, req.user);
  }

  @Roles(Role.REFEREE)
  @Get('referee/tournaments')
  listAuthorizedTournaments(@Req() req: RequestWithUser) {
    return this.scoringService.listAuthorizedTournaments(req.user);
  }

  @Roles(Role.REFEREE)
  @Get('referee/matches')
  listRefereeMatches(@Req() req: RequestWithUser) {
    return this.scoringService.listRefereeMatches(req.user);
  }

  @Roles(Role.REFEREE)
  @Get('referee/tournaments/:tournamentId/courts')
  listTournamentCourts(@Param('tournamentId') tournamentId: string, @Req() req: RequestWithUser) {
    return this.scoringService.listTournamentCourts(tournamentId, req.user);
  }

  @Roles(Role.REFEREE)
  @Get('referee/tournaments/:tournamentId/courts/:venueId/matches')
  listCourtMatches(
    @Param('tournamentId') tournamentId: string,
    @Param('venueId') venueId: string,
    @Req() req: RequestWithUser,
  ) {
    return this.scoringService.listCourtMatches(tournamentId, venueId, req.user);
  }

  @Roles(Role.REFEREE)
  @Post('referee/tournaments/:tournamentId/courts/:venueId/matches/:id/claim')
  async claimCourtMatch(
    @Param('tournamentId') tournamentId: string,
    @Param('venueId') venueId: string,
    @Param('id') id: string,
    @Req() req: RequestWithUser,
  ) {
    const result = await this.scoringService.claimCourtMatch(tournamentId, venueId, id, req.user);
    this.scoringGateway.emitBracketUpdate({ tournamentId, matchId: id });
    return result;
  }

  @Roles(Role.ADMIN, Role.ROOT, Role.REFEREE)
  @Get('matches/:id/score')
  getMatchScore(@Param('id') id: string, @Req() req: RequestWithUser) {
    return this.scoringService.getMatchState(id, req.user);
  }

  @Roles(Role.ADMIN, Role.REFEREE)
  @Post('matches/:id/start')
  async startMatch(@Param('id') id: string, @Body() dto: StartMatchDto, @Req() req: RequestWithUser) {
    const state = await this.scoringService.startMatch(id, req.user, dto);
    this.scoringGateway.emitMatchState(id, state);
    return state;
  }

  @Roles(Role.ADMIN, Role.REFEREE)
  @Post('matches/:id/game-serve')
  async setGameServe(
    @Param('id') id: string,
    @Body() dto: SetGameServeDto,
    @Req() req: RequestWithUser,
  ) {
    const state = await this.scoringService.setGameServe(id, req.user, dto);
    this.scoringGateway.emitMatchState(id, state);
    return state;
  }

  @Roles(Role.ADMIN, Role.REFEREE)
  @Post('matches/:id/point')
  async addPoint(
    @Param('id') id: string,
    @Body() dto: ScorePointDto,
    @Req() req: RequestWithUser,
  ) {
    const state = await this.scoringService.addPoint(id, dto.side, req.user);
    this.scoringGateway.emitMatchState(id, state);
    return state;
  }

  @Roles(Role.ADMIN, Role.REFEREE)
  @Post('matches/:id/undo')
  async undoLastPoint(
    @Param('id') id: string,
    @Body() dto: UndoPointDto,
    @Req() req: RequestWithUser,
  ) {
    const state = await this.scoringService.undoLastPoint(id, req.user, dto.side);
    this.scoringGateway.emitMatchState(id, state);
    return state;
  }

  @Roles(Role.ADMIN, Role.REFEREE)
  @Post('matches/:id/finish')
  async finishMatch(@Param('id') id: string, @Body() dto: FinishMatchDto, @Req() req: RequestWithUser) {
    const state = await this.scoringService.finishMatch(id, req.user, dto?.signatures, scoreSheetRequestMeta(req));
    this.scoringGateway.emitMatchState(id, state);
    return state;
  }

  @Roles(Role.ADMIN, Role.REFEREE)
  @Post('matches/:id/pause')
  async pauseMatch(@Param('id') id: string, @Body() dto: PauseMatchDto, @Req() req: RequestWithUser) {
    const state = await this.scoringService.pauseMatch(id, req.user, dto.reason);
    this.scoringGateway.emitMatchState(id, state);
    return state;
  }

  @Roles(Role.ADMIN, Role.REFEREE)
  @Post('matches/:id/resume')
  async resumeMatch(@Param('id') id: string, @Req() req: RequestWithUser) {
    const state = await this.scoringService.resumeMatch(id, req.user);
    this.scoringGateway.emitMatchState(id, state);
    return state;
  }

  @Roles(Role.ADMIN, Role.REFEREE)
  @Post('matches/:id/warmup')
  async startWarmup(@Param('id') id: string, @Body() dto: StartWarmupDto, @Req() req: RequestWithUser) {
    const state = await this.scoringService.startWarmup(id, req.user, dto.seconds);
    this.scoringGateway.emitMatchState(id, state);
    return state;
  }

  @Roles(Role.ADMIN, Role.REFEREE)
  @Post('matches/:id/warmup-end')
  async endWarmup(@Param('id') id: string, @Req() req: RequestWithUser) {
    const state = await this.scoringService.endWarmup(id, req.user);
    this.scoringGateway.emitMatchState(id, state);
    return state;
  }

  @Roles(Role.ADMIN, Role.REFEREE)
  @Post('matches/:id/swap-court')
  async swapCourt(@Param('id') id: string, @Req() req: RequestWithUser) {
    const state = await this.scoringService.swapCourt(id, req.user);
    this.scoringGateway.emitMatchState(id, state);
    return state;
  }

  /** 自定义分数的比赛新一局开始前，裁判选「不换边」。 */
  @Roles(Role.ADMIN, Role.REFEREE)
  @Post('matches/:id/keep-court')
  async keepCourt(@Param('id') id: string, @Req() req: RequestWithUser) {
    const state = await this.scoringService.keepCourt(id, req.user);
    this.scoringGateway.emitMatchState(id, state);
    return state;
  }

  @Roles(Role.ADMIN, Role.REFEREE)
  @Post('matches/:id/forfeit')
  async forfeitMatch(
    @Param('id') id: string,
    @Body() dto: ForfeitMatchDto,
    @Req() req: RequestWithUser,
  ) {
    const state = await this.scoringService.forfeitMatch(
      id,
      dto.side,
      req.user,
      dto.reason,
      dto.signatures,
      scoreSheetRequestMeta(req),
    );
    this.scoringGateway.emitMatchState(id, state);
    return state;
  }

  /** 团体赛整队弃权：只限后台管理员，不开放给裁判。 */
  @Roles(Role.ADMIN, Role.ROOT)
  @Post('team-matches/:id/forfeit')
  async forfeitTeamMatch(
    @Param('id') id: string,
    @Body() dto: ForfeitMatchDto,
    @Req() req: RequestWithUser,
  ) {
    const result = await this.scoringService.forfeitTeamEncounter(id, dto.side, req.user, dto.reason);
    for (const matchId of result.forfeitedMatchIds) {
      this.scoringGateway.emitMatchState(matchId, await this.scoringService.getMatchState(matchId, req.user));
    }
    return result;
  }

  @Roles(Role.ADMIN, Role.REFEREE)
  @Post('matches/:id/forfeit-both')
  async forfeitBoth(
    @Param('id') id: string,
    @Body() body: ForfeitBothDto,
    @Req() req: RequestWithUser,
  ) {
    const state = await this.scoringService.forfeitBothSides(
      id,
      req.user,
      body?.reason,
      body?.signatures,
      scoreSheetRequestMeta(req),
    );
    this.scoringGateway.emitMatchState(id, state);
    return state;
  }

  @Roles(Role.ADMIN, Role.REFEREE)
  @Post('matches/:id/retire')
  async retireMatch(
    @Param('id') id: string,
    @Body() dto: RetireMatchDto,
    @Req() req: RequestWithUser,
  ) {
    const state = await this.scoringService.retireMatch(
      id,
      dto.side,
      req.user,
      dto.reason,
      dto.signatures,
      scoreSheetRequestMeta(req),
    );
    this.scoringGateway.emitMatchState(id, state);
    return state;
  }

  @Roles(Role.ADMIN, Role.REFEREE)
  @Post('matches/:id/events')
  async logEvent(
    @Param('id') id: string,
    @Body() dto: LogMatchEventDto,
    @Req() req: RequestWithUser,
  ) {
    const state = await this.scoringService.logMatchEvent(
      id,
      dto.type,
      req.user,
      dto.side,
      dto.note,
    );
    this.scoringGateway.emitMatchState(id, state);
    return state;
  }

  @Roles(Role.ADMIN, Role.REFEREE)
  @Post('matches/:id/fault')
  async recordFault(
    @Param('id') id: string,
    @Body() dto: FaultMatchDto,
    @Req() req: RequestWithUser,
  ) {
    const state = await this.scoringService.recordFault(
      id,
      req.user,
      dto.side,
      dto.faultType,
      dto.playerIndex,
    );
    this.scoringGateway.emitMatchState(id, state);
    return state;
  }

  @Roles(Role.ADMIN, Role.REFEREE)
  @Post('matches/:id/card')
  async recordCard(
    @Param('id') id: string,
    @Body() dto: CardMatchDto,
    @Req() req: RequestWithUser,
  ) {
    const state = await this.scoringService.recordCard(
      id,
      req.user,
      dto.side,
      dto.cardType,
      dto.reason,
      dto.playerIndex,
      dto.signatures,
      scoreSheetRequestMeta(req),
    );
    this.scoringGateway.emitMatchState(id, state);
    return state;
  }

  @Roles(Role.ADMIN, Role.ROOT)
  @Patch('matches/:id/score')
  async correctMatchScore(@Param('id') id: string, @Body() dto: CorrectMatchScoreDto) {
    const state = await this.scoringService.correctMatchScore(id, dto.games);
    this.scoringGateway.emitMatchState(id, state);
    return state;
  }

  @Roles(Role.ADMIN, Role.ROOT)
  @Patch('matches/:id/referee')
  async assignReferee(@Param('id') id: string, @Body() dto: AssignRefereeDto) {
    const state = await this.scoringService.assignReferee(id, dto.refereeId);
    this.scoringGateway.emitMatchState(id, state);
    return state;
  }
}

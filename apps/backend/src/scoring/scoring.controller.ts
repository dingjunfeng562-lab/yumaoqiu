import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  AssignRefereeDto,
  CardMatchDto,
  FaultMatchDto,
  ForfeitMatchDto,
  LogMatchEventDto,
  PauseMatchDto,
  RetireMatchDto,
  ScorePointDto,
  StartMatchDto,
} from './dto/scoring.dto';
import { ScoringGateway } from './scoring.gateway';
import { ScoringService } from './scoring.service';

type RequestWithUser = {
  user: {
    id: string;
    role: Role;
  };
};

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class ScoringController {
  constructor(
    private scoringService: ScoringService,
    private scoringGateway: ScoringGateway,
  ) {}

  @Roles(Role.REFEREE)
  @Get('referee/matches')
  listRefereeMatches(@Req() req: RequestWithUser) {
    return this.scoringService.listRefereeMatches(req.user);
  }

  @Roles(Role.ADMIN, Role.REFEREE)
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
  async undoLastPoint(@Param('id') id: string, @Req() req: RequestWithUser) {
    const state = await this.scoringService.undoLastPoint(id, req.user);
    this.scoringGateway.emitMatchState(id, state);
    return state;
  }

  @Roles(Role.ADMIN, Role.REFEREE)
  @Post('matches/:id/finish')
  async finishMatch(@Param('id') id: string, @Req() req: RequestWithUser) {
    const state = await this.scoringService.finishMatch(id, req.user);
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
  @Post('matches/:id/swap-court')
  async swapCourt(@Param('id') id: string, @Req() req: RequestWithUser) {
    const state = await this.scoringService.swapCourt(id, req.user);
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
    const state = await this.scoringService.forfeitMatch(id, dto.side, req.user, dto.reason);
    this.scoringGateway.emitMatchState(id, state);
    return state;
  }

  @Roles(Role.ADMIN, Role.REFEREE)
  @Post('matches/:id/forfeit-both')
  async forfeitBoth(
    @Param('id') id: string,
    @Body() body: { reason?: string },
    @Req() req: RequestWithUser,
  ) {
    const state = await this.scoringService.forfeitBothSides(id, req.user, body?.reason);
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
    const state = await this.scoringService.retireMatch(id, dto.side, req.user, dto.reason);
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
    );
    this.scoringGateway.emitMatchState(id, state);
    return state;
  }

  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Patch('matches/:id/referee')
  async assignReferee(@Param('id') id: string, @Body() dto: AssignRefereeDto) {
    const state = await this.scoringService.assignReferee(id, dto.refereeId);
    this.scoringGateway.emitMatchState(id, state);
    return state;
  }
}

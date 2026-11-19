import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthActor } from '../auth/admin-scope';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CorrectMatchScoreDto } from '../scoring/dto/scoring.dto';
import {
  ListAllMatchesQueryDto,
  UpdateManagedMatchDto,
  ReleaseRefereeDto,
} from './dto/match-management.dto';
import { AllMatchesService } from './all-matches.service';
import { MatchDirectoryService } from './match-directory.service';
import { MatchManagementService } from './match-management.service';
import { MatchOperationLogService } from './match-operation-log.service';

type ActorRequest = { user?: AuthActor & { username?: string | null } };

/**
 * 裁判员对局管理：赛事级查看对阵、时间、比分与结束状态，并提供修改入口。
 * 需要「对局管理」功能权限（管理员默认有）；管理员只能管自己创建的赛事——
 * 带 tournamentId / 场次 id 的接口由 RolesGuard 检查归属，列表和搜索在服务里按 tournamentScope 过滤。
 * 每次修改都记操作记录（谁、什么时候、改前改后）。
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.ROOT)
@Controller('match-management')
export class MatchManagementController {
  constructor(
    private readonly matchManagementService: MatchManagementService,
    private readonly directory: MatchDirectoryService,
    private readonly operationLog: MatchOperationLogService,
    private readonly allMatches: AllMatchesService,
  ) {}

  /** 选赛事用：管理员只有自己的赛事，超级管理员全部（带创建账号）。 */
  @Get('tournaments')
  listTournaments(@Req() req: ActorRequest) {
    return this.directory.listTournaments(req.user);
  }

  /** 跨赛事搜选手 / 队伍。 */
  @Get('search')
  searchMatches(@Query('q') q: string, @Req() req: ActorRequest) {
    return this.directory.searchMatches(req.user, q ?? '');
  }

  /** 全部场次：不用先选赛事，列出能管的所有赛事的场次（分页，带各状态数量）。 */
  @Get('matches')
  listAllMatches(
    @Query() query: ListAllMatchesQueryDto,
    @Req() req: ActorRequest,
  ) {
    return this.allMatches.list(req.user, query);
  }

  @Get('tournaments/:tournamentId/overview')
  getOverview(@Param('tournamentId') tournamentId: string, @Req() req: ActorRequest) {
    return this.matchManagementService.getOverview(tournamentId, req.user);
  }

  /** 某一场的操作记录（最新的在前）。 */
  @Get('matches/:id/logs')
  listMatchLogs(@Param('id') id: string) {
    return this.operationLog.list(id);
  }

  @Patch('matches/:id')
  updateMatch(@Param('id') id: string, @Body() dto: UpdateManagedMatchDto, @Req() req: ActorRequest) {
    return this.matchManagementService.updateMatch(id, dto, req.user);
  }

  /**
   * 解除单场比赛的裁判接手，比赛回到「未分配」。
   * 进行中的比赛要带 force=true（后台红色二次确认），已结束的比赛需先重开。
   */
  @Post('matches/:id/release-referee')
  releaseReferee(
    @Param('id') id: string,
    @Body() dto: ReleaseRefereeDto,
    @Req() req: ActorRequest,
  ) {
    return this.matchManagementService.releaseReferee(id, dto ?? {}, req.user);
  }

  @Patch('matches/:id/score')
  correctScore(@Param('id') id: string, @Body() dto: CorrectMatchScoreDto, @Req() req: ActorRequest) {
    return this.matchManagementService.correctScore(id, dto.games, req.user);
  }

  @Post('matches/:id/complete')
  completeMatch(@Param('id') id: string, @Req() req: ActorRequest) {
    return this.matchManagementService.completeMatch(id, req.user);
  }

  @Post('matches/:id/reopen')
  reopenMatch(@Param('id') id: string, @Req() req: ActorRequest) {
    return this.matchManagementService.reopenMatch(id, req.user);
  }
}

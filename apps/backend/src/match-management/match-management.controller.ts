import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CorrectMatchScoreDto } from '../scoring/dto/scoring.dto';
import { UpdateManagedMatchDto, ReleaseRefereeDto } from './dto/match-management.dto';
import { MatchManagementService } from './match-management.service';

/**
 * 裁判员对局管理：赛事级查看对阵、时间、比分与结束状态，并提供修改入口。
 * 入口与读写权限都只属于超级管理员（ROOT），其他角色既看不到入口也调不通接口。
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ROOT)
@Controller('match-management')
export class MatchManagementController {
  constructor(
    private readonly matchManagementService: MatchManagementService,
  ) {}

  @Get('tournaments/:tournamentId/overview')
  getOverview(@Param('tournamentId') tournamentId: string) {
    return this.matchManagementService.getOverview(tournamentId);
  }

  @Patch('matches/:id')
  updateMatch(@Param('id') id: string, @Body() dto: UpdateManagedMatchDto, @Req() req: { user: { id: string } }) {
    return this.matchManagementService.updateMatch(id, dto, req.user.id);
  }

  /**
   * 解除单场比赛的裁判接手，比赛回到「未分配」。
   * 进行中的比赛要带 force=true（后台红色二次确认），已结束的比赛需先重开。
   */
  @Post('matches/:id/release-referee')
  releaseReferee(
    @Param('id') id: string,
    @Body() dto: ReleaseRefereeDto,
    @Req() req: { user: { id: string } },
  ) {
    return this.matchManagementService.releaseReferee(id, dto ?? {}, req.user.id);
  }

  @Patch('matches/:id/score')
  correctScore(@Param('id') id: string, @Body() dto: CorrectMatchScoreDto) {
    return this.matchManagementService.correctScore(id, dto.games);
  }

  @Post('matches/:id/complete')
  completeMatch(@Param('id') id: string) {
    return this.matchManagementService.completeMatch(id);
  }

  @Post('matches/:id/reopen')
  reopenMatch(@Param('id') id: string) {
    return this.matchManagementService.reopenMatch(id);
  }
}

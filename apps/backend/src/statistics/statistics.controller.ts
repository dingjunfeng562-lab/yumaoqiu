import { Body, Controller, Delete, Get, Header, Param, Put, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { SaveSchoolAliasesDto } from './dto/school-alias.dto';
import { StatisticsService } from './statistics.service';

type AuthRequest = { user?: { id?: string; username?: string | null } };

// 赛事统计：管理员凭「仪表盘」权限查看自己创建的赛事（RolesGuard 按 :tournamentId 校验归属），
// 超级管理员看全部。学校名称归并是全局数据，只有超级管理员能改。
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.ROOT)
@Controller('admin/statistics')
export class AdminStatisticsController {
  constructor(private readonly statistics: StatisticsService) {}

  @Get('tournaments/:tournamentId')
  @Header('Cache-Control', 'no-store')
  tournamentStatistics(@Param('tournamentId') tournamentId: string) {
    return this.statistics.tournamentStatistics(tournamentId);
  }

  @Roles(Role.ROOT)
  @Get('school-aliases')
  @Header('Cache-Control', 'no-store')
  listSchoolAliases() {
    return this.statistics.listSchoolAliases();
  }

  @Roles(Role.ROOT)
  @Put('school-aliases')
  saveSchoolAliases(@Body() dto: SaveSchoolAliasesDto, @Req() req: AuthRequest) {
    return this.statistics.saveSchoolAliases(dto, req.user?.username ?? req.user?.id ?? null);
  }

  @Roles(Role.ROOT)
  @Delete('school-aliases/:aliasId')
  deleteSchoolAlias(@Param('aliasId') aliasId: string) {
    return this.statistics.deleteSchoolAlias(aliasId);
  }
}

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RegistrationStatus, type EntrantType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SaveSchoolAliasesDto } from './dto/school-alias.dto';
import { createSchoolResolver, normalizeSchoolName } from './school-name';
import { buildTournamentStatistics } from './statistics.builder';

@Injectable()
export class StatisticsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 后台「赛事统计」：报名人数、参赛高校、各组别人数。只读，现查现算。 */
  async tournamentStatistics(tournamentId: string) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { id: true, name: true },
    });
    if (!tournament) throw new NotFoundException('赛事不存在');

    const player = { select: { name: true, affiliation: true } } as const;
    const [events, teamCompetitions, pending, aliases] = await Promise.all([
      this.prisma.event.findMany({
        where: { tournamentId },
        select: {
          type: true,
          entrantType: true,
          groupId: true,
          group: { select: { name: true } },
          registrations: {
            where: { status: RegistrationStatus.APPROVED },
            select: { player1: player, player2: player, competitionRegistration: { select: { status: true } } },
          },
        },
      }),
      this.prisma.teamCompetition.findMany({
        where: { tournamentId },
        select: {
          entrantType: true,
          groupId: true,
          group: { select: { name: true } },
          teams: { select: { affiliation: true, members: { select: { player } } } },
        },
      }),
      this.prisma.competitionRegistration.groupBy({
        by: ['entrantType', 'groupId'],
        where: { competitionId: tournamentId, status: RegistrationStatus.PENDING },
        _count: { _all: true },
      }),
      this.prisma.schoolAlias.findMany({ select: { alias: true, canonical: true, ignored: true } }),
    ]);

    const pendingByEntrantType: Partial<Record<EntrantType, number>> = {};
    const pendingByGroupId: Record<string, number> = {};
    for (const row of pending) {
      pendingByEntrantType[row.entrantType] = (pendingByEntrantType[row.entrantType] ?? 0) + row._count._all;
      if (row.groupId) pendingByGroupId[row.groupId] = row._count._all;
    }

    return {
      tournament,
      generatedAt: new Date().toISOString(),
      groups: buildTournamentStatistics({
        events: events.map((event) => ({
          type: event.type,
          entrantType: event.entrantType,
          groupId: event.groupId,
          groupLabel: event.group?.name,
          registrations: event.registrations.map((registration) => ({
            player1: registration.player1,
            player2: registration.player2,
            competitionRegistrationStatus: registration.competitionRegistration?.status ?? null,
          })),
        })),
        teamCompetitions: teamCompetitions.map((competition) => ({
          entrantType: competition.entrantType,
          groupId: competition.groupId,
          groupLabel: competition.group?.name,
          teams: competition.teams.map((team) => ({
            affiliation: team.affiliation,
            members: team.members.map((member) => member.player),
          })),
        })),
        pendingByEntrantType,
        pendingByGroupId,
        aliases,
      }),
    };
  }

  listSchoolAliases() {
    return this.prisma.schoolAlias.findMany({ orderBy: [{ updatedAt: 'desc' }, { alias: 'asc' }] });
  }

  /**
   * 归并写法到标准校名，或标记为无效。别名表保持「一步到位」：目标校名若本身是别名，
   * 先解析到它最终指向的校名；原来指向这些写法的别名也一起改指新目标，避免出现连环和环。
   */
  async saveSchoolAliases(dto: SaveSchoolAliasesDto, updatedBy: string | null) {
    const names = [...new Set(dto.names.map((name) => normalizeSchoolName(name)).filter(Boolean))];
    if (!names.length) throw new BadRequestException('请选择要归并的学校名称');

    if (dto.ignored) {
      await this.prisma.$transaction(names.map((alias) => this.prisma.schoolAlias.upsert({
        where: { alias },
        create: { alias, canonical: null, ignored: true, updatedBy },
        update: { canonical: null, ignored: true, updatedBy },
      })));
      return this.listSchoolAliases();
    }

    const requested = normalizeSchoolName(dto.canonical);
    if (!requested) throw new BadRequestException('请填写标准校名');
    const rules = await this.prisma.schoolAlias.findMany({ select: { alias: true, canonical: true, ignored: true } });
    const resolved = createSchoolResolver(rules)(requested);
    if (resolved.kind === 'ignored') throw new BadRequestException(`「${requested}」已被标记为无效，不能作为标准校名`);
    const target = resolved.kind === 'school' ? resolved.canonical : requested;
    const sources = names.filter((name) => name !== target);
    if (!sources.length) throw new BadRequestException('要归并的写法和标准校名相同');

    await this.prisma.$transaction([
      // 标准校名自己不能再是别名，否则会形成环。
      this.prisma.schoolAlias.deleteMany({ where: { alias: target } }),
      ...sources.map((alias) => this.prisma.schoolAlias.upsert({
        where: { alias },
        create: { alias, canonical: target, ignored: false, updatedBy },
        update: { canonical: target, ignored: false, updatedBy },
      })),
      this.prisma.schoolAlias.updateMany({
        where: { canonical: { in: sources } },
        data: { canonical: target, updatedBy },
      }),
    ]);
    return this.listSchoolAliases();
  }

  async deleteSchoolAlias(id: string) {
    const existing = await this.prisma.schoolAlias.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new NotFoundException('这条归并记录不存在');
    await this.prisma.schoolAlias.delete({ where: { id } });
    return { id };
  }
}

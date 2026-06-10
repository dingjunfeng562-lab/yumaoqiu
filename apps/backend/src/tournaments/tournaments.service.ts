import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EventType,
  Format,
  Prisma,
  Role,
  ScoringMode,
  ScoringRule,
  TournamentApprovalStatus,
  TournamentStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTournamentDto, UpdateTournamentDto } from './dto/tournament.dto';

export type AuthUser = {
  id: string;
  username?: string | null;
  role?: Role | null;
};

function isSuperAdmin(user?: AuthUser | null) {
  return user?.role === Role.SUPER_ADMIN;
}

const EVENT_TYPE_LABELS: Record<EventType, string> = {
  MENS_SINGLES: '男子单打',
  WOMENS_SINGLES: '女子单打',
  MENS_DOUBLES: '男子双打',
  WOMENS_DOUBLES: '女子双打',
  MIXED_DOUBLES: '混合双打',
};

type TournamentDetail = Prisma.TournamentGetPayload<{
  include: ReturnType<TournamentsService['detailInclude']>;
}>;

@Injectable()
export class TournamentsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateTournamentDto, user?: AuthUser) {
    this.validateTournamentInput(dto);
    const superAdmin = isSuperAdmin(user);
    return this.prisma.$transaction(async (tx) => {
      // showOnHome is reserved for already-approved tournaments — a brand-new
      // pending submission shouldn't take over the home feature card.
      if (dto.showOnHome && superAdmin) {
        await tx.tournament.updateMany({ data: { showOnHome: false } });
      }

      const edition = dto.edition ?? (await this.nextEdition(tx));
      const tournament = await tx.tournament.create({
        data: {
          ...(this.toTournamentData(dto) as Prisma.TournamentUncheckedCreateInput),
          edition,
          // Auto-approve when the super admin creates it; otherwise the new
          // tournament is queued for review and stays hidden until approval.
          approvalStatus: superAdmin
            ? TournamentApprovalStatus.APPROVED
            : TournamentApprovalStatus.PENDING,
          submittedById: user?.id ?? null,
          approvedById: superAdmin ? user?.id ?? null : null,
          approvedAt: superAdmin ? new Date() : null,
          isPublished: superAdmin,
          showOnHome: superAdmin ? Boolean(dto.showOnHome) : false,
        },
      });

      await this.syncEvents(tx, tournament.id, dto.eventTypes);
      await this.syncVenues(tx, tournament.id, dto.venueNames);
      await this.syncTeamCompetition(tx, tournament.id, dto);

      const created = await tx.tournament.findUniqueOrThrow({
        where: { id: tournament.id },
        include: this.detailInclude(),
      });
      return this.withEffectiveStatus(created);
    });
  }

  async approve(id: string, approver: AuthUser) {
    if (!isSuperAdmin(approver)) {
      throw new ForbiddenException('仅总管理员可审核赛事');
    }
    const tournament = await this.findOne(id);
    if (tournament.approvalStatus === TournamentApprovalStatus.APPROVED) {
      throw new BadRequestException('该赛事已通过审核');
    }
    return this.prisma.tournament.update({
      where: { id },
      data: {
        approvalStatus: TournamentApprovalStatus.APPROVED,
        approvedById: approver.id,
        approvedAt: new Date(),
        rejectReason: null,
        isPublished: true,
      },
      include: this.detailInclude(),
    });
  }

  async reject(id: string, approver: AuthUser, reason?: string) {
    if (!isSuperAdmin(approver)) {
      throw new ForbiddenException('仅总管理员可审核赛事');
    }
    await this.findOne(id);
    return this.prisma.tournament.update({
      where: { id },
      data: {
        approvalStatus: TournamentApprovalStatus.REJECTED,
        approvedById: approver.id,
        approvedAt: new Date(),
        rejectReason: reason?.trim() || '未通过审核',
        isPublished: false,
        showOnHome: false,
      },
      include: this.detailInclude(),
    });
  }

  async findAll() {
    const tournaments = await this.prisma.tournament.findMany({
      include: this.listInclude(),
      orderBy: [{ edition: 'desc' }],
    });
    return tournaments.map((tournament) => this.withEffectiveStatus(tournament));
  }

  async findOne(id: string) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id },
      include: this.detailInclude(),
    });
    if (!tournament) throw new NotFoundException(`赛事 ${id} 不存在`);
    return this.withEffectiveStatus(tournament);
  }

  async update(id: string, dto: UpdateTournamentDto, user?: AuthUser) {
    if (dto.status !== undefined && !isSuperAdmin(user)) {
      throw new ForbiddenException('仅总管理员可修改赛事状态');
    }

    const current = await this.findOne(id);
    this.validateTournamentInput(dto, current);

    return this.prisma.$transaction(async (tx) => {
      if (dto.showOnHome) {
        await tx.tournament.updateMany({
          where: { id: { not: id } },
          data: { showOnHome: false },
        });
      }

      // Only an APPROVED tournament can be published / shown on home.
      const isApproved = current.approvalStatus === TournamentApprovalStatus.APPROVED;
      await tx.tournament.update({
        where: { id },
        data: {
          ...(this.toTournamentData(dto) as Prisma.TournamentUncheckedUpdateInput),
          ...(dto.showOnHome && isApproved ? { isPublished: true } : {}),
          ...(dto.showOnHome && !isApproved ? { showOnHome: false } : {}),
        },
      });

      if (dto.eventTypes) {
        await this.syncEvents(tx, id, dto.eventTypes);
      }
      if (dto.venueNames) {
        await this.syncVenues(tx, id, dto.venueNames);
      }
      if (dto.includeTeamCompetition !== undefined || dto.teamEventTypes || dto.teamWinThreshold) {
        await this.syncTeamCompetition(tx, id, dto);
      }

      const updated = await tx.tournament.findUniqueOrThrow({
        where: { id },
        include: this.detailInclude(),
      });
      return this.withEffectiveStatus(updated);
    });
  }

  async archive(id: string) {
    await this.findOne(id);
    return this.prisma.tournament.update({
      where: { id },
      data: { isArchived: true },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.tournament.delete({ where: { id } });
  }

  private toTournamentData(dto: CreateTournamentDto | UpdateTournamentDto) {
    const data: Record<string, unknown> = { ...dto };
    delete data.eventTypes;
    delete data.includeTeamCompetition;
    delete data.teamWinThreshold;
    delete data.teamEventTypes;
    delete data.venueNames;

    if (dto.startDate) data.startDate = new Date(dto.startDate);
    if (dto.endDate) data.endDate = new Date(dto.endDate);
    if (dto.registrationStartDate) data.registrationStartDate = new Date(dto.registrationStartDate);
    if (dto.registrationEndDate) data.registrationEndDate = new Date(dto.registrationEndDate);
    if (dto.allowCrossEventRegistration === false) data.maxRegistrationEvents = 1;
    return data;
  }

  private validateTournamentInput(dto: CreateTournamentDto | UpdateTournamentDto, current?: TournamentDetail) {
    const startDate = dto.startDate ? new Date(dto.startDate) : current?.startDate;
    const endDate = dto.endDate ? new Date(dto.endDate) : current?.endDate;
    const registrationStartDate = dto.registrationStartDate
      ? new Date(dto.registrationStartDate)
      : current?.registrationStartDate;
    const registrationEndDate = dto.registrationEndDate
      ? new Date(dto.registrationEndDate)
      : current?.registrationEndDate;

    if (startDate && Number.isNaN(startDate.getTime())) throw new BadRequestException('赛事开始日期无效');
    if (endDate && Number.isNaN(endDate.getTime())) throw new BadRequestException('赛事结束日期无效');
    if (registrationStartDate && Number.isNaN(registrationStartDate.getTime())) {
      throw new BadRequestException('报名开始时间无效');
    }
    if (registrationEndDate && Number.isNaN(registrationEndDate.getTime())) {
      throw new BadRequestException('报名截止时间无效');
    }
    if (!current && startDate) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (startDate < today) throw new BadRequestException('赛事开始日期不能早于今天');
    }
    if (startDate && endDate && endDate < startDate) throw new BadRequestException('赛事结束日期必须不早于开始日期');
    if (startDate && registrationEndDate && registrationEndDate >= startDate) {
      throw new BadRequestException('报名截止时间必须早于赛事开始日期');
    }
    if (registrationStartDate && registrationEndDate && registrationEndDate <= registrationStartDate) {
      throw new BadRequestException('报名截止时间必须晚于报名开始时间');
    }

    const dailyStartTime = dto.dailyStartTime ?? current?.dailyStartTime;
    const dailyEndTime = dto.dailyEndTime ?? current?.dailyEndTime;
    if (dailyStartTime && dailyEndTime && dailyEndTime <= dailyStartTime) {
      throw new BadRequestException('每日比赛结束时间必须晚于开始时间');
    }

    if (dto.allowCrossEventRegistration === false && dto.maxRegistrationEvents && dto.maxRegistrationEvents !== 1) {
      throw new BadRequestException('不允许跨项目报名时，每人最多报名项目数必须为 1');
    }

    if (dto.eventTypes) this.ensureUnique(dto.eventTypes, '包含的单项不能重复');

    const includeTeamCompetition = dto.includeTeamCompetition ?? Boolean(current?.teamCompetitions.length);
    if (includeTeamCompetition) {
      const selectedEvents = dto.eventTypes ?? current?.events.map((event) => event.type) ?? [];
      const teamEventTypes = dto.teamEventTypes ?? current?.teamCompetitions[0]?.items.map((item) => item.eventType) ?? [];
      const teamWinThreshold = dto.teamWinThreshold ?? current?.teamCompetitions[0]?.winThreshold ?? 2;
      const requiredCount = teamWinThreshold === 3 ? 5 : 3;
      if (teamEventTypes.length !== requiredCount) {
        throw new BadRequestException(
          teamWinThreshold === 3 ? '5 项 3 胜必须选择 5 个团体赛单项' : '3 项 2 胜必须选择 3 个团体赛单项',
        );
      }
      const selectedSet = new Set(selectedEvents);
      for (const type of teamEventTypes) {
        if (!selectedSet.has(type)) throw new BadRequestException('团体赛单项必须来自已勾选的包含单项');
      }
      this.ensureUnique(teamEventTypes, '团体赛单项不能重复');
    }
  }

  private async syncEvents(tx: Prisma.TransactionClient, tournamentId: string, eventTypes: EventType[]) {
    const nextTypes = [...new Set(eventTypes)];
    const existing = await tx.event.findMany({
      where: { tournamentId },
      include: {
        _count: {
          select: {
            registrations: true,
            competitionRegistrationItems: true,
            matches: true,
            drawBrackets: true,
          },
        },
      },
    });
    const existingTypes = new Set(existing.map((event) => event.type));
    const removeEvents = existing.filter((event) => !nextTypes.includes(event.type));
    for (const event of removeEvents) {
      const linkedCount =
        event._count.registrations +
        event._count.competitionRegistrationItems +
        event._count.matches +
        event._count.drawBrackets;
      if (linkedCount > 0) {
        throw new ConflictException(`单项「${EVENT_TYPE_LABELS[event.type]}」已有报名、抽签或比赛数据，不能直接移除`);
      }
    }
    if (removeEvents.length) {
      await tx.event.deleteMany({ where: { id: { in: removeEvents.map((event) => event.id) } } });
    }
    const createTypes = nextTypes.filter((type) => !existingTypes.has(type));
    if (createTypes.length) {
      await tx.event.createMany({
        data: createTypes.map((type) => ({
          tournamentId,
          type,
          format: Format.SINGLE_ELIMINATION,
          scoringRule: ScoringRule.TWENTYONE_BO3,
          scoringMode: ScoringMode.STANDARD_GOLDEN,
        })),
      });
    }
  }

  private async syncVenues(tx: Prisma.TransactionClient, tournamentId: string, venueNames: string[]) {
    const names = [...new Set(venueNames.map((name) => name.trim()).filter(Boolean))];
    if (!names.length) throw new BadRequestException('至少需要填写一个比赛场地');
    const existing = await tx.venue.findMany({
      where: { tournamentId },
      include: { _count: { select: { matches: true } } },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });

    for (const [index, name] of names.entries()) {
      const current = existing.find((venue) => venue.name === name);
      if (current) {
        await tx.venue.update({ where: { id: current.id }, data: { sortOrder: index, isActive: true } });
      } else {
        await tx.venue.create({ data: { tournamentId, name, sortOrder: index, isActive: true } });
      }
    }

    const nextNameSet = new Set(names);
    for (const venue of existing.filter((item) => !nextNameSet.has(item.name))) {
      if (venue._count.matches > 0) {
        await tx.venue.update({ where: { id: venue.id }, data: { isActive: false } });
      } else {
        await tx.venue.delete({ where: { id: venue.id } });
      }
    }
  }

  private async syncTeamCompetition(
    tx: Prisma.TransactionClient,
    tournamentId: string,
    dto: Pick<UpdateTournamentDto, 'includeTeamCompetition' | 'teamWinThreshold' | 'teamEventTypes' | 'name' | 'description'>,
  ) {
    const current = await tx.teamCompetition.findFirst({
      where: { tournamentId },
      include: { items: true, _count: { select: { teams: true, teamMatches: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const includeTeamCompetition = dto.includeTeamCompetition ?? Boolean(current);
    if (!includeTeamCompetition) {
      if (!current) return;
      if (current._count.teams > 0 || current._count.teamMatches > 0) {
        throw new ConflictException('团体赛已有队伍或对阵数据，不能直接关闭');
      }
      await tx.teamCompetition.delete({ where: { id: current.id } });
      return;
    }

    const teamEventTypes =
      dto.teamEventTypes ??
      current?.items.sort((a, b) => a.sortOrder - b.sortOrder).map((item) => item.eventType) ??
      [];
    const winThreshold = dto.teamWinThreshold ?? current?.winThreshold ?? 2;
    const data = {
      name: `${dto.name ?? '团体赛'} 团体赛`,
      description: dto.description,
      winThreshold,
      isPublished: false,
    };

    if (!current) {
      await tx.teamCompetition.create({
        data: {
          tournamentId,
          ...data,
          items: {
            create: teamEventTypes.map((eventType, index) => ({ eventType, sortOrder: index + 1 })),
          },
        },
      });
      return;
    }

    await tx.teamCompetition.update({
      where: { id: current.id },
      data: {
        name: data.name,
        description: data.description,
        winThreshold: data.winThreshold,
      },
    });

    const currentTypes = current.items.sort((a, b) => a.sortOrder - b.sortOrder).map((item) => item.eventType);
    if (JSON.stringify(currentTypes) !== JSON.stringify(teamEventTypes)) {
      if (current._count.teamMatches > 0) {
        throw new ConflictException('团体赛已生成对阵后不能直接修改出场项目');
      }
      await tx.teamCompetitionItem.deleteMany({ where: { teamCompetitionId: current.id } });
      await tx.teamCompetitionItem.createMany({
        data: teamEventTypes.map((eventType, index) => ({
          teamCompetitionId: current.id,
          eventType,
          sortOrder: index + 1,
        })),
      });
    }
  }

  private async nextEdition(tx: Prisma.TransactionClient) {
    const latest = await tx.tournament.findFirst({
      select: { edition: true },
      orderBy: { edition: 'desc' },
    });
    return (latest?.edition ?? 0) + 1;
  }

  private ensureUnique<T>(items: T[], message: string) {
    if (new Set(items).size !== items.length) throw new BadRequestException(message);
  }

  // Admin endpoints surface the raw stored status so the SUPER_ADMIN's manual
  // override in 赛事配置 takes effect immediately — public-facing callers
  // apply effectiveTournamentStatus() themselves where time-based auto-advance
  // is desired.
  private withEffectiveStatus<T extends {
    status: TournamentStatus;
    registrationStartDate: Date | null;
    registrationEndDate: Date | null;
    startDate: Date;
    endDate: Date;
  }>(tournament: T): T {
    return tournament;
  }

  private listInclude() {
    return {
      events: { orderBy: { type: 'asc' as const } },
      venues: { orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }] },
      teamCompetitions: {
        include: { items: { orderBy: { sortOrder: 'asc' as const } } },
        orderBy: { createdAt: 'asc' as const },
      },
      _count: { select: { events: true } },
    };
  }

  private detailInclude() {
    return {
      events: { orderBy: { type: 'asc' as const } },
      venues: { orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }] },
      teamCompetitions: {
        include: { items: { orderBy: { sortOrder: 'asc' as const } } },
        orderBy: { createdAt: 'asc' as const },
      },
    };
  }
}

import { ensureLegacyGroups, legacyGroupId, saveRegistrationGroup } from '../registration-groups/registration-groups.service';
import { groupFields } from '../common/age-eligibility';
import { hasPermission } from '../auth/permissions';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  EntrantType,
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
import { ScoringGateway } from '../scoring/scoring.gateway';
import { TeamCompetitionsService } from '../team-competitions/team-competitions.service';
import { CreateTournamentDto, UpdateTournamentDto } from './dto/tournament.dto';
import { sanitizeAnnouncementContent } from '../announcements/announcement-content';
import { ScreenSettingsDto } from './dto/screen-settings.dto';
import { AuthActor, tournamentScope } from '../auth/admin-scope';
import { deriveTournamentStatusByTime } from './tournament-status';
import { generateRegistrationCode, normalizeRegistrationCode } from '../common/registration-code';
import { defaultGroupLabel, normalizeRegistrationFieldRules } from '../common/entrant';

export type AuthUser = {
  id: string;
  username?: string | null;
  role?: Role | null;
  permissions?: Prisma.JsonValue;
};

// 赛事审核和状态管理能力由功能权限控制，ROOT 固定拥有全部权限。
// 超级管理员(ROOT)作为最高权限同样拥有。
function isSuperAdmin(user?: AuthUser | null) {
  return !!user?.role && hasPermission({ role: user.role, permissions: user.permissions }, 'TOURNAMENT_ADMIN');
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
  constructor(
    private prisma: PrismaService,
    private teamCompetitionsService: TeamCompetitionsService,
    @Optional() private scoringGateway?: ScoringGateway,
  ) {}

  async getScreenSettings(id: string) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id },
      select: { screenSettings: true, _count: { select: { venues: { where: { isActive: true } } } } },
    });
    if (!tournament) throw new NotFoundException('赛事不存在');
    const courtCount = tournament._count.venues;
    const columns = courtCount <= 3 ? Math.max(1, courtCount) : courtCount <= 6 ? 3 : 4;
    const defaultCardWidth = courtCount > 6 ? 770 : 560;
    const defaultCardHeight = courtCount > 6 ? 495 : 360;
    const defaultCardFontScale = courtCount > 6 ? 150 : 100;
    const defaults = { columns, rows: Math.min(8, Math.max(1, Math.ceil(courtCount / columns))), scale: 100, titleFontSize: 48, cardWidth: defaultCardWidth, cardHeight: defaultCardHeight, boundaryPadding: 0, cardFontScale: defaultCardFontScale };
    return { settings: tournament.screenSettings ?? defaults, defaults, courtCount };
  }

  async updateScreenSettings(id: string, dto: ScreenSettingsDto) {
    const current = await this.getScreenSettings(id);
    await this.prisma.tournament.update({ where: { id }, data: { screenSettings: { cardWidth: current.defaults.cardWidth, cardHeight: current.defaults.cardHeight, boundaryPadding: 0, cardFontScale: current.defaults.cardFontScale, ...dto } } });
    return this.getScreenSettings(id);
  }

  async create(dto: CreateTournamentDto, user?: AuthUser) {
    const groups = this.resolveCreateGroups(dto);
    this.validateTournamentInput(dto, undefined, groups, dto.customGroups?.some(group => group.eventTypes.length > 0));
    const superAdmin = isSuperAdmin(user);
    return this.prisma.$transaction(async (tx) => {
      // showOnHome 只留给已审核通过的赛事——新建后还在待审核的赛事
      // 不应该抢走首页推荐位。
      if (dto.showOnHome && superAdmin) {
        await tx.tournament.updateMany({ data: { showOnHome: false } });
      }

      const edition = dto.edition ?? (await this.nextEdition(tx));
      const tournament = await tx.tournament.create({
        data: {
          ...(this.toTournamentData(dto) as Prisma.TournamentUncheckedCreateInput),
          // 未显式指定状态时按报名/比赛时间算出初始状态，避免报名已开始却显示「报名未开始」。
          ...(dto.status ? {} : { status: this.statusFromTiming(dto) }),
          edition,
          allowSchoolRegistration: groups.school.length > 0
            ? dto.allowSchoolRegistration ?? true
            : false,
          schoolRegistrationCode: groups.school.length
            ? await this.uniqueRegistrationCode(tx)
            : null,
          // 赛事报名码：一个赛事一个码，扫码后报名人自己选组别。
          registrationCode: await this.uniqueRegistrationCode(tx),
          registrationCodeEnabled: true,
          // 超级管理员创建时直接审核通过；其他人新建的赛事进入待审核，
          // 审核通过前不对外显示。
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

      await ensureLegacyGroups(tx, tournament);
      for (const group of dto.customGroups ?? []) {
        await saveRegistrationGroup(tx, tournament.id, group);
      }
      await this.syncEvents(tx, tournament.id, groups.school);
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
      throw new ForbiddenException('仅超级管理员可审核赛事');
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
      throw new ForbiddenException('仅超级管理员可审核赛事');
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

  async findAll(actor?: AuthActor) {
    const tournaments = await this.prisma.tournament.findMany({
      where: tournamentScope(actor),
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
    if (!isSuperAdmin(user) && dto.isArchived !== undefined) {
      throw new ForbiddenException('管理员无权归档或恢复赛事');
    }
    if (dto.isArchived === false && !isSuperAdmin(user)) {
      throw new ForbiddenException('仅超级管理员可恢复归档赛事');
    }
    if (dto.status !== undefined && !isSuperAdmin(user)) {
      throw new ForbiddenException('仅超级管理员可修改赛事状态');
    }
    // showOnHome 和创建一样仅限超级管理员——其他角色编辑时直接忽略该字段，
    // 避免管理员把首页推荐位改掉。
    if (!isSuperAdmin(user)) {
      delete dto.showOnHome;
    }

    const current = await this.findOne(id);
    const groups = this.resolveUpdateGroups(dto, current);
    this.validateTournamentInput(dto, current, groups);

    // 只有审核通过的赛事才能发布 / 上首页。
    const isApproved = current.approvalStatus === TournamentApprovalStatus.APPROVED;
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM Tournament WHERE id = ${id} FOR UPDATE`;
      if (dto.registrationFieldRules !== undefined) {
        // 赛事表单只维护默认学生组的字段；其它组别在「组别设置」里各自配置。
        const incoming = normalizeRegistrationFieldRules(dto.registrationFieldRules);
        const group = await tx.tournamentGroup.findUnique({ where: { id: legacyGroupId(id, EntrantType.SCHOOL) } });
        if (group) {
          const currentFields = groupFields(group.fieldRules);
          const nextFields = { ...currentFields, ...incoming.SCHOOL };
          if (JSON.stringify(nextFields) !== JSON.stringify(currentFields)) {
            if (await tx.competitionRegistration.count({ where: { groupId: group.id } }) || await tx.registration.count({ where: { event: { groupId: group.id } } }) || await tx.team.count({ where: { teamCompetition: { groupId: group.id } } })) {
              throw new ConflictException(`${group.name}已有报名，不能直接改变报名字段规则；请在组别设置中新增组别`);
            }
            await tx.tournamentGroup.update({ where: { id: group.id }, data: { fieldRules: nextFields, ruleVersion: { increment: 1 } } });
          }
        }
      }
      if (dto.showOnHome && isApproved) {
        await tx.tournament.updateMany({
          where: { id: { not: id } },
          data: { showOnHome: false },
        });
      }

      // 时间真的变了且没有显式指定状态时，按新时间重算状态（延长报名后会回到「报名中」）。
      // 编辑表单每次都会带上全部时间，所以要和库里的值比较，只改简介不应重算状态。
      const differs = (value: string | undefined, stored: Date | null) =>
        value !== undefined && new Date(value).getTime() !== (stored?.getTime() ?? NaN);
      const timingChanged =
        differs(dto.startDate, current.startDate) ||
        differs(dto.endDate, current.endDate) ||
        differs(dto.registrationStartDate, current.registrationStartDate) ||
        differs(dto.registrationEndDate, current.registrationEndDate);
      await tx.tournament.update({
        where: { id },
        data: {
          ...(this.toTournamentData(dto) as Prisma.TournamentUncheckedUpdateInput),
          ...(timingChanged && dto.status === undefined ? { status: this.statusFromTiming(dto, current) } : {}),
          ...(dto.showOnHome && isApproved ? { isPublished: true } : {}),
          ...(dto.showOnHome && !isApproved ? { showOnHome: false } : {}),
        },
      });

      if (dto.eventTypes !== undefined || dto.schoolEventTypes !== undefined) {
        await this.syncEvents(tx, id, groups.school);
        await this.syncRegistrationCodes(tx, id, groups.school, dto);
      }
      if (dto.venueNames) {
        await this.syncVenues(tx, id, dto.venueNames);
      }
      if (dto.includeTeamCompetition !== undefined || dto.teamEventTypes || dto.teamWinThreshold || dto.teamMaxPlayerAppearances !== undefined || dto.teamPlayAllMatches !== undefined || dto.teamScoringRule || dto.teamScoringMode) {
        await this.syncTeamCompetition(tx, id, dto);
      }

      await ensureLegacyGroups(tx, await tx.tournament.findUniqueOrThrow({ where: { id } }));
      const updated = await tx.tournament.findUniqueOrThrow({
        where: { id },
        include: this.detailInclude(),
      });
      return this.withEffectiveStatus(updated);
    });
    if (dto.venueNames) this.scoringGateway?.emitBracketUpdate({ tournamentId: id });
    return result;
  }

  async archive(id: string) {
    await this.findOne(id);
    return this.prisma.tournament.update({
      where: { id },
      data: { isArchived: true },
    });
  }

  async restore(id: string, user: AuthUser) {
    if (!isSuperAdmin(user)) {
      throw new ForbiddenException('仅超级管理员可恢复归档赛事');
    }
    await this.findOne(id);
    return this.prisma.tournament.update({
      where: { id },
      data: { isArchived: false },
    });
  }

  async remove(id: string, user?: AuthUser) {
    const tournament = await this.findOne(id);
    // 超级管理员可以删除任意赛事；普通管理员只能删除自己创建的赛事。
    // RolesGuard 已按 submittedById 过滤过一遍，这里再做一次归属校验，
    // 避免服务被其他入口直接调用时越权。
    if (!isSuperAdmin(user) && tournament.submittedById !== user?.id) {
      throw new ForbiddenException('只能删除自己创建的赛事');
    }
    return this.prisma.tournament.delete({ where: { id } });
  }

  private statusFromTiming(dto: CreateTournamentDto | UpdateTournamentDto, current?: TournamentDetail) {
    const pick = (value: string | null | undefined, fallback: Date | null | undefined) =>
      value ? new Date(value) : value === null ? null : fallback ?? null;
    const startDate = pick(dto.startDate, current?.startDate);
    const endDate = pick(dto.endDate, current?.endDate);
    if (!startDate || !endDate) return current?.status ?? TournamentStatus.REGISTRATION_NOT_STARTED;
    return deriveTournamentStatusByTime({
      startDate,
      endDate,
      registrationStartDate: pick(dto.registrationStartDate, current?.registrationStartDate),
      registrationEndDate: pick(dto.registrationEndDate, current?.registrationEndDate),
    });
  }

  private toTournamentData(dto: CreateTournamentDto | UpdateTournamentDto) {
    const data: Record<string, unknown> = { ...dto };
    delete data.eventTypes;
    delete data.schoolEventTypes;
    delete data.includeTeamCompetition;
    delete data.teamWinThreshold;
    delete data.teamEventTypes;
    delete data.teamMalePlayerCount;
    delete data.teamFemalePlayerCount;
    delete data.teamMaxPlayerAppearances;
    delete data.teamPlayAllMatches;
    delete data.teamScoringRule;
    delete data.teamScoringMode;
    delete data.venueNames;
    delete data.customGroups;

    if (dto.startDate) data.startDate = new Date(dto.startDate);
    if (dto.endDate) data.endDate = new Date(dto.endDate);
    if (dto.registrationStartDate) data.registrationStartDate = new Date(dto.registrationStartDate);
    if (dto.registrationEndDate) data.registrationEndDate = new Date(dto.registrationEndDate);
    if (dto.allowCrossEventRegistration === false) data.maxRegistrationEvents = 1;
    if (dto.registrationFieldRules !== undefined) {
      data.registrationFieldRules = normalizeRegistrationFieldRules(dto.registrationFieldRules);
    }
    if (typeof dto.description === 'string') {
      data.description = sanitizeAnnouncementContent(dto.description.trim());
    }
    if (typeof dto.rules === 'string') {
      data.rules = sanitizeAnnouncementContent(dto.rules.trim());
    }
    return data;
  }

  private validateTournamentInput(
    dto: CreateTournamentDto | UpdateTournamentDto,
    current?: TournamentDetail,
    groups?: { school: EventType[] },
    hasNewCustomEvents = false,
  ) {
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

    if (groups) {
      if (!groups.school.length && !hasNewCustomEvents && !current?.events.some(e => e.groupId && e.groupId !== legacyGroupId(current.id, EntrantType.SCHOOL))) {
        throw new BadRequestException('请至少为一个组别选择比赛项目');
      }
      this.ensureUnique(groups.school, '学生组包含的单项不能重复');
    } else if (dto.eventTypes) {
      this.ensureUnique(dto.eventTypes, '包含的单项不能重复');
    }

    const schoolTeamCompetition = current?.teamCompetitions.find(
      (item) => item.entrantType === EntrantType.SCHOOL && (!item.groupId || item.groupId === legacyGroupId(current!.id, EntrantType.SCHOOL)),
    );
    const includeTeamCompetition = dto.includeTeamCompetition ?? Boolean(schoolTeamCompetition);
    if (includeTeamCompetition) {
      const selectedEvents = groups?.school
        ?? dto.eventTypes
        ?? current?.events
          .filter((event) => event.entrantType === EntrantType.SCHOOL && (!event.groupId || event.groupId === legacyGroupId(current!.id, EntrantType.SCHOOL)))
          .map((event) => event.type)
        ?? [];
      const teamEventTypes = dto.teamEventTypes
        ?? schoolTeamCompetition?.items.map((item) => item.eventType)
        ?? [];
      const teamWinThreshold = dto.teamWinThreshold ?? schoolTeamCompetition?.winThreshold ?? 2;
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

  private async syncEvents(
    tx: Prisma.TransactionClient,
    tournamentId: string,
    schoolTypes: EventType[],
  ) {
    const school = [...new Set(schoolTypes)];
    if (!school.length && !await tx.event.count({ where: { tournamentId, group: { legacyType: null } } })) {
      throw new BadRequestException('请至少选择一个单项（学生组或自定义组别）');
    }
    const configuredGroups = await tx.tournamentGroup.findMany({ where: { tournamentId } });
    const schoolLabel = configuredGroups.find(g => g.legacyType === EntrantType.SCHOOL)?.name ?? '学生组';
    const nextKeys = new Set(school);

    // 赛事表单只维护默认学生组的单项；自定义组别的单项在「组别设置」里维护。
    const existing = await tx.event.findMany({
      where: {
        tournamentId,
        OR: [
          { groupId: null, entrantType: EntrantType.SCHOOL },
          { group: { legacyType: EntrantType.SCHOOL } },
        ],
      },
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
    const existingKeys = new Set(existing.map((event) => event.type));
    const removeEvents = existing.filter((event) => !nextKeys.has(event.type));
    for (const event of removeEvents) {
      const linkedCount =
        event._count.registrations +
        event._count.competitionRegistrationItems +
        event._count.matches +
        event._count.drawBrackets;
      if (linkedCount > 0) {
        throw new ConflictException(
          `单项「${event.groupLabel ? `${event.groupLabel} · ` : ''}${EVENT_TYPE_LABELS[event.type]}」已有报名、抽签或比赛数据，不能直接移除`,
        );
      }
    }
    if (removeEvents.length) {
      await tx.event.deleteMany({ where: { id: { in: removeEvents.map((event) => event.id) } } });
    }

    const createRows: Prisma.EventCreateManyInput[] = school
      .filter((type) => !existingKeys.has(type))
      .map((type) => ({
        tournamentId,
        type,
        entrantType: EntrantType.SCHOOL,
        groupId: legacyGroupId(tournamentId, EntrantType.SCHOOL),
        groupLabel: schoolLabel,
        format: Format.SINGLE_ELIMINATION,
        scoringRule: ScoringRule.TWENTYONE_BO3,
        scoringMode: ScoringMode.STANDARD_GOLDEN,
      }));
    if (createRows.length) {
      // 默认学生组只在真正开设时才建（新赛事不开学生组时没有这条记录）。
      if (!configuredGroups.some((group) => group.legacyType === EntrantType.SCHOOL)) {
        await tx.tournamentGroup.create({ data: {
          id: legacyGroupId(tournamentId, EntrantType.SCHOOL), tournamentId, name: '学生组', legacyType: EntrantType.SCHOOL,
          fieldTemplate: 'SCHOOL', sortOrder: 0, fieldRules: groupFields({}, true, true), ageRule: { mode: 'NONE' },
        } });
      }
      await tx.event.createMany({ data: createRows });
    }

    // 学生组改名后，已有单项的组名跟着更新。
    for (const event of existing) {
      if (!nextKeys.has(event.type) || event.groupLabel === schoolLabel) continue;
      await tx.event.update({
        where: { id: event.id },
        data: { groupLabel: schoolLabel },
      });
    }
  }

  private resolveCreateGroups(dto: CreateTournamentDto) {
    return {
      school: [...new Set(dto.schoolEventTypes ?? dto.eventTypes ?? [])],
    };
  }

  private resolveUpdateGroups(dto: UpdateTournamentDto, current: TournamentDetail) {
    const currentSchool = current.events
      .filter((event) => event.entrantType === EntrantType.SCHOOL && (!event.groupId || event.groupId === legacyGroupId(current!.id, EntrantType.SCHOOL)))
      .map((event) => event.type);
    const school = dto.schoolEventTypes ?? dto.eventTypes ?? currentSchool;
    return {
      school: [...new Set(school)],
    };
  }

  private async uniqueRegistrationCode(tx: Prisma.TransactionClient): Promise<string> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const code = generateRegistrationCode();
      const exists = await tx.tournament.findFirst({
        where: { OR: [{ registrationCode: code }, { schoolRegistrationCode: code }] },
        select: { id: true },
      });
      if (!exists && !await tx.tournamentGroup.findUnique({ where: { registrationCode: code } })) return code;
    }
    throw new ConflictException('报名码生成失败，请重试');
  }

  /**
   * 学生组有单项时补报名码；单项清空时清空报名码并关闭通道。
   * 已有码不重新生成，避免旧二维码失效。
   */
  private async syncRegistrationCodes(
    tx: Prisma.TransactionClient,
    tournamentId: string,
    school: EventType[],
    dto: UpdateTournamentDto,
  ) {
    const current = await tx.tournament.findUniqueOrThrow({
      where: { id: tournamentId },
      select: {
        schoolRegistrationCode: true,
        allowSchoolRegistration: true,
      },
    });
    const schoolCode = school.length
      ? current.schoolRegistrationCode ?? (await this.uniqueRegistrationCode(tx))
      : null;
    const schoolWasEmpty = !current.schoolRegistrationCode;

    await tx.tournament.update({
      where: { id: tournamentId },
      data: {
        schoolRegistrationCode: schoolCode,
        allowSchoolRegistration: school.length
          ? dto.allowSchoolRegistration ?? (schoolWasEmpty ? true : current.allowSchoolRegistration)
          : false,
      },
    });
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
    dto: Pick<UpdateTournamentDto, 'includeTeamCompetition' | 'teamWinThreshold' | 'teamEventTypes' | 'teamMaxPlayerAppearances' | 'teamPlayAllMatches' | 'teamScoringRule' | 'teamScoringMode' | 'name' | 'description'>,
  ) {
    const current = await tx.teamCompetition.findFirst({
      // 赛事表单只维护学生组团体赛；其它组别的团体赛在“团体赛管理”页单独创建。
      where: { tournamentId, entrantType: EntrantType.SCHOOL, OR: [{ groupId: null }, { groupId: legacyGroupId(tournamentId, EntrantType.SCHOOL) }] },
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
      maxPlayerAppearances: dto.teamMaxPlayerAppearances ?? current?.maxPlayerAppearances ?? 2,
      playAllMatches: dto.teamPlayAllMatches ?? current?.playAllMatches ?? false,
      scoringRule: dto.teamScoringRule ?? current?.scoringRule ?? 'TWENTYONE_BO3' as const,
      scoringMode: dto.teamScoringMode ?? current?.scoringMode ?? 'CAPPED_30' as const,
      name: dto.name ? `${dto.name} 团体赛` : current?.name ?? '团体赛',
      description: dto.description,
      winThreshold,
      isPublished: false,
    };

    if (!current) {
      await tx.teamCompetition.create({
        data: {
          tournamentId,
          groupId: legacyGroupId(tournamentId, EntrantType.SCHOOL),
          entrantType: EntrantType.SCHOOL,
          ...data,
          items: {
            create: teamEventTypes.map((eventType, index) => ({ eventType, sortOrder: index + 1 })),
          },
        },
      });
      return;
    }

    if (current._count.teamMatches > 0 && (data.winThreshold !== current.winThreshold || data.maxPlayerAppearances !== current.maxPlayerAppearances || data.scoringRule !== current.scoringRule || data.scoringMode !== current.scoringMode)) {
      throw new ConflictException('已生成团体对阵，不能修改兼项、胜场或计分规则');
    }
    const playAllTurnedOn = data.playAllMatches && !current.playAllMatches;
    await tx.teamCompetition.update({
      where: { id: current.id },
      data: {
        name: data.name,
        description: data.description,
        winThreshold: data.winThreshold,
        maxPlayerAppearances: data.maxPlayerAppearances,
        playAllMatches: data.playAllMatches,
        scoringRule: data.scoringRule,
        scoringMode: data.scoringMode,
      },
    });
    // 与团体赛设置页保持一致：开启「胜负确定后继续比赛」时恢复因胜负已定取消的剩余子项。
    if (playAllTurnedOn) await this.teamCompetitionsService.reopenCancelledChildren(tx, current.id);

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

  // 管理端接口返回数据库里存的原始状态，管理员的「赛事配置」手动改动能立即生效；
  // 需要按时间自动推进的公开页面，由调用方自己套 effectiveTournamentStatus()。
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
      events: { orderBy: [{ entrantType: 'asc' as const }, { type: 'asc' as const }] },
      venues: { orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }] },
      teamCompetitions: {
        include: { items: { orderBy: { sortOrder: 'asc' as const } } },
        orderBy: { createdAt: 'asc' as const },
      },
      _count: { select: { events: true } },
      // 列表「项目」列按组别分行显示；接口仅管理员可调。
      registrationGroups: {
        select: {
          id: true,
          name: true,
          legacyType: true,
          enabled: true,
          registrationCode: true,
          registrationCodeEnabled: true,
          _count: { select: { events: true } },
        },
        orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }],
      },
    };
  }

  private detailInclude() {
    return {
      events: { orderBy: [{ entrantType: 'asc' as const }, { type: 'asc' as const }] },
      venues: { orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }] },
      teamCompetitions: {
        include: { items: { orderBy: { sortOrder: 'asc' as const } } },
        orderBy: { createdAt: 'asc' as const },
      },
    };
  }
}

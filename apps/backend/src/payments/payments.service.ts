import { groupFields } from '../common/age-eligibility';
import { legacyGroupId } from '../registration-groups/registration-groups.service';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EntrantType, EventType, PaymentStatus, Prisma, RegistrationStatus, TournamentPaymentSetting } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { entrantTypeLabel, eventDisplayLabel, normalizeRegistrationFieldRules } from '../common/entrant';
import { ChangeActor, ensureRegistrationEditable, requireAdminActor } from '../common/registration-changes';
import { CompetitionsService } from '../competitions/competitions.service';
import { AdminCompetitionPlayerDto } from '../competitions/dto/competition-registration.dto';
import { TeamCompetitionsService } from '../team-competitions/team-competitions.service';
import {
  DeletePaymentEntriesDto,
  UpdateEditDeadlineDto,
  UpdatePaymentSettingDto,
  UpdatePaymentStatusDto,
  UpdatePaymentTeamDto,
} from './dto/payment.dto';
import {
  FeeKind,
  FeeSetting,
  feeAmount,
  feeKindForEvent,
  normalizeContact,
  registrationDisplayName,
} from './payment-rules';

type Actor = { id: string; username?: string | null };

type SettingView = Omit<TournamentPaymentSetting, 'id' | 'createdAt' | 'updatedAt'> & { groupLabel?: string };

/** 选手端看到的状态：除三种缴费状态外，还有「无需缴费」和「待审核」。 */
export type PlayerPaymentStatus = PaymentStatus | 'NOT_REQUIRED' | 'PENDING_REVIEW' | 'REJECTED';

export type PaymentItemView = {
  id: string;
  kind: 'EVENT' | 'TEAM';
  itemName: string;
  name: string;
  amount: number;
  status: PlayerPaymentStatus;
  paidAt: Date | null;
  // 驳回原因等补充说明。
  note: string | null;
};

export type PaymentGroupView = {
  groupId?: string;
  competitionId: string;
  competitionName: string;
  entrantType: EntrantType;
  groupLabel: string;
  required: boolean;
  instructions: string | null;
  qrImageUrl: string | null;
  totalDue: number;
  totalPaid: number;
  items: PaymentItemView[];
};

const ENTRANT_TYPES: EntrantType[] = [EntrantType.SCHOOL, EntrantType.SOCIAL];

const playerName = { select: { name: true, contact: true, affiliation: true } } as const;

const DOUBLES_TYPES = new Set<EventType>([EventType.MENS_DOUBLES, EventType.WOMENS_DOUBLES, EventType.MIXED_DOUBLES]);

@Injectable()
export class PaymentsService {
  constructor(
    private prisma: PrismaService,
    private competitionsService: CompetitionsService,
    private teamCompetitionsService: TeamCompetitionsService,
  ) {}

  // ==================== 后台 ====================

  async getSettings(competitionId: string): Promise<SettingView[]> {
    await this.ensureCompetition(competitionId);
    const settings = await this.settingMap([competitionId]);
    const groups = await this.prisma.tournamentGroup.findMany({ where: { tournamentId: competitionId }, orderBy: { sortOrder: 'asc' } });
    return groups.map(group => ({ ...this.settingView(settings, competitionId, group.id), groupLabel: group.name }));
  }

  async updateSetting(competitionId: string, entrantType: string, dto: UpdatePaymentSettingDto) {
    await this.ensureCompetition(competitionId);
    const group = await this.resolveGroup(competitionId, entrantType);
    const type = group.fieldTemplate === 'SCHOOL' ? EntrantType.SCHOOL : EntrantType.SOCIAL;
    const data = {
      enabled: dto.enabled,
      singlesFee: dto.singlesFee,
      doublesFee: dto.doublesFee,
      teamFee: dto.teamFee,
      instructions: dto.instructions?.trim() || null,
    };
    return this.prisma.tournamentPaymentSetting.upsert({
      where: { tournamentId_groupId: { tournamentId: competitionId, groupId: group.id } },
      create: { tournamentId: competitionId, groupId: group.id, entrantType: type, ...data },
      update: data,
    });
  }

  async setQrImage(competitionId: string, entrantType: string, qrImageUrl: string | null) {
    await this.ensureCompetition(competitionId);
    const group = await this.resolveGroup(competitionId, entrantType);
    const type = group.fieldTemplate === 'SCHOOL' ? EntrantType.SCHOOL : EntrantType.SOCIAL;
    return this.prisma.tournamentPaymentSetting.upsert({
      where: { tournamentId_groupId: { tournamentId: competitionId, groupId: group.id } },
      create: { tournamentId: competitionId, groupId: group.id, entrantType: type, qrImageUrl },
      update: { qrImageUrl },
    });
  }

  /** 赛事缴费总览：两个组别的设置、全部已通过报名与团体赛队伍、按组别汇总。 */
  async overview(competitionId: string) {
    const groups = await this.prisma.tournamentGroup.findMany({ where: { tournamentId: competitionId }, orderBy: { sortOrder: 'asc' } });
    const competition = await this.ensureCompetition(competitionId);
    const tournament = await this.prisma.tournament.findUniqueOrThrow({
      where: { id: competitionId },
      select: { registrationEditDeadline: true, registrationFieldRules: true },
    });
    const settings = await this.settingMap([competitionId]);
    const [registrations, teams, events, teamCompetitions] = await Promise.all([
      this.prisma.registration.findMany({
        where: { status: RegistrationStatus.APPROVED, event: { tournamentId: competitionId } },
        include: {
          event: { select: { id: true, type: true, groupLabel: true, entrantType: true, groupId: true } },
          player1: playerName,
          player2: playerName,
        },
        orderBy: [{ eventId: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.team.findMany({
        where: { teamCompetition: { tournamentId: competitionId } },
        include: {
          teamCompetition: { select: { id: true, name: true, entrantType: true, groupId: true } },
          members: { include: { player: playerName }, orderBy: { createdAt: 'asc' } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.event.findMany({
        where: { tournamentId: competitionId },
        select: { id: true, type: true, groupLabel: true, entrantType: true, groupId: true },
        orderBy: [{ entrantType: 'asc' }, { type: 'asc' }],
      }),
      this.prisma.teamCompetition.findMany({
        where: { tournamentId: competitionId },
        select: { id: true, name: true, entrantType: true, groupId: true },
      }),
    ]);

    const confirmerIds = [...registrations, ...teams]
      .map((row) => row.paymentConfirmedById)
      .filter((id): id is string => !!id);
    const confirmers = confirmerIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: [...new Set(confirmerIds)] } }, select: { id: true, username: true } })
      : [];
    const confirmerName = new Map(confirmers.map((user) => [user.id, user.username]));

    const rows = [
      ...registrations.map((row) => {
        const setting = settings.get(this.key(competitionId, row.event.groupId ?? row.event.entrantType));
        return {
          kind: 'EVENT' as const,
          id: row.id,
          entrantType: row.event.entrantType,
          groupId: row.event.groupId,
          groupLabel: row.event.groupLabel,
          itemId: row.event.id,
          itemName: eventDisplayLabel(row.event),
          name: registrationDisplayName(row),
          contact: [row.player1?.contact ?? row.phone, row.player2 ? row.player2.contact ?? row.partnerPhone : null]
            .filter(Boolean).join(' / '),
          affiliation: row.player1?.affiliation ?? '',
          amountDue: feeAmount(setting, feeKindForEvent(row.event.type)),
          paymentStatus: row.paymentStatus,
          paidAmount: row.paidAmount,
          paidAt: row.paidAt,
          paymentNote: row.paymentNote,
          confirmedByName: row.paymentConfirmedById ? confirmerName.get(row.paymentConfirmedById) ?? null : null,
        };
      }),
      ...teams.map((team) => {
        const setting = settings.get(this.key(competitionId, team.teamCompetition.groupId ?? team.teamCompetition.entrantType));
        return {
          kind: 'TEAM' as const,
          id: team.id,
          entrantType: team.teamCompetition.entrantType,
          groupId: team.teamCompetition.groupId,
          groupLabel: team.teamCompetition.name,
          itemId: team.teamCompetition.id,
          itemName: `团体赛 · ${team.teamCompetition.name}`,
          name: team.name,
          contact: team.members.map((member) => member.player.contact).find(Boolean) ?? '',
          affiliation: team.affiliation,
          members: team.members.map((member) => member.player.name).join('、'),
          teamNotes: team.notes,
          amountDue: feeAmount(setting, 'TEAM'),
          paymentStatus: team.paymentStatus,
          paidAmount: team.paidAmount,
          paidAt: team.paidAt,
          paymentNote: team.paymentNote,
          confirmedByName: team.paymentConfirmedById ? confirmerName.get(team.paymentConfirmedById) ?? null : null,
        };
      }),
    ];

    const summary = groups.map((group) => {
      const type = group.fieldTemplate === 'SCHOOL' ? EntrantType.SCHOOL : EntrantType.SOCIAL;
      const groupRows = rows.filter((row) => row.groupId === group.id);
      const charged = groupRows.filter((row) => row.amountDue > 0 || row.paymentStatus !== PaymentStatus.UNPAID);
      const unpaid = charged.filter((row) => row.paymentStatus === PaymentStatus.UNPAID);
      const paid = charged.filter((row) => row.paymentStatus === PaymentStatus.PAID);
      return {
        entrantType: type,
        groupId: group.id,
        groupLabel: group.name,
        enabled: !!settings.get(this.key(competitionId, group.id))?.enabled,
        total: charged.length,
        paidCount: paid.length,
        waivedCount: charged.filter((row) => row.paymentStatus === PaymentStatus.WAIVED).length,
        unpaidCount: unpaid.length,
        paidTotal: paid.reduce((sum, row) => sum + (row.paidAmount ?? 0), 0),
        unpaidTotal: unpaid.reduce((sum, row) => sum + row.amountDue, 0),
      };
    });

    return {
      competition: { id: competition.id, name: competition.name },
      // 报名信息修改截止时间；过了这个时间不能再编辑报名信息和组别，删除不受影响。
      editDeadline: tournament.registrationEditDeadline,
      fieldRules: normalizeRegistrationFieldRules(tournament.registrationFieldRules),
      settings: groups.map(group => ({ ...this.settingView(settings, competitionId, group.id), groupLabel: group.name })),
      events: events.map((event) => ({
        id: event.id,
        type: event.type,
        isDouble: DOUBLES_TYPES.has(event.type),
        entrantType: event.entrantType,
        groupId: event.groupId,
        groupLabel: groups.find(g => g.id === event.groupId)?.name ?? event.groupLabel,
        groupFields: groupFields(groups.find(g => g.id === event.groupId)?.fieldRules),
        label: eventDisplayLabel(event),
      })),
      teamCompetitions,
      summary,
      rows,
    };
  }

  async updateStatus(competitionId: string, dto: UpdatePaymentStatusDto, actor: Actor) {
    await this.ensureCompetition(competitionId);
    const status = dto.status as PaymentStatus;
    const note = dto.note?.trim() || null;
    const registrationIds = new Set<string>();
    const teamIds = new Set<string>();
    for (const entry of dto.entries) {
      if (entry.registrationId) registrationIds.add(entry.registrationId);
      else if (entry.teamId) teamIds.add(entry.teamId);
      else throw new BadRequestException('缺少要修改的报名或队伍');
    }

    const settings = await this.settingMap([competitionId]);
    const [registrations, teams] = await Promise.all([
      registrationIds.size
        ? this.prisma.registration.findMany({
          where: { id: { in: [...registrationIds] }, status: RegistrationStatus.APPROVED, event: { tournamentId: competitionId } },
          include: { event: true, player1: playerName, player2: playerName },
        })
        : [],
      teamIds.size
        ? this.prisma.team.findMany({
          where: { id: { in: [...teamIds] }, teamCompetition: { tournamentId: competitionId } },
          include: { teamCompetition: true },
        })
        : [],
    ]);
    if (registrations.length !== registrationIds.size || teams.length !== teamIds.size) {
      throw new NotFoundException('部分报名或队伍不存在、未通过审核或不属于该赛事，请刷新后重试');
    }

    const operatorName = actor.username ?? null;
    let updated = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const row of registrations) {
        if (row.paymentStatus === status) continue;
        const amount = this.recordedAmount(status, settings.get(this.key(competitionId, row.event.groupId ?? row.event.entrantType)), feeKindForEvent(row.event.type));
        await tx.registration.update({ where: { id: row.id }, data: this.statusData(status, amount, actor.id, note) });
        await tx.paymentLog.create({
          data: {
            tournamentId: competitionId,
            entrantType: row.event.entrantType,
            registrationId: row.id,
            targetName: registrationDisplayName(row).slice(0, 191),
            itemName: eventDisplayLabel(row.event).slice(0, 120),
            fromStatus: row.paymentStatus,
            toStatus: status,
            amount,
            note,
            operatorId: actor.id,
            operatorName,
          },
        });
        updated += 1;
      }
      for (const team of teams) {
        if (team.paymentStatus === status) continue;
        const amount = this.recordedAmount(status, settings.get(this.key(competitionId, team.teamCompetition.groupId ?? team.teamCompetition.entrantType)), 'TEAM');
        await tx.team.update({ where: { id: team.id }, data: this.statusData(status, amount, actor.id, note) });
        await tx.paymentLog.create({
          data: {
            tournamentId: competitionId,
            entrantType: team.teamCompetition.entrantType,
            teamId: team.id,
            targetName: team.name.slice(0, 191),
            itemName: `团体赛 · ${team.teamCompetition.name}`.slice(0, 120),
            fromStatus: team.paymentStatus,
            toStatus: status,
            amount,
            note,
            operatorId: actor.id,
            operatorName,
          },
        });
        updated += 1;
      }
    }, { timeout: 30000, maxWait: 10000 });
    return { updated };
  }

  /**
   * 删除缴费行：单项删除这一条报名，团体赛删除这支队伍（真删除）。两类放在同一个事务里，
   * 有一条不能删（签表已冻结、已发布或已开赛）就整批不删。联动规则见
   * CompetitionsService.deleteAdminRegistrations 与 TeamCompetitionsService.removeTeamsInTx。
   */
  async deleteEntries(competitionId: string, dto: DeletePaymentEntriesDto, actor: ChangeActor | undefined) {
    requireAdminActor(actor, '删除报名');
    await this.ensureCompetition(competitionId);
    const registrationIds: string[] = [];
    const teamIds: string[] = [];
    for (const entry of dto.entries) {
      if (entry.registrationId) registrationIds.push(entry.registrationId);
      else if (entry.teamId) teamIds.push(entry.teamId);
      else throw new BadRequestException('缺少要删除的报名或队伍');
    }
    return this.prisma.$transaction(async (tx) => {
      const events = await this.competitionsService.deleteEventRegistrationsInTx(tx, competitionId, registrationIds, actor, dto.note);
      const teams = await this.teamCompetitionsService.removeTeamsInTx(tx, competitionId, teamIds, actor, dto.note);
      return {
        deleted: events.deleted + teams.deleted,
        redrawEvents: events.redrawEvents,
        redrawTeamCompetitions: teams.redrawTeamCompetitions,
      };
    }, { timeout: 60_000, maxWait: 10_000 });
  }

  /** 编辑表单读取单条报名（与参赛选手页同一份数据，不含缴费信息）。 */
  getRegistration(competitionId: string, registrationId: string) {
    return this.competitionsService.getAdminPlayer(competitionId, registrationId);
  }

  /** 修改单项报名信息或组别，规则与参赛选手页一致。 */
  updateRegistration(
    competitionId: string,
    registrationId: string,
    dto: AdminCompetitionPlayerDto,
    actor: ChangeActor | undefined,
  ) {
    requireAdminActor(actor, '修改报名信息');
    return this.competitionsService.updateAdminPlayer(competitionId, registrationId, dto, actor);
  }

  /** 缴费管理里只改队名、单位、备注；队员名单在团体赛管理里调整，不能改组别。 */
  async updateTeam(competitionId: string, teamId: string, dto: UpdatePaymentTeamDto, actor: ChangeActor | undefined) {
    requireAdminActor(actor, '修改队伍信息');
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      include: { teamCompetition: { include: { tournament: { select: { registrationEditDeadline: true } } } } },
    });
    if (!team || team.teamCompetition.tournamentId !== competitionId) throw new NotFoundException('队伍不存在');
    ensureRegistrationEditable(team.teamCompetition.tournament);
    try {
      return await this.prisma.team.update({
        where: { id: teamId },
        data: {
          name: dto.name.trim(),
          affiliation: dto.affiliation.trim(),
          notes: dto.notes?.trim() || null,
        },
        select: { id: true, name: true, affiliation: true, notes: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('该团体赛已有同名队伍');
      }
      throw error;
    }
  }

  /** 设置报名信息修改截止时间；为空表示不限制。 */
  async setEditDeadline(competitionId: string, dto: UpdateEditDeadlineDto, actor: ChangeActor | undefined) {
    requireAdminActor(actor, '设置修改截止时间');
    await this.ensureCompetition(competitionId);
    const deadline = dto.deadline ? new Date(dto.deadline) : null;
    if (deadline && Number.isNaN(deadline.getTime())) throw new BadRequestException('截止时间格式不正确');
    const updated = await this.prisma.tournament.update({
      where: { id: competitionId },
      data: { registrationEditDeadline: deadline },
      select: { registrationEditDeadline: true },
    });
    return { editDeadline: updated.registrationEditDeadline };
  }

  async logs(competitionId: string) {
    await this.ensureCompetition(competitionId);
    return this.prisma.paymentLog.findMany({
      where: { tournamentId: competitionId },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
  }

  // ==================== 选手端 ====================

  /** 登录用户自己的报名缴费情况，按赛事 + 组别分组。 */
  async myPayments(userId: string) {
    const registrations = await this.prisma.competitionRegistration.findMany({
      where: { userId, status: { in: [RegistrationStatus.PENDING, RegistrationStatus.APPROVED] } },
      include: this.competitionRegistrationInclude(),
      orderBy: { createdAt: 'desc' },
    });
    return this.groupsForCompetitionRegistrations(registrations);
  }

  /** 游客凭报名编号查看本次报名的缴费情况。 */
  async guestPayment(competitionId: string, token: string) {
    const registration = await this.prisma.competitionRegistration.findFirst({
      where: { competitionId, guestToken: token },
      include: this.competitionRegistrationInclude(),
    });
    if (!registration) throw new NotFoundException('报名记录不存在');
    const [group] = await this.groupsForCompetitionRegistrations([registration]);
    return group ?? null;
  }

  /**
   * 公开查询：姓名 + 联系方式，不需要选赛事。
   * 只查已发布赛事；姓名精确匹配，联系方式去掉空格横线后精确匹配，覆盖线上报名、后台导入和团体赛队员。
   */
  async lookup(name: string, contact: string) {
    const trimmedName = name.trim();
    const target = normalizeContact(contact);
    if (!trimmedName || target.length < 5) throw new BadRequestException('请输入姓名和完整的联系方式');

    const candidates = await this.prisma.player.findMany({
      where: { name: trimmedName },
      select: { id: true, contact: true },
      take: 1000,
    });
    const playerIds = candidates.filter((player) => normalizeContact(player.contact) === target).map((player) => player.id);
    const published = { isPublished: true };

    const [registrations, teams, pending] = await Promise.all([
      playerIds.length
        ? this.prisma.registration.findMany({
          where: {
            status: RegistrationStatus.APPROVED,
            OR: [{ player1Id: { in: playerIds } }, { player2Id: { in: playerIds } }],
            event: { tournament: published },
          },
          include: {
            event: { include: { tournament: { select: { id: true, name: true } } } },
            player1: playerName,
            player2: playerName,
          },
          orderBy: { createdAt: 'desc' },
        })
        : [],
      playerIds.length
        ? this.prisma.team.findMany({
          where: {
            members: { some: { playerId: { in: playerIds } } },
            teamCompetition: { tournament: published },
          },
          include: { teamCompetition: { include: { tournament: { select: { id: true, name: true } } } } },
          orderBy: { createdAt: 'desc' },
        })
        : [],
      this.prisma.competitionRegistration.findMany({
        // 待审核和被驳回的报名还没有参赛记录，按报名表展示，便于选手看到驳回原因。
        where: {
          name: trimmedName,
          status: { in: [RegistrationStatus.PENDING, RegistrationStatus.REJECTED] },
          competition: published,
        },
        include: { competition: { select: { id: true, name: true } }, eventItems: { include: { event: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);
    // 被驳回后已重新报名（待审核或已通过）的赛事，不再显示旧的驳回记录。
    const activeCompetitions = new Set([
      ...registrations.map((row) => row.event.tournament.id),
      ...pending.filter((row) => row.status === RegistrationStatus.PENDING && normalizeContact(row.contact) === target)
        .map((row) => row.competitionId),
    ]);
    const pendingMatches = pending.filter((row) => normalizeContact(row.contact) === target
      && (row.status !== RegistrationStatus.REJECTED || !activeCompetitions.has(row.competitionId)));

    const competitionIds = [
      ...registrations.map((row) => row.event.tournament.id),
      ...teams.map((team) => team.teamCompetition.tournament.id),
      ...pendingMatches.map((row) => row.competitionId),
    ];
    const settings = await this.settingMap([...new Set(competitionIds)]);
    const builder = new GroupBuilder(settings);

    for (const row of pendingMatches) {
      for (const item of row.eventItems) {
        builder.add(row.competition, item.event.entrantType, {
          groupId: item.event.groupId,
          groupLabel: item.event.groupLabel,
          id: item.id,
          kind: 'EVENT',
          itemName: eventDisplayLabel(item.event),
          name: item.partnerName ? `${row.name} / ${item.partnerName}` : row.name,
          feeKind: feeKindForEvent(item.event.type),
          pending: true,
          rejected: row.status === RegistrationStatus.REJECTED,
          note: row.status === RegistrationStatus.REJECTED ? row.rejectReason || '报名未通过审核' : null,
        });
      }
    }
    for (const row of registrations) {
      builder.add(row.event.tournament, row.event.entrantType, {
          groupId: row.event.groupId,
          groupLabel: row.event.groupLabel,
        id: row.id,
        kind: 'EVENT',
        itemName: eventDisplayLabel(row.event),
        name: registrationDisplayName(row),
        feeKind: feeKindForEvent(row.event.type),
        paymentStatus: row.paymentStatus,
        paidAmount: row.paidAmount,
        paidAt: row.paidAt,
      });
    }
    for (const team of teams) {
      builder.add(team.teamCompetition.tournament, team.teamCompetition.entrantType, {
          groupId: team.teamCompetition.groupId,
          groupLabel: team.teamCompetition.name,
        id: team.id,
        kind: 'TEAM',
        itemName: `团体赛 · ${team.teamCompetition.name}`,
        name: team.name,
        feeKind: 'TEAM',
        paymentStatus: team.paymentStatus,
        paidAmount: team.paidAmount,
        paidAt: team.paidAt,
      });
    }

    return { name: trimmedName, contact: contact.trim(), groups: builder.build() };
  }

  // ==================== 内部 ====================

  private competitionRegistrationInclude() {
    return {
      competition: { select: { id: true, name: true } },
      eventItems: { include: { event: true } },
      registrations: {
        where: { status: RegistrationStatus.APPROVED },
        include: { event: true, player1: playerName, player2: playerName },
        orderBy: { createdAt: 'asc' as const },
      },
    } satisfies Prisma.CompetitionRegistrationInclude;
  }

  private async groupsForCompetitionRegistrations(
    registrations: Prisma.CompetitionRegistrationGetPayload<{
      include: ReturnType<PaymentsService['competitionRegistrationInclude']>;
    }>[],
  ) {
    const settings = await this.settingMap([...new Set(registrations.map((row) => row.competitionId))]);
    const builder = new GroupBuilder(settings);
    for (const row of registrations) {
      // 审核通过前没有参赛记录，按报名项目展示应缴金额，状态为「待审核」。
      if (row.status !== RegistrationStatus.APPROVED) {
        for (const item of row.eventItems) {
          builder.add(row.competition, item.event.entrantType, {
          groupId: item.event.groupId,
          groupLabel: item.event.groupLabel,
            id: item.id,
            kind: 'EVENT',
            itemName: eventDisplayLabel(item.event),
            name: item.partnerName ? `${row.name} / ${item.partnerName}` : row.name,
            feeKind: feeKindForEvent(item.event.type),
            pending: true,
          });
        }
        continue;
      }
      for (const entry of row.registrations) {
        builder.add(row.competition, entry.event.entrantType, {
          groupId: entry.event.groupId,
          groupLabel: entry.event.groupLabel,
          id: entry.id,
          kind: 'EVENT',
          itemName: eventDisplayLabel(entry.event),
          name: registrationDisplayName(entry),
          feeKind: feeKindForEvent(entry.event.type),
          paymentStatus: entry.paymentStatus,
          paidAmount: entry.paidAmount,
          paidAt: entry.paidAt,
        });
      }
    }
    return builder.build();
  }

  private recordedAmount(status: PaymentStatus, setting: FeeSetting | undefined, kind: FeeKind) {
    if (status === PaymentStatus.PAID) return feeAmount(setting, kind);
    return status === PaymentStatus.WAIVED ? 0 : null;
  }

  private statusData(status: PaymentStatus, amount: number | null, operatorId: string, note: string | null) {
    if (status === PaymentStatus.UNPAID) {
      return { paymentStatus: status, paidAmount: null, paidAt: null, paymentConfirmedById: null, paymentNote: note };
    }
    return { paymentStatus: status, paidAmount: amount, paidAt: new Date(), paymentConfirmedById: operatorId, paymentNote: note };
  }

  private async settingMap(competitionIds: string[]) {
    if (!competitionIds.length) return new Map<string, TournamentPaymentSetting>();
    const rows = await this.prisma.tournamentPaymentSetting.findMany({ where: { tournamentId: { in: competitionIds } } });
    return new Map(rows.map((row) => [this.key(row.tournamentId, row.groupId ?? row.entrantType), row]));
  }

  private settingView(settings: Map<string, TournamentPaymentSetting>, competitionId: string, type: string): SettingView {
    const row = settings.get(this.key(competitionId, type));
    return {
      tournamentId: competitionId,
      groupId: row?.groupId ?? (type === 'SCHOOL' || type === 'SOCIAL' ? legacyGroupId(competitionId, type) : type),
      entrantType: row?.entrantType ?? (type === 'SCHOOL' ? EntrantType.SCHOOL : EntrantType.SOCIAL),
      enabled: row?.enabled ?? false,
      singlesFee: row?.singlesFee ?? 0,
      doublesFee: row?.doublesFee ?? 0,
      teamFee: row?.teamFee ?? 0,
      instructions: row?.instructions ?? null,
      qrImageUrl: row?.qrImageUrl ?? null,
    };
  }

  private key(competitionId: string, type: string) {
    return `${competitionId}:${type === 'SCHOOL' || type === 'SOCIAL' ? legacyGroupId(competitionId, type) : type}`;
  }

  private async resolveGroup(tournamentId: string, value: string) {
    const id = value === 'SCHOOL' || value === 'SOCIAL' ? legacyGroupId(tournamentId, value) : value;
    const group = await this.prisma.tournamentGroup.findFirst({ where: { id, tournamentId } });
    if (!group) throw new NotFoundException('组别不存在');
    return group;
  }

  private entrantType(value: string): EntrantType {
    if (value === EntrantType.SCHOOL || value === EntrantType.SOCIAL) return value;
    throw new BadRequestException('组别只能是学生组或第三方');
  }

  private async ensureCompetition(competitionId: string) {
    const competition = await this.prisma.tournament.findUnique({
      where: { id: competitionId },
      select: { id: true, name: true },
    });
    if (!competition) throw new NotFoundException('赛事不存在');
    return competition;
  }
}

type BuilderItem = {
  groupId?: string | null;
  groupLabel?: string | null;
  id: string;
  kind: 'EVENT' | 'TEAM';
  itemName: string;
  name: string;
  feeKind: FeeKind;
  pending?: boolean;
  rejected?: boolean;
  note?: string | null;
  paymentStatus?: PaymentStatus;
  paidAmount?: number | null;
  paidAt?: Date | null;
};

/** 把参赛项按「赛事 + 组别」归组，并计算每项金额和选手端状态。 */
export class GroupBuilder {
  private groups = new Map<string, PaymentGroupView>();

  constructor(private settings: Map<string, TournamentPaymentSetting>) {}

  add(competition: { id: string; name: string }, entrantType: EntrantType, item: BuilderItem) {
    const key = `${competition.id}:${item.groupId ?? legacyGroupId(competition.id, entrantType)}`;
    const setting = this.settings.get(key) ?? (!item.groupId ? this.settings.get(`${competition.id}:${entrantType}`) : undefined);
    let group = this.groups.get(key);
    if (!group) {
      group = {
        competitionId: competition.id,
        competitionName: competition.name,
        entrantType,
        groupId: item.groupId ?? legacyGroupId(competition.id, entrantType),
        groupLabel: item.groupLabel ?? entrantTypeLabel(entrantType),
        required: false,
        instructions: null,
        qrImageUrl: null,
        totalDue: 0,
        totalPaid: 0,
        items: [],
      };
      this.groups.set(key, group);
    }
    const fee = feeAmount(setting, item.feeKind);
    const status = paymentItemStatus(fee, item);
    const amount = status === PaymentStatus.PAID ? item.paidAmount ?? fee : status === PaymentStatus.WAIVED || status === 'REJECTED' ? 0 : fee;
    if (status === PaymentStatus.UNPAID) group.totalDue += amount;
    if (status === PaymentStatus.PAID) group.totalPaid += amount;
    if ((fee > 0 && status !== 'REJECTED') || status === PaymentStatus.PAID) group.required = true;
    // 审核通过后才缴费：待审核或被驳回的项目不展示收款方式。
    if (group.required && status !== 'PENDING_REVIEW' && status !== 'REJECTED') {
      group.instructions = setting?.instructions ?? null;
      group.qrImageUrl = setting?.qrImageUrl ?? null;
    }
    group.items.push({
      id: item.id,
      kind: item.kind,
      itemName: item.itemName,
      name: item.name,
      amount,
      status,
      paidAt: item.paidAt ?? null,
      note: item.note ?? null,
    });
  }

  build() {
    return [...this.groups.values()];
  }
}

export function paymentItemStatus(
  fee: number,
  item: { pending?: boolean; rejected?: boolean; paymentStatus?: PaymentStatus },
): PlayerPaymentStatus {
  if (item.rejected) return 'REJECTED';
  if (item.pending) return fee > 0 ? 'PENDING_REVIEW' : 'NOT_REQUIRED';
  const status = item.paymentStatus ?? PaymentStatus.UNPAID;
  if (status === PaymentStatus.UNPAID && fee <= 0) return 'NOT_REQUIRED';
  return status;
}

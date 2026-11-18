import { legacyGroupId } from '../registration-groups/registration-groups.service';
import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { EntrantType, Format, Prisma, RegistrationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthActor, tournamentScope } from '../auth/admin-scope';
import { eventDisplayLabel } from '../common/entrant';
import { hostDisplayLabel, mixCategory } from '../common/event-mix';
import { eventEntryCounts } from '../common/registration-capacity';
import { ChangeActor, deleteOrphanPlayers, lockEvents } from '../common/registration-changes';
import { registrationDisplayName } from '../payments/payment-rules';
import { collectEventDeleteImpact } from './event-delete';
import { GROUP_COUNT_MAX } from '../draws/draw-algorithm.service';
import {
  CreateEventDto,
  STAGE_SCORING_KEYS,
  StageScoringRulesDto,
  UpdateEventDto,
} from './dto/event.dto';

// 单项排序：男单、女单、男双、女双、混双。
const EVENT_TYPE_ORDER: string[] = ['MENS_SINGLES', 'WOMENS_SINGLES', 'MENS_DOUBLES', 'WOMENS_DOUBLES', 'MIXED_DOUBLES'];

@Injectable()
export class EventsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateEventDto) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: dto.tournamentId },
    });
    if (!tournament) throw new NotFoundException('赛事不存在');

    const groupId = dto.groupId ?? legacyGroupId(dto.tournamentId, dto.entrantType ?? EntrantType.SCHOOL);
    const group = await this.prisma.tournamentGroup.findFirst({ where: { id: groupId, tournamentId: dto.tournamentId } });
    if (!group) throw new BadRequestException('赛事组别不存在，请先配置组别');
    const entrantType = group.fieldTemplate === 'SCHOOL' ? EntrantType.SCHOOL : EntrantType.SOCIAL;
    const existing = await this.prisma.event.findFirst({
      where: { tournamentId: dto.tournamentId, type: dto.type, groupId },
    });
    if (existing) throw new ConflictException('该赛事该组别已存在相同类型的单项');

    const { stageScoringRules, ...rest } = dto;
    const groupConfig = this.groupConfigFor(
      dto.format,
      dto.groupSize,
      dto.groupCount,
      dto.qualifiersPerGroup,
    );
    const created = await this.prisma.event.create({
      data: {
        ...rest,
        ...groupConfig,
        entrantType, groupId,
        groupLabel: group.name,
        stageScoringRules: this.normalizeStageScoringRules(stageScoringRules),
      },
      include: { tournament: true },
    });
    return created;
  }

  async findByTournament(tournamentId: string, actor?: AuthActor) {
    const events = await this.prisma.event.findMany({
      where: { tournamentId, tournament: tournamentScope(actor) },
      include: { tournament: true, group: { select: { id: true, name: true, sortOrder: true, createdAt: true } } },
      orderBy: [{ entrantType: 'asc' }, { type: 'asc' }],
    });
    // 按组别排（顺序同组别设置），组内按男单、女单、男双、女双、混双；没有组别的旧单项排最后。
    const sorted = [...events].sort((a, b) =>
      (a.group?.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.group?.sortOrder ?? Number.MAX_SAFE_INTEGER)
      || (a.group?.createdAt.getTime() ?? 0) - (b.group?.createdAt.getTime() ?? 0)
      || (a.groupId ?? '').localeCompare(b.groupId ?? '')
      || EVENT_TYPE_ORDER.indexOf(a.type) - EVENT_TYPE_ORDER.indexOf(b.type));
    // 单项管理的「名额」列：已占名额（已通过 + 待审核），口径与扫码报名的名额检查一致。
    const counts = await eventEntryCounts(this.prisma, sorted.map((event) => event.id));
    // 混编：主项目带 mixLabel（混编名）和 mixMemberIds；并入项目带 mixHostLabel（所在混编的名称）。
    const membersOf = (hostId: string) => sorted.filter((item) => item.mixHostId === hostId);
    const labelOfHost = (hostId: string) => {
      const host = sorted.find((item) => item.id === hostId);
      return host ? hostDisplayLabel({ ...host, mixMembers: membersOf(hostId) }) : null;
    };
    return sorted.map((event) => {
      const members = membersOf(event.id);
      return {
        ...event,
        entryCount: counts.get(event.id) ?? 0,
        mixCategory: mixCategory(event.type),
        mixMemberIds: members.map((member) => member.id),
        mixLabel: members.length ? labelOfHost(event.id) : null,
        mixHostLabel: event.mixHostId ? labelOfHost(event.mixHostId) : null,
      };
    });
  }

  /**
   * 设置混编：hostId 是主项目，memberEventIds 是并入它的单项（空数组 = 取消混编）。
   * - 只能编同一赛事、同一类（单打类 / 双打类）的单项；
   * - 一个单项只能属于一个混编：并入项目不能再并入别处，也不能是别的混编的主项目；
   * - 主项目、新加入和被移出的并入项目都必须还没抽签、没有场次（抽签前才能改）。
   * 抽签、种子、赛程、记分、名次在主项目里统一进行；报名、资格、名额、缴费仍按原单项。
   */
  async setMix(hostId: string, memberEventIds: string[]) {
    const memberIds = [...new Set(memberEventIds)];
    if (memberIds.includes(hostId)) throw new BadRequestException('主项目不能同时作为并入项目');
    const select = {
      id: true,
      tournamentId: true,
      type: true,
      groupLabel: true,
      mixHostId: true,
      mixMembers: { select: { id: true } },
    } as const;
    await this.prisma.$transaction(async (tx) => {
      const host = await tx.event.findUnique({ where: { id: hostId }, select });
      if (!host) throw new NotFoundException('单项不存在');
      if (host.mixHostId) throw new ConflictException(`${eventDisplayLabel(host)}已并入其他混编，不能再做主项目`);
      const targets = memberIds.length
        ? await tx.event.findMany({ where: { id: { in: memberIds } }, select })
        : [];
      if (targets.length !== memberIds.length) throw new BadRequestException('要并入的单项不存在，请刷新后重试');
      for (const target of targets) {
        const label = eventDisplayLabel(target);
        if (target.tournamentId !== host.tournamentId) throw new BadRequestException('只能混编同一赛事的单项');
        if (mixCategory(target.type) !== mixCategory(host.type)) {
          throw new BadRequestException('单打只能和单打混编，双打只能和双打混编');
        }
        if (target.mixHostId && target.mixHostId !== hostId) throw new ConflictException(`${label}已并入其他混编`);
        if (target.mixMembers.length) throw new ConflictException(`${label}是另一个混编的主项目，请先取消那个混编`);
      }

      const currentIds = host.mixMembers.map((member) => member.id);
      const added = memberIds.filter((id) => !currentIds.includes(id));
      const removed = currentIds.filter((id) => !memberIds.includes(id));
      if (!added.length && !removed.length) return;

      // 先锁住涉及的单项，和抽签、报名变动的加锁顺序一致；再确认它们都还没抽签。
      const touched = [hostId, ...added, ...removed];
      await lockEvents(tx, touched);
      const drawn = await tx.event.findMany({
        where: {
          id: { in: touched },
          OR: [
            { drawGeneratedAt: { not: null } },
            { matches: { some: {} } },
            { drawBrackets: { some: { isCurrent: true } } },
          ],
        },
        select: { type: true, groupLabel: true },
      });
      if (drawn.length) {
        throw new ConflictException(
          `${drawn.map((event) => eventDisplayLabel(event)).join('、')}已经抽签，请先在抽签编排中清空签表，再设置或取消混编`,
        );
      }

      if (removed.length) {
        await tx.event.updateMany({ where: { id: { in: removed } }, data: { mixHostId: null } });
        await this.detachMixSeeds(tx, hostId, removed);
      }
      if (added.length) {
        await tx.event.updateMany({ where: { id: { in: added } }, data: { mixHostId: hostId } });
      }
    });
    const host = await this.prisma.event.findUniqueOrThrow({ where: { id: hostId }, select: { tournamentId: true } });
    return this.findByTournament(host.tournamentId);
  }

  /**
   * 移出混编时整理种子：
   * - 移出的单项不再在主项目里抽签，主项目上指向它们选手的种子去掉；
   *   剩下的种子按原顺序重新编成 1、2、3……（抽签要求种子号从 1 开始连续）。
   * - 这些选手身上的种子标记是在主项目里设的，一并清掉；移出的单项自己有种子设置的，按它恢复。
   */
  private async detachMixSeeds(tx: Prisma.TransactionClient, hostId: string, removed: string[]) {
    const dropped = await tx.drawSeedSetting.findMany({
      where: { eventItemId: hostId, entrant: { eventId: { in: removed } } },
      select: { id: true, entrantId: true },
    });
    if (dropped.length) {
      await tx.drawSeedSetting.deleteMany({ where: { id: { in: dropped.map((seed) => seed.id) } } });
      await tx.registration.updateMany({
        where: { id: { in: dropped.map((seed) => seed.entrantId) } },
        data: { isSeed: false, seedRank: null },
      });
    }
    const remaining = await tx.drawSeedSetting.findMany({ where: { eventItemId: hostId }, orderBy: { seedNo: 'asc' } });
    // 按升序逐个改小：新号不大于旧号，不会撞上 (eventItemId, seedNo) 唯一约束。
    for (const [index, seed] of remaining.entries()) {
      if (seed.seedNo === index + 1) continue;
      await tx.drawSeedSetting.update({ where: { id: seed.id }, data: { seedNo: index + 1 } });
      await tx.registration.update({ where: { id: seed.entrantId }, data: { isSeed: true, seedRank: index + 1 } });
    }
    const own = await tx.drawSeedSetting.findMany({ where: { eventItemId: { in: removed } } });
    for (const seed of own) {
      await tx.registration.update({ where: { id: seed.entrantId }, data: { isSeed: true, seedRank: seed.seedNo } });
    }
  }

  async findOne(id: string) {
    const event = await this.prisma.event.findUnique({
      where: { id },
      include: { tournament: true },
    });
    if (!event) throw new NotFoundException(`单项 ${id} 不存在`);
    return event;
  }

  async update(id: string, dto: UpdateEventDto) {
    const current = await this.findOne(id);
    const nextType = dto.type ?? current.type;
    if (mixCategory(nextType) !== mixCategory(current.type)) {
      const inMix = current.mixHostId || (await this.prisma.event.count({ where: { mixHostId: id } }));
      if (inMix) throw new ConflictException('该单项在混编中，单打、双打之间不能互改；请先取消混编');
    }
    const nextGroupId = dto.groupId ?? (dto.entrantType && dto.entrantType !== current.entrantType ? legacyGroupId(current.tournamentId, dto.entrantType) : current.groupId ?? legacyGroupId(current.tournamentId, current.entrantType));
    const group = await this.prisma.tournamentGroup.findFirst({ where: { id: nextGroupId, tournamentId: current.tournamentId } });
    if (!group) throw new BadRequestException('赛事组别不存在');
    const nextEntrantType = group.fieldTemplate === 'SCHOOL' ? EntrantType.SCHOOL : EntrantType.SOCIAL;
    if (nextType !== current.type || nextGroupId !== current.groupId) {
      const duplicate = await this.prisma.event.findFirst({
        where: {
          tournamentId: current.tournamentId,
          type: nextType,
          groupId: nextGroupId,
          id: { not: id },
        },
      });
      if (duplicate) throw new ConflictException('该赛事该组别已存在相同类型的单项');
    }
    if (nextGroupId !== current.groupId) {
      const linked = await this.prisma.event.findUnique({
        where: { id },
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
      const linkedCount = linked
        ? linked._count.registrations +
          linked._count.competitionRegistrationItems +
          linked._count.matches +
          linked._count.drawBrackets
        : 0;
      if (linkedCount > 0) {
        throw new ConflictException('该单项已有报名、抽签或比赛数据，不能修改组别');
      }
    }

    const { stageScoringRules, ...rest } = dto;
    const nextFormat = dto.format ?? current.format;
    // 分组配置三个字段任一被提交就整体重算：手动组数与每组人数互斥，切换赛制时清空旧配置。
    const groupConfig =
      dto.format !== undefined ||
      dto.groupSize !== undefined ||
      dto.groupCount !== undefined ||
      dto.qualifiersPerGroup !== undefined
        ? this.groupConfigFor(
            nextFormat,
            dto.groupSize !== undefined ? dto.groupSize : current.groupSize,
            dto.groupCount !== undefined ? dto.groupCount : current.groupCount,
            dto.qualifiersPerGroup !== undefined ? dto.qualifiersPerGroup : current.qualifiersPerGroup,
          )
        : null;
    const updated = await this.prisma.event.update({
      where: { id },
      data: {
        ...rest,
        ...(groupConfig ?? {}),
        entrantType: nextEntrantType,
        groupId: nextGroupId,
        groupLabel: group.name,
        ...(stageScoringRules === undefined
          ? {}
          : { stageScoringRules: this.normalizeStageScoringRules(stageScoringRules) }),
      },
      include: { tournament: true },
    });
    return updated;
  }

  /**
   * 分组的两个字段互斥：手动「小组数量」优先，否则用「每组人数」（留空按默认 4 人）。
   * 只有「小组循环+淘汰」两种赛制使用分组配置，其他赛制一律清空，避免切赛制后残留旧配置。
   */
  private groupConfigFor(
    format: Format,
    groupSize?: number | null,
    groupCount?: number | null,
    qualifiersPerGroup?: number | null,
  ): { groupSize: number | null; groupCount: number | null } {
    const usesGroups =
      format === Format.GROUP_PLUS_KNOCKOUT || format === Format.GROUP_PLUS_KNOCKOUT_STD;
    if (!usesGroups) return { groupSize: null, groupCount: null };
    if (groupCount != null) {
      if (groupCount < 1 || groupCount > GROUP_COUNT_MAX) {
        throw new BadRequestException(`小组数量需在 1–${GROUP_COUNT_MAX} 之间`);
      }
      return { groupSize: null, groupCount };
    }
    if (groupSize != null) {
      if (groupSize < 2 || groupSize > 8) {
        throw new BadRequestException('每组人数需在 2–8 之间');
      }
      if (qualifiersPerGroup != null && qualifiersPerGroup > groupSize) {
        throw new BadRequestException('每组出线数不能大于每组人数');
      }
      return { groupSize, groupCount: null };
    }
    return { groupSize: null, groupCount: null };
  }

  /** 删除单项前的影响预览，单项管理的删除确认框用。 */
  async deletePreview(id: string) {
    const event = await this.prisma.event.findUnique({
      where: { id },
      select: {
        id: true,
        type: true,
        groupLabel: true,
        drawLocked: true,
        drawPublished: true,
        drawGeneratedAt: true,
        _count: { select: { drawBrackets: true } },
      },
    });
    if (!event) throw new NotFoundException(`单项 ${id} 不存在`);
    const impact = await collectEventDeleteImpact(this.prisma, id);
    return {
      id: event.id,
      label: eventDisplayLabel(event),
      drawGenerated: Boolean(event.drawGeneratedAt) || event._count.drawBrackets > 0,
      drawPublished: event.drawPublished || event.drawLocked,
      ...impact.summary,
    };
  }

  /**
   * 删除单项，连同这个项目的报名一起删除，不能恢复。规则与参赛选手页、缴费管理的「删除报名」一致：
   * - 每条已通过的报名在缴费操作记录里记一条「删除」，写明删除时的缴费状态和金额，便于退款对账；
   * - 只报了这一项的人整份报名表删除（含待审核、已驳回），报名编号失效，可以重新报名；
   *   兼项的人只去掉这一项，其他项目、报名表和缴费都不动；
   * - 只为这些报名生成、没有别的报名或团体赛在用的选手档案一并删除，选手库里的正式选手保留；
   * - 签表、种子、分组、比赛（含比分）、场地设置随单项一起删除。签表已发布或已开赛也可以删，确认框里会提示。
   * 组名随所属组别保存（groupLabel = 组别名），删除单项不需要再同步其它单项的组名。
   */
  async remove(id: string, actor?: ChangeActor, note?: string) {
    const found = await this.findOne(id);
    const reason = note?.trim() ?? '';
    return this.prisma.$transaction(
      async (tx) => {
        // 先锁赛事再锁单项：和扫码报名提交同一把赛事锁，删除过程中不会有人报进这个项目。
        await tx.$queryRaw`SELECT id FROM Tournament WHERE id = ${found.tournamentId} FOR UPDATE`;
        await lockEvents(tx, [id]);
        const event = await tx.event.findUnique({ where: { id } });
        if (!event) throw new NotFoundException('单项不存在或已删除');
        const label = eventDisplayLabel(event);
        if (event.mixHostId) {
          // 并入混编的单项：主项目的签表和场次里有它的选手，主项目抽签后不能直接删。
          const hostDrawn = await tx.event.count({
            where: { id: event.mixHostId, OR: [{ drawGeneratedAt: { not: null } }, { matches: { some: {} } }] },
          });
          if (hostDrawn) throw new ConflictException(`${label}已并入混编且主项目已抽签，请先清空主项目签表并取消混编，再删除`);
        }
        const impact = await collectEventDeleteImpact(tx, id);

        const approved = await tx.registration.findMany({
          where: { eventId: id, status: RegistrationStatus.APPROVED },
          include: { player1: { select: { name: true } }, player2: { select: { name: true } } },
        });
        const logNote = (reason ? `删除单项：${reason}` : '删除单项').slice(0, 255);
        for (const row of approved) {
          await tx.paymentLog.create({
            data: {
              tournamentId: event.tournamentId,
              entrantType: event.entrantType,
              action: 'DELETE',
              registrationId: row.id,
              targetName: registrationDisplayName(row).slice(0, 191),
              itemName: label.slice(0, 120),
              fromStatus: row.paymentStatus,
              toStatus: row.paymentStatus,
              amount: row.paidAmount,
              note: logNote,
              operatorId: actor?.id ?? null,
              operatorName: actor?.username ?? null,
            },
          });
        }

        await tx.registration.deleteMany({ where: { eventId: id } });
        await tx.competitionRegistrationEventItem.deleteMany({ where: { eventId: id } });
        if (impact.removedApplicationIds.length) {
          await tx.competitionRegistration.deleteMany({ where: { id: { in: impact.removedApplicationIds } } });
        }
        const players =
          (await deleteOrphanPlayers(tx, impact.ownedPlayerIds, { registrationOwned: true })) +
          (await deleteOrphanPlayers(tx, impact.adminPlayerIds, { registrationOwned: false }));
        await tx.event.delete({ where: { id } });
        return { id, label, ...impact.summary, players };
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
  }

  /**
   * 清洗分阶段规则：
   * - 丢弃没有任何有效内容的阶段（既无预设规则也无自定义分数）
   * - 自定义分数时校验封顶分不小于每局分数
   * - 可见阶段使用 QF/TOP4/SF/BRONZE/F；BEFORE_TOP4 旧两段键继续兼容
   * - 全部为空时存 JSON null（与"未配置"等价）
   */
  private normalizeStageScoringRules(
    value: StageScoringRulesDto | null | undefined,
  ): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    if (!value) return Prisma.JsonNull;

    const result: Record<string, Record<string, string | number | null>> = {};
    for (const key of STAGE_SCORING_KEYS) {
      const stage = value[key];
      if (!stage) continue;
      if (!stage.scoringRule && !stage.customGamePoint) continue;

      if (stage.customGamePoint) {
        if (stage.customGameCap && stage.customGameCap < stage.customGamePoint) {
          throw new BadRequestException(`阶段 ${key} 的封顶分不能小于每局分数`);
        }
        result[key] = {
          customGamePoint: stage.customGamePoint,
          customGameCap: stage.customGameCap ?? null,
          customGamesToWin: stage.customGamesToWin ?? 1,
        };
      } else if (stage.scoringRule) {
        result[key] = { scoringRule: stage.scoringRule };
      }
    }

    return Object.keys(result).length ? result : Prisma.JsonNull;
  }
}

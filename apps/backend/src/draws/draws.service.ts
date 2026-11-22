import { AuthActor, tournamentScope } from '../auth/admin-scope';
import { groupFields, normalizeAgeRule } from '../common/age-eligibility';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DrawFormat,
  DrawOperationType,
  DrawRedrawRequestStatus,
  DrawSlotSourceType,
  DrawStatus,
  Format,
  MatchStatus,
  Prisma,
  Registration,
  RegistrationStatus,
  Role,
  SecondStageMode,
  SecondStageRankingMode,
  SecondStageStatus,
  EventType,
  GroupNaming,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { groupCodeFor, groupCodeSortValue } from '../common/group-code';
import { unpaidEventEntrants, unpaidMessage } from '../payments/payment-rules';
import { assertNotMixMember, hostDisplayLabel, mixEventIds } from '../common/event-mix';
import { DrawAlgorithmService, GroupPlan } from './draw-algorithm.service';
import { DrawLogService } from './draw-log.service';
import {
  CreateRegistrationDto,
  ConfirmSecondStageDto,
  GenerateDrawDto,
  GetDrawLogsQueryDto,
  SeedItemDto,
  SwapDrawSlotsDto,
  UpdateDrawGroupSettingsDto,
  UpdateRegistrationDto,
} from './dto/draw.dto';
import { resolveGroupConfig, usesGroupConfig } from '../events/group-config';
import {
  drawnGroupSettingsSnapshot,
  groupPlanDrift,
  readDrawnGroupSettings,
} from './group-plan-drift';
import {
  SECOND_STAGE_FORMAL_ROUND_NO_BASE,
  SECOND_STAGE_MAX_RANK,
  includesSecondStageMatch,
  isSecondStageFormalRoundNo,
  secondStageFormalRoundNo,
  secondStageRankingLimit,
} from '../common/second-stage-bracket';
import { SecondStageProgressService } from '../common/second-stage-progress.service';
import { knockoutPlacementPlayoffView } from '../common/knockout-placement';
import { isKnockoutPlacementPlayoff } from '../common/knockout-placement-playoff';
import {
  buildKnockoutSkeleton,
  groupSizesFromGroupMatches,
  knockoutPlaceholdersOnly,
} from '../common/knockout-skeleton';
import {
  buildEliminationDrafts,
  buildGroupFixtureDrafts,
  planMatchReconcile,
} from './draw-swap-plan';

type RegistrationWithPlayers = Registration & {
  player1: { id: string; name: string; gender: string | null; affiliation: string };
  player2: { id: string; name: string; gender: string | null; affiliation: string } | null;
};

type MatchDraft = {
  round: string;
  roundNo: number;
  matchNo: number;
  side1Id: string | null;
  side2Id: string | null;
  status: MatchStatus;
  winnerSide: number | null;
};

const SECOND_STAGE_SLOTS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;
type SecondStageSlotCode = (typeof SECOND_STAGE_SLOTS)[number];

type SecondStageEntrant = {
  id: string | null;
  name: string | null;
};

type StandardSecondStageEntrant = {
  id: string;
  name: string;
  members: string[];
  group: string;
  rank: number;
};

type SecondStageMatchTemplate = {
  matchNo: number;
  roundName: string;
  area: string;
  slotInfo?: string | null;
  side1Source?: string | null;
  side2Source?: string | null;
  side1?: SecondStageEntrant;
  side2?: SecondStageEntrant;
};

@Injectable()
export class DrawsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly drawAlgorithmService: DrawAlgorithmService,
    private readonly drawLogService: DrawLogService,
    private readonly secondStageProgress: SecondStageProgressService,
  ) {}

  async listRegistrations(eventId: string) {
    await this.ensureEvent(eventId);
    // 混编主项目：并入单项的选手一起列出，抽签编排页选种子、看名单用。
    return this.prisma.registration.findMany({
      where: { eventId: await this.entrantScope(eventId), status: RegistrationStatus.APPROVED },
      include: { player1: true, player2: true },
      orderBy: [{ isSeed: 'desc' }, { seedRank: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async createRegistration(eventId: string, dto: CreateRegistrationDto) {
    const event = await this.ensureEvent(eventId);
    if (event.groupId) {
      const group = await this.prisma.tournamentGroup.findUniqueOrThrow({ where: { id: event.groupId } });
      if (normalizeAgeRule(group.ageRule).mode !== 'NONE' || groupFields(group.fieldRules).identityNumber === 'required') {
        throw new BadRequestException('本组需要资格校验，请在参赛选手页新增报名，完成核验后再抽签');
      }
      const crossGroup = await this.prisma.registration.findFirst({ where: { status: 'APPROVED', event: { tournamentId: event.tournamentId, groupId: { not: event.groupId } }, OR: [{ player1Id: { in: [dto.player1Id, ...(dto.player2Id ? [dto.player2Id] : [])] } }, { player2Id: { in: [dto.player1Id, ...(dto.player2Id ? [dto.player2Id] : [])] } }] } });
      if (crossGroup) throw new ConflictException('选手已在其他组别报名，请到参赛选手页办理转组');
    }
    if (event.drawLocked) {
      throw new ConflictException('签表已冻结或对阵已发布，请先取消发布后再调整报名');
    }
    await this.validateRegistrationPlayers(event.type, dto.player1Id, dto.player2Id);
    await this.ensureRegistrationLimit(dto.player1Id, eventId);
    if (dto.player2Id) await this.ensureRegistrationLimit(dto.player2Id, eventId);

    const existing = await this.prisma.registration.findFirst({
      where: {
        eventId,
        player1Id: dto.player1Id,
        player2Id: dto.player2Id ?? null,
      },
    });
    if (existing) throw new ConflictException('该报名已存在');

    return this.prisma.registration.create({
      data: {
        eventId,
        player1Id: dto.player1Id,
        player2Id: dto.player2Id,
        entrantType: event.entrantType,
        status: RegistrationStatus.APPROVED,
        isSeed: dto.isSeed ?? false,
        seedRank: dto.isSeed ? dto.seedRank : null,
      },
      include: { player1: true, player2: true },
    });
  }

  async updateRegistration(id: string, dto: UpdateRegistrationDto) {
    const registration = await this.prisma.registration.findUnique({
      where: { id },
      include: { event: true },
    });
    if (!registration) throw new NotFoundException('报名不存在');
    if (registration.event.drawLocked) {
      throw new ConflictException('签表已冻结或对阵已发布，请先取消发布后再调整报名');
    }

    const player1Id = dto.player1Id ?? registration.player1Id;
    const player2Id = dto.player2Id === undefined ? registration.player2Id : dto.player2Id;
    if (registration.event.groupId && (player1Id !== registration.player1Id || player2Id !== registration.player2Id)) {
      throw new BadRequestException('请到参赛选手页修改本人或搭档，以重新校验组别资格');
    }
    await this.validateRegistrationPlayers(registration.event.type, player1Id, player2Id ?? undefined);

    return this.prisma.registration.update({
      where: { id },
      data: {
        player1Id,
        player2Id,
        isSeed: dto.isSeed ?? registration.isSeed,
        seedRank: dto.isSeed === false ? null : dto.seedRank,
      },
      include: { player1: true, player2: true },
    });
  }

  async removeRegistration(id: string) {
    const registration = await this.prisma.registration.findUnique({
      where: { id },
      include: { event: true },
    });
    if (!registration) throw new NotFoundException('报名不存在');
    if (registration.event.drawLocked) {
      throw new ConflictException('签表已冻结或对阵已发布，请先取消发布后再调整报名');
    }
    return this.prisma.registration.delete({ where: { id } });
  }

  async getDrawDetail(eventId: string) {
    const event = await this.ensureEvent(eventId);
    const scope = await this.entrantScope(eventId);
    // 混编：主项目带混编名；并入单项带它所在混编的主项目，前端提示到主项目抽签。
    const mixHost = event.mixHostId
      ? await this.prisma.event.findUnique({
          where: { id: event.mixHostId },
          select: { id: true, type: true, groupLabel: true, mixMembers: { select: { type: true, groupLabel: true } } },
        })
      : null;
    const mixMembers = scope.in.length > 1
      ? await this.prisma.event.findMany({ where: { mixHostId: eventId }, select: { type: true, groupLabel: true } })
      : [];

    const [currentDraw, seedSettings, entrantCount, unpaidEntrants] = await Promise.all([
      this.prisma.drawBracket.findFirst({
        where: { eventItemId: eventId, isCurrent: true },
        include: {
          slots: { orderBy: { position: 'asc' } },
          groups: { include: { members: true }, orderBy: { sortOrder: 'asc' } },
        },
      }),
      this.prisma.drawSeedSetting.findMany({
        where: { eventItemId: eventId },
        orderBy: { seedNo: 'asc' },
      }),
      this.prisma.registration.count({
        where: { eventId: scope, status: RegistrationStatus.APPROVED },
      }),
      this.unpaidEntrants(event),
    ]);

    return {
      eventItemId: eventId,
      mixLabel: mixMembers.length ? hostDisplayLabel({ ...event, mixMembers }) : null,
      mixHost: mixHost ? { id: mixHost.id, label: hostDisplayLabel(mixHost) } : null,
      hasDraw: Boolean(currentDraw),
      currentDraw,
      seedSettings,
      entrantCount,
      // 组别开启收费时，未缴费的报名会阻止抽签/重抽，前端据此提示。
      unpaidEntrants,
      // 签表生成后报名有删除、调出或调入，需要重新抽签；前端据此提示，冻结和发布也会被拒绝。
      drawStale: event.drawStale,
      seedLimit: this.drawAlgorithmService.getSeedLimit(entrantCount),
    };
  }

  async updateSeeds(
    eventId: string,
    seeds: SeedItemDto[],
    operatorId: string,
    operatorName: string | null,
  ) {
    if (!operatorId) throw new BadRequestException('缺少操作人信息');
    await this.ensureDrawEvent(eventId);
    const scope = await this.entrantScope(eventId);

    const registrations = await this.prisma.registration.findMany({
      where: { eventId: scope, status: RegistrationStatus.APPROVED },
      select: { id: true },
    });
    const seedLimit = this.drawAlgorithmService.getSeedLimit(registrations.length);
    this.validateSeedSettings(seeds, seedLimit);

    const registrationIds = new Set(registrations.map((item) => item.id));
    for (const seed of seeds) {
      if (!registrationIds.has(seed.entrantId)) {
        throw new BadRequestException('种子必须来自当前单项已通过报名');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const before = await tx.drawSeedSetting.findMany({
        where: { eventItemId: eventId },
        orderBy: { seedNo: 'asc' },
      });

      await tx.drawSeedSetting.deleteMany({ where: { eventItemId: eventId } });
      await tx.registration.updateMany({
        where: { eventId: scope },
        data: { isSeed: false, seedRank: null },
      });

      if (seeds.length) {
        await tx.drawSeedSetting.createMany({
          data: seeds.map((seed) => ({
            eventItemId: eventId,
            entrantId: seed.entrantId,
            seedNo: seed.seedNo,
            createdBy: operatorId,
          })),
        });

        for (const seed of seeds) {
          await tx.registration.update({
            where: { id: seed.entrantId },
            data: {
              isSeed: true,
              seedRank: seed.seedNo,
            },
          });
        }
      }

      const currentDraw = await tx.drawBracket.findFirst({
        where: { eventItemId: eventId, isCurrent: true },
      });
      if (currentDraw) {
        await this.drawLogService.create(tx, {
          eventItemId: eventId,
          drawBracketId: currentDraw.id,
          operationType: DrawOperationType.SEED_UPDATE,
          operatorId,
          operatorNameSnapshot: operatorName,
          beforeData: before as unknown as Prisma.InputJsonValue,
          afterData: seeds as unknown as Prisma.InputJsonValue,
        });
      }

      return {
        eventItemId: eventId,
        seedLimit,
        seedCount: seeds.length,
        seedSettings: seeds,
      };
    });
  }

  /**
   * 抽签编排页保存分组设置：与单项管理页同一套校验（resolveGroupConfig），
   * 只更新单项上的设置，不动现有签表——重新抽签后才按新设置分组。
   */
  async updateGroupSettings(eventId: string, dto: UpdateDrawGroupSettingsDto) {
    const event = await this.ensureDrawEvent(eventId);
    if (!usesGroupConfig(event.format)) {
      throw new BadRequestException('当前赛制没有分组设置，只有「小组循环+淘汰」可以设置每组人数或小组数量');
    }
    const config = resolveGroupConfig(
      event.format,
      dto.groupSize ?? null,
      dto.groupCount ?? null,
      dto.qualifiersPerGroup,
    );
    return this.prisma.event.update({
      where: { id: eventId },
      data: { ...config, qualifiersPerGroup: dto.qualifiersPerGroup },
    });
  }

  async generateDraw(
    eventId: string,
    dto: GenerateDrawDto,
    operatorId: string,
    operatorName: string | null,
  ) {
    await this.ensureEvent(eventId);
    return this.executeDraw(eventId, operatorId, operatorName, dto.force ?? false);
  }

  async executeDraw(
    eventId: string,
    operatorId: string,
    operatorName: string | null,
    force = false,
  ) {
    if (!operatorId) throw new BadRequestException('缺少操作人信息');
    const event = await this.ensureDrawEvent(eventId);

    const existingCurrent = await this.prisma.drawBracket.findFirst({
      where: { eventItemId: eventId, isCurrent: true },
    });
    if (existingCurrent && !force) {
      throw new ConflictException('已有当前签表，请使用重新抽签覆盖');
    }

    // 混编主项目：并入单项的已通过报名一起抽签。
    const registrations = await this.prisma.registration.findMany({
      where: { eventId: await this.entrantScope(eventId), status: RegistrationStatus.APPROVED },
      include: { player1: true, player2: true },
      orderBy: [{ isSeed: 'desc' }, { seedRank: 'asc' }, { createdAt: 'asc' }],
    });
    if (registrations.length < 2) {
      throw new BadRequestException('至少需要 2 个报名才能抽签');
    }
    // 生成、重抽、审批通过的重抽都经过这里；未缴费的报名必须先确认缴费或设为免缴。
    const unpaid = await this.unpaidEntrants(event);
    if (unpaid.length) {
      throw new BadRequestException(unpaidMessage('选手', unpaid.map((entry) => entry.name)));
    }

    const seedLimit = this.drawAlgorithmService.getSeedLimit(registrations.length);
    // 前端通过报名表单(registration.isSeed/seedRank)标记种子，并不会写入 drawSeedSetting；
    // 因此优先读取独立种子配置，缺失时回退到报名上的种子标记，并规范化(按顺位排序、限额内截断、
    // 重新连续编号)，确保选中的种子在抽签中真正生效。
    let seedSettings: Array<{ entrantId: string; seedNo: number }> =
      await this.prisma.drawSeedSetting.findMany({
        where: { eventItemId: eventId },
        orderBy: { seedNo: 'asc' },
      });
    if (seedSettings.length) {
      this.validateSeedSettings(seedSettings, seedLimit);
    } else {
      seedSettings = registrations
        .filter((registration) => registration.isSeed && registration.seedRank != null)
        .sort((a, b) => (a.seedRank ?? 0) - (b.seedRank ?? 0))
        .slice(0, seedLimit)
        .map((registration, index) => ({ entrantId: registration.id, seedNo: index + 1 }));
    }

    // 分组计划在事务外算好：组数/每组人数/出线人数都由「每组人数」或「手动组数」决定，
    // 校验失败直接 400，避免先生成一份残缺签表再回滚。
    const format = this.drawFormatForEvent(event.format);
    const groupPlan = this.groupPlanFor(event, format, registrations.length);
    if (groupPlan?.errors.length) throw new BadRequestException(groupPlan.errors[0]);

    const latest = await this.prisma.drawBracket.findFirst({
      where: { eventItemId: eventId },
      orderBy: { version: 'desc' },
    });

    return this.prisma.$transaction(async (tx) => {
      await tx.drawBracket.updateMany({
        where: { eventItemId: eventId, isCurrent: true },
        data: { isCurrent: false, updatedBy: operatorId },
      });

      // 重新生成第一阶段对阵会让既有第二阶段（手动 A-H 签位 + 排位赛对阵）失效：正式赛 Match
      // （roundNo ≥ 100）在 materialize 时按 eventId 一并删除，这里同步清空 SecondStage 实体
      // （级联删 slots/matches/rankings），要求重抽后重新指定 A-H。首次抽签时无第二阶段，空操作。
      await tx.secondStage.deleteMany({ where: { eventId } });

      let bracketSize = registrations.length;
      let byeCount = 0;
      let seedCount = seedSettings.length;

      const draw = await tx.drawBracket.create({
        data: {
          eventItemId: eventId,
          version: (latest?.version ?? 0) + 1,
          isCurrent: true,
          format,
          status: DrawStatus.DRAWN,
          bracketSize,
          entrantCount: registrations.length,
          seedLimit,
          seedCount,
          byeCount,
          groupCount: groupPlan
            ? groupPlan.groupCount
            : format === DrawFormat.round_robin
              ? 1
              : null,
          qualifyPerGroup: event.qualifiersPerGroup ?? null,
          executedAt: new Date(),
          createdBy: operatorId,
          updatedBy: operatorId,
        },
      });

      if (format === DrawFormat.single_elim) {
        const built = this.drawAlgorithmService.buildSingleEliminationSlots(
          registrations.map((registration) => ({
            id: registration.id,
            name: this.registrationName(registration),
          })),
          seedSettings.map((seed) => ({ entrantId: seed.entrantId, seedNo: seed.seedNo })),
        );

        bracketSize = built.bracketSize;
        byeCount = built.byeCount;
        seedCount = seedSettings.length;

        await tx.drawBracket.update({
          where: { id: draw.id },
          data: {
            bracketSize,
            byeCount,
            seedCount,
          },
        });

        await tx.drawSlot.createMany({
          data: built.slots.map((slot) => ({
            drawBracketId: draw.id,
            position: slot.position,
            entrantId: slot.entrantId,
            entrantNameSnapshot: slot.entrantNameSnapshot,
            seedNoSnapshot: slot.seedNoSnapshot,
            isSeed: slot.isSeed,
            isBye: slot.isBye,
            sourceType: slot.sourceType,
            groupRankCode: slot.groupRankCode,
          })),
        });

        await this.materializeSingleElimination(tx, eventId, built.slots);
      } else {
        const entrants = registrations.map((registration) => ({
          id: registration.id,
          name: this.registrationName(registration),
        }));
        const seedInputs = seedSettings.map((seed) => ({
          entrantId: seed.entrantId,
          seedNo: seed.seedNo,
        }));

        // 小组编号按单项设置：A、B、C 或 1、2、3。
        const groups =
          format === DrawFormat.round_robin
            ? this.drawAlgorithmService.buildSingleRoundRobin(entrants, seedInputs, event.groupNaming)
            : this.drawAlgorithmService.buildGroups(entrants, seedInputs, groupPlan?.sizes ?? [], event.groupNaming);

        await tx.drawBracket.update({
          where: { id: draw.id },
          data: {
            bracketSize: groups.length,
            byeCount: 0,
            seedCount,
            groupCount: groups.length,
          },
        });

        for (const group of groups) {
          const createdGroup = await tx.drawGroup.create({
            data: {
              drawBracketId: draw.id,
              groupCode: group.groupCode,
              sortOrder: group.sortOrder,
            },
          });

          await tx.drawGroupMember.createMany({
            data: group.members.map((member) => ({
              drawGroupId: createdGroup.id,
              entrantId: member.entrantId,
              entrantNameSnapshot: member.entrantNameSnapshot,
              seedNoSnapshot: member.seedNoSnapshot,
              groupRank: member.groupRank,
              isQualified: member.isQualified,
            })),
          });
        }

        if (format === DrawFormat.group_then_playoff) {
          await this.materializeGroupPlusPlayoff(tx, eventId, groups);
        } else {
          await this.materializeGroupStage(tx, eventId, groups);
        }
      }

      await tx.event.update({
        where: { id: eventId },
        data: { drawLocked: false, drawPublished: false, drawGeneratedAt: new Date(), drawStale: false },
      });

      await this.drawLogService.create(tx, {
        eventItemId: eventId,
        drawBracketId: draw.id,
        operationType: DrawOperationType.EXECUTE,
        operatorId,
        operatorNameSnapshot: operatorName,
        afterData: {
          drawId: draw.id,
          version: draw.version,
          format,
          // 抽签当时的分组设置：之后改了设置却没重抽时，抽签编排页据此提示「签表与设置不一致」。
          groupSettings: drawnGroupSettingsSnapshot(event),
        } as Prisma.InputJsonValue,
      });

      return tx.drawBracket.findUniqueOrThrow({
        where: { id: draw.id },
        include: {
          slots: { orderBy: { position: 'asc' } },
          groups: { include: { members: true }, orderBy: { sortOrder: 'asc' } },
        },
      });
    });
  }

  /**
   * 换签位：统一入口。scope 决定「签位」落在哪种载体上：
   * - SLOT：单淘汰的 draw_slot 签位（1..N）
   * - GROUP：小组/循环赛的组内位置（跨组换人）
   * - SECOND_STAGE：A–H 第二阶段签位
   * - KNOCKOUT_SIDE：没有 draw_slot 的自动淘汰赛（标准2023 出线 >8 人）首轮位置
   *
   * 所有 scope 都走「原地更新」：场次 id、场地/时间、裁判、签到与比分关联全部保留；
   * 带 expectFromId/expectToId 时按幂等处理，避免双击导致两次交换互相抵消。
   */
  async swapDrawPositions(
    eventId: string,
    dto: SwapDrawSlotsDto,
    operatorId: string,
    operatorName: string | null,
  ) {
    if (!operatorId) throw new BadRequestException('缺少操作人信息');
    switch (dto.scope ?? 'SLOT') {
      case 'SLOT':
        return this.swapDrawSlots(eventId, dto, operatorId, operatorName);
      case 'GROUP':
        return this.swapGroupMembers(eventId, dto, operatorId, operatorName);
      case 'SECOND_STAGE':
        return this.swapSecondStageSlots(eventId, dto, operatorId, operatorName);
      case 'KNOCKOUT_SIDE':
        return this.swapKnockoutSides(eventId, dto, operatorId, operatorName);
      default:
        throw new BadRequestException('不支持的换签位类型');
    }
  }

  /** 单淘汰签位交换：只换两个人（或人与轮空）的位置，签表原地重算，不删任何场次。 */
  async swapDrawSlots(
    eventId: string,
    dto: SwapDrawSlotsDto,
    operatorId: string,
    operatorName: string | null,
  ) {
    const positionA = dto.positionA;
    const positionB = dto.positionB;
    if (!positionA || !positionB) throw new BadRequestException('请选择两个要交换的签位');
    if (positionA === positionB) throw new BadRequestException('不能交换同一个签位');

    return this.prisma.$transaction(async (tx) => {
      await this.lockEventForDraw(tx, eventId);
      const event = await this.ensureDrawEvent(eventId);
      const draw = await this.currentDrawBracket(tx, eventId, dto.drawId);
      if (draw.format !== DrawFormat.single_elim) {
        throw new BadRequestException('当前项目第一阶段不是单淘汰签表，请使用小组换位');
      }
      this.assertDrawEditable(draw, event);
      await this.assertDrawMatchIdle(tx, eventId, {
        roundNo: { gte: 1, lt: SECOND_STAGE_FORMAL_ROUND_NO_BASE },
      });

      const slotA = await tx.drawSlot.findFirst({ where: { drawBracketId: draw.id, position: positionA } });
      const slotB = await tx.drawSlot.findFirst({ where: { drawBracketId: draw.id, position: positionB } });
      if (!slotA || !slotB) throw new NotFoundException('签位不存在');

      const action = this.swapAction(slotA.entrantId, slotB.entrantId, dto);
      if (action === 'conflict') throw new ConflictException('签位已被其他人调整，请刷新后重试');
      if (action === 'already') return { changed: false, scope: 'SLOT' as const, drawId: draw.id };

      await tx.drawSlot.update({
        where: { id: slotA.id },
        data: {
          entrantId: slotB.entrantId,
          entrantNameSnapshot: slotB.entrantNameSnapshot,
          seedNoSnapshot: slotB.seedNoSnapshot,
          isSeed: slotB.isSeed,
          isBye: slotB.isBye,
          groupRankCode: slotB.groupRankCode,
          sourceType: DrawSlotSourceType.MANUAL_SWAP,
        },
      });
      await tx.drawSlot.update({
        where: { id: slotB.id },
        data: {
          entrantId: slotA.entrantId,
          entrantNameSnapshot: slotA.entrantNameSnapshot,
          seedNoSnapshot: slotA.seedNoSnapshot,
          isSeed: slotA.isSeed,
          isBye: slotA.isBye,
          groupRankCode: slotA.groupRankCode,
          sourceType: DrawSlotSourceType.MANUAL_SWAP,
        },
      });

      const slots = await tx.drawSlot.findMany({ where: { drawBracketId: draw.id }, orderBy: { position: 'asc' } });
      await this.reconcileEliminationMatches(tx, eventId, slots, { bronze: true });
      await tx.drawBracket.update({ where: { id: draw.id }, data: { updatedBy: operatorId } });

      const updatedSlots = await tx.drawSlot.findMany({
        where: { drawBracketId: draw.id, position: { in: [positionA, positionB] } },
      });
      await this.drawLogService.create(tx, {
        eventItemId: eventId,
        drawBracketId: draw.id,
        operationType: DrawOperationType.SWAP,
        operatorId,
        operatorNameSnapshot: operatorName,
        positionA,
        positionB,
        beforeData: {
          scope: 'SLOT',
          status: draw.status,
          slotA: this.drawSlotLogSnapshot(slotA),
          slotB: this.drawSlotLogSnapshot(slotB),
        } as Prisma.InputJsonValue,
        afterData: {
          scope: 'SLOT',
          status: draw.status,
          slotA: this.drawSlotLogSnapshot(updatedSlots.find((slot) => slot.position === positionA) ?? slotA),
          slotB: this.drawSlotLogSnapshot(updatedSlots.find((slot) => slot.position === positionB) ?? slotB),
        } as Prisma.InputJsonValue,
      });

      return { changed: true, scope: 'SLOT' as const, drawId: draw.id };
    });
  }

  /**
   * 小组换位：两名选手互换所在小组（同组内换位不影响对阵，直接返回未变更）。
   * 只原地重排受影响两组的组内循环场次，排程/裁判/场次 id 都不动。
   */
  async swapGroupMembers(
    eventId: string,
    dto: SwapDrawSlotsDto,
    operatorId: string,
    operatorName: string | null,
  ) {
    const { fromGroupCode, toGroupCode, fromEntrantId, toEntrantId } = dto;
    if (!fromGroupCode || !toGroupCode || !fromEntrantId || !toEntrantId) {
      throw new BadRequestException('请选择两个要交换的小组位置');
    }
    if (fromGroupCode === toGroupCode && fromEntrantId === toEntrantId) {
      throw new BadRequestException('不能交换同一个位置');
    }

    return this.prisma.$transaction(async (tx) => {
      await this.lockEventForDraw(tx, eventId);
      const event = await this.ensureDrawEvent(eventId);
      const draw = await this.currentDrawBracket(tx, eventId, dto.drawId);
      if (draw.format === DrawFormat.single_elim) {
        throw new BadRequestException('当前项目是单淘汰签表，请使用签位交换');
      }
      this.assertDrawEditable(draw, event);

      const memberships = await tx.drawGroupMember.findMany({
        where: {
          entrantId: { in: [fromEntrantId, toEntrantId] },
          drawGroup: { drawBracketId: draw.id },
        },
        include: { drawGroup: true },
      });
      const memberFrom = memberships.find((member) => member.entrantId === fromEntrantId);
      const memberTo = memberships.find((member) => member.entrantId === toEntrantId);
      if (!memberFrom || !memberTo) throw new NotFoundException('选手不在当前签表的小组里');

      const currentFromGroup = memberFrom.drawGroup.groupCode;
      const currentToGroup = memberTo.drawGroup.groupCode;
      // 幂等：已经是目标状态（两人已在对方原来的小组）→ 直接返回，不再交换回去。
      if (currentFromGroup === toGroupCode && currentToGroup === fromGroupCode) {
        return { changed: false, scope: 'GROUP' as const, drawId: draw.id };
      }
      if (currentFromGroup !== fromGroupCode || currentToGroup !== toGroupCode) {
        throw new ConflictException('小组分组已被其他人调整，请刷新后重试');
      }
      if (currentFromGroup === currentToGroup) {
        return {
          changed: false,
          scope: 'GROUP' as const,
          drawId: draw.id,
          message: '同一小组内换位不改变组内循环对阵',
        };
      }

      const groups = await tx.drawGroup.findMany({
        where: { id: { in: [memberFrom.drawGroupId, memberTo.drawGroupId] } },
      });
      const groupFrom = groups.find((group) => group.id === memberFrom.drawGroupId);
      const groupTo = groups.find((group) => group.id === memberTo.drawGroupId);
      if (!groupFrom || !groupTo) throw new NotFoundException('小组不存在');

      await this.assertDrawMatchIdle(tx, eventId, {
        roundNo: 0,
        round: { in: [groupFrom.groupCode, groupTo.groupCode] },
      });

      await tx.drawGroupMember.update({ where: { id: memberFrom.id }, data: { drawGroupId: groupTo.id } });
      await tx.drawGroupMember.update({ where: { id: memberTo.id }, data: { drawGroupId: groupFrom.id } });
      // 分组表来自 Registration.groupName，必须与 draw_group_member 同步，否则页面两边不一致。
      await tx.registration.update({ where: { id: memberFrom.entrantId }, data: { groupName: groupTo.groupCode } });
      await tx.registration.update({ where: { id: memberTo.entrantId }, data: { groupName: groupFrom.groupCode } });

      const refreshedGroups = await tx.drawGroup.findMany({
        where: { id: { in: [groupFrom.id, groupTo.id] } },
        include: { members: true },
      });
      for (const group of refreshedGroups) {
        const fixtureDrafts = buildGroupFixtureDrafts(group.members.map((member) => member.entrantId)).map(
          (draft) => ({
            round: group.groupCode,
            roundNo: 0,
            matchNo: draft.matchNo,
            side1Id: draft.side1Id,
            side2Id: draft.side2Id,
            status: MatchStatus.PENDING,
            winnerSide: null,
          }),
        );
        const existing = await tx.match.findMany({
          where: { eventId, roundNo: 0, round: group.groupCode },
          select: { id: true, roundNo: true, matchNo: true },
        });
        const plan = planMatchReconcile(existing, fixtureDrafts);
        for (const update of plan.updates) {
          await tx.match.update({
            where: { id: update.id },
            data: {
              side1Id: update.draft.side1Id,
              side2Id: update.draft.side2Id,
              status: update.draft.status,
              winnerSide: update.draft.winnerSide,
            },
          });
        }
        if (plan.deletes.length) await tx.match.deleteMany({ where: { id: { in: plan.deletes } } });
        if (plan.creates.length) await this.createMatchDrafts(tx, eventId, plan.creates);
      }

      await tx.drawBracket.update({ where: { id: draw.id }, data: { updatedBy: operatorId } });
      await this.drawLogService.create(tx, {
        eventItemId: eventId,
        drawBracketId: draw.id,
        operationType: DrawOperationType.SWAP,
        operatorId,
        operatorNameSnapshot: operatorName,
        beforeData: {
          scope: 'GROUP',
          from: { group: currentFromGroup, entrantId: memberFrom.entrantId },
          to: { group: currentToGroup, entrantId: memberTo.entrantId },
        } as Prisma.InputJsonValue,
        afterData: {
          scope: 'GROUP',
          from: { group: groupTo.groupCode, entrantId: memberFrom.entrantId },
          to: { group: groupFrom.groupCode, entrantId: memberTo.entrantId },
        } as Prisma.InputJsonValue,
      });

      return { changed: true, scope: 'GROUP' as const, drawId: draw.id };
    });
  }

  /** A–H 第二阶段签位交换：换人后重算第二阶段规划表与正式场次，场次 id 保持不变。 */
  async swapSecondStageSlots(
    eventId: string,
    dto: SwapDrawSlotsDto,
    operatorId: string,
    operatorName: string | null,
  ) {
    const fromSlot = dto.fromSlot;
    const toSlot = dto.toSlot;
    if (!fromSlot || !toSlot) throw new BadRequestException('请选择两个 A–H 签位');
    if (fromSlot === toSlot) throw new BadRequestException('不能交换同一个签位');

    return this.prisma.$transaction(async (tx) => {
      await this.lockEventForDraw(tx, eventId);
      const event = await this.ensureDrawEvent(eventId);
      if (
        event.format !== Format.SINGLE_ELIMINATION_PLUS_GROUP_RANKING &&
        event.format !== Format.GROUP_PLUS_KNOCKOUT_STD
      ) {
        throw new BadRequestException('当前项目没有 A–H 第二阶段签位');
      }
      const stage = await tx.secondStage.findUnique({
        where: { eventId },
        include: { slots: { orderBy: { sortOrder: 'asc' } } },
      });
      if (!stage) throw new NotFoundException('第二阶段还没有生成，请先确认 A–H 签位');
      if (stage.status === SecondStageStatus.FINISHED) {
        throw new ConflictException('第二阶段已结束，不能换签位');
      }
      const slotA = stage.slots.find((slot) => slot.slot === fromSlot);
      const slotB = stage.slots.find((slot) => slot.slot === toSlot);
      if (!slotA || !slotB) throw new NotFoundException('签位不存在');

      await this.assertDrawMatchIdle(tx, eventId, {
        roundNo: { gte: SECOND_STAGE_FORMAL_ROUND_NO_BASE },
      });

      const action = this.swapAction(slotA.entrantId, slotB.entrantId, dto);
      if (action === 'conflict') throw new ConflictException('签位已被其他人调整，请刷新后重试');
      if (action === 'already') return { changed: false, scope: 'SECOND_STAGE' as const };

      await tx.secondStageSlot.update({
        where: { id: slotA.id },
        data: { entrantId: slotB.entrantId, entrantNameSnapshot: slotB.entrantNameSnapshot },
      });
      await tx.secondStageSlot.update({
        where: { id: slotB.id },
        data: { entrantId: slotA.entrantId, entrantNameSnapshot: slotA.entrantNameSnapshot },
      });

      await this.reconcileSecondStageMatches(tx, stage.id, eventId);

      const draw = await tx.drawBracket.findFirst({
        where: { eventItemId: eventId, isCurrent: true },
        orderBy: { version: 'desc' },
      });
      if (draw) {
        await tx.drawBracket.update({ where: { id: draw.id }, data: { updatedBy: operatorId } });
        await this.drawLogService.create(tx, {
          eventItemId: eventId,
          drawBracketId: draw.id,
          operationType: DrawOperationType.SWAP,
          operatorId,
          operatorNameSnapshot: operatorName,
          beforeData: {
            scope: 'SECOND_STAGE',
            from: { slot: fromSlot, entrantId: slotA.entrantId, name: slotA.entrantNameSnapshot },
            to: { slot: toSlot, entrantId: slotB.entrantId, name: slotB.entrantNameSnapshot },
          } as Prisma.InputJsonValue,
          afterData: {
            scope: 'SECOND_STAGE',
            from: { slot: fromSlot, entrantId: slotB.entrantId, name: slotB.entrantNameSnapshot },
            to: { slot: toSlot, entrantId: slotA.entrantId, name: slotA.entrantNameSnapshot },
          } as Prisma.InputJsonValue,
        });
      }

      return { changed: true, scope: 'SECOND_STAGE' as const };
    });
  }

  /**
   * 标准2023 出线超过 8 人时，淘汰赛由记分模块自动生成，只有 Match、没有 draw_slot。
   * 这里直接换首轮两个位置上的选手，再按首轮签位重算整棵树（原地更新）。
   */
  async swapKnockoutSides(
    eventId: string,
    dto: SwapDrawSlotsDto,
    operatorId: string,
    operatorName: string | null,
  ) {
    const { fromRoundNo, fromMatchNo, fromSide, toRoundNo, toMatchNo, toSide } = dto;
    if (!fromRoundNo || !fromMatchNo || !fromSide || !toRoundNo || !toMatchNo || !toSide) {
      throw new BadRequestException('请选择两个要交换的签位');
    }
    if (fromRoundNo === toRoundNo && fromMatchNo === toMatchNo && fromSide === toSide) {
      throw new BadRequestException('不能交换同一个位置');
    }

    return this.prisma.$transaction(async (tx) => {
      await this.lockEventForDraw(tx, eventId);
      const event = await this.ensureDrawEvent(eventId);
      const draw = await this.currentDrawBracket(tx, eventId, dto.drawId);
      if (draw.format !== DrawFormat.group_then_elim) {
        throw new BadRequestException('当前项目不是小组+淘汰赛');
      }
      this.assertDrawEditable(draw, event);
      const stage = await tx.secondStage.findUnique({ where: { eventId }, select: { id: true } });
      if (stage) {
        throw new BadRequestException('本项目使用 A–H 第二阶段签位，请在第二阶段里换签位');
      }

      const matches = await tx.match.findMany({
        where: { eventId, roundNo: { gte: 1, lt: SECOND_STAGE_FORMAL_ROUND_NO_BASE } },
        orderBy: [{ roundNo: 'asc' }, { matchNo: 'asc' }],
      });
      if (!matches.length) throw new BadRequestException('淘汰赛还没有生成，暂无可交换的签位');
      const firstRoundNo = matches[0].roundNo;
      if (fromRoundNo !== firstRoundNo || toRoundNo !== firstRoundNo) {
        throw new BadRequestException('只能交换首轮签位');
      }
      const firstRound = matches
        .filter((match) => match.roundNo === firstRoundNo)
        .sort((a, b) => a.matchNo - b.matchNo);
      if (firstRound.every((match) => !match.side1Id && !match.side2Id)) {
        throw new BadRequestException('淘汰赛对阵还没有生成，小组赛打完后才能换签位');
      }
      await this.assertDrawMatchIdle(tx, eventId, {
        roundNo: { gte: firstRoundNo, lt: SECOND_STAGE_FORMAL_ROUND_NO_BASE },
      });

      const matchA = firstRound.find((match) => match.matchNo === fromMatchNo);
      const matchB = firstRound.find((match) => match.matchNo === toMatchNo);
      if (!matchA || !matchB) throw new NotFoundException('场次不存在');
      const currentFrom = fromSide === 1 ? matchA.side1Id : matchA.side2Id;
      const currentTo = toSide === 1 ? matchB.side1Id : matchB.side2Id;

      const action = this.swapAction(currentFrom, currentTo, dto);
      if (action === 'conflict') throw new ConflictException('签位已被其他人调整，请刷新后重试');
      if (action === 'already') return { changed: false, scope: 'KNOCKOUT_SIDE' as const, drawId: draw.id };

      const slots = firstRound.flatMap((match) => [
        { entrantId: match.side1Id, isBye: !match.side1Id },
        { entrantId: match.side2Id, isBye: !match.side2Id },
      ]);
      const indexFrom = firstRound.findIndex((match) => match.matchNo === fromMatchNo) * 2 + (fromSide - 1);
      const indexTo = firstRound.findIndex((match) => match.matchNo === toMatchNo) * 2 + (toSide - 1);
      [slots[indexFrom], slots[indexTo]] = [slots[indexTo], slots[indexFrom]];

      await this.reconcileEliminationMatches(tx, eventId, slots, {
        bronze: matches.some((match) => match.round === 'BRONZE'),
        fromRoundNo: firstRoundNo,
      });
      await tx.drawBracket.update({ where: { id: draw.id }, data: { updatedBy: operatorId } });
      await this.drawLogService.create(tx, {
        eventItemId: eventId,
        drawBracketId: draw.id,
        operationType: DrawOperationType.SWAP,
        operatorId,
        operatorNameSnapshot: operatorName,
        beforeData: {
          scope: 'KNOCKOUT_SIDE',
          from: { roundNo: fromRoundNo, matchNo: fromMatchNo, side: fromSide, entrantId: currentFrom },
          to: { roundNo: toRoundNo, matchNo: toMatchNo, side: toSide, entrantId: currentTo },
        } as Prisma.InputJsonValue,
        afterData: {
          scope: 'KNOCKOUT_SIDE',
          from: { roundNo: fromRoundNo, matchNo: fromMatchNo, side: fromSide, entrantId: currentTo },
          to: { roundNo: toRoundNo, matchNo: toMatchNo, side: toSide, entrantId: currentFrom },
        } as Prisma.InputJsonValue,
      });

      return { changed: true, scope: 'KNOCKOUT_SIDE' as const, drawId: draw.id };
    });
  }

  /** 抽签编排页「换签位」可选项：按当前赛制给出有哪些签位可以换、以及为什么不能换。 */
  async getSwapOptions(eventId: string) {
    type SwapOptionView = {
      key: string;
      label: string;
      entrantId: string | null;
      group?: string;
      position?: number;
      slotCode?: string;
      roundNo?: number;
      matchNo?: number;
      side?: number;
    };
    type SwapScopeView = {
      scope: 'SLOT' | 'GROUP' | 'SECOND_STAGE' | 'KNOCKOUT_SIDE';
      title: string;
      description: string;
      disabled: boolean;
      reason: string | null;
      options: SwapOptionView[];
    };

    const event = await this.ensureEvent(eventId);
    const draw = await this.prisma.drawBracket.findFirst({
      where: { eventItemId: eventId, isCurrent: true },
      orderBy: { version: 'desc' },
    });
    const base = {
      drawId: draw?.id ?? null,
      drawStatus: draw?.status ?? null,
      drawFormat: draw?.format ?? null,
      eventFormat: event.format,
      drawPublished: event.drawPublished,
      drawLocked: event.drawLocked,
    };

    if (event.mixHostId) {
      return { ...base, canSwap: false, reason: '并入混编的单项在主项目里换签位', scopes: [] as SwapScopeView[] };
    }
    if (!draw) return { ...base, canSwap: false, reason: '还没有抽签', scopes: [] as SwapScopeView[] };
    if (event.drawPublished) {
      return { ...base, canSwap: false, reason: '对阵已发布，请先取消发布', scopes: [] as SwapScopeView[] };
    }
    if (draw.status !== DrawStatus.DRAWN) {
      return { ...base, canSwap: false, reason: '签表已冻结，请先解冻', scopes: [] as SwapScopeView[] };
    }

    const scopes: SwapScopeView[] = [];

    if (draw.format === DrawFormat.single_elim) {
      const slots = await this.prisma.drawSlot.findMany({
        where: { drawBracketId: draw.id },
        orderBy: { position: 'asc' },
      });
      const blocked = await this.hasMatchProgress({
        eventId,
        roundNo: { gte: 1, lt: SECOND_STAGE_FORMAL_ROUND_NO_BASE },
      });
      scopes.push({
        scope: 'SLOT',
        title: '淘汰赛签位',
        description: '选择两个签位交换选手位置；轮空位也可以参与交换。',
        disabled: blocked,
        reason: blocked ? '已有场次开赛或产生比分' : null,
        options: slots.map((slot) => ({
          key: `SLOT:${slot.position}`,
          label: `#${slot.position} ${slot.isBye || !slot.entrantNameSnapshot ? '轮空' : slot.entrantNameSnapshot}`,
          entrantId: slot.entrantId,
          position: slot.position,
        })),
      });
    } else {
      const groups = await this.prisma.drawGroup.findMany({
        where: { drawBracketId: draw.id },
        include: { members: true },
        orderBy: { sortOrder: 'asc' },
      });
      const groupCodes = groups.map((group) => group.groupCode);
      const blocked = groupCodes.length
        ? await this.hasMatchProgress({ eventId, roundNo: 0, round: { in: groupCodes } })
        : false;
      scopes.push({
        scope: 'GROUP',
        title: '小组位置',
        description: '选择两个不同小组的选手互换位置；同组内换位不改变组内循环对阵。',
        disabled: blocked || groups.length < 2,
        reason: blocked
          ? '已有小组赛场次开赛或产生比分'
          : groups.length < 2
            ? groups.length === 1
              ? '当前只有一个小组，组内换位不改变对阵'
              : '还没有分组'
            : null,
        options: groups.flatMap((group) =>
          group.members.map((member) => ({
            key: `GROUP:${group.groupCode}:${member.entrantId}`,
            label: `${group.groupCode}组 · ${member.entrantNameSnapshot ?? member.entrantId}`,
            group: group.groupCode,
            entrantId: member.entrantId,
          })),
        ),
      });
    }

    const stage = await this.prisma.secondStage.findUnique({
      where: { eventId },
      include: { slots: { orderBy: { sortOrder: 'asc' } } },
    });
    if (stage) {
      const blocked = await this.hasMatchProgress({
        eventId,
        roundNo: { gte: SECOND_STAGE_FORMAL_ROUND_NO_BASE },
      });
      scopes.push({
        scope: 'SECOND_STAGE',
        title: '第二阶段 A–H 签位',
        description: '交换两个 A–H 签位上的选手，第二阶段对阵与正式场次原地重算。',
        disabled: blocked || stage.status === SecondStageStatus.FINISHED,
        reason: blocked
          ? '第二阶段已有场次开赛或产生比分'
          : stage.status === SecondStageStatus.FINISHED
            ? '第二阶段已结束'
            : null,
        options: stage.slots.map((slot) => ({
          key: `SECOND_STAGE:${slot.slot}`,
          label: `${slot.slot} · ${slot.entrantNameSnapshot ?? '待定'}`,
          slotCode: slot.slot,
          entrantId: slot.entrantId,
        })),
      });
    } else if (draw.format === DrawFormat.group_then_elim) {
      const matches = await this.prisma.match.findMany({
        where: { eventId, roundNo: { gte: 1, lt: SECOND_STAGE_FORMAL_ROUND_NO_BASE } },
        orderBy: [{ roundNo: 'asc' }, { matchNo: 'asc' }],
      });
      const firstRoundNo = matches.length ? matches[0].roundNo : null;
      const firstRound = firstRoundNo === null ? [] : matches.filter((match) => match.roundNo === firstRoundNo);
      const names = await this.entrantNameMap(eventId);
      const generated = firstRound.some((match) => match.side1Id || match.side2Id);
      const blocked = firstRoundNo === null
        ? false
        : await this.hasMatchProgress({
            eventId,
            roundNo: { gte: firstRoundNo, lt: SECOND_STAGE_FORMAL_ROUND_NO_BASE },
          });
      scopes.push({
        scope: 'KNOCKOUT_SIDE',
        title: '淘汰赛首轮位置',
        description: '标准2023 出线超过 8 人时，淘汰赛由系统按小组名次自动生成，可交换首轮两个位置上的选手。',
        disabled: !generated || blocked,
        reason: !generated
          ? '小组赛全部打完后才生成淘汰赛对阵'
          : blocked
            ? '已有场次开赛或产生比分'
            : null,
        options: firstRound.flatMap((match) =>
          ([1, 2] as const).map((side) => {
            const entrantId = side === 1 ? match.side1Id : match.side2Id;
            return {
              key: `KNOCKOUT_SIDE:${match.roundNo}:${match.matchNo}:${side}`,
              label: `第${match.matchNo}场 ${side === 1 ? '上' : '下'} · ${entrantId ? (names.get(entrantId) ?? '待定') : '轮空'}`,
              entrantId,
              roundNo: match.roundNo,
              matchNo: match.matchNo,
              side,
            };
          }),
        ),
      });
    }

    const usable = scopes.filter((scope) => !scope.disabled && scope.options.length >= 2);
    return {
      ...base,
      canSwap: usable.length > 0,
      reason: usable.length ? null : (scopes[0]?.reason ?? '当前没有可交换的签位'),
      scopes,
    };
  }

  /** 锁定单项行，避免同一次抽签被并发改两次。 */
  private async lockEventForDraw(tx: Prisma.TransactionClient, eventId: string) {
    await tx.$queryRaw`SELECT id FROM Event WHERE id = ${eventId} FOR UPDATE`;
  }

  private async currentDrawBracket(tx: Prisma.TransactionClient, eventId: string, drawId?: string) {
    if (drawId) {
      const draw = await tx.drawBracket.findUnique({ where: { id: drawId } });
      if (!draw || draw.eventItemId !== eventId) throw new NotFoundException('签表不存在');
      return draw;
    }
    const draw = await tx.drawBracket.findFirst({
      where: { eventItemId: eventId, isCurrent: true },
      orderBy: { version: 'desc' },
    });
    if (!draw) throw new NotFoundException('当前单项还没有签表，请先抽签');
    return draw;
  }

  private assertDrawEditable(draw: { status: DrawStatus }, event: { drawPublished: boolean }) {
    if (event.drawPublished) throw new ConflictException('对阵已发布，请先取消发布再换签位');
    if (draw.status !== DrawStatus.DRAWN) throw new ConflictException('当前签表已冻结，请先解冻再换签位');
  }

  /** 幂等 / 并发判定：apply 执行交换，already 已是目标状态，conflict 与前端看到的不一致。 */
  private swapAction(
    currentFrom: string | null,
    currentTo: string | null,
    dto: { expectFromId?: string | null; expectToId?: string | null },
  ): 'apply' | 'already' | 'conflict' {
    const hasExpect = dto.expectFromId !== undefined || dto.expectToId !== undefined;
    if (!hasExpect) {
      return !currentFrom && !currentTo ? 'already' : 'apply';
    }
    const expectFrom = dto.expectFromId ?? null;
    const expectTo = dto.expectToId ?? null;
    if (currentFrom === expectFrom && currentTo === expectTo) {
      return currentFrom === currentTo ? 'already' : 'apply';
    }
    if (currentFrom === expectTo && currentTo === expectFrom) return 'already';
    return 'conflict';
  }

  /** 指定范围内的场次里是否有「已开赛 / 已有比分 / 已结束的真实比赛」。 */
  private async hasMatchProgress(scope: Prisma.MatchWhereInput) {
    const count = await this.prisma.match.count({
      where: { AND: [scope, this.matchProgressCondition()] },
    });
    return count > 0;
  }

  private async assertDrawMatchIdle(
    tx: Prisma.TransactionClient,
    eventId: string,
    scope: Prisma.MatchWhereInput,
  ) {
    const count = await tx.match.count({
      where: { AND: [{ eventId }, scope, this.matchProgressCondition()] },
    });
    if (count > 0) {
      throw new ConflictException('这些场次已开赛或已有成绩，不能换签位；请先清空成绩再调整');
    }
  }

  private matchProgressCondition(): Prisma.MatchWhereInput {
    return {
      OR: [
        { status: MatchStatus.LIVE },
        { startedAt: { not: null } },
        { games: { some: {} } },
        { forfeitedSide: { not: null } },
        { status: MatchStatus.COMPLETED, side1Id: { not: null }, side2Id: { not: null } },
      ],
    };
  }

  /**
   * 单淘汰签表的原地重算：按 (roundNo, matchNo) 对齐，只更新对阵与状态，
   * 不动场次 id、场地、时间、裁判与时长，因此排程、签到、比分关联都不会丢。
   */
  private async reconcileEliminationMatches(
    tx: Prisma.TransactionClient,
    eventId: string,
    slots: Array<{ entrantId: string | null; isBye: boolean }>,
    options: { bronze: boolean; fromRoundNo?: number },
  ) {
    const fromRoundNo = options.fromRoundNo ?? 1;
    const drafts = buildEliminationDrafts(slots, { bronze: options.bronze }).filter(
      (draft) => draft.roundNo >= fromRoundNo,
    );
    const existing = await tx.match.findMany({
      where: {
        eventId,
        roundNo: { gte: fromRoundNo, lt: SECOND_STAGE_FORMAL_ROUND_NO_BASE },
      },
      select: { id: true, roundNo: true, matchNo: true },
    });
    const plan = planMatchReconcile(existing, drafts);
    for (const update of plan.updates) {
      await tx.match.update({
        where: { id: update.id },
        data: {
          round: update.draft.round,
          side1Id: update.draft.side1Id,
          side2Id: update.draft.side2Id,
          status: update.draft.status,
          winnerSide: update.draft.winnerSide,
        },
      });
    }
    if (plan.deletes.length) await tx.match.deleteMany({ where: { id: { in: plan.deletes } } });
    if (plan.creates.length) await this.createMatchDrafts(tx, eventId, plan.creates);
  }

  /** 第二阶段 A–H 换位后重算：规划表按 matchNo 原地更新，正式场次走同一个 reconcile。 */
  private async reconcileSecondStageMatches(
    tx: Prisma.TransactionClient,
    stageId: string,
    eventId: string,
  ) {
    const stage = await tx.secondStage.findUnique({
      where: { id: stageId },
      include: { slots: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!stage) throw new NotFoundException('第二阶段不存在');

    const slotMap = new Map<SecondStageSlotCode, SecondStageEntrant>();
    for (const slot of stage.slots) {
      slotMap.set(this.normalizeSecondStageSlot(slot.slot), {
        id: slot.entrantId,
        name: slot.entrantNameSnapshot,
      });
    }
    const rankingLimit = secondStageRankingLimit(stage);
    const templates = this.secondStageMatchTemplates(slotMap, rankingLimit);
    const existing = await tx.secondStageMatch.findMany({
      where: { secondStageId: stage.id },
      orderBy: { matchNo: 'asc' },
    });
    const keep = new Set(templates.map((template) => template.matchNo));
    for (const template of templates) {
      const data = {
        roundName: template.roundName,
        area: template.area,
        slotInfo: template.slotInfo ?? null,
        side1Source: template.side1Source ?? null,
        side2Source: template.side2Source ?? null,
        side1Id: template.side1?.id ?? null,
        side2Id: template.side2?.id ?? null,
        side1NameSnapshot: template.side1?.name ?? null,
        side2NameSnapshot: template.side2?.name ?? null,
        score: null,
        status: MatchStatus.PENDING,
        winnerSide: null,
        winnerId: null,
        winnerNameSnapshot: null,
      };
      const current = existing.find((match) => match.matchNo === template.matchNo);
      if (current) await tx.secondStageMatch.update({ where: { id: current.id }, data });
      else await tx.secondStageMatch.create({ data: { secondStageId: stage.id, matchNo: template.matchNo, ...data } });
    }
    const stale = existing.filter((match) => !keep.has(match.matchNo)).map((match) => match.id);
    if (stale.length) await tx.secondStageMatch.deleteMany({ where: { id: { in: stale } } });

    await this.createSecondStageFormalMatches(tx, eventId, templates);
    await this.secondStageProgress.progress(tx, {
      secondStageId: stage.id,
      eventId,
      rankingLimit,
    });
  }

  /** 报名 id → 显示名，用于换签位可选项的文案。 */
  private async entrantNameMap(eventId: string) {
    const registrations = await this.prisma.registration.findMany({
      where: { eventId: await this.entrantScope(eventId) },
      include: { player1: true, player2: true },
    });
    return new Map(registrations.map((registration) => [registration.id, this.registrationName(registration)]));
  }

  /**
   * 抽签编排页切换小组编号方式（A、B… ↔ 1、2…）。没抽签时只保存设置，下次抽签按它生成；
   * 已抽签时把当前签表的小组直接改名：分组表、选手所在组、小组赛场次三处一起换，
   * 签表、对阵、比分、排程都不变。混编主项目连同并入单项的选手一起改。
   */
  async updateGroupNaming(
    eventId: string,
    naming: GroupNaming,
    operatorId: string,
    operatorName: string | null,
  ) {
    if (!operatorId) throw new BadRequestException('缺少操作人信息');
    const event = await this.ensureDrawEvent(eventId);
    if (this.drawFormatForEvent(event.format) === DrawFormat.single_elim) {
      throw new BadRequestException('淘汰赛抽签没有小组，不需要设置小组编号');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.event.update({ where: { id: eventId }, data: { groupNaming: naming } });
      const draw = await tx.drawBracket.findFirst({
        where: { eventItemId: eventId, isCurrent: true },
        include: { groups: { orderBy: [{ sortOrder: 'asc' }, { groupCode: 'asc' }] } },
      });
      // 按小组顺序重新编号：第 1 组 = A / 1，第 2 组 = B / 2……
      const renames = (draw?.groups ?? [])
        .map((group, index) => ({ id: group.id, from: group.groupCode, to: groupCodeFor(index, naming) }))
        .filter((item) => item.from !== item.to);
      if (!draw || !renames.length) return { event: updated, renamedGroups: 0 };

      const scope = await this.entrantScope(eventId, tx);
      // 分两步：先改成临时编号再改成最终编号。新旧编号有重叠时（如 B→A、A→B）一步改会撞名、把两组选手并到一起。
      const steps = [
        renames.map((item, index) => ({ ...item, to: `#${index}` })),
        renames.map((item, index) => ({ ...item, from: `#${index}` })),
      ];
      for (const step of steps) {
        for (const item of step) {
          await tx.drawGroup.update({ where: { id: item.id }, data: { groupCode: item.to } });
          await tx.registration.updateMany({ where: { eventId: scope, groupName: item.from }, data: { groupName: item.to } });
          await tx.match.updateMany({ where: { eventId, roundNo: 0, round: item.from }, data: { round: item.to } });
        }
      }

      await this.drawLogService.create(tx, {
        eventItemId: eventId,
        drawBracketId: draw.id,
        operationType: DrawOperationType.GROUP_NAMING,
        operatorId,
        operatorNameSnapshot: operatorName,
        beforeData: { groupNaming: event.groupNaming, groups: renames.map((item) => item.from) } as Prisma.InputJsonValue,
        afterData: { groupNaming: naming, groups: renames.map((item) => item.to) } as Prisma.InputJsonValue,
        remark: naming === GroupNaming.NUMBER ? '小组编号改为 1、2、3' : '小组编号改为 A、B、C',
      });
      return { event: updated, renamedGroups: renames.length };
    });
  }

  async freezeDraw(
    eventId: string,
    drawId: string,
    operatorId: string,
    operatorName: string | null,
  ) {
    if (!operatorId) throw new BadRequestException('缺少操作人信息');
    const draw = await this.prisma.drawBracket.findUnique({ where: { id: drawId } });
    if (!draw || draw.eventItemId !== eventId) throw new NotFoundException('签表不存在');
    if (draw.status !== DrawStatus.DRAWN) throw new ConflictException('只有已抽签状态才能冻结');
    const staleEvent = await this.ensureEvent(eventId);
    if (staleEvent.drawStale) throw new ConflictException('报名有删除或调整，签表与参赛名单不一致，请先重新抽签后再冻结');

    return this.prisma.$transaction(async (tx) => {
      const frozen = await tx.drawBracket.update({
        where: { id: drawId },
        data: {
          status: DrawStatus.FROZEN,
          frozenAt: new Date(),
          updatedBy: operatorId,
        },
      });

      await tx.event.update({
        where: { id: eventId },
        data: { drawLocked: true },
      });

      await this.drawLogService.create(tx, {
        eventItemId: eventId,
        drawBracketId: drawId,
        operationType: DrawOperationType.FREEZE,
        operatorId,
        operatorNameSnapshot: operatorName,
        beforeData: { status: draw.status } as Prisma.InputJsonValue,
        afterData: { status: DrawStatus.FROZEN } as Prisma.InputJsonValue,
      });

      return frozen;
    });
  }

  async unfreezeDraw(
    eventId: string,
    drawId: string,
    operatorId: string,
    operatorName: string | null,
  ) {
    if (!operatorId) throw new BadRequestException('缺少操作人信息');
    const draw = await this.prisma.drawBracket.findUnique({ where: { id: drawId } });
    if (!draw || draw.eventItemId !== eventId) throw new NotFoundException('签表不存在');
    if (draw.status !== DrawStatus.FROZEN) throw new ConflictException('当前签表尚未冻结');

    const event = await this.ensureEvent(eventId);
    if (event.drawPublished) {
      throw new ConflictException('对阵已发布，请先取消发布');
    }

    const lockedMatches = await this.prisma.match.count({
      where: this.lockedPlayableMatchWhere(eventId),
    });
    if (lockedMatches > 0) {
      throw new ConflictException('已有进行中或已结束比赛，暂不允许解冻签表');
    }

    return this.prisma.$transaction(async (tx) => {
      const unfrozen = await tx.drawBracket.update({
        where: { id: drawId },
        data: {
          status: DrawStatus.DRAWN,
          frozenAt: null,
          updatedBy: operatorId,
        },
      });

      await tx.event.update({
        where: { id: eventId },
        data: { drawLocked: false },
      });

      await this.drawLogService.create(tx, {
        eventItemId: eventId,
        drawBracketId: drawId,
        operationType: DrawOperationType.FREEZE,
        operatorId,
        operatorNameSnapshot: operatorName,
        beforeData: { status: draw.status } as Prisma.InputJsonValue,
        afterData: { status: DrawStatus.DRAWN } as Prisma.InputJsonValue,
        remark: 'UNFREEZE',
      });

      return unfrozen;
    });
  }

  async publishDraw(
    eventId: string,
    drawId: string,
    operatorId: string,
    operatorName: string | null,
  ) {
    if (!operatorId) throw new BadRequestException('缺少操作人信息');
    const event = await this.ensureEvent(eventId);
    if (event.drawPublished) throw new ConflictException('对阵已发布，无需重复发布');
    if (event.drawStale) throw new ConflictException('报名有删除或调整，签表与参赛名单不一致，请先重新抽签后再发布');
    const draw = await this.prisma.drawBracket.findUnique({ where: { id: drawId } });
    if (!draw || draw.eventItemId !== eventId) throw new NotFoundException('签表不存在');
    if (draw.status !== DrawStatus.DRAWN && draw.status !== DrawStatus.FROZEN) {
      throw new ConflictException('只有已抽签或已冻结的签表才能发布');
    }

    return this.prisma.$transaction(async (tx) => {
      const published = await tx.drawBracket.update({
        where: { id: drawId },
        data: {
          status: DrawStatus.FROZEN,
          frozenAt: draw.frozenAt ?? new Date(),
          updatedBy: operatorId,
        },
      });

      await tx.event.update({
        where: { id: eventId },
        data: { drawPublished: true, drawLocked: true },
      });

      await this.drawLogService.create(tx, {
        eventItemId: eventId,
        drawBracketId: drawId,
        operationType: DrawOperationType.FREEZE,
        operatorId,
        operatorNameSnapshot: operatorName,
        beforeData: { status: draw.status } as Prisma.InputJsonValue,
        afterData: { status: DrawStatus.FROZEN, drawPublished: true } as Prisma.InputJsonValue,
        remark: 'PUBLISH',
      });

      return published;
    });
  }

  async unpublishDraw(
    eventId: string,
    drawId: string,
    operatorId: string,
    operatorName: string | null,
  ) {
    if (!operatorId) throw new BadRequestException('缺少操作人信息');
    const event = await this.ensureEvent(eventId);
    if (!event.drawPublished) throw new ConflictException('对阵尚未发布，无需取消发布');
    const draw = await this.prisma.drawBracket.findUnique({ where: { id: drawId } });
    if (!draw || draw.eventItemId !== eventId) throw new NotFoundException('签表不存在');

    const lockedMatches = await this.prisma.match.count({
      where: this.lockedPlayableMatchWhere(eventId),
    });
    if (lockedMatches > 0) {
      throw new ConflictException('已有进行中或已结束的比赛，暂不允许取消发布');
    }

    return this.prisma.$transaction(async (tx) => {
      const unpublished = await tx.drawBracket.update({
        where: { id: drawId },
        data: { status: DrawStatus.DRAWN, frozenAt: null, updatedBy: operatorId },
      });

      await tx.event.update({
        where: { id: eventId },
        data: {
          drawPublished: false,
          drawLocked: false,
        },
      });

      await this.drawLogService.create(tx, {
        eventItemId: eventId,
        drawBracketId: drawId,
        operationType: DrawOperationType.FREEZE,
        operatorId,
        operatorNameSnapshot: operatorName,
        beforeData: { status: draw.status } as Prisma.InputJsonValue,
        afterData: { status: DrawStatus.DRAWN, drawPublished: false, drawLocked: false } as Prisma.InputJsonValue,
        remark: 'UNPUBLISH',
      });

      return unpublished;
    });
  }

  async redraw(
    eventId: string,
    confirm: boolean,
    operatorId: string,
    operatorName: string | null,
    operatorRole: Role,
    canRedrawPublished = false,
  ) {
    if (!confirm) throw new BadRequestException('重新抽签需要确认');
    const event = await this.ensureEvent(eventId);
    const current = await this.prisma.drawBracket.findFirst({
      where: { eventItemId: eventId, isCurrent: true },
      orderBy: { version: 'desc' },
    });
    if (!current) throw new NotFoundException('当前单项还没有可重抽的签表');

    if (
      event.drawPublished &&
      operatorRole !== Role.ROOT && !canRedrawPublished
    ) {
      throw new ForbiddenException('对阵已发布，普通管理员请提交重抽申请，由超级管理员审批');
    }

    const next = await this.executeDraw(eventId, operatorId, operatorName, true);
    await this.prisma.drawOperationLog.create({
      data: {
        eventItemId: eventId,
        drawBracketId: next.id,
        operationType: DrawOperationType.REDRAW,
        operatorId,
        operatorNameSnapshot: operatorName,
        beforeData: {
          previousDrawId: current.id,
          previousVersion: current.version,
        },
        afterData: {
          currentDrawId: next.id,
          currentVersion: next.version,
        },
      },
    });
    return next;
  }

  /**
   * 取消整个赛事下「全部单项」的抽签编排,回到未抽签状态:
   * 删除所有已生成的比赛(级联清空比分)、第二阶段(级联签位/对阵/名次)、
   * 签表(级联 DrawSlot / DrawOperationLog / DrawGroup),撤销待审批的重抽申请,
   * 并复位每个单项的抽签状态标志。报名名单与种子设置(编排的输入)予以保留,可直接重新抽签。
   */
  async clearAllDraws(
    tournamentId: string,
    operatorId: string,
    operatorName: string | null,
  ) {
    if (!operatorId) throw new BadRequestException('缺少操作人信息');
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { id: true },
    });
    if (!tournament) throw new NotFoundException('赛事不存在');

    const events = await this.prisma.event.findMany({
      where: { tournamentId },
      select: { id: true },
    });
    const eventIds = events.map((event) => event.id);
    if (!eventIds.length) return { cleared: 0 };

    await this.prisma.$transaction(async (tx) => {
      // 单项正式比赛(组内循环 / 淘汰 / 第二阶段正式赛),删除时级联清空 Game 比分。
      await tx.match.deleteMany({ where: { eventId: { in: eventIds } } });
      // 第二阶段实体,级联删除其签位 / 对阵 / 名次。
      await tx.secondStage.deleteMany({ where: { eventId: { in: eventIds } } });
      // 签表,级联删除 DrawSlot / DrawOperationLog / DrawGroup。
      await tx.drawBracket.deleteMany({ where: { eventItemId: { in: eventIds } } });
      // 签表已不存在,待审批的重抽申请失去意义,统一置为已取消。
      await tx.drawRedrawRequest.updateMany({
        where: { eventItemId: { in: eventIds }, status: DrawRedrawRequestStatus.PENDING },
        data: {
          status: DrawRedrawRequestStatus.CANCELLED,
          decisionRemark: '赛事已取消全部编排,申请自动作废',
        },
      });
      // 复位单项抽签状态:回到未锁定、未发布、未生成。
      await tx.event.updateMany({
        where: { id: { in: eventIds } },
        data: { drawLocked: false, drawPublished: false, drawGeneratedAt: null, drawStale: false },
      });
    });

    return { cleared: eventIds.length };
  }

  async createRedrawRequest(
    eventId: string,
    reason: string | undefined,
    requesterId: string,
    requesterName: string | null,
  ) {
    if (!requesterId) throw new BadRequestException('缺少操作人信息');
    const event = await this.ensureEvent(eventId);
    if (!event.drawPublished) {
      throw new ConflictException('对阵尚未发布，可直接重新抽签，无需申请');
    }

    const current = await this.prisma.drawBracket.findFirst({
      where: { eventItemId: eventId, isCurrent: true },
      orderBy: { version: 'desc' },
    });
    if (!current) throw new NotFoundException('当前单项还没有可重抽的签表');

    const pending = await this.prisma.drawRedrawRequest.findFirst({
      where: { eventItemId: eventId, status: DrawRedrawRequestStatus.PENDING },
    });
    if (pending) {
      throw new ConflictException('该单项已存在待审批的重抽申请');
    }

    return this.prisma.drawRedrawRequest.create({
      data: {
        eventItemId: eventId,
        drawBracketId: current.id,
        status: DrawRedrawRequestStatus.PENDING,
        reason: reason?.trim() || null,
        requesterId,
        requesterNameSnapshot: requesterName,
      },
    });
  }

  async listRedrawRequests(query: { eventId?: string; status?: string }, actor?: AuthActor) {
    const where: Prisma.DrawRedrawRequestWhereInput = { event: { tournament: tournamentScope(actor) } };
    if (query.eventId) where.eventItemId = query.eventId;
    if (query.status) {
      const statuses = query.status
        .split(',')
        .map((item) => item.trim())
        .filter((item): item is DrawRedrawRequestStatus =>
          (Object.values(DrawRedrawRequestStatus) as string[]).includes(item),
        );
      if (statuses.length === 1) where.status = statuses[0];
      else if (statuses.length > 1) where.status = { in: statuses };
    }

    return this.prisma.drawRedrawRequest.findMany({
      where,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      include: {
        event: {
          select: { id: true, type: true, tournamentId: true },
        },
      },
    });
  }

  async approveRedrawRequest(
    requestId: string,
    operatorId: string,
    operatorName: string | null,
  ) {
    if (!operatorId) throw new BadRequestException('缺少操作人信息');
    const request = await this.prisma.drawRedrawRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) throw new NotFoundException('申请不存在');
    if (request.status !== DrawRedrawRequestStatus.PENDING) {
      throw new ConflictException('该申请已处理，无法重复审批');
    }

    const next = await this.executeDraw(
      request.eventItemId,
      operatorId,
      operatorName,
      true,
    );

    await this.prisma.$transaction([
      this.prisma.drawRedrawRequest.update({
        where: { id: requestId },
        data: {
          status: DrawRedrawRequestStatus.APPROVED,
          decidedById: operatorId,
          decidedByNameSnapshot: operatorName,
          decidedAt: new Date(),
          drawBracketId: next.id,
        },
      }),
      this.prisma.drawOperationLog.create({
        data: {
          eventItemId: request.eventItemId,
          drawBracketId: next.id,
          operationType: DrawOperationType.REDRAW,
          operatorId,
          operatorNameSnapshot: operatorName,
          beforeData: {
            requestId: request.id,
            requesterId: request.requesterId,
            requesterName: request.requesterNameSnapshot,
            reason: request.reason,
          } as Prisma.InputJsonValue,
          afterData: {
            currentDrawId: next.id,
            currentVersion: next.version,
          } as Prisma.InputJsonValue,
          remark: 'REDRAW_APPROVED',
        },
      }),
    ]);

    return {
      request: await this.prisma.drawRedrawRequest.findUniqueOrThrow({
        where: { id: requestId },
      }),
      draw: next,
    };
  }

  async rejectRedrawRequest(
    requestId: string,
    reason: string | undefined,
    operatorId: string,
    operatorName: string | null,
  ) {
    if (!operatorId) throw new BadRequestException('缺少操作人信息');
    const request = await this.prisma.drawRedrawRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) throw new NotFoundException('申请不存在');
    if (request.status !== DrawRedrawRequestStatus.PENDING) {
      throw new ConflictException('该申请已处理，无法重复审批');
    }

    return this.prisma.drawRedrawRequest.update({
      where: { id: requestId },
      data: {
        status: DrawRedrawRequestStatus.REJECTED,
        decidedById: operatorId,
        decidedByNameSnapshot: operatorName,
        decisionRemark: reason?.trim() || null,
        decidedAt: new Date(),
      },
    });
  }

  async cancelRedrawRequest(requestId: string, operatorId: string) {
    if (!operatorId) throw new BadRequestException('缺少操作人信息');
    const request = await this.prisma.drawRedrawRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) throw new NotFoundException('申请不存在');
    if (request.status !== DrawRedrawRequestStatus.PENDING) {
      throw new ConflictException('该申请已处理，无法撤回');
    }
    if (request.requesterId !== operatorId) {
      throw new ForbiddenException('只能撤回自己提交的申请');
    }
    return this.prisma.drawRedrawRequest.update({
      where: { id: requestId },
      data: { status: DrawRedrawRequestStatus.CANCELLED },
    });
  }

  async getDrawHistory(eventId: string) {
    await this.ensureEvent(eventId);
    return this.prisma.drawBracket.findMany({
      where: { eventItemId: eventId },
      orderBy: { version: 'desc' },
    });
  }

  async getDrawLogs(eventId: string, query: GetDrawLogsQueryDto) {
    await this.ensureEvent(eventId);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = {
      eventItemId: eventId,
      ...(query.drawId ? { drawBracketId: query.drawId } : {}),
    };

    const [list, total] = await Promise.all([
      this.prisma.drawOperationLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.drawOperationLog.count({ where }),
    ]);

    return { list, total, page, pageSize };
  }

  async getBracket(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { tournament: true },
    });
    if (!event) throw new NotFoundException('单项不存在');

    const registrations = await this.prisma.registration.findMany({
      where: { eventId: await this.entrantScope(eventId), status: RegistrationStatus.APPROVED },
      include: { player1: true, player2: true },
      orderBy: [{ isSeed: 'desc' }, { seedRank: 'asc' }, { createdAt: 'asc' }],
    });
    const registrationMap = new Map(registrations.map((item) => [item.id, item]));
    const matches = await this.prisma.match.findMany({
      where: { eventId },
      include: { games: { orderBy: { gameNo: 'asc' } }, venue: { select: { name: true } } },
      orderBy: [{ roundNo: 'asc' }, { matchNo: 'asc' }],
    });
    const sortedMatches = [...matches].sort((a, b) => this.bracketMatchCompare(a, b));
    const currentDraw = await this.prisma.drawBracket.findFirst({
      where: { eventItemId: eventId, isCurrent: true },
      orderBy: { version: 'desc' },
    });
    const secondStage = await this.prisma.secondStage.findUnique({
      where: { eventId },
      include: {
        slots: { orderBy: { sortOrder: 'asc' } },
        matches: { orderBy: { matchNo: 'asc' } },
        rankings: { orderBy: { rank: 'asc' } },
      },
    });

    const hydrateMatch = (match: (typeof matches)[number]) => ({
      ...match,
      side1: match.side1Id ? registrationMap.get(match.side1Id) ?? null : null,
      side2: match.side2Id ? registrationMap.get(match.side2Id) ?? null : null,
    });

    // 预排的淘汰赛空位 / 清空成绩后留下的空骨架（双方都空）不当作已生成的淘汰赛：
    // 仍显示出线前骨架「X组第N名」（时间场地在场地排程页看）。
    const knockoutPlaceholders =
      event.format === Format.GROUP_PLUS_KNOCKOUT_STD && knockoutPlaceholdersOnly(sortedMatches);
    const rounds = sortedMatches
      .filter((match) => match.roundNo > 0 && !isSecondStageFormalRoundNo(match.roundNo))
      .filter(match => !isKnockoutPlacementPlayoff(match.round))
      .filter(() => !knockoutPlaceholders)
      .reduce<Array<{ roundNo: number; round: string; matches: ReturnType<typeof hydrateMatch>[] }>>(
        (acc, match) => {
          let round = acc.find((item) => item.roundNo === match.roundNo);
          if (!round) {
            round = { roundNo: match.roundNo, round: match.round, matches: [] };
            acc.push(round);
          }
          round.matches.push(hydrateMatch(match));
          return acc;
        },
        [],
      );

    const groups = registrations
      .filter((registration) => registration.groupName)
      .reduce<
        Array<{
          name: string;
          registrations: RegistrationWithPlayers[];
          matches: ReturnType<typeof hydrateMatch>[];
        }>
      >((acc, registration) => {
        const name = registration.groupName!;
        let group = acc.find((item) => item.name === name);
        if (!group) {
          group = { name, registrations: [], matches: [] };
          acc.push(group);
        }
        group.registrations.push(registration);
        return acc;
      }, []);

    for (const group of groups) {
      group.matches = sortedMatches
        .filter((match) => match.round === group.name)
        .map((match) => hydrateMatch(match));
    }
    groups.sort((a, b) => this.groupNameCompare(a.name, b.name));

    // 第二阶段的正式比赛（roundNo≥100）单独返回——它们不属于一阶段对阵图，但
    // 必须出现在管理端记分页才能被分配裁判、正常记分（记分后会同步回 second_stage_match，
    // 前台对阵表与抽签编排随之显示结果）。
    const secondStageFormalMatches = sortedMatches
      .filter((match) => isSecondStageFormalRoundNo(match.roundNo))
      .map((match) => hydrateMatch(match));

    // GROUP_PLUS_KNOCKOUT_STD 出线超过 A-H 的 8 个签位：小组赛全部完赛后自动生成单淘汰
    //（scoring.fillGroupKnockoutIfReady）。生成前按 各组人数×出线数 预画对阵骨架，签位用
    //「X组第N名」占位，排法与实际生成相同，出线后由真实签表无缝替换。
    // 出线不超过 8 人走 A-H 第二阶段，第二阶段区块有自己的对阵预览，这里不画骨架。
    const groupSizes = groupSizesFromGroupMatches(matches);
    const knockoutSkeleton =
      rounds.length === 0 &&
      event.format === Format.GROUP_PLUS_KNOCKOUT_STD &&
      this.standardQualifierTotal(
        [...groupSizes.values()],
        event.qualifiersPerGroup,
      ) > SECOND_STAGE_SLOTS.length
        ? buildKnockoutSkeleton(
            groups.map((group) => group.name),
            event.qualifiersPerGroup ?? 2,
            groupSizes,
          )
        : null;
    const secondStageEntrants =
      event.format === Format.GROUP_PLUS_KNOCKOUT_STD
        ? await this.getStandardSecondStageEntrants(eventId, event.qualifiersPerGroup ?? 2)
        : [];

    // 当前报名人数下的分组预览：抽签编排页用来显示「几组、每组几人、出线几人」，
    // 以及重新抽签会带来什么变化。与真正抽签调用同一份计划逻辑。
    const groupPlan = this.groupPlanFor(
      event,
      this.drawFormatForEvent(event.format),
      registrations.length,
    );
    // 标准2023 出线超过 8 人：不走 A-H 第二阶段（不返回第二阶段预览），抽签编排页改为提示自动生成淘汰赛。
    // 已确认过的第二阶段照常返回。
    const standardQualifiers = this.standardQualifierTotal(
      [...groupSizes.values()],
      event.qualifiersPerGroup,
      groupPlan?.qualifiersTotal,
    );
    const autoKnockout =
      event.format === Format.GROUP_PLUS_KNOCKOUT_STD &&
      !secondStage &&
      standardQualifiers > SECOND_STAGE_SLOTS.length
        ? { qualifiers: standardQualifiers }
        : null;

    // 当前签表与「按现在的分组设置重新抽签」不一致时给出对比，抽签编排页据此显示黄色警告。
    const executeLog = currentDraw
      ? await this.prisma.drawOperationLog.findFirst({
          where: { drawBracketId: currentDraw.id, operationType: DrawOperationType.EXECUTE },
          orderBy: { createdAt: 'desc' },
          select: { afterData: true },
        })
      : null;
    const groupPlanDriftView = currentDraw
      ? groupPlanDrift({
          plan: groupPlan,
          currentSizes: groups.map((group) => group.registrations.length),
          event,
          drawnWith: readDrawnGroupSettings(executeLog?.afterData),
          playedMatches: matches.filter(
            (match) => match.status === MatchStatus.COMPLETED || match.status === MatchStatus.LIVE,
          ).length,
        })
      : null;

    const placementPlayoff = knockoutPlacementPlayoffView(sortedMatches, id => {
      const registration = registrationMap.get(id);
      return registration ? this.registrationName(registration) : '待定';
    }, event.rankingLimit === 7 ? 7 : 8);
    const officialView = autoKnockout || placementPlayoff ? null : this.secondStageView(
      secondStage,
      event.format,
      new Map(registrations.map((registration) => [registration.id, registration])),
      secondStageEntrants,
      event.qualifiersPerGroup ?? 2,
      groups.map((group) => group.name),
    );
    const scheduledStageMatches = new Map(secondStageFormalMatches.map(match => [match.matchNo, match]));
    return {
      event,
      currentDraw,
      registrations,
      rounds,
      groups,
      groupPlan,
      groupPlanDrift: groupPlanDriftView,
      knockoutSkeleton,
      secondStage: placementPlayoff
        ? { ...placementPlayoff, eligibleEntrants: this.secondStageEligibleView(secondStageEntrants) }
        : officialView && {
          ...officialView,
          matches: officialView.matches.map((match: { matchNo: number }) => {
            const scheduled = scheduledStageMatches.get(match.matchNo);
            return {
              ...match,
              scheduledAt: scheduled?.scheduledAt?.toISOString() ?? null,
              venueName: scheduled?.venue?.name ?? null,
            };
          }),
        },
      secondStageFormalMatches,
      autoKnockout: placementPlayoff ? null : autoKnockout,
    };
  }

  async getSecondStage(eventId: string) {
    const event = await this.ensureEvent(eventId);
    const [stage, registrations, groupMatches] = await Promise.all([
      this.prisma.secondStage.findUnique({
        where: { eventId },
        include: {
          slots: { orderBy: { sortOrder: 'asc' } },
          matches: { orderBy: { matchNo: 'asc' } },
          rankings: { orderBy: { rank: 'asc' } },
        },
      }),
      this.prisma.registration.findMany({
        where: { eventId: await this.entrantScope(eventId), status: RegistrationStatus.APPROVED },
        include: { player1: true, player2: true },
      }),
      this.prisma.match.findMany({
        where: { eventId, roundNo: 0 },
        select: { roundNo: true, round: true, side1Id: true, side2Id: true },
      }),
    ]);
    // 标准2023 出线超过 8 人：小组赛结束后自动生成淘汰赛，没有 A-H 第二阶段（已确认过的照常返回）。
    if (
      !stage &&
      this.standardAutoKnockoutTotal(
        event,
        groupMatches,
        registrations.length,
      ) !== null
    ) {
      return null;
    }
    const groupCodes = [
      ...new Set(
        registrations
          .map((registration) => registration.groupName)
          .filter((name): name is string => Boolean(name)),
      ),
    ];
    return this.secondStageView(
      stage,
      event.format,
      new Map(registrations.map((registration) => [registration.id, registration])),
      event.format === Format.GROUP_PLUS_KNOCKOUT_STD
        ? await this.getStandardSecondStageEntrants(eventId, event.qualifiersPerGroup ?? 2)
        : [],
      event.qualifiersPerGroup ?? 2,
      groupCodes,
    );
  }

  async confirmSecondStage(
    eventId: string,
    dto: ConfirmSecondStageDto,
    operatorId: string,
    operatorName: string | null,
  ) {
    if (!operatorId) throw new BadRequestException('缺少操作人信息');
    const event = await this.ensureEvent(eventId);
    const isManualRankingFormat = event.format === Format.SINGLE_ELIMINATION_PLUS_GROUP_RANKING;
    const isStandard2023Format = event.format === Format.GROUP_PLUS_KNOCKOUT_STD;
    if (!isManualRankingFormat && !isStandard2023Format) {
      throw new BadRequestException('当前单项不支持第二阶段 A-H 签位编排');
    }
    if (isStandard2023Format) {
      // 出线超过 8 人时小组赛结束后自动生成淘汰赛。若在这里确认了 A-H，第二阶段场次会挡住自动生成。
      const scope = await this.entrantScope(eventId);
      const [groupMatches, approvedCount] = await Promise.all([
        this.prisma.match.findMany({
          where: { eventId, roundNo: 0 },
          select: { roundNo: true, round: true, side1Id: true, side2Id: true },
        }),
        this.prisma.registration.count({
          where: { eventId: scope, status: RegistrationStatus.APPROVED },
        }),
      ]);
      const autoKnockoutTotal = this.standardAutoKnockoutTotal(
        event,
        groupMatches,
        approvedCount,
      );
      if (autoKnockoutTotal !== null) {
        throw new BadRequestException(
          `本项目小组赛出线 ${autoKnockoutTotal} 人，超过 A-H 的 8 个签位：小组赛全部结束后系统会自动生成淘汰赛，不使用 A-H 第二阶段`,
        );
      }
    }

    // A-H 签位允许留空（轮空）：留空/未选的签位无选手，对应初始赛由对手不战而胜。
    const seenSlots = new Set<SecondStageSlotCode>();
    const normalizedSlots = dto.slots.map((item) => {
      const slot = this.normalizeSecondStageSlot(item.slot);
      if (seenSlots.has(slot)) {
        throw new BadRequestException('A-H 签位不能重复');
      }
      seenSlots.add(slot);
      const entrantId = item.entrantId?.trim() ? item.entrantId.trim() : null;
      return { slot, entrantId };
    });

    let assigned = normalizedSlots.filter(
      (item): item is { slot: SecondStageSlotCode; entrantId: string } => Boolean(item.entrantId),
    );

    let standardEntrants: StandardSecondStageEntrant[] = [];
    if (isStandard2023Format) {
      standardEntrants = await this.getStandardSecondStageEntrants(eventId, event.qualifiersPerGroup ?? 2);
      if (standardEntrants.length >= 2) {
        // 官方出线名次已产生（小组赛全部完赛）：签位只能选出线队伍，未指定部分按官方种子序自动补齐。
        if (standardEntrants.length > SECOND_STAGE_SLOTS.length) {
          throw new BadRequestException('A-H 第二阶段最多支持 8 名出线队伍，请调整每组出线数或使用普通淘汰签表');
        }
        const eligibleIds = new Set(standardEntrants.map((entrant) => entrant.id));
        const invalid = assigned.find((item) => !eligibleIds.has(item.entrantId));
        if (invalid) {
          throw new BadRequestException('标准2023第二阶段签位只能选择已出线队伍');
        }

        const usedIds = new Set(assigned.map((item) => item.entrantId));
        const occupiedSlots = new Set(assigned.map((item) => item.slot));
        const autoAssigned: Array<{ slot: SecondStageSlotCode; entrantId: string }> = [];
        const defaultAssignments = this.buildStandardSecondStageDefaultAssignments(
          standardEntrants,
          event.qualifiersPerGroup ?? 2,
        );

        for (const item of defaultAssignments) {
          if (usedIds.has(item.entrantId) || occupiedSlots.has(item.slot)) continue;
          autoAssigned.push(item);
          usedIds.add(item.entrantId);
          occupiedSlots.add(item.slot);
        }

        const remaining = standardEntrants.filter((entrant) => !usedIds.has(entrant.id));
        for (const entrant of remaining) {
          const slot = SECOND_STAGE_SLOTS.find((candidate) => !occupiedSlots.has(candidate));
          if (!slot) {
            throw new BadRequestException('A-H 签位不足以容纳全部出线队伍');
          }
          autoAssigned.push({ slot, entrantId: entrant.id });
          usedIds.add(entrant.id);
          occupiedSlots.add(slot);
        }
        assigned = [...assigned, ...autoAssigned];
      } else if (assigned.length < 2) {
        // 小组赛尚未全部完赛、官方出线名次未产生：退回手动指定，至少需要 2 名（任意已通过报名均可入位）。
        throw new BadRequestException('至少需要指定 2 名选手，其余签位可留空（轮空）');
      }
    } else if (assigned.length < 2) {
      throw new BadRequestException('至少需要指定 2 名选手，其余签位可留空（轮空）');
    }

    const entrantIds = assigned.map((item) => item.entrantId);
    if (new Set(entrantIds).size !== entrantIds.length) {
      throw new BadRequestException('A-H 签位不能重复选择同一名选手');
    }

    const entrantEvents = await this.entrantScope(eventId);
    const registrations = isStandard2023Format
      ? await this.prisma.registration.findMany({
          where: { eventId: entrantEvents, id: { in: entrantIds }, status: RegistrationStatus.APPROVED },
          include: { player1: true, player2: true },
        })
      : await this.prisma.registration.findMany({
          where: {
            eventId: entrantEvents,
            id: { in: entrantIds },
            status: RegistrationStatus.APPROVED,
          },
          include: { player1: true, player2: true },
        });
    if (registrations.length !== entrantIds.length) {
      throw new BadRequestException('签位选手必须来自当前单项已通过报名名单');
    }
    const registrationMap = new Map(registrations.map((registration) => [registration.id, registration]));
    const slotMap = new Map<SecondStageSlotCode, SecondStageEntrant>();
    for (const item of assigned) {
      const registration = registrationMap.get(item.entrantId);
      if (!registration) continue;
      slotMap.set(item.slot, {
        id: registration.id,
        // 优先用队伍名称（双打队伍名），无则回退到选手名；A-H 签位/对阵表统一显示队伍名称。
        name: registration.teamName?.trim() || this.registrationName(registration),
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM Event WHERE id = ${eventId} FOR UPDATE`;
      const rankingLimit = secondStageRankingLimit(dto);
      const matchTemplates = this.secondStageMatchTemplates(slotMap, rankingLimit);
      const phaseStart = isStandard2023Format ? 1 : SECOND_STAGE_FORMAL_ROUND_NO_BASE;
      const previousStage = await tx.secondStage.findUnique({ where: { eventId } });
      const started = await tx.match.findFirst({
        where: { ...this.lockedPlayableMatchWhere(eventId), roundNo: { gte: phaseStart } },
        select: { id: true },
      });
      if (started) throw new ConflictException('第二阶段已有比赛开赛或录入成绩，无法重新生成对阵');
      const retainedMatches = previousStage
        ? await tx.match.findMany({
          where: { eventId, OR: matchTemplates.map(({ matchNo }) => ({ matchNo, roundNo: secondStageFormalRoundNo(matchNo) })) },
          select: { id: true },
        })
        : [];
      await tx.secondStage.deleteMany({ where: { eventId } });
      const stage = await tx.secondStage.create({
        data: {
          eventId,
          status: SecondStageStatus.CONFIRMED,
          mode: SecondStageMode.MANUAL_BY_REFEREE,
          rankingMode: rankingLimit <= 6 ? SecondStageRankingMode.TOP_6 : SecondStageRankingMode.TOP_8,
          rankingLimit: dto.rankingLimit ?? null,
          confirmedAt: new Date(),
          createdBy: operatorId,
          updatedBy: operatorName ?? operatorId,
        },
      });

      await tx.secondStageSlot.createMany({
        data: SECOND_STAGE_SLOTS.map((slot, index) => {
          const entrant = slotMap.get(slot);
          return {
            secondStageId: stage.id,
            slot,
            sortOrder: index + 1,
            entrantId: entrant?.id ?? null,
            entrantNameSnapshot: entrant?.name ?? null,
          };
        }),
      });

      await tx.secondStageMatch.createMany({
        data: matchTemplates.map((match) => ({
          secondStageId: stage.id,
          matchNo: match.matchNo,
          roundName: match.roundName,
          area: match.area,
          slotInfo: match.slotInfo ?? null,
          side1Source: match.side1Source ?? null,
          side2Source: match.side2Source ?? null,
          side1Id: match.side1?.id ?? null,
          side2Id: match.side2?.id ?? null,
          side1NameSnapshot: match.side1?.name ?? null,
          side2NameSnapshot: match.side2?.name ?? null,
          status: MatchStatus.PENDING,
        })),
      });
      await tx.match.deleteMany({
        where: {
          eventId,
          roundNo: {
            gte: phaseStart,
          },
          ...(retainedMatches.length ? { id: { notIn: retainedMatches.map(match => match.id) } } : {}),
        },
      });
      await this.createSecondStageFormalMatches(tx, eventId, matchTemplates);

      // 解析轮空：一侧空一侧有人 → 不战而胜并向下级联；双方皆空 → 标记取消。
      // planning 与正式赛两表一并更新。无轮空时为幂等空操作。
      await this.secondStageProgress.progress(tx, {
        secondStageId: stage.id,
        eventId,
        rankingLimit,
      });
    });

    return this.getSecondStage(eventId);
  }

  private normalizeSecondStageSlot(slot: string): SecondStageSlotCode {
    const normalized = String(slot).trim().toUpperCase();
    if ((SECOND_STAGE_SLOTS as readonly string[]).includes(normalized)) {
      return normalized as SecondStageSlotCode;
    }
    throw new BadRequestException('第二阶段签位必须为 A-H');
  }

  private secondStageMatchTemplates(
    slotMap: Map<SecondStageSlotCode, SecondStageEntrant>,
    rankingLimit: number,
  ): SecondStageMatchTemplate[] {
    const slot = (code: SecondStageSlotCode) => slotMap.get(code) ?? { id: null, name: null };
    const lowerArea = rankingLimit >= 7 ? '5-8名争夺区' : '5-6名争夺区';
    const lowerRound = rankingLimit >= 7 ? '5-8名半决赛' : '5-6名资格赛';
    const templates: SecondStageMatchTemplate[] = [
      {
        matchNo: 1,
        roundName: '前8初始赛',
        area: '前8初始赛',
        slotInfo: 'A vs B',
        side1Source: 'A',
        side2Source: 'B',
        side1: slot('A'),
        side2: slot('B'),
      },
      {
        matchNo: 2,
        roundName: '前8初始赛',
        area: '前8初始赛',
        slotInfo: 'C vs D',
        side1Source: 'C',
        side2Source: 'D',
        side1: slot('C'),
        side2: slot('D'),
      },
      {
        matchNo: 3,
        roundName: '前8初始赛',
        area: '前8初始赛',
        slotInfo: 'E vs F',
        side1Source: 'E',
        side2Source: 'F',
        side1: slot('E'),
        side2: slot('F'),
      },
      {
        matchNo: 4,
        roundName: '前8初始赛',
        area: '前8初始赛',
        slotInfo: 'G vs H',
        side1Source: 'G',
        side2Source: 'H',
        side1: slot('G'),
        side2: slot('H'),
      },
      {
        matchNo: 5,
        roundName: '1-4名半决赛',
        area: '1-4名争夺区',
        side1Source: '第1场胜者',
        side2Source: '第2场胜者',
      },
      {
        matchNo: 6,
        roundName: '1-4名半决赛',
        area: '1-4名争夺区',
        side1Source: '第3场胜者',
        side2Source: '第4场胜者',
      },
      {
        matchNo: 7,
        roundName: '决赛',
        area: '1-4名争夺区',
        side1Source: '第5场胜者',
        side2Source: '第6场胜者',
      },
      {
        matchNo: 8,
        roundName: '三四名决赛',
        area: '1-4名争夺区',
        side1Source: '第5场负者',
        side2Source: '第6场负者',
      },
      {
        matchNo: 9,
        roundName: lowerRound,
        area: lowerArea,
        side1Source: '第1场负者',
        side2Source: '第2场负者',
      },
      {
        matchNo: 10,
        roundName: lowerRound,
        area: lowerArea,
        side1Source: '第3场负者',
        side2Source: '第4场负者',
      },
      {
        matchNo: 11,
        roundName: '五六名决赛',
        area: lowerArea,
        side1Source: '第9场胜者',
        side2Source: '第10场胜者',
      },
      {
        matchNo: 12,
        roundName: '七八名决赛',
        area: '5-8名争夺区',
        side1Source: '第9场负者',
        side2Source: '第10场负者',
      },
    ];

    return templates.filter(({ matchNo }) => includesSecondStageMatch(matchNo, rankingLimit));
  }

  private secondStageView(
    stage: any | null,
    eventFormat?: Format,
    registrationMap: Map<string, RegistrationWithPlayers> = new Map(),
    standardEntrants: StandardSecondStageEntrant[] = [],
    qualifiersPerGroup: number = 2,
    groupCodes: string[] = [],
  ) {
    // 每个 A-H 签位归属「X组第N名」（官方交叉序）：让抽签编排页直接标出归属，
    // 小组赛未完赛时也能看到结构；STD 赛制专用，其它赛制为空。
    const slotSourceLabels =
      eventFormat === Format.GROUP_PLUS_KNOCKOUT_STD
        ? this.buildStandardSecondStageSlotLabels(groupCodes, qualifiersPerGroup)
        : new Map<SecondStageSlotCode, string>();
    const sourceLabelOf = (slot: SecondStageSlotCode) => slotSourceLabels.get(slot) ?? null;

    if (!stage) {
      if (!this.supportsSecondStageBracket(eventFormat)) return null;
      const rankingMode = SecondStageRankingMode.TOP_8;
      const rankingLimit = SECOND_STAGE_MAX_RANK;

      // 标准2023「每组出线 ≥ 2」小组赛全部完赛后，按官方种子序（相邻两组交叉：
      // A1-B2 / A2-B1 / …）把出线队伍预排进 A-H 签位，让抽签编排页打开即看到默认对阵，
      // 避免管理员每次都得手动重排或先点确认才能看到。每组只取第一(q=1)是随机排入，
      // 没有固定交叉结构，保持原行为（待定，确认时随机补齐）。非 STD 同样回退「待定」。
      const isStdReady =
        eventFormat === Format.GROUP_PLUS_KNOCKOUT_STD &&
        (qualifiersPerGroup ?? 2) >= 2 &&
        standardEntrants.length >= 2;
      const defaultAssignments = isStdReady
        ? this.buildStandardSecondStageDefaultAssignments(standardEntrants, qualifiersPerGroup)
        : [];
      const entrantById = new Map(standardEntrants.map((entrant) => [entrant.id, entrant]));
      const slotEntrantMap = new Map<SecondStageSlotCode, StandardSecondStageEntrant>();
      for (const { slot, entrantId } of defaultAssignments) {
        const entrant = entrantById.get(entrantId);
        if (entrant) slotEntrantMap.set(slot, entrant);
      }
      const templateSlotMap = new Map<SecondStageSlotCode, SecondStageEntrant>();
      for (const slot of SECOND_STAGE_SLOTS) {
        const entrant = slotEntrantMap.get(slot);
        // 已知出线队伍则填真名，否则用「X组第N名」占位，让对阵预览也显示归属。
        templateSlotMap.set(slot, {
          id: entrant?.id ?? null,
          name: entrant?.name ?? sourceLabelOf(slot),
        });
      }
      const previewMatches = this.secondStageMatchTemplates(templateSlotMap, rankingLimit);
      const membersById = (id: string | null | undefined) =>
        id ? entrantById.get(id)?.members ?? [] : [];

      return {
        status: SecondStageStatus.NOT_STARTED,
        secondStageStatus: SecondStageStatus.NOT_STARTED,
        mode: SecondStageMode.MANUAL_BY_REFEREE,
        secondStageMode: SecondStageMode.MANUAL_BY_REFEREE,
        modeText:
          eventFormat === Format.GROUP_PLUS_KNOCKOUT_STD ? '标准2023出线抽签' : '裁判手动指定',
        rankingMode,
        rankingLimit,
        rankingModeText: `取前${rankingLimit}名`,
        slotSourceText: isStdReady
          ? '已按官方种子序自动排布，可手动调整后确认'
          : eventFormat === Format.GROUP_PLUS_KNOCKOUT_STD
            ? '出线队伍随机或手动安排'
            : '组委会手动安排',
        qualifierReady: standardEntrants.length >= 2,
        eligibleEntrants: this.secondStageEligibleView(standardEntrants),
        slots: SECOND_STAGE_SLOTS.map((slot) => {
          const entrant = slotEntrantMap.get(slot);
          return {
            slot,
            sourceLabel: sourceLabelOf(slot),
            playerId: entrant?.id ?? null,
            playerName: entrant?.name ?? '待定',
            playerMembers: entrant?.members ?? [],
          };
        }),
        matches: previewMatches.map((match) => ({
          id: `preview-${match.matchNo}`,
          matchNo: match.matchNo,
          stageName: '第二阶段',
          roundName: match.roundName,
          area: match.area,
          slotInfo: match.slotInfo,
          source1: match.side1Source,
          source2: match.side2Source,
          player1Id: match.side1?.id ?? null,
          player2Id: match.side2?.id ?? null,
          player1Name: match.side1?.name ?? '待定',
          player2Name: match.side2?.name ?? '待定',
          player1Members: membersById(match.side1?.id),
          player2Members: membersById(match.side2?.id),
          score: null,
          winnerSide: null,
          winnerId: null,
          winnerName: null,
          status: MatchStatus.PENDING,
        })),
        rankings: [],
      };
    }

    // 卡片统一显示「队伍名称 + 队员名」：按 entrantId 实时回查报名信息，兼容旧快照。
    const membersOf = (id: string | null): string[] => {
      const reg = id ? registrationMap.get(id) : null;
      if (!reg) return [];
      return [reg.player1?.name, reg.player2?.name].filter(Boolean) as string[];
    };
    const displayName = (id: string | null, snapshot: string | null, source: string | null) => {
      const reg = id ? registrationMap.get(id) : null;
      if (reg) return reg.teamName?.trim() || membersOf(id).join(' / ') || snapshot || source || '待定';
      return snapshot ?? source ?? '待定';
    };

    const sourceLabelByEntrantId = new Map(
      standardEntrants.map((entrant) => [entrant.id, `${entrant.group}组第${entrant.rank}名`]),
    );
    const rankingMode = stage.rankingMode as SecondStageRankingMode;
    const rankingLimit = secondStageRankingLimit(stage);
    return {
      id: stage.id,
      status: stage.status,
      secondStageStatus: stage.status,
      mode: stage.mode,
      secondStageMode: stage.mode,
      modeText: '裁判手动指定',
      rankingMode,
      rankingLimit,
      rankingModeText: `取前${rankingLimit}名`,
      slotSourceText: '组委会手动安排',
      qualifierReady: standardEntrants.length >= 2,
      eligibleEntrants: this.secondStageEligibleView(standardEntrants),
      confirmedAt: stage.confirmedAt?.toISOString?.() ?? null,
      finishedAt: stage.finishedAt?.toISOString?.() ?? null,
      slots: (stage.slots ?? []).map((slot: any) => ({
        slot: slot.slot,
        sourceLabel: sourceLabelByEntrantId.get(slot.entrantId) ?? null,
        playerId: slot.entrantId,
        playerName: slot.entrantId ? displayName(slot.entrantId, slot.entrantNameSnapshot, null) : '轮空',
        playerMembers: membersOf(slot.entrantId),
      })),
      matches: (stage.matches ?? []).map((match: any) => ({
        id: match.id,
        matchNo: match.matchNo,
        stageName: '第二阶段：小组赛排位赛',
        roundName: match.roundName,
        area: match.area,
        slotInfo: match.slotInfo,
        source1: match.side1Source,
        source2: match.side2Source,
        player1Id: match.side1Id,
        player2Id: match.side2Id,
        player1Name: displayName(match.side1Id, match.side1NameSnapshot, match.side1Source),
        player2Name: displayName(match.side2Id, match.side2NameSnapshot, match.side2Source),
        player1Members: membersOf(match.side1Id),
        player2Members: membersOf(match.side2Id),
        score: match.score,
        winnerSide: match.winnerSide,
        winnerId: match.winnerId,
        winnerName: match.winnerNameSnapshot,
        status: this.publicSecondStageMatchStatus(match.status),
      })),
      rankings: (stage.rankings ?? []).map((ranking: any) => ({
        rank: ranking.rank,
        playerId: ranking.entrantId,
        playerName: ranking.entrantNameSnapshot ?? '待定',
      })),
    };
  }

  private publicSecondStageMatchStatus(status: MatchStatus) {
    return status === MatchStatus.COMPLETED ? 'FINISHED' : status;
  }

  private async ensureEvent(eventId: string) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException('单项不存在');
    return event;
  }

  /** 抽签用的单项：并入混编的单项不能自己抽签，要到主项目操作。 */
  private async ensureDrawEvent(eventId: string) {
    const event = await this.ensureEvent(eventId);
    await assertNotMixMember(this.prisma, event);
    return event;
  }

  /** 抽签的报名范围：主项目 + 并入它的混编单项（普通单项就是它自己）。 */
  private async entrantScope(eventId: string, db: Prisma.TransactionClient | PrismaService = this.prisma) {
    return { in: await mixEventIds(db, eventId) };
  }

  /** 未缴费的报名：混编主项目连同并入单项一起查，每个单项按它自己组别的收费设置。 */
  private async unpaidEntrants(event: Parameters<typeof unpaidEventEntrants>[1]) {
    const members = await this.prisma.event.findMany({ where: { mixHostId: event.id } });
    const lists = await Promise.all([event, ...members].map((item) => unpaidEventEntrants(this.prisma, item)));
    return lists.flat();
  }

  private isDoubles(type: EventType) {
    const doublesTypes: EventType[] = [
      EventType.MENS_DOUBLES,
      EventType.WOMENS_DOUBLES,
      EventType.MIXED_DOUBLES,
    ];
    return doublesTypes.includes(type);
  }

  private async validateRegistrationPlayers(
    eventType: EventType,
    player1Id: string,
    player2Id?: string | null,
  ) {
    if (player1Id === player2Id) throw new BadRequestException('同一报名中不能选择同一位选手');
    const players = await this.prisma.player.findMany({
      where: { id: { in: [player1Id, player2Id].filter(Boolean) as string[] } },
    });
    if (players.length !== (player2Id ? 2 : 1)) throw new NotFoundException('选手不存在');
    if (this.isDoubles(eventType) && !player2Id) {
      throw new BadRequestException('双打项目需要选择两位选手');
    }
    if (!this.isDoubles(eventType) && player2Id) {
      throw new BadRequestException('单打项目只能选择一位选手');
    }
  }

  private async ensureRegistrationLimit(playerId: string, currentEventId: string) {
    const count = await this.prisma.registration.count({
      where: {
        OR: [{ player1Id: playerId }, { player2Id: playerId }],
        status: RegistrationStatus.APPROVED,
        eventId: { not: currentEventId },
      },
    });
    if (count >= 2) throw new ConflictException('同一选手最多报名 2 个单项');
  }

  private validateSeedSettings(
    seeds: Array<{ entrantId: string; seedNo: number }>,
    seedLimit: number,
  ) {
    if (seeds.length > seedLimit) {
      throw new BadRequestException('种子数量超过上限');
    }

    const seenEntrants = new Set<string>();
    const sortedSeedNos = seeds.map((item) => item.seedNo).sort((a, b) => a - b);
    for (const seed of seeds) {
      if (seenEntrants.has(seed.entrantId)) {
        throw new BadRequestException('同一选手不能重复设为种子');
      }
      seenEntrants.add(seed.entrantId);
    }

    for (let index = 0; index < sortedSeedNos.length; index += 1) {
      if (sortedSeedNos[index] !== index + 1) {
        throw new BadRequestException('种子编号必须从 1 开始连续');
      }
    }
  }

  private async materializeSingleElimination(
    tx: Prisma.TransactionClient,
    eventId: string,
    slots: Array<{
      position: number;
      entrantId: string | null;
      isBye: boolean;
    }>,
  ) {
    await tx.match.deleteMany({ where: { eventId } });
    await tx.registration.updateMany({ where: { eventId: await this.entrantScope(eventId, tx) }, data: { groupName: null } });
    // 配对规则与换签位的原地重算共用同一份纯函数，避免两处规则漂移。
    const drafts = buildEliminationDrafts(slots, { bronze: true });
    await this.createMatchDrafts(tx, eventId, drafts);
  }

  private async materializeGroupStage(
    tx: Prisma.TransactionClient,
    eventId: string,
    groups: Array<{
      groupCode: string;
      members: Array<{ entrantId: string }>;
    }>,
  ) {
    await tx.match.deleteMany({ where: { eventId } });
    await tx.registration.updateMany({ where: { eventId: await this.entrantScope(eventId, tx) }, data: { groupName: null } });

    for (const group of groups) {
      const ids = group.members.map((member) => member.entrantId);
      if (ids.length) {
        await tx.registration.updateMany({
          where: { id: { in: ids } },
          data: { groupName: group.groupCode },
        });
      }
    }

    const drafts: MatchDraft[] = [];
    for (const group of groups) {
      for (let i = 0; i < group.members.length; i += 1) {
        for (let j = i + 1; j < group.members.length; j += 1) {
          drafts.push({
            round: group.groupCode,
            roundNo: 0,
            matchNo: drafts.filter((draft) => draft.round === group.groupCode).length + 1,
            side1Id: group.members[i].entrantId,
            side2Id: group.members[j].entrantId,
            status: MatchStatus.PENDING,
            winnerSide: null,
          });
        }
      }
    }

    await this.createMatchDrafts(tx, eventId, drafts);
  }

  private drawFormatForEvent(eventFormat: Format): DrawFormat {
    switch (eventFormat) {
      case Format.GROUP_PLUS_KNOCKOUT:
      // 标准小组循环+淘汰：抽签阶段同样只生成小组(蛇形分组+组内循环)，
      // 淘汰赛在小组赛全部完赛后由 scoring 自动按出线名次生成。
      case Format.GROUP_PLUS_KNOCKOUT_STD:
        return DrawFormat.group_then_elim;
      case Format.ROUND_ROBIN:
        return DrawFormat.round_robin;
      case Format.GROUP_PLUS_PLAYOFF:
        return DrawFormat.group_then_playoff;
      default:
        return DrawFormat.single_elim;
    }
  }

  /**
   * 抽签/重抽、抽签编排页预览共用的分组计划。
   * - 淘汰赛、单循环：不分组，返回 null；
   * - 小组循环+淘汰：按单项的「每组人数」或「手动小组数量」计算；
   * - 小组循环+交叉排位：固定 A/B 两组（每组至少 2 人）。
   */
  private groupPlanFor(
    event: {
      format: Format;
      groupCount?: number | null;
      groupSize?: number | null;
      qualifiersPerGroup?: number | null;
    },
    format: DrawFormat,
    entrantCount: number,
  ): GroupPlan | null {
    if (format === DrawFormat.single_elim || format === DrawFormat.round_robin) return null;
    const isPlayoff = format === DrawFormat.group_then_playoff;
    const plan = this.drawAlgorithmService.planGroups({
      entrantCount,
      groupCount: isPlayoff ? 2 : event.groupCount,
      groupSize: isPlayoff ? null : event.groupSize,
      qualifiersPerGroup: isPlayoff ? 1 : event.qualifiersPerGroup,
    });
    if (isPlayoff) {
      return {
        ...plan,
        secondStage: 'PLAYOFF',
        errors:
          entrantCount < 4
            ? [`交叉排位赛按 A/B 两组交叉对阵，至少需要 4 个报名（当前 ${entrantCount} 个）`]
            : plan.errors,
      };
    }
    // 旧赛制 GROUP_PLUS_KNOCKOUT 没有自动生成淘汰赛的实现（只有 _STD 有），如实标注。
    if (event.format === Format.GROUP_PLUS_KNOCKOUT) {
      return { ...plan, secondStage: 'MANUAL' };
    }
    return plan;
  }

  private bracketMatchCompare(
    a: { round: string; roundNo: number; matchNo: number; id: string },
    b: { round: string; roundNo: number; matchNo: number; id: string },
  ) {
    if (a.roundNo === 0 || b.roundNo === 0) {
      return a.roundNo - b.roundNo
        || this.groupNameCompare(a.round, b.round)
        || a.matchNo - b.matchNo
        || a.id.localeCompare(b.id);
    }
    return a.roundNo - b.roundNo
      || a.matchNo - b.matchNo
      || a.id.localeCompare(b.id);
  }

  private groupNameCompare(a: string, b: string) {
    return this.groupNameSortValue(a) - this.groupNameSortValue(b)
      || a.localeCompare(b, 'zh-CN', { numeric: true });
  }

  /** 字母编号 A=1…Z=26、AA=27；数字编号按数值（2组 在 10组 前）。 */
  private groupNameSortValue(value: string) {
    return groupCodeSortValue(value);
  }

  /**
   * 标准2023 预计出线人数：已抽签时按各组人数（每组最多取「每组出线数」人，与 scoring 实际出线一致），
   * 未抽签时按当前报名的分组计划。
   */
  private standardQualifierTotal(
    groupSizes: number[],
    qualifiersPerGroup: number | null | undefined,
    plannedTotal?: number | null,
  ) {
    const q = Math.max(1, qualifiersPerGroup || 2);
    if (groupSizes.length) {
      return groupSizes.reduce((sum, size) => sum + Math.min(q, size), 0);
    }
    return plannedTotal ?? 0;
  }

  /**
   * 标准2023 出线超过 A-H 的 8 个签位时返回预计出线人数（小组赛结束后自动生成淘汰赛，
   * 不走 A-H 第二阶段）；其它情况返回 null。
   */
  private standardAutoKnockoutTotal(
    event: {
      format: Format;
      groupCount?: number | null;
      groupSize?: number | null;
      qualifiersPerGroup?: number | null;
    },
    groupMatches: Array<{
      roundNo: number;
      round: string;
      side1Id: string | null;
      side2Id: string | null;
    }>,
    approvedCount: number,
  ): number | null {
    if (event.format !== Format.GROUP_PLUS_KNOCKOUT_STD) return null;
    const total = this.standardQualifierTotal(
      [...groupSizesFromGroupMatches(groupMatches).values()],
      event.qualifiersPerGroup,
      this.groupPlanFor(
        event,
        this.drawFormatForEvent(event.format),
        approvedCount,
      )?.qualifiersTotal,
    );
    return total > SECOND_STAGE_SLOTS.length ? total : null;
  }

  private supportsSecondStageBracket(eventFormat?: Format) {
    return (
      eventFormat === Format.SINGLE_ELIMINATION_PLUS_GROUP_RANKING ||
      eventFormat === Format.GROUP_PLUS_KNOCKOUT_STD
    );
  }

  private secondStageEligibleView(entrants: StandardSecondStageEntrant[]) {
    // 出线名单按组聚合后再按名次：A1,A2 → B1,B2 → C1,C2 …，方便管理员对照分组核对。
    // 仅影响展示顺序，签位编排仍由 orderStandardSecondStageEntrants 按官方种子序决定。
    return [...entrants]
      .sort(
        (a, b) => this.groupNameCompare(a.group, b.group) || a.rank - b.rank,
      )
      .map((entrant) => ({
        playerId: entrant.id,
        playerName: entrant.name,
        playerMembers: entrant.members,
        group: entrant.group,
        rank: entrant.rank,
      }));
  }

  private buildStandardSecondStageDefaultAssignments(
    entrants: StandardSecondStageEntrant[],
    qualifiersPerGroup: number,
  ): Array<{ slot: SecondStageSlotCode; entrantId: string }> {
    const ordered = this.orderStandardSecondStageEntrants(entrants, qualifiersPerGroup);
    return ordered.map((entrant, index) => ({
      slot: SECOND_STAGE_SLOTS[index],
      entrantId: entrant.id,
    }));
  }

  /**
   * 按 A-H 签位顺序生成「X组第N名」来源标签，顺序与 orderStandardSecondStageEntrants
   * 的官方交叉序一致（A组第1, B组第2, A组第2, B组第1, …）。即使小组赛尚未完赛、
   * 还不知道具体出线队伍，也能让抽签编排页直接标出每个签位归属哪一组第几名。
   *
   * 仅在「每组出线 ≥ 2」时才有确定的交叉归属；每组只取第一(q=1)是随机排入 A-H，
   * 没有 A1-B2 这种固定结构，返回空表（不标注、不预填）。
   */
  private buildStandardSecondStageSlotLabels(
    groupCodes: string[],
    qualifiersPerGroup: number,
  ): Map<SecondStageSlotCode, string> {
    const labels = new Map<SecondStageSlotCode, string>();
    const q = Math.max(1, qualifiersPerGroup || 2);
    if (q < 2) return labels;
    const codes = [...new Set(groupCodes.filter((code) => code && code.trim()))].sort((a, b) =>
      this.groupNameCompare(a, b),
    );
    if (!codes.length) return labels;

    const ordered: string[] = [];
    const label = (group: string, rank: number) => `${group}组第${rank}名`;
    for (let index = 0; index < codes.length; index += 2) {
      const groupA = codes[index];
      const groupB = codes[index + 1];
      if (groupB) {
        ordered.push(label(groupA, 1), label(groupB, 2), label(groupA, 2), label(groupB, 1));
        for (let rank = 3; rank <= q; rank += 1) {
          ordered.push(label(groupA, rank), label(groupB, rank));
        }
      } else {
        for (let rank = 1; rank <= q; rank += 1) ordered.push(label(groupA, rank));
      }
    }

    ordered.slice(0, SECOND_STAGE_SLOTS.length).forEach((text, index) => {
      labels.set(SECOND_STAGE_SLOTS[index], text);
    });
    return labels;
  }

  private orderStandardSecondStageEntrants(
    entrants: StandardSecondStageEntrant[],
    qualifiersPerGroup: number,
  ): StandardSecondStageEntrant[] {
    const q = Math.max(1, qualifiersPerGroup || 2);
    if (q <= 1) return this.shuffle(entrants);

    const byGroupRank = new Map<string, Map<number, StandardSecondStageEntrant>>();
    for (const entrant of entrants) {
      let ranks = byGroupRank.get(entrant.group);
      if (!ranks) byGroupRank.set(entrant.group, (ranks = new Map()));
      ranks.set(entrant.rank, entrant);
    }

    const append = (
      list: StandardSecondStageEntrant[],
      used: Set<string>,
      entrant?: StandardSecondStageEntrant,
    ) => {
      if (!entrant || used.has(entrant.id)) return;
      list.push(entrant);
      used.add(entrant.id);
    };

    const groups = [...byGroupRank.keys()].sort((a, b) => this.groupNameCompare(a, b));
    const ordered: StandardSecondStageEntrant[] = [];
    const used = new Set<string>();
    for (let index = 0; index < groups.length; index += 2) {
      const groupA = groups[index];
      const groupB = groups[index + 1];
      const a = byGroupRank.get(groupA);
      const b = groupB ? byGroupRank.get(groupB) : undefined;
      if (b) {
        append(ordered, used, a?.get(1));
        append(ordered, used, b.get(2));
        append(ordered, used, a?.get(2));
        append(ordered, used, b.get(1));
        for (let rank = 3; rank <= q; rank += 1) {
          append(ordered, used, a?.get(rank));
          append(ordered, used, b.get(rank));
        }
      } else {
        for (let rank = 1; rank <= q; rank += 1) {
          append(ordered, used, a?.get(rank));
        }
      }
    }

    const fallback = [...entrants].sort(
      (a, b) => a.rank - b.rank || this.groupNameCompare(a.group, b.group),
    );
    for (const entrant of fallback) append(ordered, used, entrant);
    return ordered;
  }

  private shuffle<T>(items: T[]): T[] {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  private async getStandardSecondStageEntrants(
    eventId: string,
    qualifiersPerGroup: number,
  ): Promise<StandardSecondStageEntrant[]> {
    const groupMatches = await this.prisma.match.findMany({
      where: { eventId, roundNo: 0 },
      include: { games: true },
    });
    if (!groupMatches.length) return [];
    const allSettled = groupMatches.every(
      (match) => match.status === MatchStatus.COMPLETED || match.status === MatchStatus.CANCELLED,
    );
    if (!allSettled) return [];

    const rankedByGroup = this.computeOfficialGroupRanking(groupMatches);
    const groupCodes = [...rankedByGroup.keys()].sort((a, b) => this.groupNameCompare(a, b));
    const q = Math.max(1, qualifiersPerGroup || 2);
    const qualifiers: Array<{ id: string; group: string; rank: number }> = [];
    for (let rankIndex = 0; rankIndex < q; rankIndex += 1) {
      for (const group of groupCodes) {
        const id = rankedByGroup.get(group)?.[rankIndex];
        if (id) qualifiers.push({ id, group, rank: rankIndex + 1 });
      }
    }
    if (!qualifiers.length) return [];

    const registrations = await this.prisma.registration.findMany({
      where: {
        eventId: await this.entrantScope(eventId),
        id: { in: qualifiers.map((qualifier) => qualifier.id) },
        status: RegistrationStatus.APPROVED,
      },
      include: { player1: true, player2: true },
    });
    const registrationMap = new Map(registrations.map((registration) => [registration.id, registration]));

    return qualifiers
      .map((qualifier) => {
        const registration = registrationMap.get(qualifier.id);
        if (!registration) return null;
        const members = [registration.player1?.name, registration.player2?.name].filter(Boolean) as string[];
        return {
          id: registration.id,
          name: registration.teamName?.trim() || this.registrationName(registration),
          members,
          group: qualifier.group,
          rank: qualifier.rank,
        };
      })
      .filter((entrant): entrant is StandardSecondStageEntrant => Boolean(entrant));
  }

  private computeOfficialGroupRanking(
    groupMatches: Array<{
      round: string;
      side1Id: string | null;
      side2Id: string | null;
      status: MatchStatus;
      winnerSide: number | null;
      games: Array<{ side1Score: number; side2Score: number; winnerSide: number | null }>;
    }>,
  ): Map<string, string[]> {
    type Stat = { id: string; wins: number; netGames: number; netPoints: number };
    const groups = new Map<string, Map<string, Stat>>();
    const head = new Map<string, Map<string, Map<string, number>>>();

    const ensureStat = (code: string, id: string) => {
      let group = groups.get(code);
      if (!group) groups.set(code, (group = new Map()));
      let stat = group.get(id);
      if (!stat) group.set(id, (stat = { id, wins: 0, netGames: 0, netPoints: 0 }));
      return stat;
    };
    const addHead = (code: string, winnerId: string, loserId: string) => {
      let group = head.get(code);
      if (!group) head.set(code, (group = new Map()));
      let winnerMap = group.get(winnerId);
      if (!winnerMap) group.set(winnerId, (winnerMap = new Map()));
      winnerMap.set(loserId, (winnerMap.get(loserId) ?? 0) + 1);
    };

    for (const match of groupMatches) {
      if (!match.side1Id || !match.side2Id) continue;
      const side1 = ensureStat(match.round, match.side1Id);
      const side2 = ensureStat(match.round, match.side2Id);
      if (match.status !== MatchStatus.COMPLETED || !match.winnerSide) continue;
      let side1Games = 0;
      let side2Games = 0;
      for (const game of match.games) {
        if (game.winnerSide === 1) side1Games += 1;
        else if (game.winnerSide === 2) side2Games += 1;
        side1.netPoints += game.side1Score - game.side2Score;
        side2.netPoints += game.side2Score - game.side1Score;
      }
      side1.netGames += side1Games - side2Games;
      side2.netGames += side2Games - side1Games;
      if (match.winnerSide === 1) {
        side1.wins += 1;
        addHead(match.round, match.side1Id, match.side2Id);
      } else {
        side2.wins += 1;
        addHead(match.round, match.side2Id, match.side1Id);
      }
    }

    const headBetween = (code: string, x: string, y: string) => {
      const group = head.get(code);
      const xy = group?.get(x)?.get(y) ?? 0;
      const yx = group?.get(y)?.get(x) ?? 0;
      return xy - yx;
    };

    const order = (code: string, members: Stat[], stage: 'wins' | 'netGames' | 'netPoints'): Stat[] => {
      if (members.length <= 1) return members;
      const keyOf = (stat: Stat) =>
        stage === 'wins' ? stat.wins : stage === 'netGames' ? stat.netGames : stat.netPoints;
      const sorted = [...members].sort((a, b) => keyOf(b) - keyOf(a));
      const buckets: Stat[][] = [];
      for (const stat of sorted) {
        const last = buckets[buckets.length - 1];
        if (last && keyOf(last[0]) === keyOf(stat)) last.push(stat);
        else buckets.push([stat]);
      }
      const nextStage = (bucket: Stat[]): Stat[] =>
        stage === 'wins'
          ? order(code, bucket, 'netGames')
          : stage === 'netGames'
            ? order(code, bucket, 'netPoints')
            : bucket;
      const result: Stat[] = [];
      for (const bucket of buckets) {
        if (bucket.length === 1) {
          result.push(bucket[0]);
        } else if (bucket.length === 2) {
          const headToHead = headBetween(code, bucket[0].id, bucket[1].id);
          if (headToHead > 0) result.push(bucket[0], bucket[1]);
          else if (headToHead < 0) result.push(bucket[1], bucket[0]);
          else result.push(...nextStage(bucket));
        } else {
          result.push(...nextStage(bucket));
        }
      }
      return result;
    };

    const ranked = new Map<string, string[]>();
    for (const [code, members] of groups) {
      ranked.set(code, order(code, [...members.values()], 'wins').map((stat) => stat.id));
    }
    return ranked;
  }

  /**
   * 小组循环 + 交叉排位赛：先生成两组组内循环（roundNo = 0），再追加排位赛
   * 占位场（round = `P{名次}`，roundNo = 1）。排位赛对阵在小组赛全部完赛后由
   * 记分模块（scoring.service.fillPlayoffMatchesIfReady）按各组名次自动填充：
   *   第 k 场 = A 组第 k 名 vs B 组第 k 名，决出第 (2k-1) 名与第 2k 名。
   */
  private async materializeGroupPlusPlayoff(
    tx: Prisma.TransactionClient,
    eventId: string,
    groups: Array<{
      groupCode: string;
      members: Array<{ entrantId: string }>;
    }>,
  ) {
    await this.materializeGroupStage(tx, eventId, groups);

    const playoffRounds = Math.max(0, ...groups.map((group) => group.members.length));
    const drafts: MatchDraft[] = [];
    for (let k = 1; k <= playoffRounds; k += 1) {
      drafts.push({
        round: `P${2 * k - 1}`,
        roundNo: 1,
        matchNo: k,
        side1Id: null,
        side2Id: null,
        status: MatchStatus.PENDING,
        winnerSide: null,
      });
    }
    if (drafts.length) {
      await this.createMatchDrafts(tx, eventId, drafts);
    }
  }

  private async createMatchDrafts(
    tx: Prisma.TransactionClient,
    eventId: string,
    drafts: MatchDraft[],
  ) {
    const event = await tx.event.findUnique({
      where: { id: eventId },
      select: { defaultMatchMinutes: true, tournament: { select: { defaultMatchMinutes: true } } },
    });
    const minutes =
      event?.defaultMatchMinutes ?? event?.tournament?.defaultMatchMinutes ?? 45;
    for (const draft of drafts) {
      await tx.match.create({
        data: {
          eventId,
          round: draft.round,
          roundNo: draft.roundNo,
          matchNo: draft.matchNo,
          side1Id: draft.side1Id,
          side2Id: draft.side2Id,
          status: draft.status,
          winnerSide: draft.winnerSide,
          durationMinutes: minutes,
        },
      });
    }
  }

  private async createSecondStageFormalMatches(
    tx: Prisma.TransactionClient,
    eventId: string,
    templates: SecondStageMatchTemplate[],
  ) {
    const event = await tx.event.findUnique({
      where: { id: eventId },
      select: { defaultMatchMinutes: true, tournament: { select: { defaultMatchMinutes: true } } },
    });
    const minutes =
      event?.defaultMatchMinutes ?? event?.tournament?.defaultMatchMinutes ?? 45;

    for (const template of templates) {
      const existing = await tx.match.findFirst({ where: { eventId, roundNo: secondStageFormalRoundNo(template.matchNo), matchNo: template.matchNo } });
      const data = {
        round: template.roundName,
        roundNo: secondStageFormalRoundNo(template.matchNo),
        matchNo: template.matchNo,
        side1Id: template.side1?.id ?? null,
        side2Id: template.side2?.id ?? null,
        status: MatchStatus.PENDING,
        winnerSide: null, startedAt: null, finishedAt: null,
      };
      if (existing) await tx.match.update({ where: { id: existing.id }, data });
      else await tx.match.create({ data: { ...data, eventId, durationMinutes: minutes } });
    }
  }

  private registrationName(registration: RegistrationWithPlayers | Registration) {
    const maybeRegistration = registration as RegistrationWithPlayers;
    if (maybeRegistration.player1) {
      return maybeRegistration.player2
        ? `${maybeRegistration.player1.name} / ${maybeRegistration.player2.name}`
        : maybeRegistration.player1.name;
    }
    return registration.name ?? registration.id;
  }

  private lockedPlayableMatchWhere(eventId: string): Prisma.MatchWhereInput {
    return {
      eventId,
      OR: [
        { status: MatchStatus.LIVE },
        {
          status: MatchStatus.COMPLETED,
          side1Id: { not: null },
          side2Id: { not: null },
        },
      ],
    };
  }

  private drawSlotLogSnapshot(slot: {
    position: number;
    entrantId: string | null;
    entrantNameSnapshot: string | null;
    seedNoSnapshot: number | null;
    isSeed: boolean;
    isBye: boolean;
    sourceType: DrawSlotSourceType;
    groupRankCode: string | null;
  }) {
    return {
      position: slot.position,
      entrantId: slot.entrantId,
      entrantNameSnapshot: slot.entrantNameSnapshot,
      seedNoSnapshot: slot.seedNoSnapshot,
      isSeed: slot.isSeed,
      isBye: slot.isBye,
      sourceType: slot.sourceType,
      groupRankCode: slot.groupRankCode,
    };
  }
}

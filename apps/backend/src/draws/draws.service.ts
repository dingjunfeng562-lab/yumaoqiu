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
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DrawAlgorithmService } from './draw-algorithm.service';
import { DrawLogService } from './draw-log.service';
import {
  CreateRegistrationDto,
  ConfirmSecondStageDto,
  GenerateDrawDto,
  GetDrawLogsQueryDto,
  SeedItemDto,
  UpdateRegistrationDto,
} from './dto/draw.dto';
import {
  SECOND_STAGE_FORMAL_ROUND_NO_BASE,
  isSecondStageFormalRoundNo,
  secondStageFormalRoundNo,
} from '../common/second-stage-bracket';
import { SecondStageProgressService } from '../common/second-stage-progress.service';
import { buildKnockoutSkeleton } from '../common/knockout-skeleton';

type RegistrationWithPlayers = Registration & {
  player1: { id: string; name: string; gender: string; affiliation: string };
  player2: { id: string; name: string; gender: string; affiliation: string } | null;
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
    return this.prisma.registration.findMany({
      where: { eventId, status: RegistrationStatus.APPROVED },
      include: { player1: true, player2: true },
      orderBy: [{ isSeed: 'desc' }, { seedRank: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async createRegistration(eventId: string, dto: CreateRegistrationDto) {
    const event = await this.ensureEvent(eventId);
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
    await this.ensureEvent(eventId);

    const [currentDraw, seedSettings, entrantCount] = await Promise.all([
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
        where: { eventId, status: RegistrationStatus.APPROVED },
      }),
    ]);

    return {
      eventItemId: eventId,
      hasDraw: Boolean(currentDraw),
      currentDraw,
      seedSettings,
      entrantCount,
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
    await this.ensureEvent(eventId);

    const registrations = await this.prisma.registration.findMany({
      where: { eventId, status: RegistrationStatus.APPROVED },
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
        where: { eventId },
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
    const event = await this.ensureEvent(eventId);

    const existingCurrent = await this.prisma.drawBracket.findFirst({
      where: { eventItemId: eventId, isCurrent: true },
    });
    if (existingCurrent && !force) {
      throw new ConflictException('已有当前签表，请使用重新抽签覆盖');
    }

    const registrations = await this.prisma.registration.findMany({
      where: { eventId, status: RegistrationStatus.APPROVED },
      include: { player1: true, player2: true },
      orderBy: [{ isSeed: 'desc' }, { seedRank: 'asc' }, { createdAt: 'asc' }],
    });
    if (registrations.length < 2) {
      throw new BadRequestException('至少需要 2 个报名才能抽签');
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

      const format = this.drawFormatForEvent(event.format);

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
          groupCount: this.initialDrawGroupCount(event, format, registrations.length),
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

        const groups =
          format === DrawFormat.round_robin
            ? this.drawAlgorithmService.buildSingleRoundRobin(entrants, seedInputs)
            : this.drawAlgorithmService.buildGroups(
                entrants,
                seedInputs,
                format === DrawFormat.group_then_playoff
                  ? 2
                  : this.configuredGroupCount(event, entrants.length),
              );

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
        data: { drawLocked: false, drawPublished: false, drawGeneratedAt: new Date() },
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

  async swapDrawSlots(
    eventId: string,
    drawId: string,
    positionA: number,
    positionB: number,
    operatorId: string,
    operatorName: string | null,
  ) {
    if (!operatorId) throw new BadRequestException('缺少操作人信息');
    if (positionA === positionB) throw new BadRequestException('不能交换同一个签位');

    return this.prisma.$transaction(async (tx) => {
      const draw = await tx.drawBracket.findUnique({
        where: { id: drawId },
      });
      if (!draw || draw.eventItemId !== eventId) throw new NotFoundException('签表不存在');
      if (draw.status !== DrawStatus.DRAWN) {
        throw new ConflictException('当前签表已冻结或已发布，不可调整');
      }
      if (draw.format !== DrawFormat.single_elim) {
        throw new BadRequestException('当前仅支持单淘汰签位交换');
      }

      const slotA = await tx.drawSlot.findFirstOrThrow({
        where: { drawBracketId: drawId, position: positionA },
      });
      const slotB = await tx.drawSlot.findFirstOrThrow({
        where: { drawBracketId: drawId, position: positionB },
      });

      await tx.drawSlot.update({
        where: { id: slotA.id },
        data: {
          entrantId: slotB.entrantId,
          entrantNameSnapshot: slotB.entrantNameSnapshot,
          seedNoSnapshot: slotB.seedNoSnapshot,
          isSeed: slotB.isSeed,
          isBye: slotB.isBye,
          sourceType: DrawSlotSourceType.MANUAL_SWAP,
          groupRankCode: slotB.groupRankCode,
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
          sourceType: DrawSlotSourceType.MANUAL_SWAP,
          groupRankCode: slotA.groupRankCode,
        },
      });

      const refreshedSlots = await tx.drawSlot.findMany({
        where: { drawBracketId: drawId },
        orderBy: { position: 'asc' },
      });
      await this.materializeSingleElimination(tx, eventId, refreshedSlots);

      await this.drawLogService.create(tx, {
        eventItemId: eventId,
        drawBracketId: drawId,
        operationType: DrawOperationType.SWAP,
        operatorId,
        operatorNameSnapshot: operatorName,
        positionA,
        positionB,
        beforeData: {
          slotA: this.drawSlotLogSnapshot(slotA),
          slotB: this.drawSlotLogSnapshot(slotB),
          status: draw.status,
        } as Prisma.InputJsonValue,
        afterData: {
          status: DrawStatus.DRAWN,
          slotA: this.drawSlotLogSnapshot(refreshedSlots[positionA - 1]),
          slotB: this.drawSlotLogSnapshot(refreshedSlots[positionB - 1]),
        } as Prisma.InputJsonValue,
      });

      return tx.drawBracket.findUniqueOrThrow({
        where: { id: drawId },
        include: { slots: { orderBy: { position: 'asc' } } },
      });
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
      operatorRole !== Role.SUPER_ADMIN &&
      operatorRole !== Role.ROOT
    ) {
      throw new ForbiddenException('对阵已发布，普通管理员请提交重抽申请，由总管理员审批');
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
        data: { drawLocked: false, drawPublished: false, drawGeneratedAt: null },
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

  async listRedrawRequests(query: { eventId?: string; status?: string }) {
    const where: Prisma.DrawRedrawRequestWhereInput = {};
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
      where: { eventId, status: RegistrationStatus.APPROVED },
      include: { player1: true, player2: true },
      orderBy: [{ isSeed: 'desc' }, { seedRank: 'asc' }, { createdAt: 'asc' }],
    });
    const registrationMap = new Map(registrations.map((item) => [item.id, item]));
    const matches = await this.prisma.match.findMany({
      where: { eventId },
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

    const rounds = sortedMatches
      .filter((match) => match.roundNo > 0 && !isSecondStageFormalRoundNo(match.roundNo))
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

    // GROUP_PLUS_KNOCKOUT_STD：小组赛出线前淘汰赛尚未生成，按 组数×出线数 预画对阵骨架
    //（签位用「X组第N名」占位，出线后由真实签表无缝替换）。
    const knockoutSkeleton =
      rounds.length === 0 && event.format === Format.GROUP_PLUS_KNOCKOUT_STD
        ? buildKnockoutSkeleton(
            groups.map((group) => group.name),
            event.qualifiersPerGroup ?? 2,
          )
        : null;
    const secondStageEntrants =
      event.format === Format.GROUP_PLUS_KNOCKOUT_STD
        ? await this.getStandardSecondStageEntrants(eventId, event.qualifiersPerGroup ?? 2)
        : [];

    return {
      event,
      currentDraw,
      registrations,
      rounds,
      groups,
      knockoutSkeleton,
      secondStage: this.secondStageView(
        secondStage,
        event.format,
        new Map(registrations.map((registration) => [registration.id, registration])),
        secondStageEntrants,
        event.qualifiersPerGroup ?? 2,
        groups.map((group) => group.name),
      ),
      secondStageFormalMatches,
    };
  }

  async getSecondStage(eventId: string) {
    const event = await this.ensureEvent(eventId);
    const [stage, registrations] = await Promise.all([
      this.prisma.secondStage.findUnique({
        where: { eventId },
        include: {
          slots: { orderBy: { sortOrder: 'asc' } },
          matches: { orderBy: { matchNo: 'asc' } },
          rankings: { orderBy: { rank: 'asc' } },
        },
      }),
      this.prisma.registration.findMany({
        where: { eventId, status: RegistrationStatus.APPROVED },
        include: { player1: true, player2: true },
      }),
    ]);
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

    const registrations = isStandard2023Format
      ? await this.prisma.registration.findMany({
          where: { eventId, id: { in: entrantIds }, status: RegistrationStatus.APPROVED },
          include: { player1: true, player2: true },
        })
      : await this.prisma.registration.findMany({
          where: {
            eventId,
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
      await tx.secondStage.deleteMany({ where: { eventId } });
      const stage = await tx.secondStage.create({
        data: {
          eventId,
          status: SecondStageStatus.CONFIRMED,
          mode: SecondStageMode.MANUAL_BY_REFEREE,
          rankingMode: dto.rankingMode,
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

      const matchTemplates = this.secondStageMatchTemplates(slotMap, dto.rankingMode);
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
            gte: isStandard2023Format ? 1 : SECOND_STAGE_FORMAL_ROUND_NO_BASE,
          },
        },
      });
      await this.createSecondStageFormalMatches(tx, eventId, matchTemplates);

      // 解析轮空：一侧空一侧有人 → 不战而胜并向下级联；双方皆空 → 标记取消。
      // planning 与正式赛两表一并更新。无轮空时为幂等空操作。
      await this.secondStageProgress.progress(tx, {
        secondStageId: stage.id,
        eventId,
        rankingMode: dto.rankingMode,
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
    rankingMode: SecondStageRankingMode,
  ): SecondStageMatchTemplate[] {
    const slot = (code: SecondStageSlotCode) => slotMap.get(code) ?? { id: null, name: null };
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
        roundName: rankingMode === SecondStageRankingMode.TOP_8 ? '5-8名半决赛' : '5-6名资格赛',
        area: rankingMode === SecondStageRankingMode.TOP_8 ? '5-8名争夺区' : '5-6名争夺区',
        side1Source: '第1场负者',
        side2Source: '第2场负者',
      },
      {
        matchNo: 10,
        roundName: rankingMode === SecondStageRankingMode.TOP_8 ? '5-8名半决赛' : '5-6名资格赛',
        area: rankingMode === SecondStageRankingMode.TOP_8 ? '5-8名争夺区' : '5-6名争夺区',
        side1Source: '第3场负者',
        side2Source: '第4场负者',
      },
      {
        matchNo: 11,
        roundName: '五六名决赛',
        area: rankingMode === SecondStageRankingMode.TOP_8 ? '5-8名争夺区' : '5-6名争夺区',
        side1Source: '第9场胜者',
        side2Source: '第10场胜者',
      },
    ];

    if (rankingMode === SecondStageRankingMode.TOP_8) {
      templates.push({
        matchNo: 12,
        roundName: '七八名决赛',
        area: '5-8名争夺区',
        side1Source: '第9场负者',
        side2Source: '第10场负者',
      });
    }

    return templates;
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
      const previewMatches = this.secondStageMatchTemplates(templateSlotMap, rankingMode);
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
        rankingModeText: '取前8名',
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

    const rankingMode = stage.rankingMode as SecondStageRankingMode;
    return {
      id: stage.id,
      status: stage.status,
      secondStageStatus: stage.status,
      mode: stage.mode,
      secondStageMode: stage.mode,
      modeText: '裁判手动指定',
      rankingMode,
      rankingModeText: rankingMode === SecondStageRankingMode.TOP_6 ? '取前6名' : '取前8名',
      slotSourceText: '组委会手动安排',
      qualifierReady: standardEntrants.length >= 2,
      eligibleEntrants: this.secondStageEligibleView(standardEntrants),
      confirmedAt: stage.confirmedAt?.toISOString?.() ?? null,
      finishedAt: stage.finishedAt?.toISOString?.() ?? null,
      slots: (stage.slots ?? []).map((slot: any) => ({
        slot: slot.slot,
        sourceLabel: sourceLabelOf(slot.slot as SecondStageSlotCode),
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
    await tx.registration.updateMany({ where: { eventId }, data: { groupName: null } });

    const entrantCount = slots.filter((slot) => !slot.isBye && slot.entrantId).length;
    const slotEntries = slots.map((slot) => ({
      entrantId: slot.isBye ? null : slot.entrantId,
      isPendingWinner: false,
    }));
    const drafts: MatchDraft[] = [];
    let roundNo = 1;
    let currentSlots = slotEntries;

    while (currentSlots.length >= 2) {
      const roundLabel = this.drawAlgorithmService.roundLabel(currentSlots.length);
      const nextSlots: Array<{ entrantId: string | null; isPendingWinner: boolean }> = [];
      for (let i = 0; i < currentSlots.length; i += 2) {
        const side1 = currentSlots[i];
        const side2 = currentSlots[i + 1];
        const side1Id = side1?.entrantId ?? null;
        const side2Id = side2?.entrantId ?? null;
        const side1IsRealBye = !side1Id && !side1?.isPendingWinner;
        const side2IsRealBye = !side2Id && !side2?.isPendingWinner;
        const bothByes = side1IsRealBye && side2IsRealBye;
        const hasBye =
          (Boolean(side1Id) && side2IsRealBye) ||
          (Boolean(side2Id) && side1IsRealBye);
        drafts.push({
          round: roundLabel,
          roundNo,
          matchNo: i / 2 + 1,
          side1Id,
          side2Id,
          // 一方有人一方轮空 → 直接判晋级（COMPLETED）；双方皆轮空 → 是空场，同样
          // 标记 COMPLETED 但无胜者，绝不能留成永远打不了的 PENDING 把后续卡死。
          status: hasBye || bothByes ? MatchStatus.COMPLETED : MatchStatus.PENDING,
          winnerSide: hasBye ? (side1Id ? 1 : 2) : null,
        });
        nextSlots.push({
          // 双方皆轮空时继续向下一轮传递“真实轮空”（isPendingWinner=false），
          // 让相邻的真实队伍一路轮空晋级，直到遇见真正的对手。
          entrantId: hasBye ? (side1Id ?? side2Id) : null,
          isPendingWinner: !hasBye && !bothByes,
        });
      }
      currentSlots = nextSlots;
      roundNo += 1;
    }

    const finalRoundNo = roundNo - 1;
    if (entrantCount >= 4 && finalRoundNo > 1) {
      drafts.push({
        round: 'BRONZE',
        roundNo: finalRoundNo,
        matchNo: 2,
        side1Id: null,
        side2Id: null,
        status: MatchStatus.PENDING,
        winnerSide: null,
      });
    }

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
    await tx.registration.updateMany({ where: { eventId }, data: { groupName: null } });

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

  private initialDrawGroupCount(
    event: { groupCount?: number | null; groupSize?: number | null },
    format: DrawFormat,
    entrantCount: number,
  ) {
    if (format === DrawFormat.single_elim) return null;
    if (format === DrawFormat.round_robin) return 1;
    if (format === DrawFormat.group_then_playoff) return 2;
    return this.configuredGroupCount(event, entrantCount);
  }

  private configuredGroupCount(
    event: { groupCount?: number | null; groupSize?: number | null },
    entrantCount: number,
  ) {
    if (event.groupCount && event.groupCount > 0) return event.groupCount;
    const legacyGroupSize = Math.max(event.groupSize ?? 4, 2);
    return Math.ceil(entrantCount / legacyGroupSize);
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

  private groupNameSortValue(value: string) {
    const letters = /^[A-Z]+/.exec(value.trim().toUpperCase())?.[0];
    if (!letters) return Number.MAX_SAFE_INTEGER;
    return [...letters].reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0);
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
        eventId,
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
      await tx.match.create({
        data: {
          eventId,
          round: template.roundName,
          roundNo: secondStageFormalRoundNo(template.matchNo),
          matchNo: template.matchNo,
          side1Id: template.side1?.id ?? null,
          side2Id: template.side2?.id ?? null,
          status: MatchStatus.PENDING,
          durationMinutes: minutes,
        },
      });
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

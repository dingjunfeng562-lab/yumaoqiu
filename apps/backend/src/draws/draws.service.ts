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
  EventType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DrawAlgorithmService } from './draw-algorithm.service';
import { DrawLogService } from './draw-log.service';
import {
  CreateRegistrationDto,
  GenerateDrawDto,
  GetDrawLogsQueryDto,
  SeedItemDto,
  UpdateRegistrationDto,
} from './dto/draw.dto';

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

@Injectable()
export class DrawsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly drawAlgorithmService: DrawAlgorithmService,
    private readonly drawLogService: DrawLogService,
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
      throw new ConflictException('抽签结果已冻结，请先重新抽签后再调整报名');
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
      throw new ConflictException('抽签结果已冻结，请先重新抽签后再调整报名');
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
      throw new ConflictException('抽签结果已冻结，请先重新抽签后再调整报名');
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
    const event = await this.ensureEvent(eventId);
    if (event.drawLocked && !dto.force) {
      throw new ConflictException('抽签结果已冻结，如需覆盖请使用重新抽签');
    }

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
    if (existingCurrent && existingCurrent.status === DrawStatus.FROZEN && !force) {
      throw new ConflictException('当前签表已冻结，请使用重新抽签');
    }

    const registrations = await this.prisma.registration.findMany({
      where: { eventId, status: RegistrationStatus.APPROVED },
      include: { player1: true, player2: true },
      orderBy: [{ isSeed: 'desc' }, { seedRank: 'asc' }, { createdAt: 'asc' }],
    });
    if (registrations.length < 2) {
      throw new BadRequestException('至少需要 2 个报名才能抽签');
    }

    const seedSettings = await this.prisma.drawSeedSetting.findMany({
      where: { eventItemId: eventId },
      orderBy: { seedNo: 'asc' },
    });
    const seedLimit = this.drawAlgorithmService.getSeedLimit(registrations.length);
    this.validateSeedSettings(seedSettings, seedLimit);

    const latest = await this.prisma.drawBracket.findFirst({
      where: { eventItemId: eventId },
      orderBy: { version: 'desc' },
    });

    return this.prisma.$transaction(async (tx) => {
      await tx.drawBracket.updateMany({
        where: { eventItemId: eventId, isCurrent: true },
        data: { isCurrent: false, updatedBy: operatorId },
      });

      const format =
        event.format === Format.GROUP_PLUS_KNOCKOUT
          ? DrawFormat.group_then_elim
          : DrawFormat.single_elim;

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
          groupCount: event.groupSize ?? null,
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
        const groups = this.drawAlgorithmService.buildGroups(
          registrations.map((registration) => ({
            id: registration.id,
            name: this.registrationName(registration),
          })),
          seedSettings.map((seed) => ({ entrantId: seed.entrantId, seedNo: seed.seedNo })),
          event.groupSize ?? 4,
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

        await this.materializeGroupStage(tx, eventId, groups);
      }

      await tx.event.update({
        where: { id: eventId },
        data: { drawLocked: true, drawPublished: false, drawGeneratedAt: new Date() },
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
      const originalDrawStatus = draw?.status;
      if (draw && draw.status !== DrawStatus.DRAWN) {
        const event = await tx.event.findUnique({
          where: { id: eventId },
          select: { drawPublished: true },
        });
        const lockedMatches = await tx.match.count({
          where: this.lockedPlayableMatchWhere(eventId),
        });
        if (draw.status !== DrawStatus.FROZEN || event?.drawPublished || lockedMatches > 0) {
          throw new ConflictException('褰撳墠绛捐〃涓嶅彲璋冩暣');
        }
        await tx.drawBracket.update({
          where: { id: drawId },
          data: { status: DrawStatus.DRAWN, frozenAt: null, updatedBy: operatorId },
        });
        draw.status = DrawStatus.DRAWN;
      }
      if (!draw || draw.eventItemId !== eventId) throw new NotFoundException('签表不存在');
      if (draw.status !== DrawStatus.DRAWN) throw new ConflictException('当前签表不可调整');
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
          status: originalDrawStatus ?? draw.status,
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
    const draw = await this.prisma.drawBracket.findUnique({ where: { id: drawId } });
    if (!draw || draw.eventItemId !== eventId) throw new NotFoundException('签表不存在');
    if (draw.status !== DrawStatus.DRAWN) throw new ConflictException('只有已抽签状态才能发布');

    return this.prisma.$transaction(async (tx) => {
      const published = await tx.drawBracket.update({
        where: { id: drawId },
        data: { status: DrawStatus.FROZEN, frozenAt: new Date(), updatedBy: operatorId },
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
    const draw = await this.prisma.drawBracket.findUnique({ where: { id: drawId } });
    if (!draw || draw.eventItemId !== eventId) throw new NotFoundException('签表不存在');
    if (draw.status !== DrawStatus.FROZEN) throw new ConflictException('只有已发布状态才能取消发布');

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
        data: { drawPublished: false },
      });

      await this.drawLogService.create(tx, {
        eventItemId: eventId,
        drawBracketId: drawId,
        operationType: DrawOperationType.FREEZE,
        operatorId,
        operatorNameSnapshot: operatorName,
        beforeData: { status: draw.status } as Prisma.InputJsonValue,
        afterData: { status: DrawStatus.DRAWN, drawPublished: false } as Prisma.InputJsonValue,
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

    if (event.drawPublished && operatorRole !== Role.SUPER_ADMIN) {
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
    const currentDraw = await this.prisma.drawBracket.findFirst({
      where: { eventItemId: eventId, isCurrent: true },
      orderBy: { version: 'desc' },
    });

    const hydrateMatch = (match: (typeof matches)[number]) => ({
      ...match,
      side1: match.side1Id ? registrationMap.get(match.side1Id) ?? null : null,
      side2: match.side2Id ? registrationMap.get(match.side2Id) ?? null : null,
    });

    const rounds = matches
      .filter((match) => match.roundNo > 0)
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
      group.matches = matches.filter((match) => match.round === group.name).map((match) => hydrateMatch(match));
    }

    return { event, currentDraw, registrations, rounds, groups };
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
        const hasBye =
          (Boolean(side1Id) && side2IsRealBye) ||
          (Boolean(side2Id) && side1IsRealBye);
        drafts.push({
          round: roundLabel,
          roundNo,
          matchNo: i / 2 + 1,
          side1Id,
          side2Id,
          status: hasBye ? MatchStatus.COMPLETED : MatchStatus.PENDING,
          winnerSide: hasBye ? (side1Id ? 1 : 2) : null,
        });
        nextSlots.push({
          entrantId: hasBye ? (side1Id ?? side2Id) : null,
          isPendingWinner: !hasBye,
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

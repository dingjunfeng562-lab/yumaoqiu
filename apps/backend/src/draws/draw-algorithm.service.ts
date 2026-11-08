import { DrawSlotSourceType } from '@prisma/client';

export type DrawSeedSettingInput = {
  entrantId: string;
  seedNo: number;
};

export type DrawEntrantInput = {
  id: string;
  name: string;
};

export type BuiltDrawSlot = {
  position: number;
  entrantId: string | null;
  entrantNameSnapshot: string | null;
  seedNoSnapshot: number | null;
  isSeed: boolean;
  isBye: boolean;
  sourceType: DrawSlotSourceType;
  groupRankCode: string | null;
};

export type BuiltDrawGroup = {
  groupCode: string;
  sortOrder: number;
  members: Array<{
    entrantId: string;
    entrantNameSnapshot: string;
    seedNoSnapshot: number | null;
    groupRank: number | null;
    isQualified: boolean;
  }>;
};

import { Injectable } from '@nestjs/common';

/** 每组人数可配置范围，默认 4 人（与历史「每组 4 人」的数据一致）。 */
export const GROUP_SIZE_DEFAULT = 4;
export const GROUP_SIZE_MIN = 2;
export const GROUP_SIZE_MAX = 8;
/** 小组数量上限：组代码用 A–Z（超出后 AA/AB…，但业务上限保持 26）。 */
export const GROUP_COUNT_MAX = 26;
/** 每组出线数范围：A–H 第二阶段最多 8 个签位。 */
export const QUALIFIERS_PER_GROUP_MIN = 1;
export const QUALIFIERS_PER_GROUP_MAX = 8;

export type GroupPlanRequest = {
  entrantCount: number;
  /** 手动指定的小组数量；给出时优先于 groupSize。 */
  groupCount?: number | null;
  /** 每组人数；未手动指定组数时用它推导组数。 */
  groupSize?: number | null;
  qualifiersPerGroup?: number | null;
};

/**
 * 分组计划：抽签前算好「几组、每组几人、出线几人、第二阶段走哪条路」。
 * 纯计算，不抛异常；errors 非空表示这份计划不能落库（由调用方转成 400）。
 */
export type GroupPlan = {
  entrantCount: number;
  groupCount: number;
  sizes: number[];
  manualGroupCount: boolean;
  groupSize: number | null;
  qualifiersPerGroup: number;
  qualifiersTotal: number;
  /** AH：出线 ≤8，进 A–H 手动签位；AUTO：>8，小组赛结束后自动生成淘汰赛；
   * PLAYOFF：交叉排位赛；MANUAL：该赛制没有自动淘汰赛，需要人工生成。 */
  secondStage: 'AH' | 'AUTO' | 'PLAYOFF' | 'MANUAL';
  errors: string[];
};

@Injectable()
export class DrawAlgorithmService {
  getSeedLimit(entrantCount: number) {
    if (entrantCount >= 72) return 16;
    if (entrantCount >= 32) return 8;
    if (entrantCount >= 16) return 4;
    return 2;
  }

  nextPowerOfTwo(value: number) {
    return 2 ** Math.ceil(Math.log2(Math.max(1, value)));
  }

  shuffle<T>(items: T[]) {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  buildSingleEliminationSlots(
    entrants: DrawEntrantInput[],
    seedSettings: DrawSeedSettingInput[],
  ) {
    const entrantCount = entrants.length;
    const bracketSize = this.nextPowerOfTwo(entrantCount);
    const byeCount = bracketSize - entrantCount;
    const slots: BuiltDrawSlot[] = Array.from({ length: bracketSize }, (_, index) => ({
      position: index + 1,
      entrantId: null,
      entrantNameSnapshot: null,
      seedNoSnapshot: null,
      isSeed: false,
      isBye: false,
      sourceType: DrawSlotSourceType.NON_SEED,
      groupRankCode: null,
    }));

    const entrantMap = new Map(entrants.map((item) => [item.id, item]));
    const seedMap = new Map(seedSettings.map((item) => [item.seedNo, item]));

    const placeSeed = (seedNo: number, position: number) => {
      const seed = seedMap.get(seedNo);
      if (!seed) return;
      const entrant = entrantMap.get(seed.entrantId);
      if (!entrant) return;
      const slot = slots[position - 1];
      slot.entrantId = entrant.id;
      slot.entrantNameSnapshot = entrant.name;
      slot.seedNoSnapshot = seedNo;
      slot.isSeed = true;
      slot.isBye = false;
      slot.sourceType = DrawSlotSourceType.SEED;
    };

    placeSeed(1, 1);
    placeSeed(2, bracketSize);
    this.placeTierSeeds(slots, entrantMap, seedMap, [3, 4], this.seedTier34Positions(bracketSize));
    this.placeTierSeeds(slots, entrantMap, seedMap, [5, 6, 7, 8], this.seedTier58Positions(bracketSize));
    this.placeTierSeeds(
      slots,
      entrantMap,
      seedMap,
      [9, 10, 11, 12, 13, 14, 15, 16],
      this.seedTier916Positions(bracketSize),
    );

    this.assignByes(slots, seedMap, byeCount);
    this.fillNonSeeds(slots, entrants, seedSettings);

    return {
      bracketSize,
      entrantCount,
      byeCount,
      slots,
    };
  }

  /**
   * 按 planGroups() 给出的每组人数建组：种子按蛇形落在各组，其余随机补齐，
   * 每组人数严格等于 sizes[index]（余数先给 A 组）。
   */
  buildGroups(
    entrants: DrawEntrantInput[],
    seedSettings: DrawSeedSettingInput[],
    sizes: number[],
  ) {
    const resolvedGroupCount = sizes.length;
    const targetSizes = sizes;
    const groups: BuiltDrawGroup[] = Array.from({ length: resolvedGroupCount }, (_, index) => ({
      groupCode: this.groupCodeLabel(index),
      sortOrder: index,
      members: [],
    }));

    const entrantMap = new Map(entrants.map((item) => [item.id, item]));
    const seedMap = new Map(seedSettings.map((item) => [item.entrantId, item.seedNo]));

    const sortedSeeds = [...seedSettings].sort((a, b) => a.seedNo - b.seedNo);
    for (const seed of sortedSeeds) {
      const entrant = entrantMap.get(seed.entrantId);
      if (!entrant) continue;
      const group = groups[this.snakeGroupIndex(seed.seedNo, resolvedGroupCount)];
      group.members.push({
        entrantId: entrant.id,
        entrantNameSnapshot: entrant.name,
        seedNoSnapshot: seed.seedNo,
        groupRank: null,
        isQualified: false,
      });
    }

    const seededIds = new Set(seedSettings.map((item) => item.entrantId));
    const nonSeeds = this.shuffle(entrants.filter((item) => !seededIds.has(item.id)));
    for (const entrant of nonSeeds) {
      const target = [...groups].sort((a, b) => {
        const aRemaining = targetSizes[a.sortOrder] - a.members.length;
        const bRemaining = targetSizes[b.sortOrder] - b.members.length;
        return bRemaining - aRemaining || a.members.length - b.members.length || a.sortOrder - b.sortOrder;
      })[0];
      target.members.push({
        entrantId: entrant.id,
        entrantNameSnapshot: entrant.name,
        seedNoSnapshot: seedMap.get(entrant.id) ?? null,
        groupRank: null,
        isQualified: false,
      });
    }

    return groups;
  }

  /**
   * 计算分组计划。规则（不再有「每组最多 4 人」和「出线总数必须是 ≥8 的 2 的幂」两条硬编码）：
   * - 手动给了小组数量：以它为准；
   * - 否则按每组人数（默认 4）推导组数 = ceil(报名数 / 每组人数)；
   * - 组数上限 26（A–Z），且每组至少 2 人（人数不足时宁可少分一组，不产生 1 人组）；
   * - 每组出线数不能超过最小组人数（否则「出线」名次不存在）。
   */
  planGroups(request: GroupPlanRequest): GroupPlan {
    const entrantCount = Math.max(0, Math.floor(Number(request.entrantCount) || 0));
    const errors = new Set<string>();

    const rawQualifiers = Math.floor(Number(request.qualifiersPerGroup ?? 2));
    const qualifiersPerGroup = Number.isFinite(rawQualifiers) ? rawQualifiers : 2;
    if (qualifiersPerGroup < QUALIFIERS_PER_GROUP_MIN || qualifiersPerGroup > QUALIFIERS_PER_GROUP_MAX) {
      errors.add(`每组出线数需在 ${QUALIFIERS_PER_GROUP_MIN}–${QUALIFIERS_PER_GROUP_MAX} 之间`);
    }
    const resolvedQualifiers = Math.min(
      QUALIFIERS_PER_GROUP_MAX,
      Math.max(QUALIFIERS_PER_GROUP_MIN, qualifiersPerGroup || QUALIFIERS_PER_GROUP_MIN),
    );

    const manualGroupCount =
      typeof request.groupCount === 'number' && Number.isFinite(request.groupCount) && request.groupCount > 0;
    const rawGroupSize =
      typeof request.groupSize === 'number' && Number.isFinite(request.groupSize)
        ? Math.floor(request.groupSize)
        : null;
    const groupSizeInRange =
      rawGroupSize !== null && rawGroupSize >= GROUP_SIZE_MIN && rawGroupSize <= GROUP_SIZE_MAX;
    if (rawGroupSize !== null && !groupSizeInRange) {
      errors.add(`每组人数需在 ${GROUP_SIZE_MIN}–${GROUP_SIZE_MAX} 之间`);
    }

    let groupCount = 1;
    if (entrantCount < 2) {
      errors.add('至少需要 2 个报名才能分组');
    } else if (manualGroupCount) {
      groupCount = Math.floor(request.groupCount as number);
    } else {
      const perGroup = groupSizeInRange ? (rawGroupSize as number) : GROUP_SIZE_DEFAULT;
      // 每组至少 2 人：人数不足时宁可少分一组，也不产生 1 人组（1 人组没有任何场次）。
      const maxGroupsByPairs = Math.max(1, Math.floor(entrantCount / 2));
      groupCount = Math.min(Math.ceil(entrantCount / perGroup), maxGroupsByPairs);
    }

    if (groupCount < 1) {
      errors.add('小组数量至少为 1');
      groupCount = 1;
    }
    if (groupCount > GROUP_COUNT_MAX) {
      errors.add(
        `需要 ${groupCount} 个小组，超过 ${GROUP_COUNT_MAX} 组上限（A–Z），请增大每组人数`,
      );
      groupCount = GROUP_COUNT_MAX;
    }
    if (entrantCount >= 2 && groupCount > Math.floor(entrantCount / 2)) {
      errors.add(`报名 ${entrantCount} 人分成 ${groupCount} 组会出现 1 人组，请减少组数`);
    }

    const sizes = entrantCount > 0 ? this.distribute(entrantCount, groupCount) : [];
    const minSize = sizes.length ? Math.min(...sizes) : 0;
    if (minSize >= 2 && resolvedQualifiers > minSize) {
      errors.add(
        `最小组只有 ${minSize} 人，每组出线 ${resolvedQualifiers} 人；请增大每组人数或减少出线数`,
      );
    }

    const qualifiersTotal = groupCount * resolvedQualifiers;
    return {
      entrantCount,
      groupCount,
      sizes,
      manualGroupCount,
      groupSize: groupSizeInRange ? rawGroupSize : null,
      qualifiersPerGroup: resolvedQualifiers,
      qualifiersTotal,
      secondStage: qualifiersTotal <= 8 ? 'AH' : 'AUTO',
      errors: [...errors],
    };
  }

  /** 把 total 人尽量均分到 groups 组，余数从 A 组开始各 +1。 */
  private distribute(total: number, groups: number): number[] {
    if (groups <= 0) return [];
    const base = Math.floor(total / groups);
    const remainder = total % groups;
    return Array.from({ length: groups }, (_, index) => base + (index < remainder ? 1 : 0));
  }

  /** 0 → A，25 → Z，26 → AA…（业务上限定 26 组，这里仍按 26 进制输出，避免出现 '['）。 */
  private groupCodeLabel(index: number): string {
    let value = Math.max(0, Math.floor(index));
    let label = '';
    do {
      label = String.fromCharCode(65 + (value % 26)) + label;
      value = Math.floor(value / 26) - 1;
    } while (value >= 0);
    return label;
  }

  /**
   * 单循环排名赛：所有选手编入一个组（组别代码 A），组内两两对战，
   * 直接按战绩排出全部名次。种子在前、其余随机，决定组内默认呈现顺序。
   */
  buildSingleRoundRobin(
    entrants: DrawEntrantInput[],
    seedSettings: DrawSeedSettingInput[],
  ): BuiltDrawGroup[] {
    const entrantMap = new Map(entrants.map((item) => [item.id, item]));
    const seedMap = new Map(seedSettings.map((item) => [item.entrantId, item.seedNo]));

    const seededOrdered = [...seedSettings]
      .sort((a, b) => a.seedNo - b.seedNo)
      .map((seed) => entrantMap.get(seed.entrantId))
      .filter((entrant): entrant is DrawEntrantInput => Boolean(entrant));
    const seededIds = new Set(seedSettings.map((item) => item.entrantId));
    const rest = this.shuffle(entrants.filter((item) => !seededIds.has(item.id)));

    return [
      {
        groupCode: 'A',
        sortOrder: 0,
        members: [...seededOrdered, ...rest].map((entrant) => ({
          entrantId: entrant.id,
          entrantNameSnapshot: entrant.name,
          seedNoSnapshot: seedMap.get(entrant.id) ?? null,
          groupRank: null,
          isQualified: false,
        })),
      },
    ];
  }

  roundLabel(slotCount: number) {
    if (slotCount === 2) return 'F';
    if (slotCount === 4) return 'SF';
    if (slotCount === 8) return 'QF';
    return `R${Math.log2(slotCount) - 3}`;
  }

  private placeTierSeeds(
    slots: BuiltDrawSlot[],
    entrantMap: Map<string, DrawEntrantInput>,
    seedMap: Map<number, DrawSeedSettingInput>,
    seedNos: number[],
    candidatePositions: number[],
  ) {
    const presentSeeds = this.shuffle(seedNos.filter((seedNo) => seedMap.has(seedNo)));
    const positions = this.shuffle(candidatePositions).slice(0, presentSeeds.length);

    positions.forEach((position, index) => {
      const seedNo = presentSeeds[index];
      const seed = seedMap.get(seedNo);
      if (!seed) return;
      const entrant = entrantMap.get(seed.entrantId);
      if (!entrant) return;
      const slot = slots[position - 1];
      slot.entrantId = entrant.id;
      slot.entrantNameSnapshot = entrant.name;
      slot.seedNoSnapshot = seedNo;
      slot.isSeed = true;
      slot.isBye = false;
      slot.sourceType = DrawSlotSourceType.SEED;
    });
  }

  private assignByes(
    slots: BuiltDrawSlot[],
    seedMap: Map<number, DrawSeedSettingInput>,
    byeCount: number,
  ) {
    let remaining = byeCount;

    const tryAssignSeedBye = (seedNo: number) => {
      if (remaining <= 0 || !seedMap.has(seedNo)) return;
      const seedSlot = slots.find((slot) => slot.seedNoSnapshot === seedNo);
      if (!seedSlot) return;

      const opponentPosition = seedSlot.position % 2 === 1 ? seedSlot.position + 1 : seedSlot.position - 1;
      const opponentSlot = slots[opponentPosition - 1];
      if (!opponentSlot || opponentSlot.entrantId || opponentSlot.isBye) return;

      opponentSlot.isBye = true;
      opponentSlot.sourceType = DrawSlotSourceType.BYE;
      remaining -= 1;
    };

    tryAssignSeedBye(1);
    tryAssignSeedBye(2);
    for (const seedNo of this.shuffle([3, 4])) {
      tryAssignSeedBye(seedNo);
    }
    for (const seedNo of [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]) {
      tryAssignSeedBye(seedNo);
    }

    // 轮空必须落在“对手是真实参赛者一侧”的签位上，绝不能让两个轮空相邻——否则会
    // 形成“轮空 vs 轮空”的空场，使相邻真实队伍卡住无法晋级。报名数恒 > bracketSize/2，
    // 故 byeCount < 一轮场次数，每个轮空都能独占一场，相邻并非必要。
    const canPlaceBye = (slot: BuiltDrawSlot) => {
      if (slot.entrantId || slot.isBye) return false;
      const opponentPosition = slot.position % 2 === 1 ? slot.position + 1 : slot.position - 1;
      const opponentSlot = slots[opponentPosition - 1];
      return Boolean(opponentSlot) && !opponentSlot.isBye;
    };

    const availableByeSlots = this.shuffle(slots.filter(canPlaceBye));
    for (const slot of availableByeSlots) {
      if (remaining <= 0) break;
      // 上一次分配可能已把本签位的对手设为轮空，这里重新校验，避免相邻双轮空。
      if (!canPlaceBye(slot)) continue;
      slot.isBye = true;
      slot.sourceType = DrawSlotSourceType.BYE;
      remaining -= 1;
    }
  }

  private fillNonSeeds(
    slots: BuiltDrawSlot[],
    entrants: DrawEntrantInput[],
    seedSettings: DrawSeedSettingInput[],
  ) {
    const seededIds = new Set(seedSettings.map((item) => item.entrantId));
    const nonSeeds = this.shuffle(entrants.filter((item) => !seededIds.has(item.id)));
    const openSlots = slots.filter((slot) => !slot.entrantId && !slot.isBye);

    openSlots.forEach((slot, index) => {
      const entrant = nonSeeds[index];
      if (!entrant) return;
      slot.entrantId = entrant.id;
      slot.entrantNameSnapshot = entrant.name;
      slot.seedNoSnapshot = null;
      slot.isSeed = false;
      slot.isBye = false;
      slot.sourceType = DrawSlotSourceType.NON_SEED;
    });
  }

  private seedTier34Positions(bracketSize: number) {
    return [this.segmentEdge(bracketSize, 4, 2, 'top'), this.segmentEdge(bracketSize, 4, 3, 'bottom')];
  }

  private seedTier58Positions(bracketSize: number) {
    return [
      this.segmentEdge(bracketSize, 8, 2, 'bottom'),
      this.segmentEdge(bracketSize, 8, 4, 'bottom'),
      this.segmentEdge(bracketSize, 8, 5, 'top'),
      this.segmentEdge(bracketSize, 8, 7, 'top'),
    ];
  }

  private seedTier916Positions(bracketSize: number) {
    return [
      this.segmentEdge(bracketSize, 16, 2, 'bottom'),
      this.segmentEdge(bracketSize, 16, 4, 'bottom'),
      this.segmentEdge(bracketSize, 16, 6, 'bottom'),
      this.segmentEdge(bracketSize, 16, 8, 'bottom'),
      this.segmentEdge(bracketSize, 16, 9, 'top'),
      this.segmentEdge(bracketSize, 16, 11, 'top'),
      this.segmentEdge(bracketSize, 16, 13, 'top'),
      this.segmentEdge(bracketSize, 16, 15, 'top'),
    ];
  }

  private segmentEdge(
    bracketSize: number,
    segmentCount: number,
    segmentIndex: number,
    edge: 'top' | 'bottom',
  ) {
    const segmentSize = bracketSize / segmentCount;
    const start = (segmentIndex - 1) * segmentSize + 1;
    const end = segmentIndex * segmentSize;
    return edge === 'top' ? start : end;
  }

  private snakeGroupIndex(seedNo: number, groupCount: number) {
    const block = Math.floor((seedNo - 1) / groupCount);
    const offset = (seedNo - 1) % groupCount;
    return block % 2 === 0 ? offset : groupCount - 1 - offset;
  }
}

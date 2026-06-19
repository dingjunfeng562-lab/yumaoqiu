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

  buildGroups(
    entrants: DrawEntrantInput[],
    seedSettings: DrawSeedSettingInput[],
    groupSize: number,
  ) {
    const groupCount = Math.max(2, Math.ceil(entrants.length / Math.max(groupSize, 2)));
    const groups: BuiltDrawGroup[] = Array.from({ length: groupCount }, (_, index) => ({
      groupCode: String.fromCharCode(65 + index),
      sortOrder: index,
      members: [],
    }));

    const entrantMap = new Map(entrants.map((item) => [item.id, item]));
    const seedMap = new Map(seedSettings.map((item) => [item.entrantId, item.seedNo]));

    const sortedSeeds = [...seedSettings].sort((a, b) => a.seedNo - b.seedNo);
    for (const seed of sortedSeeds) {
      const entrant = entrantMap.get(seed.entrantId);
      if (!entrant) continue;
      const group = groups[this.snakeGroupIndex(seed.seedNo, groupCount)];
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
      const target = [...groups].sort((a, b) => a.members.length - b.members.length || a.sortOrder - b.sortOrder)[0];
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

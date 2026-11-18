/**
 * 小组出线 → 单淘汰：签位排法（placeGroupQualifiers）与对阵骨架（buildKnockoutSkeleton）。
 *
 * GROUP_PLUS_KNOCKOUT_STD 出线超过 8 人时，小组赛全部完赛后由 scoring.fillGroupKnockoutIfReady
 * 按 placeGroupQualifiers 落库真实签表；出线前按同一排法预画对阵骨架，签位用「X组第N名」占位，
 * 所以预览与实际生成的签表一致。纯函数，供 scoring、public 对阵表、抽签编排、秩序册导出复用。
 */

export type SkeletonParticipant = {
  id: string;
  position: number; // 1-based 签位序，与对阵树 slot 对齐
  name: string; // 「A组第1名」
  isBye: boolean;
};

export type SkeletonMatch = {
  id: string;
  round: string; // F / SF / QF / R1 / R2 ... / BRONZE
  roundNo: number;
  matchNo: number;
  side1Id: string | null;
  side2Id: string | null;
  status: 'PENDING' | 'COMPLETED';
  winnerSide: number | null;
};

export type KnockoutSkeleton = {
  bracketSize: number;
  participants: SkeletonParticipant[];
  matches: SkeletonMatch[];
};

/** 标准种子位顺序（1 v 末位、对半递归）：返回值第 i 项 = 第 i 个签位（0 起）上的种子号。 */
export function canonicalSeedOrder(bracketSize: number): number[] {
  let seeds = [1, 2];
  while (seeds.length < bracketSize) {
    const sum = seeds.length * 2 + 1;
    const next: number[] = [];
    for (const s of seeds) {
      next.push(s);
      next.push(sum - s);
    }
    seeds = next;
  }
  return seeds;
}

/** 该轮场上人数 → 轮次代码。 */
function roundCode(slotCount: number) {
  if (slotCount === 2) return 'F';
  if (slotCount === 4) return 'SF';
  if (slotCount === 8) return 'QF';
  return `R${Math.log2(slotCount) - 3}`;
}

// 组别排序：先比长度再字典序，保证 A<…<Z<AA<AB。
function compareGroupCode(a: string, b: string) {
  return a.length - b.length || a.localeCompare(b, 'en');
}

/** 一名出线者：所在组别、组内名次（1 起）与要放进签位的数据。 */
export type GroupQualifier<T> = { group: string; rank: number; entrant: T };

/** 签位 a、b（0 起）最早在第几轮相遇：1 = 首轮，log2(签表大小) = 决赛。 */
function meetingRound(a: number, b: number) {
  return 32 - Math.clz32(a ^ b);
}

/**
 * 小组出线 → 单淘汰签位（长度为 2 的幂，null = 轮空）。
 * - 各组第 1 名按组别顺序占种子 1、2、3…（canonicalSeedOrder）。轮空都排在高种子的对面，
 *   所以轮空优先给小组第 1 名，而且每场至少有一名真实选手：不会出现两边都空、
 *   或一边永远等不到对手的场次。
 * - 其余出线者按名次、组别顺序依次入签：在剩下的签位里选和本组已入签选手「最晚才可能相遇」的
 *   位置（第 2 名落在本组第 1 名的另一个半区，决赛前不会再遇到）；同样晚时取种子号小的签位，
 *   多出来的轮空先给名次靠前的人。
 * - 轮空数为单数时上半区多一个轮空（羽毛球竞赛编排：轮空平均分布在上下半区，单数时上半区多一个）。
 * 结果是确定的：同样的分组和名次，总是得到同样的签表。
 * @param groupCodes 组别顺序（A、B、…），决定各组第 1 名的种子号
 */
export function placeGroupQualifiers<T>(
  groupCodes: string[],
  qualifiers: Array<GroupQualifier<T>>,
): Array<T | null> {
  const bracketSize = 2 ** Math.ceil(Math.log2(Math.max(2, qualifiers.length)));
  const positionOfSeed = new Map<number, number>();
  canonicalSeedOrder(bracketSize).forEach((seed, position) =>
    positionOfSeed.set(seed, position),
  );
  // 轮空在种子 1…k（k = 轮空数）的对面。标准种子序里种子号除以 4 余 0、1 的在上半区，
  // 余 2、3 的在下半区，所以 k 除以 4 余 3 时下半区会多一个轮空。这时把种子 k、k+1
  //（同一档种子，规则上本来就是抽签进位）连同各自的首轮对面对调，多出的轮空就落到上半区。
  const byes = bracketSize - qualifiers.length;
  if (byes % 4 === 3) {
    const swapSeeds = (x: number, y: number) => {
      const positionX = positionOfSeed.get(x)!;
      positionOfSeed.set(x, positionOfSeed.get(y)!);
      positionOfSeed.set(y, positionX);
    };
    swapSeeds(byes, byes + 1);
    swapSeeds(bracketSize + 1 - byes, bracketSize - byes);
  }
  const groupOrder = (group: string) => {
    const index = groupCodes.indexOf(group);
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
  };
  const slots: Array<GroupQualifier<T> | null> = Array.from(
    { length: bracketSize },
    () => null,
  );

  const winners = qualifiers
    .filter((qualifier) => qualifier.rank === 1)
    .sort((a, b) => groupOrder(a.group) - groupOrder(b.group));
  winners.forEach((winner, index) => {
    slots[positionOfSeed.get(index + 1)!] = winner;
  });

  // 种子 (人数+1) … 签表大小 是轮空；中间的种子位留给其余出线者，按种子号从小到大排。
  const open: number[] = [];
  for (let seed = winners.length + 1; seed <= qualifiers.length; seed += 1) {
    open.push(positionOfSeed.get(seed)!);
  }

  const others = qualifiers
    .filter((qualifier) => qualifier.rank !== 1)
    .sort(
      (a, b) => a.rank - b.rank || groupOrder(a.group) - groupOrder(b.group),
    );
  for (const qualifier of others) {
    const mates = slots.flatMap((slot, position) =>
      slot && slot.group === qualifier.group ? [position] : [],
    );
    let best = 0;
    let bestRound = -1;
    open.forEach((position, index) => {
      const round = mates.length
        ? Math.min(...mates.map((mate) => meetingRound(mate, position)))
        : Number.MAX_SAFE_INTEGER;
      if (round > bestRound) {
        bestRound = round;
        best = index;
      }
    });
    slots[open[best]] = qualifier;
    open.splice(best, 1);
  }

  return slots.map((slot) => (slot ? slot.entrant : null));
}

/**
 * 由小组赛场次（roundNo = 0，round = 组别代码）统计各组人数。scoring 计算出线名次用的也是
 * 小组赛场次，所以按这个人数画的骨架和实际出线人数一致（某组人数少于每组出线数时只出线该组人数）。
 */
export function groupSizesFromGroupMatches(
  matches: Array<{
    roundNo?: number | null;
    round?: string | number | null;
    side1Id?: string | null;
    side2Id?: string | null;
  }>,
): Map<string, number> {
  const members = new Map<string, Set<string>>();
  for (const match of matches) {
    if ((match.roundNo ?? 0) !== 0) continue;
    const code = String(match.round ?? '').trim();
    if (!code) continue;
    const ids = members.get(code) ?? new Set<string>();
    if (match.side1Id) ids.add(match.side1Id);
    if (match.side2Id) ids.add(match.side2Id);
    members.set(code, ids);
  }
  return new Map([...members].map(([code, ids]) => [code, ids.size]));
}

/**
 * 生成小组赛之后的单淘汰对阵骨架。出线名额不足 2 时返回 null（无淘汰赛可画）。
 * @param groupCodes 小组代码（A/B/…，来自 roundNo=0 场次的 round）
 * @param qualifiersPerGroup 每组出线数（event.qualifiersPerGroup，默认 2）
 * @param groupSizes 各组人数（可选）；某组人数少于每组出线数时只出线该组人数，缺省按每组出线数
 */
export function buildKnockoutSkeleton(
  groupCodes: string[],
  qualifiersPerGroup: number,
  groupSizes?: ReadonlyMap<string, number>,
): KnockoutSkeleton | null {
  const codes = [...new Set(groupCodes.filter((c) => c && c.trim()))].sort(compareGroupCode);
  if (!codes.length) return null;
  const q = Math.max(1, qualifiersPerGroup || 2);

  const qualifiers: Array<GroupQualifier<{ id: string; name: string }>> = [];
  for (const code of codes) {
    const count = Math.min(q, groupSizes?.get(code) ?? q);
    for (let rank = 1; rank <= count; rank += 1) {
      qualifiers.push({
        group: code,
        rank,
        entrant: { id: `ph-${code}-${rank}`, name: `${code}组第${rank}名` },
      });
    }
  }
  if (qualifiers.length < 2) return null;

  const slotEntrants = placeGroupQualifiers(codes, qualifiers);
  const bracketSize = slotEntrants.length;

  const participants: SkeletonParticipant[] = slotEntrants.map((entrant, index) =>
    entrant
      ? { id: entrant.id, position: index + 1, name: entrant.name, isBye: false }
      : { id: `sk-bye-${index + 1}`, position: index + 1, name: '— 轮空 —', isBye: true },
  );

  const matches = buildSkeletonMatches(slotEntrants);
  return { bracketSize, participants, matches };
}

function buildSkeletonMatches(slotEntrants: Array<{ id: string } | null>): SkeletonMatch[] {
  const entrantCount = slotEntrants.filter(Boolean).length;
  const matches: SkeletonMatch[] = [];
  let roundNo = 1;
  let current = slotEntrants.map((e) => ({ id: e?.id ?? null, pendingWinner: false }));

  while (current.length >= 2) {
    const code = roundCode(current.length);
    const next: Array<{ id: string | null; pendingWinner: boolean }> = [];
    for (let i = 0; i < current.length; i += 2) {
      const s1 = current[i];
      const s2 = current[i + 1];
      const id1 = s1?.id ?? null;
      const id2 = s2?.id ?? null;
      const s1Bye = !id1 && !s1?.pendingWinner;
      const s2Bye = !id2 && !s2?.pendingWinner;
      const bothByes = s1Bye && s2Bye;
      const hasBye = (Boolean(id1) && s2Bye) || (Boolean(id2) && s1Bye);
      matches.push({
        id: `sk-${roundNo}-${i / 2 + 1}`,
        round: code,
        roundNo,
        matchNo: i / 2 + 1,
        side1Id: id1,
        side2Id: id2,
        status: hasBye || bothByes ? 'COMPLETED' : 'PENDING',
        winnerSide: hasBye ? (id1 ? 1 : 2) : null,
      });
      next.push({ id: hasBye ? (id1 ?? id2) : null, pendingWinner: !hasBye && !bothByes });
    }
    current = next;
    roundNo += 1;
  }

  const finalRoundNo = roundNo - 1;
  if (entrantCount >= 4 && finalRoundNo > 1) {
    matches.push({
      id: `sk-bronze`,
      round: 'BRONZE',
      roundNo: finalRoundNo,
      matchNo: 2,
      side1Id: null,
      side2Id: null,
      status: 'PENDING',
      winnerSide: null,
    });
  }
  return matches;
}

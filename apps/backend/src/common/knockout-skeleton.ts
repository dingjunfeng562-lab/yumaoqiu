/**
 * 单淘汰「对阵骨架」：GROUP_PLUS_KNOCKOUT_STD 小组赛出线前，按「组数 × 每组出线数」
 * 预先生成第二阶段淘汰赛对阵树，签位用「X组第N名」占位。小组赛出线后由
 * scoring.fillGroupKnockoutIfReady 落库真实签表无缝替换。
 *
 * 种子序与 scoring.service 的 canonicalSeedOrder / buildEliminationDrafts 一致
 * （此处为纯函数实现，供 public 对阵表、抽签编排、秩序册导出复用，不落库）。
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

/** 标准种子位顺序（1 v 末位、对半递归），与 scoring.canonicalSeedOrder 一致。 */
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

/**
 * 生成第二阶段对阵骨架。出线名额不足 2 时返回 null（无淘汰赛可画）。
 * @param groupCodes 小组代码（A/B/…，来自 roundNo=0 场次的 round）
 * @param qualifiersPerGroup 每组出线数（event.qualifiersPerGroup，默认 2）
 */
export function buildKnockoutSkeleton(
  groupCodes: string[],
  qualifiersPerGroup: number,
): KnockoutSkeleton | null {
  const codes = [...new Set(groupCodes.filter((c) => c && c.trim()))].sort(compareGroupCode);
  if (!codes.length) return null;
  const q = Math.max(1, qualifiersPerGroup || 2);

  // 种子序：各组第 1 名（按组别顺序）在前，再各组第 2 名……与 scoring 出线种子序一致。
  const labels: Array<{ id: string; name: string }> = [];
  for (let rank = 1; rank <= q; rank += 1) {
    for (const code of codes) {
      labels.push({ id: `ph-${code}-${rank}`, name: `${code}组第${rank}名` });
    }
  }
  const n = labels.length;
  if (n < 2) return null;

  const bracketSize = 2 ** Math.ceil(Math.log2(n));
  const slotEntrants = canonicalSeedOrder(bracketSize).map((seedNo) =>
    seedNo <= n ? labels[seedNo - 1] : null,
  );

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

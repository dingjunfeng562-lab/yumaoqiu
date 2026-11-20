import { MatchStatus } from '@prisma/client';

/**
 * 「换签位」的纯计算层：只负责根据签位/小组成员算出目标对阵，
 * 以及把目标对阵和现有场次做 reconcile（原地更新，保住场次 id、排程、裁判与比分关联）。
 *
 * 抽签（首次/重抽）仍然走删除重建；只有换签位这种「对阵结构不变、只是人换了位置」
 * 的场景才用这里的结果做原地更新，避免清空赛程、裁判、签到和已录比分。
 */

export type EliminationSlotInput = {
  entrantId: string | null;
  isBye: boolean;
};

export type EliminationDraft = {
  round: string;
  roundNo: number;
  matchNo: number;
  side1Id: string | null;
  side2Id: string | null;
  status: MatchStatus;
  winnerSide: number | null;
};

/** 与 DrawAlgorithmService.roundLabel 保持一致（该方法是纯函数，这里独立出来便于复用）。 */
export function roundLabelForSlotCount(slotCount: number) {
  if (slotCount === 2) return 'F';
  if (slotCount === 4) return 'SF';
  if (slotCount === 8) return 'QF';
  return `R${Math.log2(slotCount) - 3}`;
}

/**
 * 单淘汰签表 → 全部轮次对阵。
 * 轮空规则与抽签时完全一致：一方有人一方轮空 → 直接判晋级；双方皆轮空 → 空场
 * （COMPLETED 且无胜者），继续把「真实轮空」往下传，避免永远打不动的 PENDING 卡住后续。
 */
export function buildEliminationDrafts(
  slots: EliminationSlotInput[],
  options: { bronze?: boolean } = {},
): EliminationDraft[] {
  const drafts: EliminationDraft[] = [];
  const entrantCount = slots.filter((slot) => !slot.isBye && slot.entrantId).length;
  let roundNo = 1;
  let currentSlots: Array<{ entrantId: string | null; isPendingWinner: boolean }> = slots.map((slot) => ({
    entrantId: slot.isBye ? null : slot.entrantId,
    isPendingWinner: false,
  }));

  while (currentSlots.length >= 2) {
    const roundLabel = roundLabelForSlotCount(currentSlots.length);
    const nextSlots: Array<{ entrantId: string | null; isPendingWinner: boolean }> = [];
    for (let i = 0; i < currentSlots.length; i += 2) {
      const side1 = currentSlots[i];
      const side2 = currentSlots[i + 1];
      const side1Id = side1?.entrantId ?? null;
      const side2Id = side2?.entrantId ?? null;
      const side1IsRealBye = !side1Id && !side1?.isPendingWinner;
      const side2IsRealBye = !side2Id && !side2?.isPendingWinner;
      const bothByes = side1IsRealBye && side2IsRealBye;
      const hasBye = (Boolean(side1Id) && side2IsRealBye) || (Boolean(side2Id) && side1IsRealBye);
      drafts.push({
        round: roundLabel,
        roundNo,
        matchNo: i / 2 + 1,
        side1Id,
        side2Id,
        status: hasBye || bothByes ? MatchStatus.COMPLETED : MatchStatus.PENDING,
        winnerSide: hasBye ? (side1Id ? 1 : 2) : null,
      });
      nextSlots.push({
        entrantId: hasBye ? (side1Id ?? side2Id) : null,
        isPendingWinner: !hasBye && !bothByes,
      });
    }
    currentSlots = nextSlots;
    roundNo += 1;
  }

  const finalRoundNo = roundNo - 1;
  if (options.bronze && entrantCount >= 4 && finalRoundNo > 1) {
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

  return drafts;
}

/** 小组内单循环：按成员顺序 i<j 两两配对，matchNo 从 1 连续编号（与 materializeGroupStage 一致）。 */
export function buildGroupFixtureDrafts(entrantIds: string[]) {
  const drafts: Array<{ matchNo: number; side1Id: string; side2Id: string }> = [];
  for (let i = 0; i < entrantIds.length; i += 1) {
    for (let j = i + 1; j < entrantIds.length; j += 1) {
      drafts.push({ matchNo: drafts.length + 1, side1Id: entrantIds[i], side2Id: entrantIds[j] });
    }
  }
  return drafts;
}

export type ExistingMatch = { id: string; roundNo: number; matchNo: number };

export type MatchReconcilePlan = {
  updates: Array<{ id: string; draft: EliminationDraft }>;
  creates: EliminationDraft[];
  deletes: string[];
};

function matchKey(roundNo: number, matchNo: number) {
  return `${roundNo}#${matchNo}`;
}

/**
 * 把目标对阵与现有场次按 (roundNo, matchNo) 对齐：
 * - 同键 → 原地 update（只改对阵与状态，不动场地/时间/裁判/时长）；
 * - 目标多出来的 → 新建；
 * - 现有多出来的 → 删除（只会在签表规模变化时发生，换签位不会）。
 */
export function planMatchReconcile(
  existing: ExistingMatch[],
  drafts: EliminationDraft[],
): MatchReconcilePlan {
  const byKey = new Map<string, ExistingMatch>();
  for (const match of existing) {
    const key = matchKey(match.roundNo, match.matchNo);
    if (!byKey.has(key)) byKey.set(key, match);
  }
  const plan: MatchReconcilePlan = { updates: [], creates: [], deletes: [] };
  const used = new Set<string>();
  for (const draft of drafts) {
    const key = matchKey(draft.roundNo, draft.matchNo);
    const current = byKey.get(key);
    if (current) {
      used.add(current.id);
      plan.updates.push({ id: current.id, draft });
    } else {
      plan.creates.push(draft);
    }
  }
  for (const match of byKey.values()) {
    if (!used.has(match.id)) plan.deletes.push(match.id);
  }
  return plan;
}

/** 交换两个签位上的内容（纯函数，便于单测）。返回 null 表示两个位置相同。 */
export function swapPositions<T>(items: T[], positionA: number, positionB: number): T[] | null {
  const indexA = positionA - 1;
  const indexB = positionB - 1;
  if (indexA === indexB) return null;
  if (indexA < 0 || indexB < 0 || indexA >= items.length || indexB >= items.length) return null;
  const next = [...items];
  [next[indexA], next[indexB]] = [next[indexB], next[indexA]];
  return next;
}

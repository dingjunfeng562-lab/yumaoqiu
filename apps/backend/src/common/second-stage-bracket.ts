/**
 * 第二阶段（前8/前6晋级赛）赛事拓扑的单一事实来源。
 *
 * draws / scoring / scheduling 三个模块此前各自维护一份 roundNo 映射、依赖映射和推进
 * 关系，极易漂移。这里集中定义：场次编号 → 正式 Match roundNo、胜负推进有向边，以及由
 * 推进边反推出的"依赖来源"映射，供三方复用，保证拓扑只有一处定义。
 *
 * 约定：第二阶段的正式 Match 用 roundNo ≥ SECOND_STAGE_FORMAL_ROUND_NO_BASE 与一阶段
 * 对阵图隔离；second_stage_match（planning 表）退化为正式 Match 的投影，结果统一通过裁判端
 * 记分正式 Match 录入后同步回 planning。
 */

/** 第二阶段正式 Match 的 roundNo 起始基准值（≥ 此值即第二阶段正式赛）。 */
export const SECOND_STAGE_FORMAL_ROUND_NO_BASE = 100;

/** 第二阶段胜负推进的一条有向边：源场次的 winner/loser 进入目标场次的某一侧。 */
export type SecondStagePropagationEdge = {
  sourceNo: number;
  outcome: 'winner' | 'loser';
  targetNo: number;
  targetSide: 1 | 2;
  /** 仅 TOP_8 排名模式生效（TOP_6 不打 7/8 名，第 12 场不存在）。 */
  top8Only?: boolean;
};

/**
 * 第二阶段全部推进边（拓扑唯一定义源）。
 * 1-4：前8初始赛；5/6：1-4名半决赛；7：决赛；8：3-4名；9/10：5-8名半决赛；11：5-6名；12：7-8名。
 */
export const SECOND_STAGE_PROPAGATION_EDGES: readonly SecondStagePropagationEdge[] = [
  { sourceNo: 1, outcome: 'winner', targetNo: 5, targetSide: 1 },
  { sourceNo: 2, outcome: 'winner', targetNo: 5, targetSide: 2 },
  { sourceNo: 3, outcome: 'winner', targetNo: 6, targetSide: 1 },
  { sourceNo: 4, outcome: 'winner', targetNo: 6, targetSide: 2 },

  { sourceNo: 1, outcome: 'loser', targetNo: 9, targetSide: 1 },
  { sourceNo: 2, outcome: 'loser', targetNo: 9, targetSide: 2 },
  { sourceNo: 3, outcome: 'loser', targetNo: 10, targetSide: 1 },
  { sourceNo: 4, outcome: 'loser', targetNo: 10, targetSide: 2 },

  { sourceNo: 5, outcome: 'winner', targetNo: 7, targetSide: 1 },
  { sourceNo: 6, outcome: 'winner', targetNo: 7, targetSide: 2 },
  { sourceNo: 5, outcome: 'loser', targetNo: 8, targetSide: 1 },
  { sourceNo: 6, outcome: 'loser', targetNo: 8, targetSide: 2 },

  { sourceNo: 9, outcome: 'winner', targetNo: 11, targetSide: 1 },
  { sourceNo: 10, outcome: 'winner', targetNo: 11, targetSide: 2 },
  { sourceNo: 9, outcome: 'loser', targetNo: 12, targetSide: 1, top8Only: true },
  { sourceNo: 10, outcome: 'loser', targetNo: 12, targetSide: 2, top8Only: true },
];

/** A-H 八个签位编码，按 1-4 初始赛配对顺序排列。 */
export const SECOND_STAGE_SLOT_CODES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;
export type SecondStageSlotCode = (typeof SECOND_STAGE_SLOT_CODES)[number];

/** 1-4 初始赛两侧分别取自哪个 A-H 签位。 */
export const SECOND_STAGE_INITIAL_SLOT_SIDES: Record<number, { side1: SecondStageSlotCode; side2: SecondStageSlotCode }> = {
  1: { side1: 'A', side2: 'B' },
  2: { side1: 'C', side2: 'D' },
  3: { side1: 'E', side2: 'F' },
  4: { side1: 'G', side2: 'H' },
};

/** 找到喂入「目标场次某一侧」的那条推进边（每个目标侧恰由一条边喂入）。 */
export function secondStageEdgeFor(
  targetNo: number,
  targetSide: 1 | 2,
): SecondStagePropagationEdge | undefined {
  return SECOND_STAGE_PROPAGATION_EDGES.find(
    (edge) => edge.targetNo === targetNo && edge.targetSide === targetSide,
  );
}

/**
 * 由 A-H 签位的轮空情况，静态推导出每个场次两侧是否为「轮空空位」。
 *
 * 这一分类只取决于哪些签位是轮空，与真实比赛谁胜谁负无关：
 * - 初始赛（1-4）某侧轮空 = 对应 A-H 签位为轮空；
 * - 「胜者」喂入的侧：源场次两侧都轮空（幽灵场，无胜者）时才是轮空；
 * - 「负者」喂入的侧：源场次任一侧轮空（不战而胜，无真实负者）时即为轮空。
 *
 * @param slotIsBye 判断某签位是否轮空（无选手）。
 * @returns matchNo → { side1, side2 } 是否轮空。
 */
export function computeSecondStageSideByes(
  slotIsBye: (slot: SecondStageSlotCode) => boolean,
): Map<number, { side1: boolean; side2: boolean }> {
  const cache = new Map<number, { side1: boolean; side2: boolean }>();

  const sideBye = (matchNo: number, side: 1 | 2): boolean => {
    const initial = SECOND_STAGE_INITIAL_SLOT_SIDES[matchNo];
    if (initial) {
      return slotIsBye(side === 1 ? initial.side1 : initial.side2);
    }
    const edge = secondStageEdgeFor(matchNo, side);
    if (!edge) return true; // 无喂入边（如 TOP_6 下不存在的来源）视为空
    const source = compute(edge.sourceNo); // 来源 matchNo 恒小于当前，递归安全
    return edge.outcome === 'winner'
      ? source.side1 && source.side2 // 胜者：两侧皆轮空才无胜者
      : source.side1 || source.side2; // 负者：任一侧轮空即无真实负者
  };

  const compute = (matchNo: number) => {
    const cached = cache.get(matchNo);
    if (cached) return cached;
    const result = { side1: sideBye(matchNo, 1), side2: sideBye(matchNo, 2) };
    cache.set(matchNo, result);
    return result;
  };

  for (let matchNo = 1; matchNo <= 12; matchNo += 1) compute(matchNo);
  return cache;
}

/** roundNo ≥ BASE 即第二阶段正式赛。 */
export function isSecondStageFormalRoundNo(roundNo: number): boolean {
  return roundNo >= SECOND_STAGE_FORMAL_ROUND_NO_BASE;
}

/** 第二阶段场次编号 → 对应正式 Match 的 roundNo（用于定位 / 推进 / 调度依赖）。 */
export function secondStageFormalRoundNo(matchNo: number): number {
  if (matchNo >= 1 && matchNo <= 4) return SECOND_STAGE_FORMAL_ROUND_NO_BASE;
  if ([5, 6, 9, 10].includes(matchNo)) return SECOND_STAGE_FORMAL_ROUND_NO_BASE + 1;
  return SECOND_STAGE_FORMAL_ROUND_NO_BASE + 2;
}

/** 目标场次 → 其上游来源场次编号（由推进边反推；调度判断依赖是否就绪时使用）。 */
const SECOND_STAGE_DEPENDENCY_MATCH_NOS: ReadonlyMap<number, readonly number[]> = (() => {
  const map = new Map<number, number[]>();
  for (const edge of SECOND_STAGE_PROPAGATION_EDGES) {
    const sources = map.get(edge.targetNo) ?? [];
    if (!sources.includes(edge.sourceNo)) sources.push(edge.sourceNo);
    map.set(edge.targetNo, sources);
  }
  for (const sources of map.values()) sources.sort((a, b) => a - b);
  return map;
})();

/**
 * 返回目标场次的上游来源场次编号（升序）。无上游（如 1-4 初始赛）返回空数组。
 * 注意：含 TOP_8 专属的第 12 场来源——但第 12 场本身仅在 TOP_8 模式下生成，故无副作用。
 */
export function secondStageDependencyMatchNos(matchNo: number): readonly number[] {
  return SECOND_STAGE_DEPENDENCY_MATCH_NOS.get(matchNo) ?? [];
}

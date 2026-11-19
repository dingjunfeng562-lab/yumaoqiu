import { GroupPlan } from './draw-algorithm.service';

/** 抽签当时的分组设置快照，写在 EXECUTE 操作日志的 afterData.groupSettings 里。 */
export type DrawnGroupSettings = {
  groupSize: number | null;
  groupCount: number | null;
  qualifiersPerGroup: number | null;
};

/** 当前签表的分组与「按单项现在的分组设置重新抽签」的分组不一致时，抽签编排页据此显示警告。 */
export type GroupPlanDrift = {
  currentGroupCount: number;
  currentSizes: number[];
  planGroupCount: number;
  planSizes: number[];
  /** 抽签之后改过分组设置（有快照且与现在不同）。 */
  settingsChangedAfterDraw: boolean;
};

export function drawnGroupSettingsSnapshot(event: {
  groupSize?: number | null;
  groupCount?: number | null;
  qualifiersPerGroup?: number | null;
}): DrawnGroupSettings {
  return {
    groupSize: event.groupSize ?? null,
    groupCount: event.groupCount ?? null,
    qualifiersPerGroup: event.qualifiersPerGroup ?? null,
  };
}

/** 从 EXECUTE 日志的 afterData 读出抽签当时的分组设置；旧签表没有这份快照，返回 null。 */
export function readDrawnGroupSettings(afterData: unknown): DrawnGroupSettings | null {
  if (!afterData || typeof afterData !== 'object' || Array.isArray(afterData)) return null;
  const value = (afterData as Record<string, unknown>).groupSettings;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const read = (key: keyof DrawnGroupSettings) => {
    const raw = (value as Record<string, unknown>)[key];
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
  };
  return {
    groupSize: read('groupSize'),
    groupCount: read('groupCount'),
    qualifiersPerGroup: read('qualifiersPerGroup'),
  };
}

function sameSizes(a: number[], b: number[]) {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort((x, y) => y - x);
  const sortedB = [...b].sort((x, y) => y - x);
  return sortedA.every((value, index) => value === sortedB[index]);
}

/**
 * 判断是否提示「当前签表与分组设置不一致，需要重新抽签」。
 * - 分组计划有错（如会出现 1 人组）时不在这里提示，抽签编排页另有错误提示；
 * - 两边每组人数一样（不计组的顺序）就不提示；
 * - 抽签后改过分组设置：提示（这正是「改了设置但没重抽」的情况）；
 * - 没有快照的旧签表是按旧规则（每组最多 4 人、出线凑 2 的幂）抽的，和新规则对不上很正常：
 *   只有未发布、也没有打过比赛的才提示，避免诱导组织者把正在进行的比赛重抽掉。
 *   有快照但设置没改（只是报名人数变了）同样按这条处理。
 */
export function groupPlanDrift(input: {
  plan: GroupPlan | null;
  currentSizes: number[];
  event: { groupSize?: number | null; groupCount?: number | null; drawPublished: boolean };
  drawnWith: DrawnGroupSettings | null;
  playedMatches: number;
}): GroupPlanDrift | null {
  const { plan, currentSizes, event, drawnWith, playedMatches } = input;
  if (!plan || plan.errors.length || !plan.sizes.length || !currentSizes.length) return null;
  if (sameSizes(currentSizes, plan.sizes)) return null;

  const settingsChangedAfterDraw =
    drawnWith !== null &&
    (drawnWith.groupSize !== (event.groupSize ?? null) ||
      drawnWith.groupCount !== (event.groupCount ?? null));
  const safeToSuggest = !event.drawPublished && playedMatches === 0;
  if (!settingsChangedAfterDraw && !safeToSuggest) return null;

  return {
    currentGroupCount: currentSizes.length,
    currentSizes,
    planGroupCount: plan.groupCount,
    planSizes: plan.sizes,
    settingsChangedAfterDraw,
  };
}

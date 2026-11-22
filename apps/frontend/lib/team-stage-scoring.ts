// 团体赛子项计分的文字说明，以及「小组赛 + 淘汰赛」赛制下分阶段计分的表单换算。
// 纯函数，不依赖 React / antd，便于用 node --test 直接测试。
// 分阶段规则的结构与后端 TeamCompetition.stageScoringRules 一致：{ GROUP?, KNOCKOUT? }。

export type TeamStageKey = 'GROUP' | 'KNOCKOUT';

export type TeamStageRule = {
  scoringRule?: string;
  customGamePoint?: number | null;
  customGameCap?: number | null;
  customGamesToWin?: number | null;
};

export type TeamStageRules = Partial<Record<TeamStageKey, TeamStageRule>>;

/** 表单里每个阶段的取值：mode 为 default（同默认规则）、预设规则值或 custom。 */
export type TeamStageFormValues = Partial<Record<TeamStageKey, {
  mode?: string;
  point?: number | null;
  cap?: number | null;
  games?: number | null;
}>>;

export const TEAM_STAGE_DEFS = [
  { key: 'GROUP', label: '小组赛', description: '各小组循环赛的全部子项' },
  { key: 'KNOCKOUT', label: '淘汰赛', description: '小组出线后的全部轮次，含季军赛' },
] as const satisfies ReadonlyArray<{ key: TeamStageKey; label: string; description: string }>;

const PRESET_SCORING: Record<string, { point: number; gamesToWin: number }> = {
  FIFTEEN_ONE: { point: 15, gamesToWin: 1 },
  FIFTEEN_BO3: { point: 15, gamesToWin: 2 },
  TWENTYONE_BO3: { point: 21, gamesToWin: 2 },
  THIRTYONE_BO3: { point: 31, gamesToWin: 2 },
};

type ScoringSource = {
  scoringRule: string;
  customGamePoint?: number | null;
  customGamesToWin?: number | null;
};

/** 一套计分规则的文字：如「21 分 3 局 2 胜」「11 分 1 局」。 */
export function scoringRuleText(rule: ScoringSource) {
  const preset = PRESET_SCORING[rule.scoringRule] ?? PRESET_SCORING.TWENTYONE_BO3;
  const point = rule.customGamePoint || preset.point;
  const gamesToWin = rule.customGamesToWin || preset.gamesToWin;
  return gamesToWin === 1 ? `${point} 分 1 局` : `${point} 分 ${gamesToWin * 2 - 1} 局 ${gamesToWin} 胜`;
}

/**
 * 某个阶段实际生效的规则，与后端 resolveStageScoringRule 一致：
 * 未设置（既没有预设也没有自定义分数）时返回 null，表示沿用默认规则；
 * 选了预设时不再继承默认规则里的自定义分数。
 */
export function teamStageRule(base: ScoringSource, stage?: TeamStageRule | null): ScoringSource | null {
  if (!stage || (!stage.scoringRule && !stage.customGamePoint)) return null;
  return {
    scoringRule: stage.scoringRule ?? base.scoringRule,
    customGamePoint: stage.customGamePoint ?? null,
    customGamesToWin: stage.customGamesToWin ?? null,
  };
}

/** 团体赛子项计分：分阶段时为「小组赛 21 分 1 局，淘汰赛 15 分 3 局 2 胜」，否则同 scoringRuleText。 */
export function teamScoringSummary(competition: ScoringSource & { stageScoringRules?: TeamStageRules | null }) {
  const base = scoringRuleText(competition);
  const rules = competition.stageScoringRules;
  const group = teamStageRule(competition, rules?.GROUP);
  const knockout = teamStageRule(competition, rules?.KNOCKOUT);
  if (!group && !knockout) return base;
  return `小组赛 ${group ? scoringRuleText(group) : base}，淘汰赛 ${knockout ? scoringRuleText(knockout) : base}`;
}

/** 已保存的分阶段规则 → 表单取值；没有设置的阶段显示「同默认」。 */
export function teamStageFormValues(rules?: TeamStageRules | null): TeamStageFormValues {
  const values: TeamStageFormValues = {};
  for (const { key } of TEAM_STAGE_DEFS) {
    const stage = rules?.[key];
    values[key] = stage?.customGamePoint
      ? { mode: 'custom', point: stage.customGamePoint, cap: stage.customGameCap ?? undefined, games: stage.customGamesToWin ?? 1 }
      : { mode: stage?.scoringRule ?? 'default', point: undefined, cap: undefined, games: undefined };
  }
  return values;
}

/** 表单取值 → 提交给后端的分阶段规则；全部为「同默认」时返回 null（清空）。 */
export function teamStagePayload(values?: TeamStageFormValues | null): TeamStageRules | null {
  const rules: TeamStageRules = {};
  for (const { key } of TEAM_STAGE_DEFS) {
    const stage = values?.[key];
    const mode = stage?.mode ?? 'default';
    if (mode === 'default') continue;
    if (mode === 'custom') {
      if (!stage?.point) continue;
      rules[key] = { customGamePoint: stage.point, customGameCap: stage.cap ?? null, customGamesToWin: stage.games ?? 1 };
    } else {
      rules[key] = { scoringRule: mode };
    }
  }
  return Object.keys(rules).length ? rules : null;
}

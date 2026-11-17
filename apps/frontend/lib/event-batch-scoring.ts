/**
 * 单项管理「批量改规则」的计算部分：把弹窗里选的改法，换算成每个单项要提交的 PATCH /events/:id 内容。
 * 只提交真的有变化的字段；没勾「修改」的部分、选「不修改」的阶段保持各单项原样。
 */

export const SCORING_RULE_LABELS: Record<string, string> = {
  FIFTEEN_ONE: '15分1局',
  FIFTEEN_BO3: '15分3局2胜',
  TWENTYONE_BO3: '21分3局2胜',
  THIRTYONE_BO3: '31分3局2胜',
};

export const SCORING_MODE_LABELS: Record<string, string> = {
  CAPPED_30: '封顶30分',
  STANDARD_GOLDEN: '标准金球制',
};

export type StageRule = {
  scoringRule?: string;
  customGamePoint?: number | null;
  customGameCap?: number | null;
  customGamesToWin?: number | null;
};

export type ScoringEvent = {
  id: string;
  format: string;
  scoringRule: string;
  scoringMode: string;
  customGamePoint?: number | null;
  customGameCap?: number | null;
  customGamesToWin?: number | null;
  stageScoringRules?: Record<string, StageRule> | null;
  mixHostId?: string | null;
};

/** 一套规则：预设，或自定义每局分数（+ 封顶分、胜出局数）。 */
export type RuleChoice =
  | { kind: 'preset'; scoringRule: string }
  | { kind: 'custom'; point: number; cap?: number | null; gamesToWin: number };

/** 分阶段规则的改法：不修改 / 清掉（沿用上级规则）/ 换成一套规则。 */
export type StageChoice = { kind: 'keep' } | { kind: 'clear' } | RuleChoice;

export type BatchScoringChange = {
  /** 不填 = 默认规则不修改。 */
  defaultRule?: RuleChoice;
  /** 不填 = 计分模式不修改。 */
  scoringMode?: string;
  /** 阶段 key → 改法；没列出的阶段不修改。 */
  stages: Record<string, StageChoice>;
};

export type BatchPlanStatus = 'change' | 'same' | 'mix-member';

export type BatchPlan<T extends ScoringEvent = ScoringEvent> = {
  event: T;
  status: BatchPlanStatus;
  /** 要提交的字段；没有变化或跳过时为 null。 */
  patch: Record<string, unknown> | null;
  /** 选了修改、但这个单项的赛制没有该阶段而跳过的阶段 key。 */
  skippedStages: string[];
};

/** 规则本身是否填完整、合理；返回错误文字，没问题返回 null。 */
export function ruleChoiceError(choice: RuleChoice): string | null {
  if (choice.kind === 'preset') return SCORING_RULE_LABELS[choice.scoringRule] ? null : '请选择计分规则';
  if (!Number.isInteger(choice.point) || choice.point < 1 || choice.point > 999) return '每局分数要在 1–999 之间';
  if (!Number.isInteger(choice.gamesToWin) || choice.gamesToWin < 1 || choice.gamesToWin > 9) return '胜出局数要在 1–9 之间';
  if (choice.cap != null) {
    if (!Number.isInteger(choice.cap) || choice.cap > 999) return '封顶分不能超过 999';
    if (choice.cap < choice.point) return '封顶分不能小于每局分数';
  }
  return null;
}

export function customRuleSummary(point: number, cap?: number | null, gamesToWin?: number | null) {
  const capText = cap && cap > point ? `（封顶${cap}）` : '';
  const gamesText = gamesToWin && gamesToWin > 1 ? `，${gamesToWin * 2 - 1}局${gamesToWin}胜` : '，单局制';
  return `${point}分/局${capText}${gamesText}`;
}

/** 单项的默认规则，与单项管理表格的「计分规则」列写法一致。 */
export function defaultRuleSummary(event: ScoringEvent) {
  return event.customGamePoint
    ? `自定义：${customRuleSummary(event.customGamePoint, event.customGameCap, event.customGamesToWin)}`
    : SCORING_RULE_LABELS[event.scoringRule] || event.scoringRule;
}

export function stageRuleSummary(stage: StageRule) {
  if (stage.customGamePoint) return customRuleSummary(stage.customGamePoint, stage.customGameCap, stage.customGamesToWin);
  if (stage.scoringRule) return SCORING_RULE_LABELS[stage.scoringRule] ?? stage.scoringRule;
  return '同上级';
}

function isCustom(event: ScoringEvent) {
  return Boolean(event.customGamePoint || event.customGameCap || event.customGamesToWin);
}

function stageRuleOf(choice: RuleChoice): StageRule {
  return choice.kind === 'preset'
    ? { scoringRule: choice.scoringRule }
    : { customGamePoint: choice.point, customGameCap: choice.cap ?? null, customGamesToWin: choice.gamesToWin };
}

/** 后端存的阶段规则只有两种形状；无效（两样都没有）的阶段等同没设置。 */
function stageKey(stage: StageRule | undefined) {
  if (!stage) return '';
  if (stage.customGamePoint) return `c:${stage.customGamePoint}:${stage.customGameCap ?? ''}:${stage.customGamesToWin ?? 1}`;
  if (stage.scoringRule) return `p:${stage.scoringRule}`;
  return '';
}

function sameStageRules(a: Record<string, StageRule>, b: Record<string, StageRule>) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((key) => stageKey(a[key]) === stageKey(b[key]));
}

/**
 * 算出每个单项要提交的内容。
 * - 并入混编的单项按主项目的规则比赛，改它不起作用，跳过（status = 'mix-member'）。
 * - 阶段规则在原有基础上合并：只动选了修改、且该赛制有这个阶段的 key。
 *   改八强时一并去掉旧两段配置的 BEFORE_TOP4（单个编辑保存时也会把它并进八强）。
 * - 所有字段都和现在一样时 status = 'same'，不提交。
 */
export function planBatchScoring<T extends ScoringEvent>(
  events: T[],
  change: BatchScoringChange,
  stageKeysFor: (format: string) => readonly string[],
): BatchPlan<T>[] {
  return events.map((event) => {
    if (event.mixHostId) return { event, status: 'mix-member', patch: null, skippedStages: [] };
    const patch: Record<string, unknown> = {};

    const rule = change.defaultRule;
    if (rule?.kind === 'preset') {
      if (event.scoringRule !== rule.scoringRule || isCustom(event)) {
        Object.assign(patch, { scoringRule: rule.scoringRule, customGamePoint: null, customGameCap: null, customGamesToWin: null });
      }
    } else if (rule?.kind === 'custom') {
      const cap = rule.cap ?? null;
      if (
        (event.customGamePoint ?? null) !== rule.point ||
        (event.customGameCap ?? null) !== cap ||
        (event.customGamesToWin ?? null) !== rule.gamesToWin
      ) {
        Object.assign(patch, { customGamePoint: rule.point, customGameCap: cap, customGamesToWin: rule.gamesToWin });
      }
    }

    if (change.scoringMode && change.scoringMode !== event.scoringMode) patch.scoringMode = change.scoringMode;

    const allowed = new Set(stageKeysFor(event.format));
    const current = { ...(event.stageScoringRules ?? {}) };
    const next = { ...current };
    const skippedStages: string[] = [];
    for (const [key, choice] of Object.entries(change.stages)) {
      if (choice.kind === 'keep') continue;
      if (!allowed.has(key)) {
        skippedStages.push(key);
        continue;
      }
      if (choice.kind === 'clear') delete next[key];
      else next[key] = stageRuleOf(choice);
      if (key === 'QF') delete next.BEFORE_TOP4;
    }
    if (!sameStageRules(current, next)) patch.stageScoringRules = Object.keys(next).length ? next : null;

    const changed = Object.keys(patch).length > 0;
    return { event, status: changed ? 'change' : 'same', patch: changed ? patch : null, skippedStages };
  });
}

/** 把要提交的内容套到单项上，用于预览「改后」的规则。 */
export function applyScoringPatch<T extends ScoringEvent>(event: T, patch: Record<string, unknown> | null): T {
  return patch ? ({ ...event, ...patch } as T) : event;
}

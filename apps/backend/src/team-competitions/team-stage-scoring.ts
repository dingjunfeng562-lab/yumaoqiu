import { BadRequestException } from '@nestjs/common';
import { Prisma, ScoringRule, TeamCompetitionFormat } from '@prisma/client';
import { isTeamGroupKnockout } from '../common/team-competition-format';
import { TEAM_STAGE_SCORING_KEYS, type TeamStageScoringRulesDto } from './dto/team-competition.dto';

export type TeamStageScoringKey = (typeof TEAM_STAGE_SCORING_KEYS)[number];

export type TeamStageScoringRule =
  | { scoringRule: ScoringRule }
  | { customGamePoint: number; customGameCap: number | null; customGamesToWin: number };

export type TeamStageScoringRules = Partial<Record<TeamStageScoringKey, TeamStageScoringRule>>;

const STAGE_LABELS: Record<TeamStageScoringKey, string> = { GROUP: '小组赛', KNOCKOUT: '淘汰赛' };

/**
 * 清洗团体赛分阶段计分：
 * - 只有「小组赛 + 淘汰赛」赛制才保留；其它赛制只有一个阶段，分阶段没有意义，一律清空
 * - 丢弃既没有预设规则、也没有自定义分数的阶段
 * - 自定义分数时封顶分不能小于每局分数，胜出局数默认 1
 * - 全部为空时返回 null（与「未配置」等价）
 */
export function normalizeTeamStageScoringRules(
  value: TeamStageScoringRulesDto | null | undefined,
  format: TeamCompetitionFormat,
): TeamStageScoringRules | null {
  if (!isTeamGroupKnockout(format) || !value) return null;
  const result: TeamStageScoringRules = {};
  for (const key of TEAM_STAGE_SCORING_KEYS) {
    const stage = value[key];
    if (!stage || (!stage.scoringRule && !stage.customGamePoint)) continue;
    if (stage.customGamePoint) {
      if (stage.customGameCap && stage.customGameCap < stage.customGamePoint) {
        throw new BadRequestException(`${STAGE_LABELS[key]}的封顶分不能小于每局分数`);
      }
      result[key] = {
        customGamePoint: stage.customGamePoint,
        customGameCap: stage.customGameCap ?? null,
        customGamesToWin: stage.customGamesToWin ?? 1,
      };
    } else if (stage.scoringRule) {
      result[key] = { scoringRule: stage.scoringRule };
    }
  }
  return Object.keys(result).length ? result : null;
}

/** 两份分阶段计分是否相同（与键顺序无关；null / undefined 视为未配置）。 */
export function sameTeamStageScoringRules(a: unknown, b: unknown): boolean {
  return canonical(a ?? null) === canonical(b ?? null);
}

/** 写库用：null 要存成 JSON null。 */
export function teamStageScoringJson(rules: TeamStageScoringRules | null) {
  return rules ?? Prisma.JsonNull;
}

function canonical(value: unknown): string {
  if (value === null || value === undefined || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
}

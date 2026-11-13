import { IsString, IsEnum, IsOptional, IsInt, Min, Max, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { EntrantType, EventType, Format, ScoringRule, ScoringMode } from '@prisma/client';

/**
 * 支持分阶段规则的键。
 * QF/TOP4/SF/BRONZE/F 是后台单项管理的可见阶段；BEFORE_TOP4 为旧两段配置兼容键。
 */
export const STAGE_SCORING_KEYS = ['BEFORE_TOP4', 'TOP4', 'QF', 'SF', 'BRONZE', 'F'] as const;
export type StageScoringKey = (typeof STAGE_SCORING_KEYS)[number];

/**
 * 单个阶段的计分规则覆盖。
 * 阶段覆盖是一套独立完整的规则，不继承单项级自定义分数：
 * 要么给 scoringRule（预设规则），要么给 customGamePoint（+ 可选封顶/胜出局数）。
 */
export class StageScoringRuleDto {
  @IsOptional()
  @IsEnum(ScoringRule)
  scoringRule?: ScoringRule;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(999)
  customGamePoint?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(999)
  customGameCap?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(9)
  customGamesToWin?: number;
}

export class StageScoringRulesDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => StageScoringRuleDto)
  BEFORE_TOP4?: StageScoringRuleDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => StageScoringRuleDto)
  TOP4?: StageScoringRuleDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => StageScoringRuleDto)
  QF?: StageScoringRuleDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => StageScoringRuleDto)
  SF?: StageScoringRuleDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => StageScoringRuleDto)
  BRONZE?: StageScoringRuleDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => StageScoringRuleDto)
  F?: StageScoringRuleDto;
}

export class CreateEventDto {
  @IsOptional() @IsString() groupId?: string;
  @IsString()
  tournamentId: string;

  @IsEnum(EventType)
  type: EventType;

  @IsOptional()
  @IsEnum(EntrantType)
  entrantType?: EntrantType;

  @IsEnum(Format)
  format: Format;

  @IsEnum(ScoringRule)
  scoringRule: ScoringRule;

  @IsEnum(ScoringMode)
  scoringMode: ScoringMode;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(999)
  customGamePoint?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(999)
  customGameCap?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(9)
  customGamesToWin?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => StageScoringRulesDto)
  stageScoringRules?: StageScoringRulesDto | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  defaultMatchMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(8)
  groupSize?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(26)
  groupCount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(8)
  qualifiersPerGroup?: number;

  /** 报名名额：单打按人、双打按队；为空表示不限。只限制扫码报名，后台添加不受限制。 */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  maxEntries?: number | null;
}

export class UpdateEventDto {
  @IsOptional() @IsString() groupId?: string;
  @IsOptional()
  @IsEnum(EventType)
  type?: EventType;

  @IsOptional()
  @IsEnum(EntrantType)
  entrantType?: EntrantType;

  @IsOptional()
  @IsEnum(Format)
  format?: Format;

  @IsOptional()
  @IsEnum(ScoringRule)
  scoringRule?: ScoringRule;

  @IsOptional()
  @IsEnum(ScoringMode)
  scoringMode?: ScoringMode;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(999)
  customGamePoint?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(999)
  customGameCap?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(9)
  customGamesToWin?: number | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => StageScoringRulesDto)
  stageScoringRules?: StageScoringRulesDto | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  defaultMatchMinutes?: number | null;

  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(8)
  groupSize?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(26)
  groupCount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(8)
  qualifiersPerGroup?: number;

  /** 报名名额：单打按人、双打按队；传 null 清空为不限。 */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  maxEntries?: number | null;
}

/** 删除单项：删除原因记入缴费操作记录。 */
export class DeleteEventDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsIn,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { GroupNaming, SecondStageRankingMode } from '@prisma/client';
import { GROUP_COUNT_MAX } from '../draw-algorithm.service';

/**
 * 抽签编排页直接修改当前单项的分组设置。每组人数与手动小组数量互斥：
 * 传了小组数量就按手动组数，否则按每组人数（null = 默认 4 人）。
 */
export class UpdateDrawGroupSettingsDto {
  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(8)
  groupSize?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(GROUP_COUNT_MAX)
  groupCount?: number | null;

  @IsInt()
  @Min(1)
  @Max(8)
  qualifiersPerGroup: number;
}

/** 抽签编排页切换小组编号方式：A、B、C（LETTER）或 1、2、3（NUMBER）。 */
export class UpdateDrawGroupNamingDto {
  @IsIn(['LETTER', 'NUMBER'])
  groupNaming: GroupNaming;
}

export class CreateRegistrationDto {
  @IsString()
  player1Id: string;

  @IsOptional()
  @IsString()
  player2Id?: string;

  @IsOptional()
  @IsBoolean()
  isSeed?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  seedRank?: number;
}

export class UpdateRegistrationDto {
  @IsOptional()
  @IsString()
  player1Id?: string;

  @IsOptional()
  @IsString()
  player2Id?: string | null;

  @IsOptional()
  @IsBoolean()
  isSeed?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  seedRank?: number | null;
}

export class GenerateDrawDto {
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

export class SeedItemDto {
  @IsString()
  entrantId: string;

  @IsInt()
  @Min(1)
  seedNo: number;
}

export class UpdateSeedsDto {
  @IsArray()
  @ArrayMaxSize(16)
  @ValidateNested({ each: true })
  @Type(() => SeedItemDto)
  seeds: SeedItemDto[];
}

export class SwapDrawSlotsDto {
  @IsString()
  drawId: string;

  @IsInt()
  @Min(1)
  positionA: number;

  @IsInt()
  @Min(1)
  positionB: number;
}

export class FreezeDrawDto {
  @IsString()
  drawId: string;
}

export class UnfreezeDrawDto {
  @IsString()
  drawId: string;
}

export class PublishDrawDto {
  @IsString()
  drawId: string;
}

export class UnpublishDrawDto {
  @IsString()
  drawId: string;
}

export class RedrawDrawDto {
  @IsBoolean()
  confirm: boolean;
}

export class CreateRedrawRequestDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

export class RejectRedrawRequestDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

export class ListRedrawRequestsQueryDto {
  @IsOptional()
  @IsString()
  eventId?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class GetDrawLogsQueryDto {
  @IsOptional()
  @IsString()
  drawId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number = 20;
}

export class SecondStageSlotDto {
  @IsIn(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'])
  slot: string;

  // 留空 / 未选 = 该签位轮空（无选手）。
  @IsOptional()
  @IsString()
  entrantId?: string | null;
}

export class ConfirmSecondStageDto {
  @IsEnum(SecondStageRankingMode)
  rankingMode: SecondStageRankingMode;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SecondStageSlotDto)
  slots: SecondStageSlotDto[];
}

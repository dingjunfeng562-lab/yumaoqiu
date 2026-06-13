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
  Min,
  ValidateNested,
} from 'class-validator';
import { SecondStageRankingMode } from '@prisma/client';

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

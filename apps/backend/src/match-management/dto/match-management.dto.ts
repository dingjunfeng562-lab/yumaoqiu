import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

/**
 * 超级管理员在“裁判员对局管理”中修改单场基础信息。
 * 只传需要变更的字段；三个排程字段任一存在时复用场地排程服务，
 * 从而保留团体赛“整场顺延”等既有联动。
 */
export class UpdateManagedMatchDto {
  @IsOptional()
  @IsDateString()
  scheduledAt?: string | null;

  @IsOptional()
  @IsString()
  venueId?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  durationMinutes?: number;

  @IsOptional()
  @IsString()
  refereeId?: string | null;
}

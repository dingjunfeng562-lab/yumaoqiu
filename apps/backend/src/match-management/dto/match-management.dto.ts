import { Type } from 'class-transformer';
import {
  IsDateString,
  IsBoolean,
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
  @IsBoolean()
  allowOutsideGroup?: boolean;

  @IsOptional()
  @IsBoolean()
  scheduleLocked?: boolean;
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

/**
 * 解除单场比赛的裁判接手，让比赛回到「未分配」。
 * 进行中的比赛必须显式确认（后台红色二次确认后传 true），已结束的比赛不允许解除。
 */
export class ReleaseRefereeDto {
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

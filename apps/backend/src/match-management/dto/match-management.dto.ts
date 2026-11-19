import { Type } from 'class-transformer';
import {
  IsDateString,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import {
  ALL_MATCH_PAGE_SIZES,
  ALL_MATCH_TABS,
  type AllMatchTab,
} from '../all-matches';

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

/**
 * 「全部场次」列表的查询条件（GET /match-management/matches）。
 * 范围始终限定在自己能管的赛事里（管理员只有自己创建的）；tournaments 里不属于自己的 id 直接忽略。
 * 日期由浏览器按本地时间算好起止时刻传过来（容器跑在 UTC，后端不自己算「今天」）。
 */
export class ListAllMatchesQueryDto {
  @IsOptional()
  @IsIn([...ALL_MATCH_TABS])
  tab?: AllMatchTab;

  /** 只看这些赛事，逗号分隔。 */
  @IsOptional()
  @IsString()
  @MaxLength(6000)
  tournaments?: string;

  /** 计划时间 ≥ from（ISO 时刻）。 */
  @IsOptional()
  @IsDateString()
  from?: string;

  /** 计划时间 < to（ISO 时刻）。 */
  @IsOptional()
  @IsDateString()
  to?: string;

  /** 搜选手 / 单位 / 队伍 / 裁判 / 场地 / 项目 / 赛事名。 */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  q?: string;

  /** 1（默认）= 只看未结束、未归档的赛事；0 = 全部赛事。 */
  @IsOptional()
  @IsIn(['0', '1'])
  activeOnly?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([...ALL_MATCH_PAGE_SIZES])
  pageSize?: number;
}

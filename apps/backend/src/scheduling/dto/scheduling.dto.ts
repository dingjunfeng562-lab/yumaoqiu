import { Type } from 'class-transformer';
import { VenueRuleMode } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class ScheduleBreakPeriodDto {
  @IsString()
  startTime: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24 * 60)
  durationMinutes: number;
}

export class CreateVenueDto {
  @IsString()
  name: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateVenueDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class AutoScheduleDto {
  @IsOptional()
  @IsBoolean()
  preview?: boolean;

  @IsOptional()
  @IsString()
  fingerprint?: string;
  @IsOptional()
  @IsBoolean()
  adjustTeamVenueCount?: boolean;

  @IsString()
  tournamentId: string;

  @IsOptional()
  @IsString()
  eventId?: string;

  @IsDateString()
  startAt: string;

  @IsOptional()
  @IsString()
  startAtLocal?: string;

  @IsOptional()
  @IsString()
  dailyStartTime?: string;

  @IsOptional()
  @IsString()
  dailyEndTime?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => ScheduleBreakPeriodDto)
  breakPeriods?: ScheduleBreakPeriodDto[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  matchMinutes?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  breakMinutes?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  venueIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  eventTypeOrder?: string[];

  @IsOptional()
  @IsBoolean()
  overrideMatchMinutes?: boolean;

  @IsOptional()
  @IsBoolean()
  prioritizeSecondStage?: boolean;

  // first：小组赛及单循环、单淘汰等单阶段赛制；second：两阶段赛制的后一阶段（淘汰 / 排位）。
  @IsOptional()
  @IsIn(['all', 'first', 'second'])
  scheduleStage?: 'all' | 'first' | 'second';

  // 只排这几个单项（不含团体赛）；优先于 eventId。不传按 eventId，再不传为全部单项和团体赛。
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  eventIds?: string[];

  // 「全部场次」时第二阶段另定开始时间（不紧接第一阶段）；不传为紧接。
  @IsOptional()
  @IsDateString()
  secondStageStartAt?: string;

  @IsOptional()
  @IsString()
  secondStageStartAtLocal?: string;

  // 只排还没安排场地和时间的场次，已排好的不动。
  @IsOptional()
  @IsBoolean()
  onlyUnscheduled?: boolean;

  // 同一运动员两场比赛之间至少休息几分钟；0 或不传为只要不同时上场即可。
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(600)
  playerRestMinutes?: number;
}

export class ClearScheduleDto {
  @IsOptional()
  @IsBoolean()
  includeLocked?: boolean;
  @IsString()
  tournamentId: string;

  @IsOptional()
  @IsString()
  eventId?: string;
}

export class UpdateMatchScheduleDto {
  @IsOptional()
  @IsBoolean()
  scheduleLocked?: boolean;

  @IsOptional()
  @IsBoolean()
  allowOutsideGroup?: boolean;

  @IsOptional()
  @IsBoolean()
  findNextAvailable?: boolean;
  @IsOptional()
  @IsString()
  venueId?: string | null;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string | null;

  @IsOptional()
  @IsString()
  scheduledAtLocal?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  durationMinutes?: number;
}

export class GroupVenueRuleDto {
  @IsString()
  groupId: string;

  @IsBoolean()
  restrictVenues: boolean;

  @IsArray()
  @IsString({ each: true })
  venueIds: string[];

  // 本组比赛日期（YYYY-MM-DD，比赛地日期），空数组表示不限；必须在赛事日期内。
  // 旧客户端不传时保持原值。
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(366)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { each: true, message: '比赛日期格式应为 YYYY-MM-DD' })
  playDates?: string[];
}

export class EventVenueRuleDto {
  @IsString()
  eventId: string;

  // INHERIT 沿用组别；ALL 忽略组别限制；SPECIFIED 使用 venueIds。
  @IsEnum(VenueRuleMode)
  venueRule: VenueRuleMode;

  @IsArray()
  @IsString({ each: true })
  venueIds: string[];
}

export class SaveGroupVenuesDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => GroupVenueRuleDto)
  groups: GroupVenueRuleDto[];

  // 单项级规则，优先于组别。旧客户端不传时保持现有单项规则不变。
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => EventVenueRuleDto)
  events?: EventVenueRuleDto[];
}

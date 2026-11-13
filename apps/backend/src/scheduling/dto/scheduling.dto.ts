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

  @IsOptional()
  @IsIn(['all', 'first', 'second'])
  scheduleStage?: 'all' | 'first' | 'second';
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

import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
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
}

export class SaveGroupVenuesDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => GroupVenueRuleDto)
  groups: GroupVenueRuleDto[];
}

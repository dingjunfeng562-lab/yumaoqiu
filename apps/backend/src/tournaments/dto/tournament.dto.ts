import {
  ArrayMinSize,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { EventType, TournamentStatus } from '@prisma/client';

export class CreateTournamentDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  edition?: number;

  @IsString()
  @MinLength(1)
  organizer: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(EventType, { each: true })
  eventTypes: EventType[];

  @IsBoolean()
  includeTeamCompetition: boolean;

  @IsOptional()
  @IsIn([2, 3])
  teamWinThreshold?: 2 | 3;

  @IsOptional()
  @IsArray()
  @IsEnum(EventType, { each: true })
  teamEventTypes?: EventType[];

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  maxRegistrationEvents: number;

  @IsBoolean()
  allowCrossEventRegistration: boolean;

  @IsBoolean()
  needsRegistrationReview: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  venueNames: string[];

  @Type(() => Number)
  @IsInt()
  @Min(1)
  defaultMatchMinutes: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  breakMinutes: number;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  dailyStartTime: string;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  dailyEndTime: string;

  @IsOptional()
  @IsString()
  subtitle?: string;

  @IsOptional()
  @IsString()
  coverImageUrl?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  projectText?: string;

  @IsOptional()
  @IsString()
  formatText?: string;

  @IsOptional()
  @IsDateString()
  registrationStartDate?: string;

  @IsOptional()
  @IsDateString()
  registrationEndDate?: string;

  @IsOptional()
  @IsEnum(TournamentStatus)
  status?: TournamentStatus;

  @IsOptional()
  @IsString()
  rules?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  registrationNotice?: string;

  @IsOptional()
  @IsBoolean()
  showOnHome?: boolean;
}

export class UpdateTournamentDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  edition?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  organizer?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(EventType, { each: true })
  eventTypes?: EventType[];

  @IsOptional()
  @IsBoolean()
  includeTeamCompetition?: boolean;

  @IsOptional()
  @IsIn([2, 3])
  teamWinThreshold?: 2 | 3;

  @IsOptional()
  @IsArray()
  @IsEnum(EventType, { each: true })
  teamEventTypes?: EventType[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  maxRegistrationEvents?: number;

  @IsOptional()
  @IsBoolean()
  allowCrossEventRegistration?: boolean;

  @IsOptional()
  @IsBoolean()
  needsRegistrationReview?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  venueNames?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  defaultMatchMinutes?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  breakMinutes?: number;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  dailyStartTime?: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  dailyEndTime?: string;

  @IsOptional()
  @IsString()
  subtitle?: string;

  @IsOptional()
  @IsString()
  coverImageUrl?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  projectText?: string;

  @IsOptional()
  @IsString()
  formatText?: string;

  @IsOptional()
  @IsDateString()
  registrationStartDate?: string;

  @IsOptional()
  @IsDateString()
  registrationEndDate?: string;

  @IsOptional()
  @IsEnum(TournamentStatus)
  status?: TournamentStatus;

  @IsOptional()
  @IsString()
  rules?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  registrationNotice?: string;

  @IsOptional()
  @IsBoolean()
  showOnHome?: boolean;

  @IsOptional()
  isArchived?: boolean;
}

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
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { EventType, TournamentStatus, ScoringRule, ScoringMode } from '@prisma/client';

export type RegistrationFieldState = 'required' | 'optional' | 'hidden';

export class SchoolRegistrationFieldRulesDto {
  @IsOptional()
  @IsIn(['required', 'optional', 'hidden'])
  studentId?: RegistrationFieldState;

  @IsOptional()
  @IsIn(['required', 'optional', 'hidden'])
  college?: RegistrationFieldState;

  @IsOptional()
  @IsIn(['required', 'optional', 'hidden'])
  majorGrade?: RegistrationFieldState;
}

export class SocialRegistrationFieldRulesDto {
  @IsOptional()
  @IsIn(['required', 'optional', 'hidden'])
  email?: RegistrationFieldState;
}

export class RegistrationFieldRulesDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => SchoolRegistrationFieldRulesDto)
  SCHOOL?: SchoolRegistrationFieldRulesDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => SocialRegistrationFieldRulesDto)
  SOCIAL?: SocialRegistrationFieldRulesDto;
}

export class CreateTournamentDto {
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  teamPlayAllMatches?: boolean;

  @ValidateIf((_, value) => value !== undefined)
  @IsIn([0, 1, 2])
  teamMaxPlayerAppearances?: 0 | 1 | 2;

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

  // 兼容旧客户端：只传 eventTypes 时等同学生组单项。
  @IsOptional()
  @IsArray()
  @IsEnum(EventType, { each: true })
  eventTypes?: EventType[];

  @IsOptional()
  @IsArray()
  @IsEnum(EventType, { each: true })
  schoolEventTypes?: EventType[];

  @IsOptional()
  @IsArray()
  @IsEnum(EventType, { each: true })
  socialEventTypes?: EventType[];

  @IsBoolean()
  includeTeamCompetition: boolean;

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
  @Min(0)
  teamMalePlayerCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  teamFemalePlayerCount?: number;

  @IsOptional()
  @IsEnum(ScoringRule)
  teamScoringRule?: ScoringRule;

  @IsOptional()
  @IsEnum(ScoringMode)
  teamScoringMode?: ScoringMode;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  maxRegistrationEvents: number;

  @IsBoolean()
  allowCrossEventRegistration: boolean;

  @IsBoolean()
  needsRegistrationReview: boolean;

  @IsOptional()
  @IsBoolean()
  allowSchoolRegistration?: boolean;

  @IsOptional()
  @IsBoolean()
  allowSocialRegistration?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => RegistrationFieldRulesDto)
  registrationFieldRules?: RegistrationFieldRulesDto;

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
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  teamPlayAllMatches?: boolean;

  @ValidateIf((_, value) => value !== undefined)
  @IsIn([0, 1, 2])
  teamMaxPlayerAppearances?: 0 | 1 | 2;

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
  @IsArray()
  @IsEnum(EventType, { each: true })
  schoolEventTypes?: EventType[];

  @IsOptional()
  @IsArray()
  @IsEnum(EventType, { each: true })
  socialEventTypes?: EventType[];

  @IsOptional()
  @IsBoolean()
  allowSchoolRegistration?: boolean;

  @IsOptional()
  @IsBoolean()
  allowSocialRegistration?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => RegistrationFieldRulesDto)
  registrationFieldRules?: RegistrationFieldRulesDto;

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
  @Min(0)
  teamMalePlayerCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  teamFemalePlayerCount?: number;

  @IsOptional()
  @IsEnum(ScoringRule)
  teamScoringRule?: ScoringRule;

  @IsOptional()
  @IsEnum(ScoringMode)
  teamScoringMode?: ScoringMode;

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
  @IsBoolean()
  isArchived?: boolean;
}

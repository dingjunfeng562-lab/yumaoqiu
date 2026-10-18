import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
  Max,
  MaxLength,
  ValidateNested,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { EventType, Gender, ScoringMode, ScoringRule } from '@prisma/client';

export class TeamScoringDto {
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  playAllMatches?: boolean;

  @IsOptional()
  @IsEnum(ScoringRule)
  scoringRule?: ScoringRule;

  @IsOptional()
  @IsEnum(ScoringMode)
  scoringMode?: ScoringMode;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(999)
  customGamePoint?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(999)
  customGameCap?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(9)
  customGamesToWin?: number | null;
}

export class TeamCompetitionItemDto {
  @IsEnum(EventType)
  eventType: EventType;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  sortOrder: number;
}

export class CreateTeamCompetitionDto extends TeamScoringDto {
  @ValidateIf((_, value) => value !== undefined)
  @IsIn([0, 1, 2])
  maxPlayerAppearances?: 0 | 1 | 2;

  // Accepted for older clients; roster sizes are no longer enforced.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  malePlayerCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  femalePlayerCount?: number;

  @IsString()
  @MinLength(1)
  tournamentId: string;

  @IsString()
  @MinLength(1)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  winThreshold: number;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TeamCompetitionItemDto)
  items: TeamCompetitionItemDto[];
}

export class UpdateTeamCompetitionDto extends TeamScoringDto {
  @ValidateIf((_, value) => value !== undefined)
  @IsIn([0, 1, 2])
  maxPlayerAppearances?: 0 | 1 | 2;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  malePlayerCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  femalePlayerCount?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  winThreshold?: number;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TeamCompetitionItemDto)
  items?: TeamCompetitionItemDto[];
}

export class TeamPlayerInputDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsEnum(Gender)
  gender: Gender;

  @IsString()
  @MinLength(1)
  affiliation: string;

  @IsOptional()
  @IsString()
  contact?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateTeamDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsString()
  @MinLength(1)
  affiliation: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  playerIds: string[];
}

export class UpdateTeamDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  affiliation?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class ReplaceTeamMembersDto {
  @IsOptional()
  @IsBoolean()
  overrideConfirmed?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  playerIds: string[];
}

export class AddTeamPlayersDto {
  @IsBoolean()
  overrideConfirmed: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TeamPlayerInputDto)
  players: TeamPlayerInputDto[];
}

export class ImportTeamPlayersDto {
  @IsString()
  @MinLength(1)
  teamName: string;

  @IsString()
  @MinLength(1)
  affiliation: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TeamPlayerInputDto)
  players: TeamPlayerInputDto[];
}

export class BatchTeamPlayerDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  teamName: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @IsEnum(Gender)
  gender: Gender;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  affiliation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  contact?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  lineNumber?: number;
}

export class BatchImportTeamsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BatchTeamPlayerDto)
  players: BatchTeamPlayerDto[];
}

export class ParseQuickTeamDto {
  @IsString()
  @MinLength(1)
  teamName: string;

  @IsString()
  @MinLength(1)
  affiliation: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsString()
  @MinLength(1)
  prompt: string;
}

export class GenerateTeamDrawDto {
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

export class TeamLineupSelectionDto {
  @IsString()
  teamId: string;

  @IsString()
  teamCompetitionItemId: string;

  @IsString()
  player1Id: string;

  @IsOptional()
  @IsString()
  player2Id?: string;
}

export class SetTeamLineupsDto {
  @IsOptional()
  @IsBoolean()
  overrideConfirmed?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TeamLineupSelectionDto)
  selections: TeamLineupSelectionDto[];

  @IsOptional()
  @IsBoolean()
  lock?: boolean;
}

export class AssignTeamMatchRefereeDto {
  @IsString()
  refereeId: string;
}

export class TeamCompetitionQueryDto {
  @IsOptional()
  @IsString()
  tournamentId?: string;
}

export class TeamMatchLineupQueryDto {
  @IsOptional()
  @IsBoolean()
  lockedOnly?: boolean;
}

export class QuickParsedAssignmentDto {
  @IsEnum(EventType)
  eventType: EventType;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  names: string[];
}

export class QuickTeamPreviewDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuickParsedAssignmentDto)
  assignments: QuickParsedAssignmentDto[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  benchNames?: string[];
}

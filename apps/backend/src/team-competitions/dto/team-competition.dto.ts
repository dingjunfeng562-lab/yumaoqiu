import {
  ArrayMaxSize,
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
import { EntrantType, EventType, Gender, ScoringMode, ScoringRule, TeamCompetitionFormat, TeamThirdPlaceMode } from '@prisma/client';

/** 团体赛每场最多的出场项目数（同一项目可重复出现）。前端 TeamCompetitionFields 保持一致。 */
export const TEAM_ITEM_MAX = 7;

// 团体赛赛制：SINGLE_ELIMINATION 单淘汰 / ROUND_ROBIN 单组循环 /
// GROUP_ROUND_ROBIN 多组循环 / GROUP_PLUS_KNOCKOUT 小组+淘汰
export { TeamCompetitionFormat, TeamThirdPlaceMode };

export class TeamScoringDto {
  /** 淘汰赛第三名：BY_RECORD 按成绩排定 / SHARED 并列第三 / PLAYOFF 加赛季军赛。新建和修改共用。 */
  @IsOptional()
  @IsEnum(TeamThirdPlaceMode)
  thirdPlaceMode?: TeamThirdPlaceMode;

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
  @IsOptional() @IsString() groupId?: string;
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

  @IsOptional()
  @IsEnum(EntrantType)
  entrantType?: EntrantType;

  // 团体赛不再单独起名：不传时自动取「组别名团体赛」（每个组别最多一个团体赛）。旧客户端传了仍可用。
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

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

  // 新增：赛制类型
  @IsOptional()
  @IsEnum(TeamCompetitionFormat)
  format?: TeamCompetitionFormat;

  // 新增：小组赛配置
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(26) // 最多26组（A-Z）
  groupCount?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  teamsPerGroup?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  advancePerGroup?: number | null;

  // 出场项目最多 7 项，同一项目可以重复（如三单两双）。
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(TEAM_ITEM_MAX, { message: `出场项目最多 ${TEAM_ITEM_MAX} 项` })
  @ValidateNested({ each: true })
  @Type(() => TeamCompetitionItemDto)
  items: TeamCompetitionItemDto[];
}

export class UpdateTeamCompetitionDto extends TeamScoringDto {
  @ValidateIf((_, value) => value !== undefined)
  @IsIn([0, 1, 2])
  maxPlayerAppearances?: 0 | 1 | 2;

  @IsOptional()
  @IsEnum(EntrantType)
  entrantType?: EntrantType;

  /** 仅用于请求：把已取消、尚未开赛的剩余子项恢复为未开始，便于开启“打满所有子项”后补录。 */
  @IsOptional()
  @IsBoolean()
  reopenCancelledChildren?: boolean;

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

  // 新增：赛制配置更新
  @IsOptional()
  @IsEnum(TeamCompetitionFormat)
  format?: TeamCompetitionFormat;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(26)
  groupCount?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  teamsPerGroup?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  advancePerGroup?: number | null;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(TEAM_ITEM_MAX, { message: `出场项目最多 ${TEAM_ITEM_MAX} 项` })
  @ValidateNested({ each: true })
  @Type(() => TeamCompetitionItemDto)
  items?: TeamCompetitionItemDto[];
}

export class TeamPlayerInputDto {
  @IsOptional() @IsString() identityNumber?: string;
  @IsString()
  @MinLength(1)
  name: string;

  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

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
  @IsOptional() @IsString() identityNumber?: string;
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  teamName: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

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

// 小组赛相关DTO

export class GenerateGroupDrawDto {
  @IsOptional()
  @IsBoolean()
  force?: boolean;

  @IsOptional()
  @IsEnum(TeamCompetitionFormat)
  format?: TeamCompetitionFormat;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(26)
  groupCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  advancePerGroup?: number;
}

export class AdjustGroupsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => GroupAdjustmentDto)
  groups: GroupAdjustmentDto[];
}

export class GroupAdjustmentDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  groupNo: number;

  @IsArray()
  @IsString({ each: true })
  teamIds: string[];
}

export class GenerateKnockoutFromGroupsDto {
  @IsOptional()
  @IsBoolean()
  force?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(1)
  knockoutFormat?: string; // 例如："直接淘汰", "交叉淘汰"
}

export class CreateTeamDrawClearRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class RejectTeamDrawClearRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}


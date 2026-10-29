import { MatchEventType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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

export class AuthorizeRefereeTournamentDto {
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  accessCode: string;
}

export class ScorePointDto {
  @IsIn([1, 2])
  side: 1 | 2;
}

export class StartWarmupDto {
  /** 赛前练球时长（秒），默认 3 分钟，裁判可在 1–5 分钟之间调整。 */
  @Type(() => Number)
  @IsInt()
  @Min(60)
  @Max(300)
  seconds: number;
}

export class UndoPointDto {
  /** 裁判点某一方的「-1」时带上，后端校验最近一分确实是这一方得的。 */
  @IsOptional()
  @IsIn([1, 2])
  side?: 1 | 2;
}

export class AssignRefereeDto {
  @IsString()
  refereeId: string;
}

export class CorrectGameScoreDto {
  @IsInt()
  @Min(0)
  @Max(999)
  side1Score: number;

  @IsInt()
  @Min(0)
  @Max(999)
  side2Score: number;
}

export class CorrectMatchScoreDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(9)
  @ValidateNested({ each: true })
  @Type(() => CorrectGameScoreDto)
  games: CorrectGameScoreDto[];
}

export class StartMatchDto {
  @IsIn([1, 2])
  servingSide: 1 | 2;

  @IsIn([1, 2])
  serverPlayerIndex: 1 | 2;

  @IsIn([1, 2])
  receiverPlayerIndex: 1 | 2;
}

/** 裁判在「当前这一局」核对/修改发球员与接发球员（发球方由上一局胜方决定，不可改）。 */
export class SetGameServeDto {
  @IsInt()
  @Min(1)
  @Max(9)
  gameNo: number;

  @IsIn([1, 2])
  serverPlayerIndex: 1 | 2;

  @IsIn([1, 2])
  receiverPlayerIndex: 1 | 2;
}

export class LogMatchEventDto {
  @IsEnum(MatchEventType)
  type: Exclude<MatchEventType, 'POINT' | 'UNDO'>;

  @IsOptional()
  @IsIn([1, 2])
  side?: 1 | 2;

  @IsOptional()
  @IsString()
  note?: string;
}

export class PauseMatchDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

export class ForfeitMatchDto {
  @IsIn([1, 2])
  side: 1 | 2;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class RetireMatchDto {
  @IsIn([1, 2])
  side: 1 | 2;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class FaultMatchDto {
  @IsIn([1, 2])
  side: 1 | 2;

  @IsOptional()
  @IsIn([1, 2])
  playerIndex?: 1 | 2;

  @IsString()
  faultType: string;
}

export class CardMatchDto {
  @IsIn([1, 2])
  side: 1 | 2;

  @IsOptional()
  @IsIn([1, 2])
  playerIndex?: 1 | 2;

  @IsIn(['yellow', 'red', 'black'])
  cardType: 'yellow' | 'red' | 'black';

  @IsOptional()
  @IsString()
  reason?: string;
}

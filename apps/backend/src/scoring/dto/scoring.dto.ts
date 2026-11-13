import { MatchEventType } from '@prisma/client';
import { Type } from 'class-transformer';
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
  Matches,
  Max,
  MaxLength,
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

  /** A 方开赛时站哪半场；不传按左半场，'right' 时后端记一条换边事件。 */
  @IsOptional()
  @IsIn(['left', 'right'])
  side1CourtSide?: 'left' | 'right';
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

/**
 * 比赛结束签字：PNG 的 data URL。赛事开启「比赛结束需签字」时由裁判端提交，
 * 胜方（双打为其中一人）和裁判各一张；双方弃权没有胜方，只交裁判签名。
 * 必须声明在使用它的 DTO 之前（装饰器元数据在类定义时就会引用它）。
 */
export class MatchSignaturesDto {
  @IsOptional()
  @IsString()
  @MaxLength(100000)
  winnerSignature?: string;

  @IsOptional()
  @IsIn([1, 2])
  winnerSignerIndex?: 1 | 2;

  @IsOptional()
  @IsString()
  @MaxLength(100000)
  refereeSignature?: string;
}

export class FinishMatchDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => MatchSignaturesDto)
  signatures?: MatchSignaturesDto;
}

export class ForfeitBothDto {
  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => MatchSignaturesDto)
  signatures?: MatchSignaturesDto;
}

export class MatchSignatureSettingDto {
  @IsBoolean()
  enabled: boolean;
}

export class ForfeitMatchDto {
  @IsIn([1, 2])
  side: 1 | 2;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => MatchSignaturesDto)
  signatures?: MatchSignaturesDto;
}

export class RetireMatchDto {
  @IsIn([1, 2])
  side: 1 | 2;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => MatchSignaturesDto)
  signatures?: MatchSignaturesDto;
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

  /** 黑牌会直接判对方胜，赛事要求签字时随黑牌一起提交。 */
  @IsOptional()
  @ValidateNested()
  @Type(() => MatchSignaturesDto)
  signatures?: MatchSignaturesDto;
}

import { MatchEventType } from '@prisma/client';
import { IsEnum, IsIn, IsOptional, IsString } from 'class-validator';

export class ScorePointDto {
  @IsIn([1, 2])
  side: 1 | 2;
}

export class AssignRefereeDto {
  @IsString()
  refereeId: string;
}

export class StartMatchDto {
  @IsIn([1, 2])
  servingSide: 1 | 2;

  @IsIn([1, 2])
  serverPlayerIndex: 1 | 2;

  @IsIn([1, 2])
  receiverPlayerIndex: 1 | 2;

  @IsOptional()
  @IsIn([1, 2])
  side1LeftPlayerIndex?: 1 | 2;

  @IsOptional()
  @IsIn([1, 2])
  side1RightPlayerIndex?: 1 | 2;

  @IsOptional()
  @IsIn([1, 2])
  side2LeftPlayerIndex?: 1 | 2;

  @IsOptional()
  @IsIn([1, 2])
  side2RightPlayerIndex?: 1 | 2;
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

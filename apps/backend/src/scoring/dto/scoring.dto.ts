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

export class ForfeitMatchDto {
  @IsIn([1, 2])
  side: 1 | 2;

  @IsOptional()
  @IsString()
  reason?: string;
}

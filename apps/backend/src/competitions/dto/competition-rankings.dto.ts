import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsNotEmpty, IsString, Max, Min, ValidateIf, ValidateNested } from 'class-validator';

class FinalRankingEntryDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @ValidateIf((_object, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(9999)
  rank: number | null;
}

export class UpdateCompetitionRankingsDto {
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsInt()
  @Min(1)
  @Max(9999)
  rankingLimit?: number | null;

  @IsIn(['event', 'team'])
  kind: 'event' | 'team';

  @IsString()
  @IsNotEmpty()
  groupId: string;

  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => FinalRankingEntryDto)
  entries: FinalRankingEntryDto[];
}

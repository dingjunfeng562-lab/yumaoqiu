import { ArrayUnique, IsArray, IsIn, IsString, Length } from 'class-validator';
import { COMPETITION_ORDER_MODES, type CompetitionOrderMode } from '../competition-order';

export class UpdateCompetitionOrderDto {
  @IsIn(COMPETITION_ORDER_MODES)
  mode: CompetitionOrderMode;

  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @Length(1, 191, { each: true })
  orderedIds: string[];
}

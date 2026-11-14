import { IsBoolean, IsIn, IsString, Length } from 'class-validator';

export class SetCheckInDto {
  @IsIn(['1', '2', 'both'])
  side!: '1' | '2' | 'both';

  @IsBoolean()
  checked!: boolean;

  // Guard against an open drawer referring to an earlier pairing.
  @IsString()
  @Length(64, 64)
  side1Key!: string;

  @IsString()
  @Length(64, 64)
  side2Key!: string;
}

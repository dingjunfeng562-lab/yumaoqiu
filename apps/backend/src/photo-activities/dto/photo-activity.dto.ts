import { IsIn, IsISO8601, IsString, MaxLength, ValidateIf } from 'class-validator';

export class CreatePhotoActivityDto {
  @IsString()
  @MaxLength(120)
  title: string;

  @IsIn(['SINGLE', 'RANGE'])
  dateMode: 'SINGLE' | 'RANGE';

  @IsISO8601({ strict: true })
  startAt: string;

  @ValidateIf((value: CreatePhotoActivityDto) => value.dateMode === 'RANGE')
  @IsISO8601({ strict: true })
  endAt?: string;
}

export class RejectPhotoActivityDto {
  @IsString()
  @MaxLength(500)
  reason: string;
}

import { IsBoolean, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';

export class UpdateImageModerationDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  enabled?: boolean;

  // Blank means keep the stored key. Reject control characters in HTTP credentials.
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(512)
  @Matches(/^[\x20-\x7e]*$/)
  apiKey?: string;
}

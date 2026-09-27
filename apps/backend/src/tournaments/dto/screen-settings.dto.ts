import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class ScreenSettingsDto {
  @IsInt()
  @Min(1)
  @Max(8)
  columns: number;

  @IsInt()
  @Min(1)
  @Max(8)
  rows: number;

  @IsInt()
  @Min(50)
  @Max(200)
  scale: number;

  @IsInt()
  @Min(20)
  @Max(120)
  titleFontSize: number;

  @IsOptional()
  @IsInt()
  @Min(240)
  @Max(1200)
  cardWidth?: number;

  @IsOptional()
  @IsInt()
  @Min(160)
  @Max(900)
  cardHeight?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(160)
  boundaryPadding?: number;

  @IsOptional()
  @IsInt()
  @Min(50)
  @Max(160)
  cardFontScale?: number;
}

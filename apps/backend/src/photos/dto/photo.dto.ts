import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
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
import { Type } from 'class-transformer';
import { PhotoCategory } from '@prisma/client';

const CATEGORIES: PhotoCategory[] = ['PLAYER', 'MATCH', 'AWARD'];

export class UploadPhotosDto {
  @IsString()
  tournamentId: string;

  @IsIn(CATEGORIES)
  category: PhotoCategory;
}

export class PublicPhotoQueryDto {
  @IsString()
  tournamentId: string;

  @IsOptional()
  @IsIn(CATEGORIES)
  category?: PhotoCategory;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class AdminPhotoQueryDto {
  @IsString()
  tournamentId: string;

  @IsOptional()
  @IsIn(CATEGORIES)
  category?: PhotoCategory;

  @IsOptional()
  @IsString()
  uploaderId?: string;

  /** ISO date strings; inclusive range on uploadedAt. */
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}

export class WatermarkLogoDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  order: number;

  /** uploads-relative path, e.g. photos/<tid>/logos/<uuid>.png */
  @IsString()
  path: string;

  @IsOptional()
  @IsString()
  filename?: string;
}

export class UpdateWatermarkDto {
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => WatermarkLogoDto)
  logos: WatermarkLogoDto[];

  /** Logo height as a percentage of the image height (2–80). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(80)
  logoHeightPercent?: number;

  /** Gap between logos as a percentage of the logo height (0–200). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(200)
  logoGapPercent?: number;

  /** Watermark corner position. */
  @IsOptional()
  @IsIn(['TOP_LEFT', 'TOP_RIGHT', 'BOTTOM_LEFT', 'BOTTOM_RIGHT'])
  position?: 'TOP_LEFT' | 'TOP_RIGHT' | 'BOTTOM_LEFT' | 'BOTTOM_RIGHT';

  /** Watermark corner position for portrait photos. */
  @IsOptional()
  @IsIn(['TOP_LEFT', 'TOP_RIGHT', 'BOTTOM_LEFT', 'BOTTOM_RIGHT'])
  portraitPosition?: 'TOP_LEFT' | 'TOP_RIGHT' | 'BOTTOM_LEFT' | 'BOTTOM_RIGHT';

  /** Text watermark content; empty string clears it. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  text?: string;

  /** Text color as #RGB or #RRGGBB hex. */
  @IsOptional()
  @IsString()
  @Matches(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, { message: '文字颜色必须是 #RGB 或 #RRGGBB 十六进制' })
  textColor?: string;

  /** Text height as a percentage of the image height (2–80). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(80)
  textSizePercent?: number;

  /** Text watermark corner position for landscape photos. */
  @IsOptional()
  @IsIn(['TOP_LEFT', 'TOP_RIGHT', 'BOTTOM_LEFT', 'BOTTOM_RIGHT'])
  textPosition?: 'TOP_LEFT' | 'TOP_RIGHT' | 'BOTTOM_LEFT' | 'BOTTOM_RIGHT';

  /** Text watermark corner position for portrait photos. */
  @IsOptional()
  @IsIn(['TOP_LEFT', 'TOP_RIGHT', 'BOTTOM_LEFT', 'BOTTOM_RIGHT'])
  textPortraitPosition?: 'TOP_LEFT' | 'TOP_RIGHT' | 'BOTTOM_LEFT' | 'BOTTOM_RIGHT';
}

export class BatchDeletePhotosDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  ids: string[];
}

export class DeleteTournamentPhotosDto {
  @IsString()
  confirmName: string;
}

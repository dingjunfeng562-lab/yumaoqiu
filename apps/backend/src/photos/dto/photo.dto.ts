import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
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

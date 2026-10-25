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
/** A legacy corner name, or a free "x,y" center in percentages. */
const WATERMARK_POSITION_PATTERN =
  /^(TOP_LEFT|TOP_RIGHT|BOTTOM_LEFT|BOTTOM_RIGHT|-?\d{1,3}(?:\.\d+)?,-?\d{1,3}(?:\.\d+)?)$/;

export enum PublicPhotoSort {
  POPULAR = 'POPULAR',
  DOWNLOADS = 'DOWNLOADS',
  LATEST = 'LATEST',
}

export class UploadPhotosDto {
  @IsIn(['TOURNAMENT', 'ACTIVITY'])
  targetType: 'TOURNAMENT' | 'ACTIVITY';

  @IsString()
  targetId: string;

  @IsIn(CATEGORIES)
  category: PhotoCategory;
}

export class PublicPhotoQueryDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{32,64}$/, { message: '图片访问地址无效' })
  accessToken: string;

  @IsOptional()
  @IsIn(Object.values(PublicPhotoSort))
  sort?: PublicPhotoSort;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  direction?: 'asc' | 'desc';

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
  @IsOptional()
  @IsString()
  tournamentId?: string;

  @IsOptional()
  @IsString()
  activityId?: string;

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

  /** Logo height as a percentage of the image's shorter edge (2–80). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(80)
  logoHeightPercent?: number;

  /** Portrait-only logo height, as a percentage of the shorter edge (2–80). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(80)
  portraitLogoHeightPercent?: number;

  /** Gap between logos as a percentage of the logo height (0–200). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(200)
  logoGapPercent?: number;

  /** Portrait-only gap between logos (0–200). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(200)
  portraitLogoGapPercent?: number;

  /** Watermark position: a legacy corner name or an "x,y" center. */
  @IsOptional()
  @IsString()
  @Matches(WATERMARK_POSITION_PATTERN, { message: '位置必须是四角名称或 x,y 坐标' })
  position?: string;

  /** Watermark position for portrait photos. */
  @IsOptional()
  @IsString()
  @Matches(WATERMARK_POSITION_PATTERN, { message: '位置必须是四角名称或 x,y 坐标' })
  portraitPosition?: string;

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

  /** Text height as a percentage of the image's shorter edge (2–80). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(80)
  textSizePercent?: number;

  /** Portrait-only text height, as a percentage of the shorter edge (2–80). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(80)
  portraitTextSizePercent?: number;

  /** Text font: HEITI (黑体), SONGTI (宋体), KAITI (楷体). */
  @IsOptional()
  @IsIn(['HEITI', 'SONGTI', 'KAITI'])
  textFont?: 'HEITI' | 'SONGTI' | 'KAITI';

  /** Text watermark position (kept for older clients; text follows the logo). */
  @IsOptional()
  @IsString()
  @Matches(WATERMARK_POSITION_PATTERN, { message: '位置必须是四角名称或 x,y 坐标' })
  textPosition?: string;

  /** Text watermark position for portrait photos. */
  @IsOptional()
  @IsString()
  @Matches(WATERMARK_POSITION_PATTERN, { message: '位置必须是四角名称或 x,y 坐标' })
  textPortraitPosition?: string;
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

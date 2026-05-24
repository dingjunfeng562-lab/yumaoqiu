import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const ANNOUNCEMENT_TYPES = ['normal', 'event', 'maintenance', 'urgent'] as const;
export const ANNOUNCEMENT_DISPLAY_MODES = ['popup', 'banner'] as const;
export const ANNOUNCEMENT_SCOPES = ['global', 'home'] as const;
export const ANNOUNCEMENT_FREQUENCIES = ['every_visit', 'once_per_day', 'once'] as const;
export const ANNOUNCEMENT_STATUSES = ['draft', 'published', 'disabled'] as const;

export type AnnouncementStatus = (typeof ANNOUNCEMENT_STATUSES)[number];

export class CreateAnnouncementDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title: string;

  @IsString()
  @MinLength(1)
  content: string;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  type?: string;

  @IsOptional()
  @IsIn(ANNOUNCEMENT_DISPLAY_MODES)
  displayMode?: string;

  @IsOptional()
  @IsIn(ANNOUNCEMENT_SCOPES)
  scope?: string;

  @IsOptional()
  @IsIn(ANNOUNCEMENT_FREQUENCIES)
  frequency?: string;

  @IsOptional()
  @IsIn(ANNOUNCEMENT_STATUSES)
  status?: AnnouncementStatus;

  @IsOptional()
  @IsDateString()
  startAt?: string | null;

  @IsOptional()
  @IsDateString()
  endAt?: string | null;

  @IsOptional()
  @IsBoolean()
  closable?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  primaryButtonText?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  primaryButtonLink?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  secondaryButtonText?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @IsOptional()
  @IsBoolean()
  isPinned?: boolean;

  @IsOptional()
  @IsBoolean()
  showAsPopup?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsDateString()
  publishedAt?: string | null;

  @IsOptional()
  @IsDateString()
  expiresAt?: string | null;
}

export class UpdateAnnouncementDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  content?: string;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  type?: string;

  @IsOptional()
  @IsIn(ANNOUNCEMENT_DISPLAY_MODES)
  displayMode?: string;

  @IsOptional()
  @IsIn(ANNOUNCEMENT_SCOPES)
  scope?: string;

  @IsOptional()
  @IsIn(ANNOUNCEMENT_FREQUENCIES)
  frequency?: string;

  @IsOptional()
  @IsIn(ANNOUNCEMENT_STATUSES)
  status?: AnnouncementStatus;

  @IsOptional()
  @IsDateString()
  startAt?: string | null;

  @IsOptional()
  @IsDateString()
  endAt?: string | null;

  @IsOptional()
  @IsBoolean()
  closable?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  primaryButtonText?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  primaryButtonLink?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  secondaryButtonText?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @IsOptional()
  @IsBoolean()
  isPinned?: boolean;

  @IsOptional()
  @IsBoolean()
  showAsPopup?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsDateString()
  publishedAt?: string | null;

  @IsOptional()
  @IsDateString()
  expiresAt?: string | null;
}

export class UpdateAnnouncementStatusDto {
  @IsIn(['published', 'disabled'])
  status: 'published' | 'disabled';
}

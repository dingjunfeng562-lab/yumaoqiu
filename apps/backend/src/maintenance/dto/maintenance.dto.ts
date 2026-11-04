import {
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateMaintenanceDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  title?: string;

  // 富文本（文字 + 图片地址），保存前按公告的白名单过滤。
  @IsOptional()
  @IsString()
  @MaxLength(60000)
  content?: string;

  // 传 null 表示清除预计恢复时间；不传表示不改。
  @IsOptional()
  @IsDateString()
  expectedEndAt?: string | null;
}

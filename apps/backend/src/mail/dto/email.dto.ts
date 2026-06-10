import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class SendTestMailDto {
  @IsEmail({}, { message: '收件人邮箱格式不正确' })
  to!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  subject?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  content?: string;
}

export class UpdateGlobalSettingsDto {
  @IsBoolean({ message: 'enabled 必须为布尔值' })
  enabled!: boolean;
}

export class UpdateTemplateDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  subject?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000, { message: '模板内容过长' })
  body?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class EventTemplateSettingDto {
  @IsBoolean({ message: 'enabled 必须为布尔值' })
  enabled!: boolean;

  /** 仅赛前提醒使用：比赛开始前多少分钟发送 */
  @IsOptional()
  @IsInt()
  @Min(5, { message: '提醒时间最少为比赛前 5 分钟' })
  @Max(30 * 24 * 60, { message: '提醒时间最多为比赛前 30 天' })
  remindBeforeMinutes?: number;
}

export class UpdateEventEmailSettingsDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => EventTemplateSettingDto)
  registration_submitted?: EventTemplateSettingDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => EventTemplateSettingDto)
  registration_approved?: EventTemplateSettingDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => EventTemplateSettingDto)
  registration_rejected?: EventTemplateSettingDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => EventTemplateSettingDto)
  match_reminder?: EventTemplateSettingDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => EventTemplateSettingDto)
  match_result?: EventTemplateSettingDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => EventTemplateSettingDto)
  custom?: EventTemplateSettingDto;
}

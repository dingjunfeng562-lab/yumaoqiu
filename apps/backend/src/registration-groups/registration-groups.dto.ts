import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsObject, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { EventType } from '@prisma/client';
import { AgeRule, GroupFields } from '../common/age-eligibility';

export class SaveRegistrationGroupDto {
  @IsString() @MinLength(1) @MaxLength(60) name: string;
  @IsOptional() @IsString() @MaxLength(60) categoryLabel?: string;
  // 字段模板不再由管理员选择，服务端按是否收集学号判断；保留参数兼容旧客户端。
  @IsOptional() @IsIn(['GENERAL', 'SCHOOL', 'SOCIAL']) fieldTemplate?: 'GENERAL' | 'SCHOOL' | 'SOCIAL';
  @IsBoolean() enabled: boolean;
  // 组别报名码已不再使用（改为一个赛事一个码），保留参数兼容旧客户端。
  @IsOptional() @IsBoolean() registrationCodeEnabled?: boolean;
  @IsObject() fieldRules: Partial<GroupFields>;
  @IsObject() ageRule: AgeRule;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(5) @ArrayUnique() @IsEnum(EventType, { each: true }) eventTypes: EventType[];
  @IsOptional() @IsBoolean() paymentEnabled?: boolean;
  @IsOptional() @IsInt() @Min(0) singlesFee?: number;
  @IsOptional() @IsInt() @Min(0) doublesFee?: number;
  @IsOptional() @IsInt() @Min(0) teamFee?: number;
  @IsOptional() @IsString() @MaxLength(2000) paymentInstructions?: string;
}

/** 只切换组别报名码的启停，不动组别的其它设置。 */
export class SetGroupCodeEnabledDto {
  @IsBoolean() enabled: boolean;
}

export class VerifyEligibilityDto {
  @IsString() @MinLength(1) @MaxLength(500) note: string;
  @IsOptional() @IsIn(['MALE', 'FEMALE']) gender?: 'MALE' | 'FEMALE';
  @IsOptional() @IsObject() partnerGenders?: Record<string, 'MALE' | 'FEMALE'>;
}

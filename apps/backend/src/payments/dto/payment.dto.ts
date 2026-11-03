import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

// 金额单位为分，上限 10 万元。
const MAX_FEE = 10_000_000;

export class UpdatePaymentSettingDto {
  @IsBoolean()
  enabled: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_FEE)
  singlesFee: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_FEE)
  doublesFee: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_FEE)
  teamFee: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  instructions?: string;
}

export class PaymentEntryDto {
  @IsOptional()
  @IsString()
  registrationId?: string;

  @IsOptional()
  @IsString()
  teamId?: string;
}

export class UpdatePaymentStatusDto {
  @IsIn(['UNPAID', 'PAID', 'WAIVED'])
  status: 'UNPAID' | 'PAID' | 'WAIVED';

  @IsOptional()
  @IsString()
  @MaxLength(255)
  note?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => PaymentEntryDto)
  entries: PaymentEntryDto[];
}

/** 删除缴费行（单项删除报名、团体赛删除队伍），真删除。 */
export class DeletePaymentEntriesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => PaymentEntryDto)
  entries: PaymentEntryDto[];

  @IsOptional()
  @IsString()
  @MaxLength(255)
  note?: string;
}

/** 缴费管理里修改队伍：只改队名、单位、备注。 */
export class UpdatePaymentTeamDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @IsString()
  @MinLength(1)
  @MaxLength(191)
  affiliation: string;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  notes?: string;
}

/** 报名信息修改截止时间，ISO 时间字符串；传 null 或不传表示不限制。 */
export class UpdateEditDeadlineDto {
  @IsOptional()
  @IsDateString()
  deadline?: string | null;
}

export class PaymentLookupQueryDto {
  @IsString()
  @MaxLength(50)
  name: string;

  @IsString()
  @MaxLength(50)
  contact: string;
}

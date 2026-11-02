import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
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

export class PaymentLookupQueryDto {
  @IsString()
  @MaxLength(50)
  name: string;

  @IsString()
  @MaxLength(50)
  contact: string;
}
